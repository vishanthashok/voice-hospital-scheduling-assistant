"""
Point your Twilio number's voice webhook at PUBLIC_BASE_URL/voice/incoming.

Run after starting a new Cloudflare Quick Tunnel (or ngrok) and updating
PUBLIC_BASE_URL in .env. Idempotent.

    python scripts/set_twilio_webhook.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

REPO = Path(__file__).resolve().parents[1]
load_dotenv(REPO / ".env", override=True)

sid = os.getenv("TWILIO_ACCOUNT_SID")
tok = os.getenv("TWILIO_AUTH_TOKEN")
num = os.getenv("TWILIO_PHONE_NUMBER")
base = (os.getenv("PUBLIC_BASE_URL") or "").rstrip("/")

missing = [k for k, v in {
    "TWILIO_ACCOUNT_SID": sid,
    "TWILIO_AUTH_TOKEN": tok,
    "TWILIO_PHONE_NUMBER": num,
    "PUBLIC_BASE_URL": base,
}.items() if not v]
if missing:
    print("Missing in .env:", ", ".join(missing))
    sys.exit(2)

from twilio.rest import Client  # noqa: E402

client = Client(sid, tok)
pns = client.incoming_phone_numbers.list(phone_number=num, limit=1)
if not pns:
    print(f"Number {num!r} is not owned by this Twilio account.")
    sys.exit(3)

voice_url = f"{base}/voice/incoming"
pn = pns[0]
print(f"BEFORE: sid={pn.sid}  voice_url={pn.voice_url!r}  method={pn.voice_method}")
updated = client.incoming_phone_numbers(pn.sid).update(
    voice_url=voice_url, voice_method="POST"
)
print(f"AFTER : sid={updated.sid}  voice_url={updated.voice_url!r}  method={updated.voice_method}")
print(f"\nTwilio number {num} will now webhook to {voice_url}")
