from __future__ import annotations

import io
import os

from openai import OpenAI


class SpeechToTextService:
    def __init__(self) -> None:
        self.api_key = os.getenv("OPENAI_API_KEY", "")
        self.client = OpenAI(api_key=self.api_key) if self.api_key else None

    def transcribe(self, audio_bytes: bytes, filename: str = "audio.wav") -> str:
        if not self.client:
            raise RuntimeError("OPENAI_API_KEY is required for Whisper transcription.")
        file_obj = io.BytesIO(audio_bytes)
        file_obj.name = filename
        result = self.client.audio.transcriptions.create(
            model=os.getenv("WHISPER_MODEL", "whisper-1"),
            file=file_obj,
        )
        return result.text
