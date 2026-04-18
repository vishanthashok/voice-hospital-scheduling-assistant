from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage


class EmailService:
    def __init__(self) -> None:
        self.sender = os.getenv("SMTP_SENDER_EMAIL", "")
        self.password = os.getenv("SMTP_APP_PASSWORD", "")
        self.host = os.getenv("SMTP_HOST", "smtp.gmail.com")
        self.port = int(os.getenv("SMTP_PORT", "587"))
        self.enabled = bool(self.sender and self.password)

    def send_confirmation(
        self,
        *,
        to_email: str,
        patient_name: str,
        doctor_id: str,
        appointment_type: str,
        date_str: str,
        time_str: str,
    ) -> None:
        if not self.enabled:
            return
        msg = EmailMessage()
        msg["Subject"] = "Appointment Confirmation"
        msg["From"] = self.sender
        msg["To"] = to_email
        msg.set_content(
            "\n".join(
                [
                    f"Hi {patient_name},",
                    "Your appointment is confirmed.",
                    f"Doctor: {doctor_id}",
                    f"Type: {appointment_type}",
                    f"Date: {date_str}",
                    f"Time: {time_str}",
                ]
            )
        )
        with smtplib.SMTP(self.host, self.port) as smtp:
            smtp.starttls()
            smtp.login(self.sender, self.password)
            smtp.send_message(msg)
