import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import twilio from "twilio";
import admin from "firebase-admin";
import dotenv from "dotenv";
import { createProxyMiddleware } from "http-proxy-middleware";

dotenv.config();

// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (e) {
    console.error("Firebase Admin initialization failed", e);
  }
}
const db = admin.firestore();

// Logging helper
async function logEvent(callSid: string, event: string, data: any = {}) {
  try {
    await db.collection("logs").add({
      callSid,
      event,
      data,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Logging error:", error);
  }
}

async function startServer() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  const PORT = parseInt(process.env.PORT || "3000");
  const ML_BACKEND_URL = process.env.ML_BACKEND_URL || "http://localhost:8000";
  const SCHEDULING_API_URL = (process.env.SCHEDULING_API_URL || "http://localhost:8001").replace(/\/$/, "");
  const activeVoiceSessions = new Map<string, { initialized: boolean; email: string }>();

  const TWILIO_SMS_ENABLED = String(process.env.TWILIO_SMS_ENABLED || "").toLowerCase() === "true";
  const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
  const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
  const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || "";
  const twilioClient =
    TWILIO_SMS_ENABLED && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) : null;

  async function sendSms(to: string, body: string) {
    if (!twilioClient) {
      throw new Error("Twilio SMS is not configured. Set TWILIO_SMS_ENABLED=true plus TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN.");
    }
    if (!TWILIO_PHONE_NUMBER) {
      throw new Error("TWILIO_PHONE_NUMBER is required to send SMS.");
    }
    return twilioClient.messages.create({
      to,
      from: TWILIO_PHONE_NUMBER,
      body,
    });
  }

  async function callSchedulingApi(route: string, payload: Record<string, unknown>) {
    const response = await fetch(`${SCHEDULING_API_URL}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Scheduling API ${response.status}: ${detail}`);
    }
    return response.json() as Promise<any>;
  }

  function gatherPrompt(
    twiml: twilio.twiml.VoiceResponse,
    prompt: string,
    callSid: string,
    fallbackPrompt = "I did not catch that. Please repeat.",
  ) {
    const gather = twiml.gather({
      input: ["speech"],
      action: `/api/voice/handle-turn?callSid=${encodeURIComponent(callSid)}`,
      timeout: 4,
      speechTimeout: "auto",
    });
    gather.say(prompt);
    twiml.say(fallbackPrompt);
    twiml.redirect(`/api/voice/handle-turn?callSid=${encodeURIComponent(callSid)}`);
  }

  async function mirrorBookingToDashboard(result: any, fromNumber: string) {
    if (result?.status !== "booked" || !result.intent) return;
    const intent = result.intent;
    await db.collection("appointments").add({
      patientName: intent.patient_name,
      patientPhone: fromNumber || "Unknown",
      reason: intent.appointment_type,
      urgency: intent.urgency,
      preferredTime: `${intent.date} ${intent.time_preference}`,
      status: "confirmed",
      createdAt: new Date().toISOString(),
    });
  }

  // Proxy /api/ml/* → Python FastAPI ML backend (port 8000)
  app.use(
    "/api/ml",
    createProxyMiddleware({
      target: ML_BACKEND_URL,
      changeOrigin: true,
      pathRewrite: { "^/api/ml": "" },
      on: {
        error: (err: any, _req: any, res: any) => {
          console.error("[ML Proxy] Error:", err.message);
          (res as any).status(503).json({ error: "ML backend unavailable", detail: err.message });
        },
      },
    })
  );

  // API Routes

  // Twilio Voice Webhook -> FastAPI conversation pipeline
  app.post("/api/voice", async (req, res) => {
    const callSid = req.body.CallSid || `call-${Date.now()}`;
    const fromNumber = req.body.From || "";
    const patientEmail = `${String(fromNumber).replace(/[^\d]/g, "") || "caller"}@voice.medivoice.local`;
    activeVoiceSessions.set(callSid, { initialized: false, email: patientEmail });
    await logEvent(callSid, "CALL_RECEIVED", { from: req.body.From });

    const twiml = new twilio.twiml.VoiceResponse();
    gatherPrompt(
      twiml,
      "Welcome to the Hospital Scheduling Assistant. Tell me your full appointment request, including name, doctor, day, and time preference.",
      callSid,
    );

    res.type("text/xml");
    res.send(twiml.toString());
  });

  app.post("/api/voice/handle-turn", async (req, res) => {
    const callSid = (req.query.callSid as string) || req.body.CallSid || `call-${Date.now()}`;
    const session = activeVoiceSessions.get(callSid) || {
      initialized: false,
      email: `${String(req.body.From || "").replace(/[^\d]/g, "") || "caller"}@voice.medivoice.local`,
    };
    const userSpeech = (req.body.SpeechResult || "").trim();
    const twiml = new twilio.twiml.VoiceResponse();
    if (!userSpeech) {
      gatherPrompt(twiml, "I did not catch that. Please repeat your answer.", callSid);
      res.type("text/xml");
      res.send(twiml.toString());
      return;
    }

    try {
      await logEvent(callSid, "VOICE_TURN_RECEIVED", { speech: userSpeech, initialized: session.initialized });
      const result = session.initialized
        ? await callSchedulingApi("/conversation/turn", {
            session_id: callSid,
            message: userSpeech,
            patient_email: session.email,
          })
        : await callSchedulingApi("/schedule-from-text", {
            text: userSpeech,
            session_id: callSid,
            patient_email: session.email,
          });

      if (result.status === "needs_more_info") {
        activeVoiceSessions.set(callSid, { ...session, initialized: true });
        await logEvent(callSid, "VOICE_ASK_NEXT_FIELD", {
          missing: result.missing_fields,
          prompt: result.message,
        });
        gatherPrompt(twiml, result.message || "Please provide the missing information.", callSid);
      } else if (result.status === "booked") {
        activeVoiceSessions.delete(callSid);
        await mirrorBookingToDashboard(result, req.body.From || "Unknown");
        await logEvent(callSid, "APPOINTMENT_BOOKED", { intent: result.intent, appointment_id: result.appointment_id });

        if (TWILIO_SMS_ENABLED) {
          const to = String(req.body.From || "").trim();
          if (to) {
            try {
              const smsBody =
                result.message ||
                "Your appointment is confirmed. Reply STOP to unsubscribe (demo).";
              const msg = await sendSms(to, smsBody);
              await logEvent(callSid, "SMS_SENT", { to, sid: msg.sid });
            } catch (e) {
              await logEvent(callSid, "SMS_FAILED", { to, error: (e as Error).message });
            }
          }
        }

        twiml.say(result.message || "Your appointment is confirmed. Thank you for calling.");
        twiml.hangup();
      } else if (result.status === "alternatives") {
        activeVoiceSessions.delete(callSid);
        const alternatives = Array.isArray(result.alternatives) ? result.alternatives.slice(0, 3) : [];
        const alternativeSpeech =
          alternatives.length > 0
            ? alternatives
                .map((slot: any, index: number) => {
                  const start = new Date(slot.start_time);
                  return `Option ${index + 1}: ${start.toDateString()} at ${start.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`;
                })
                .join(". ")
            : "No alternatives are available right now.";
        await logEvent(callSid, "APPOINTMENT_ALTERNATIVES", { alternatives });
        twiml.say(`${result.message || "Requested slot is unavailable."} ${alternativeSpeech}`);
        twiml.say("Please call again to pick one of these alternatives.");
        twiml.hangup();
      } else {
        activeVoiceSessions.delete(callSid);
        await logEvent(callSid, "APPOINTMENT_FAILED", { detail: result.message });
        twiml.say(result.message || "I could not complete the booking. Please try again later.");
        twiml.hangup();
      }
    } catch (error) {
      console.error("Error from scheduling pipeline:", error);
      activeVoiceSessions.delete(callSid);
      await logEvent(callSid, "APPOINTMENT_FAILED", { error: (error as Error).message });
      twiml.say("I encountered a system error while processing your request. Please try again shortly.");
      twiml.hangup();
    }

    res.type("text/xml");
    res.send(twiml.toString());
  });

  // SMS API (for demos / admin console)
  app.post("/api/sms/send", async (req, res) => {
    try {
      const to = String(req.body?.to || "").trim();
      const body = String(req.body?.body || "").trim();
      if (!to || !body) {
        res.status(400).json({ error: "Missing required fields: to, body" });
        return;
      }
      const msg = await sendSms(to, body);
      res.json({ sid: msg.sid, status: msg.status });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Dashboard API
  app.get("/api/appointments", async (req, res) => {
    try {
      const snapshot = await db.collection("appointments").orderBy("createdAt", "desc").get();
      const appointments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(appointments);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch appointments" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
