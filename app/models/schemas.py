from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class IntentSchema(BaseModel):
    patient_name: str = Field(min_length=1)
    appointment_type: str = Field(min_length=1)
    doctor: str = Field(min_length=1)
    date: str = Field(min_length=1)
    time_preference: str = Field(min_length=1)
    urgency: str = Field(min_length=1)


class ScheduleRequest(BaseModel):
    text: str
    session_id: str | None = None
    patient_email: EmailStr | None = None


class ConversationTurnRequest(BaseModel):
    session_id: str
    message: str
    patient_email: EmailStr | None = None


class AlternativeSlot(BaseModel):
    doctor_id: str
    start_time: datetime
    end_time: datetime


class BookingResponse(BaseModel):
    status: Literal["booked", "needs_more_info", "alternatives", "failed"]
    message: str
    appointment_id: int | None = None
    intent: IntentSchema | None = None
    alternatives: list[AlternativeSlot] = Field(default_factory=list)
    missing_fields: list[str] = Field(default_factory=list)
    transcript: str | None = None


class MetricsResponse(BaseModel):
    total_requests: int
    successful_bookings: int
    failed_attempts: int
    avg_response_time: float
