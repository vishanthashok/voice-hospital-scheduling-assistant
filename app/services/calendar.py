from __future__ import annotations

import os
from datetime import datetime

from google.oauth2 import service_account
from googleapiclient.discovery import build


class CalendarService:
    def __init__(self) -> None:
        self.calendar_id = os.getenv("GOOGLE_CALENDAR_ID", "")
        credentials_path = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", "")
        self.enabled = bool(self.calendar_id and credentials_path)
        self._service = None
        if self.enabled:
            creds = service_account.Credentials.from_service_account_file(
                credentials_path,
                scopes=["https://www.googleapis.com/auth/calendar"],
            )
            self._service = build("calendar", "v3", credentials=creds)

    def create_event(
        self,
        *,
        patient_name: str,
        appointment_type: str,
        doctor_id: str,
        start_time: datetime,
        end_time: datetime,
    ) -> str | None:
        if not self._service:
            return None
        body = {
            "summary": f"{appointment_type} - {patient_name}",
            "description": f"Doctor: {doctor_id}\nPatient: {patient_name}",
            "start": {"dateTime": start_time.isoformat()},
            "end": {"dateTime": end_time.isoformat()},
        }
        event = self._service.events().insert(calendarId=self.calendar_id, body=body).execute()
        return event.get("id")
