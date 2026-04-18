from __future__ import annotations

import json
import os
import re

from openai import OpenAI

from app.models.schemas import IntentSchema


def _fallback_extract_intent(utterance: str) -> IntentSchema:
    """
    Heuristic parser for local demos when OPENAI_API_KEY isn't configured.
    It aims to extract common fields from prompts like:
    "Book Neha Patel with Dr. Patel next Friday afternoon for a diabetes follow-up. High urgency."
    """

    text = " ".join(utterance.strip().split())
    lower = text.lower()

    # patient name: after "book " up to " with " (or end)
    patient_name = ""
    m = re.search(r"\bbook\s+(.+?)(?:\s+\bwith\b|[.?!]|$)", text, flags=re.IGNORECASE)
    if m:
        patient_name = m.group(1).strip()

    # doctor: "with Dr. X" or "with doctor X"
    doctor = ""
    m = re.search(
        r"\bwith\s+(dr\.?\s*[a-z][a-z.\s-]*?)(?=\s+(?:on|at|this|next|today|tomorrow)\b|[.?!,]|$)",
        text,
        flags=re.IGNORECASE,
    )
    if m:
        doctor = m.group(1).strip()
    else:
        m = re.search(r"\bwith\s+doctor\s+([^.?!,]+)", text, flags=re.IGNORECASE)
        if m:
            doctor = f"Dr. {m.group(1).strip()}"

    # date: capture common relative phrases
    date = ""
    m = re.search(
        r"\b(today|tomorrow|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|"
        r"(?:this|next)\s+week|next\s+month)\b",
        lower,
        flags=re.IGNORECASE,
    )
    if m:
        date = m.group(0).strip()

    # time preference: morning/afternoon/evening + specific time
    time_preference = ""
    for bucket in ("morning", "afternoon", "evening"):
        if re.search(rf"\b{bucket}\b", lower):
            time_preference = bucket
            break
    if not time_preference:
        m = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", lower)
        if m:
            hh = int(m.group(1))
            mm = int(m.group(2) or "00")
            ampm = m.group(3)
            if ampm == "pm" and hh != 12:
                hh += 12
            if ampm == "am" and hh == 12:
                hh = 0
            time_preference = f"{hh:02d}:{mm:02d}"

    # appointment type: "for (a|an|the) <reason>" up to punctuation
    appointment_type = ""
    m = re.search(r"\bfor\s+(?:a|an|the)\s+(.+?)(?:[.?!]|$)", text, flags=re.IGNORECASE)
    if m:
        appointment_type = m.group(1).strip()

    # urgency: explicit "high/medium/low urgency" or keywords
    urgency = ""
    if "high urgency" in lower or re.search(r"\burgent\b", lower):
        urgency = "high"
    elif "medium urgency" in lower:
        urgency = "medium"
    elif "low urgency" in lower:
        urgency = "low"

    # IntentSchema requires all fields; use "unknown" to trigger ConversationManager prompts.
    return IntentSchema(
        patient_name=patient_name or "unknown",
        appointment_type=appointment_type or "unknown",
        doctor=doctor or "unknown",
        date=date or "unknown",
        time_preference=time_preference or "unknown",
        urgency=urgency or "unknown",
    )


class IntentService:
    def __init__(self) -> None:
        self.api_key = os.getenv("OPENAI_API_KEY", "")
        self.model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        self.disable_llm = os.getenv("OPENAI_DISABLE", "").lower() == "true"
        # Hard timeout to keep the dev console responsive if the network/key is misconfigured.
        self.client = OpenAI(api_key=self.api_key, timeout=20.0, max_retries=1) if (self.api_key and not self.disable_llm) else None

    def extract_intent(self, utterance: str) -> IntentSchema:
        if not self.client:
            return _fallback_extract_intent(utterance)

        tools = [
            {
                "type": "function",
                "function": {
                    "name": "schedule_intent",
                    "description": "Extract appointment scheduling intent as structured JSON.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "patient_name": {"type": "string"},
                            "appointment_type": {"type": "string"},
                            "doctor": {"type": "string"},
                            "date": {"type": "string"},
                            "time_preference": {"type": "string"},
                            "urgency": {"type": "string"},
                        },
                        "required": [
                            "patient_name",
                            "appointment_type",
                            "doctor",
                            "date",
                            "time_preference",
                            "urgency",
                        ],
                    },
                },
            }
        ]

        try:
            completion = self.client.chat.completions.create(
                model=self.model,
                temperature=0,
                messages=[
                    {
                        "role": "system",
                        "content": "Extract a single scheduling intent. Return function call only.",
                    },
                    {"role": "user", "content": utterance},
                ],
                tools=tools,
                tool_choice={"type": "function", "function": {"name": "schedule_intent"}},
            )
            tool_calls = completion.choices[0].message.tool_calls or []
            if not tool_calls:
                raise RuntimeError("LLM did not return a function call.")

            args = json.loads(tool_calls[0].function.arguments)
            return IntentSchema(**args)
        except Exception:
            # If OpenAI is slow/misconfigured, degrade to heuristic parsing for demos.
            return _fallback_extract_intent(utterance)
