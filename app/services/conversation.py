from __future__ import annotations

from dataclasses import dataclass, field

from app.models.schemas import IntentSchema


INTENT_FIELDS = ["patient_name", "appointment_type", "doctor", "date", "time_preference", "urgency"]


@dataclass
class SessionState:
    values: dict[str, str] = field(default_factory=dict)

    def missing_fields(self) -> list[str]:
        return [field for field in INTENT_FIELDS if not self.values.get(field)]

    def as_intent(self) -> IntentSchema | None:
        missing = self.missing_fields()
        if missing:
            return None
        return IntentSchema(**self.values)  # type: ignore[arg-type]


class ConversationManager:
    def __init__(self) -> None:
        self.sessions: dict[str, SessionState] = {}

    def upsert_from_intent(self, session_id: str, intent: IntentSchema) -> SessionState:
        state = self.sessions.setdefault(session_id, SessionState())
        for key in INTENT_FIELDS:
            value = getattr(intent, key, "")
            if value and value.lower() not in {"unknown", "not specified", "none"}:
                state.values[key] = value
        return state

    def upsert_field(self, session_id: str, field_name: str, value: str) -> SessionState:
        state = self.sessions.setdefault(session_id, SessionState())
        if field_name in INTENT_FIELDS and value.strip():
            state.values[field_name] = value.strip()
        return state

    def get_or_create(self, session_id: str) -> SessionState:
        return self.sessions.setdefault(session_id, SessionState())

    def next_question(self, missing_field: str) -> str:
        prompts = {
            "appointment_type": "What type of appointment do you need?",
            "doctor": "Do you have a preferred doctor?",
            "date": "Which date works for you?",
            "time_preference": "What time do you prefer?",
            "urgency": "How urgent is this: low, medium, or high?",
            "patient_name": "May I have your full name?",
        }
        return prompts.get(missing_field, f"Please provide {missing_field}.")
