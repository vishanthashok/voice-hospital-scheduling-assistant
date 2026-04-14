<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# MediVoice AI - Hospital Scheduling Assistant

This contains everything you need to run your healthcare AI application locally.

## Setup & Environment Variables

**Prerequisites:** Node.js v20+ 

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file in the root directory (you can copy `.env.example` as a starting point).

### Required Environment Variables
You need to pass the real values to make the webhook trigger and the AI generate correctly:
- **Twilio Configuration** (Used for incoming calls & voice webhooks from `server.ts`):
  - `TWILIO_ACCOUNT_SID=your_sid_here`
  - `TWILIO_AUTH_TOKEN=your_token_here` 
  - `TWILIO_PHONE_NUMBER=+1234567890`

### Optional / Future Configurations
- **Gemini API Key**: `GEMINI_API_KEY=your_key_here`
- **ElevenLabs**: `ELEVENLABS_API_KEY=your_key_here` and `ELEVENLABS_VOICE_ID=voice_id`

3. Run the complete application locally (Vite frontend + Express Backend):
   ```bash
   npm run dev
   ```

## Local Development vs Admin Portal
By default, the application features a toggle at the bottom-left corner of the sidebar:
- **Admin Portal**: A dashboard for hospital staff that parses inbound database records and bookings.
- **Developer Mode**: Visualizes real-time server logs from Twilio call inputs in `server.ts`.
