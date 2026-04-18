# MediVoice Voice Hospital Scheduling Assistant

Production-ready local system for voice-first appointment booking with a complete pipeline:

`Speech -> Text -> Intent -> Scheduling -> Calendar -> Email Response`

## Architecture

```text
Client (Dev Console / API Client)
        |
        v
FastAPI (`app/main.py`)
  ├─ `/schedule-from-audio` (Fish Audio transcription)
  ├─ `/schedule-from-text` (LLM function calling + parser)
  ├─ `/conversation/turn` (state machine for missing fields)
  └─ `/metrics` (operational counters)
        |
        v
Service Layer (`app/services`)
  ├─ `speech.py` -> Fish Audio ASR
  ├─ `llm.py` -> GPT function-calling JSON intent
  ├─ `scheduler.py` -> SQLite conflict checks + alternatives
  ├─ `calendar.py` -> Google Calendar event creation
  ├─ `email_service.py` -> SMTP Gmail confirmations
  ├─ `conversation.py` -> session memory + field prompts
  └─ `metrics.py` -> request/success/failure/latency tracking
        |
        v
SQLite (`db/app.db`) via SQLAlchemy ORM
  ├─ `appointments`
  └─ `patients`
```

## Tech Stack

- Backend: FastAPI + Python
- ORM/Database: SQLAlchemy + SQLite
- Speech-to-text: Fish Audio API
- LLM intent extraction: OpenAI GPT with function calling
- Calendar: Google Calendar API (service account)
- Email: SMTP (Gmail test account)
- Frontend: React (existing admin/dev console enhanced)

## Project Structure

```text
app/
  main.py
  routes/
  services/
  models/
  utils/
db/
tests/
```

## Setup

1. Create and activate a Python virtual environment.
2. Install Python dependencies:

```bash
pip install -r requirements.txt
```

3. Copy environment template:

```bash
cp .env.example .env
```

4. Fill required backend variables in `.env`:

- `OPENAI_API_KEY`
- `FISH_AUDIO_API_KEY`
- `GOOGLE_SERVICE_ACCOUNT_FILE`
- `GOOGLE_CALENDAR_ID`
- `SMTP_SENDER_EMAIL`
- `SMTP_APP_PASSWORD`
- (Optional SMS) `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_SMS_ENABLED=true`

5. Start FastAPI backend:

```bash
uvicorn app.main:app --reload --port 8001
```

6. (Optional) Run existing frontend:

```bash
npm run dev
```

## Twilio SMS (optional)

This repo can send **SMS confirmations** when an appointment is booked via the voice flow.

- Set in `.env`:
  - `TWILIO_SMS_ENABLED=true`
  - `TWILIO_ACCOUNT_SID=...`
  - `TWILIO_AUTH_TOKEN=...`
  - `TWILIO_PHONE_NUMBER=+1...`
- Trial accounts can only send to **verified** numbers and will include a trial banner.

### SMS API endpoint (demo)

```bash
curl -X POST http://localhost:3000/api/sms/send \
  -H "Content-Type: application/json" \
  -d '{"to":"+1YOUR_NUMBER","body":"Your appointment is confirmed for tomorrow at 2 PM."}'
```

## API Endpoints

- `POST /schedule-from-audio`
  - multipart form: `audio`, optional `session_id`, `patient_email`
- `POST /schedule-from-text`
  - JSON body: `{ "text": "...", "session_id": "...", "patient_email": "..." }`
- `POST /conversation/turn`
  - JSON body: `{ "session_id": "...", "message": "...", "patient_email": "..." }`
- `GET /metrics`
- `GET /health`

## Example Request / Response

### Schedule from text

```bash
curl -X POST http://localhost:8001/schedule-from-text \
  -H "Content-Type: application/json" \
  -d '{
    "text":"Book Rahul Mehta with Dr. Chen next Friday afternoon for migraine follow-up, high urgency",
    "session_id":"demo-1",
    "patient_email":"rahul@example.com"
  }'
```

Example success response:

```json
{
  "status": "booked",
  "message": "Booked migraine follow-up for Rahul Mehta with Dr. Chen on 2026-04-24 13:00.",
  "appointment_id": 12,
  "intent": {
    "patient_name": "Rahul Mehta",
    "appointment_type": "migraine follow-up",
    "doctor": "Dr. Chen",
    "date": "next Friday",
    "time_preference": "afternoon",
    "urgency": "high"
  },
  "alternatives": [],
  "missing_fields": []
}
```

## Demo Walkthrough

1. Open Dev Console in the UI.
2. Use **Pipeline Dry Run** to send natural language input.
3. Verify structured output and booking result.
4. Check `/metrics` updates in the same console.
5. Confirm:
   - Appointment persisted in `db/app.db`
   - Google Calendar event created
   - Confirmation email received

## Edge Cases Implemented

- Relative dates like `next Friday`
- Time buckets like `afternoon` -> `13:00`
- Invalid date/time returns retry message
- Double-booked slot returns 3 nearest alternatives
- Working-hours guard (`9:00` to `17:00`, 30-minute slots)
- Multi-turn state machine collects missing fields incrementally

## Tests

Run:

```bash
pytest tests -q
```

Included:
- scheduler conflict prevention
- alternative slot generation
- health endpoint availability
