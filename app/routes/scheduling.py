from __future__ import annotations

import logging
import time
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.models.database import get_db
from app.models.schemas import BookingResponse, ConversationTurnRequest, MetricsResponse, ScheduleRequest
from app.services.calendar import CalendarService
from app.services.conversation import ConversationManager
from app.services.email_service import EmailService
from app.services.llm import IntentService
from app.services.metrics import MetricsTracker
from app.services.scheduler import book_appointment
from app.services.speech import SpeechToTextService


logger = logging.getLogger("medivoice")
router = APIRouter(tags=["scheduling"])


speech_service = SpeechToTextService()
intent_service = IntentService()
calendar_service = CalendarService()
email_service = EmailService()
conversation_manager = ConversationManager()
metrics_tracker = MetricsTracker()


def _book_from_text(
    *,
    text: str,
    session_id: str,
    patient_email: str,
    db: Session,
    transcript: str | None = None,
) -> BookingResponse:
    intent = intent_service.extract_intent(text)
    state = conversation_manager.upsert_from_intent(session_id, intent)
    missing = state.missing_fields()
    if missing:
        return BookingResponse(
            status="needs_more_info",
            intent=state.as_intent(),
            missing_fields=missing,
            transcript=transcript,
            message=conversation_manager.next_question(missing[0]),
        )

    final_intent = state.as_intent()
    if not final_intent:
        raise HTTPException(status_code=400, detail="Incomplete conversation state.")

    response, start_time, end_time = book_appointment(db, intent=final_intent, patient_email=patient_email)
    if response.status == "booked" and start_time and end_time:
        calendar_service.create_event(
            patient_name=final_intent.patient_name,
            appointment_type=final_intent.appointment_type,
            doctor_id=final_intent.doctor,
            start_time=start_time,
            end_time=end_time,
        )
        email_service.send_confirmation(
            to_email=patient_email,
            patient_name=final_intent.patient_name,
            doctor_id=final_intent.doctor,
            appointment_type=final_intent.appointment_type,
            date_str=start_time.strftime("%Y-%m-%d"),
            time_str=start_time.strftime("%H:%M"),
        )
    response.transcript = transcript
    return response


@router.post("/schedule-from-audio", response_model=BookingResponse)
async def schedule_from_audio(
    audio: UploadFile = File(...),
    session_id: str = Form(default="default-session"),
    patient_email: str = Form(default="test.patient@gmail.com"),
    db: Session = Depends(get_db),
):
    started = time.perf_counter()
    try:
        audio_bytes = await audio.read()
        transcript = speech_service.transcribe(audio_bytes, filename=audio.filename or "audio.wav")
        result = _book_from_text(
            text=transcript,
            session_id=session_id,
            patient_email=patient_email,
            db=db,
            transcript=transcript,
        )
        metrics_tracker.record(success=result.status == "booked", elapsed_seconds=time.perf_counter() - started)
        return result
    except Exception as exc:
        metrics_tracker.record(success=False, elapsed_seconds=time.perf_counter() - started)
        logger.exception("schedule-from-audio failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/schedule-from-text", response_model=BookingResponse)
def schedule_from_text(payload: ScheduleRequest, db: Session = Depends(get_db)):
    started = time.perf_counter()
    session_id = payload.session_id or f"session-{datetime.now().timestamp()}"
    patient_email = payload.patient_email or "test.patient@gmail.com"
    try:
        result = _book_from_text(
            text=payload.text,
            session_id=session_id,
            patient_email=patient_email,
            db=db,
        )
        metrics_tracker.record(success=result.status == "booked", elapsed_seconds=time.perf_counter() - started)
        return result
    except Exception as exc:
        metrics_tracker.record(success=False, elapsed_seconds=time.perf_counter() - started)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/conversation/turn", response_model=BookingResponse)
def conversation_turn(payload: ConversationTurnRequest, db: Session = Depends(get_db)):
    started = time.perf_counter()
    state = conversation_manager.get_or_create(payload.session_id)
    missing = state.missing_fields()
    if not missing:
        return BookingResponse(status="failed", message="Session is already complete.")

    state = conversation_manager.upsert_field(payload.session_id, missing[0], payload.message)
    missing = state.missing_fields()
    if missing:
        metrics_tracker.record(success=False, elapsed_seconds=time.perf_counter() - started)
        return BookingResponse(
            status="needs_more_info",
            message=conversation_manager.next_question(missing[0]),
            missing_fields=missing,
            intent=state.as_intent(),
        )

    final_intent = state.as_intent()
    if not final_intent:
        raise HTTPException(status_code=400, detail="Missing conversation data.")
    patient_email = payload.patient_email or "test.patient@gmail.com"
    response, start_time, _ = book_appointment(db, intent=final_intent, patient_email=patient_email)
    if response.status == "booked" and start_time:
        email_service.send_confirmation(
            to_email=patient_email,
            patient_name=final_intent.patient_name,
            doctor_id=final_intent.doctor,
            appointment_type=final_intent.appointment_type,
            date_str=start_time.strftime("%Y-%m-%d"),
            time_str=start_time.strftime("%H:%M"),
        )
    metrics_tracker.record(success=response.status == "booked", elapsed_seconds=time.perf_counter() - started)
    return response


@router.get("/metrics", response_model=MetricsResponse)
def get_metrics():
    return MetricsResponse(
        total_requests=metrics_tracker.total_requests,
        successful_bookings=metrics_tracker.successful_bookings,
        failed_attempts=metrics_tracker.failed_attempts,
        avg_response_time=metrics_tracker.avg_response_time,
    )
