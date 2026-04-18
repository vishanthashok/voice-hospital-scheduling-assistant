from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models.models import Appointment, Patient
from app.models.schemas import AlternativeSlot, BookingResponse, IntentSchema
from app.utils.datetime_parser import is_within_working_hours, map_time_preference, parse_natural_date


def check_availability(db: Session, doctor_id: str, start_time: datetime) -> bool:
    end_time = start_time + timedelta(minutes=30)
    stmt = select(Appointment).where(
        and_(
            Appointment.doctor_id == doctor_id,
            Appointment.start_time < end_time,
            Appointment.end_time > start_time,
        )
    )
    return db.execute(stmt).scalar_one_or_none() is None


def get_alternatives(db: Session, doctor_id: str, start_time: datetime) -> list[AlternativeSlot]:
    alternatives: list[AlternativeSlot] = []
    cursor = start_time
    while len(alternatives) < 3:
        cursor += timedelta(minutes=30)
        if not is_within_working_hours(cursor):
            next_day = (cursor + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
            cursor = next_day
            continue
        if check_availability(db, doctor_id, cursor):
            alternatives.append(
                AlternativeSlot(
                    doctor_id=doctor_id,
                    start_time=cursor,
                    end_time=cursor + timedelta(minutes=30),
                )
            )
    return alternatives


def _resolve_start_time(intent: IntentSchema) -> datetime | None:
    date_value = parse_natural_date(intent.date)
    time_value = map_time_preference(intent.time_preference)
    if not date_value or not time_value:
        return None
    return datetime.combine(date_value, time_value).replace(second=0, microsecond=0)


def book_appointment(
    db: Session,
    *,
    intent: IntentSchema,
    patient_email: str,
) -> tuple[BookingResponse, datetime | None, datetime | None]:
    start_time = _resolve_start_time(intent)
    if not start_time:
        return (
            BookingResponse(status="failed", message="Invalid date or time preference. Please try again.", intent=intent),
            None,
            None,
        )
    if not is_within_working_hours(start_time):
        return (
            BookingResponse(status="failed", message="Requested slot is outside working hours (9am-5pm).", intent=intent),
            None,
            None,
        )
    if not check_availability(db, intent.doctor, start_time):
        return (
            BookingResponse(
                status="alternatives",
                message="Requested slot is unavailable. Here are the nearest options.",
                intent=intent,
                alternatives=get_alternatives(db, intent.doctor, start_time),
            ),
            start_time,
            start_time + timedelta(minutes=30),
        )

    end_time = start_time + timedelta(minutes=30)
    appointment = Appointment(
        doctor_id=intent.doctor,
        start_time=start_time,
        end_time=end_time,
        patient_name=intent.patient_name,
        appointment_type=intent.appointment_type,
        patient_email=patient_email,
    )
    db.add(appointment)
    patient = db.execute(select(Patient).where(Patient.email == patient_email)).scalar_one_or_none()
    if patient:
        patient.name = intent.patient_name
        patient.preferred_doctor = intent.doctor
    else:
        db.add(Patient(name=intent.patient_name, email=patient_email, preferred_doctor=intent.doctor))

    db.commit()
    db.refresh(appointment)

    return (
        BookingResponse(
            status="booked",
            appointment_id=appointment.id,
            intent=intent,
            message=(
                f"Booked {intent.appointment_type} for {intent.patient_name} with "
                f"{intent.doctor} on {start_time.strftime('%Y-%m-%d %H:%M')}."
            ),
        ),
        start_time,
        end_time,
    )
