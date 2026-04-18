from __future__ import annotations

import json
import os

from openai import OpenAI

from app.models.schemas import IntentSchema


class IntentService:
    def __init__(self) -> None:
        self.api_key = os.getenv("OPENAI_API_KEY", "")
        self.model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        self.client = OpenAI(api_key=self.api_key) if self.api_key else None

    def extract_intent(self, utterance: str) -> IntentSchema:
        if not self.client:
            raise RuntimeError("OPENAI_API_KEY is required for intent extraction.")

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
