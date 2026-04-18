from __future__ import annotations

import os

import httpx


class SpeechToTextService:
    def __init__(self) -> None:
        self.api_key = os.getenv("FISH_AUDIO_API_KEY", "")
        self.base_url = os.getenv("FISH_AUDIO_BASE_URL", "https://api.fish.audio")
        self.language = os.getenv("FISH_AUDIO_LANGUAGE") or None
        self.ignore_timestamps = os.getenv("FISH_AUDIO_IGNORE_TIMESTAMPS", "true").lower() != "false"
        self.max_bytes = 20 * 1024 * 1024  # Fish Audio ASR limit: 20MB per file.

    def transcribe(self, audio_bytes: bytes, filename: str = "audio.wav") -> str:
        if not self.api_key:
            raise RuntimeError("FISH_AUDIO_API_KEY is required for Fish Audio transcription.")
        if len(audio_bytes) > self.max_bytes:
            raise RuntimeError("Fish Audio free API accepts files up to 20MB.")

        files = {"audio": (filename, audio_bytes, "application/octet-stream")}
        data = {"ignore_timestamps": str(self.ignore_timestamps).lower()}
        if self.language:
            data["language"] = self.language

        with httpx.Client(timeout=60.0) as client:
            response = client.post(
                f"{self.base_url}/v1/asr",
                headers={"Authorization": f"Bearer {self.api_key}"},
                files=files,
                data=data,
            )

        if response.status_code == 402:
            raise RuntimeError("Fish Audio transcription quota is exhausted for the current account.")
        if response.status_code >= 400:
            raise RuntimeError(f"Fish Audio transcription failed: {response.text}")

        payload = response.json()
        text = payload.get("text", "").strip()
        if not text:
            raise RuntimeError("Fish Audio returned an empty transcript.")
        return text
