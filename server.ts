import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import twilio from "twilio";
import admin from "firebase-admin";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { createProxyMiddleware } from "http-proxy-middleware";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  const ML_BACKEND_URL = process.env.ML_BACKEND_URL || "http://127.0.0.1:8000";

  // Dev-only: show where /api/ml is proxied (helps when UI says "ML offline")
  if (process.env.NODE_ENV !== "production") {
    app.get("/api/dev/ml-target", (_req, res) => {
      res.json({ mlBackendUrl: ML_BACKEND_URL });
    });
  }

  // Proxy /api/ml/* → Python FastAPI ML backend (see ML_BACKEND_URL)
  app.use(
    "/api/ml",
    createProxyMiddleware({
      target: ML_BACKEND_URL,
      changeOrigin: true,
      pathRewrite: { "^/api/ml": "" },
      on: {
        error: (err: any, _req: any, res: any) => {
          const detail =
            err?.message ||
            err?.code ||
            String(err ?? "ECONNREFUSED");
          console.error("[ML Proxy] Cannot reach", ML_BACKEND_URL, "|", detail);
          if (!res.headersSent) {
            (res as any).status(503).json({
              error: "ML backend unavailable",
              detail,
              hint:
                "Start the FastAPI app (e.g. uvicorn on port 8000) or set ML_BACKEND_URL to your Render ML URL. " +
                "For the browser to call Render directly, set VITE_ML_BACKEND_URL at build time instead of using /api/ml.",
              target: ML_BACKEND_URL,
            });
          }
        },
      },
    })
  );

  // API Routes
  
  // Twilio Voice Webhook
  app.post("/api/voice", async (req, res) => {
    const callSid = req.body.CallSid;
    await logEvent(callSid, "CALL_RECEIVED", { from: req.body.From });

    const twiml = new twilio.twiml.VoiceResponse();
    
    const gather = twiml.gather({
      input: ["speech"],
      action: "/api/voice/handle-name",
      timeout: 3,
    });
    
    gather.say("Welcome to the Hospital Scheduling Assistant. May I have your name, please?");
    
    twiml.say("I didn't catch that. Please call back later.");
    twiml.hangup();

    res.type("text/xml");
    res.send(twiml.toString());
  });

  app.post("/api/voice/handle-name", async (req, res) => {
    const callSid = req.body.CallSid;
    const name = req.body.SpeechResult;
    const twiml = new twilio.twiml.VoiceResponse();
    
    if (!name) {
      await logEvent(callSid, "NAME_MISSING");
      twiml.redirect("/api/voice");
    } else {
      await logEvent(callSid, "NAME_COLLECTED", { name });
      const gather = twiml.gather({
        input: ["speech"],
        action: `/api/voice/handle-reason?name=${encodeURIComponent(name)}`,
        timeout: 3,
      });
      gather.say(`Thank you, ${name}. What is the reason for your visit today?`);
      twiml.say("I didn't hear a reason. Please try again.");
      twiml.redirect(`/api/voice/handle-name?SpeechResult=${encodeURIComponent(name)}`);
    }

    res.type("text/xml");
    res.send(twiml.toString());
  });

  app.post("/api/voice/handle-reason", async (req, res) => {
    const callSid = req.body.CallSid;
    const name = req.query.name as string;
    const reason = req.body.SpeechResult;
    const twiml = new twilio.twiml.VoiceResponse();
    
    if (!reason) {
      await logEvent(callSid, "REASON_MISSING", { name });
      twiml.redirect(`/api/voice/handle-name?SpeechResult=${encodeURIComponent(name)}`);
    } else {
      await logEvent(callSid, "REASON_COLLECTED", { name, reason });
      const gather = twiml.gather({
        input: ["speech"],
        action: `/api/voice/handle-urgency?name=${encodeURIComponent(name)}&reason=${encodeURIComponent(reason)}`,
        timeout: 3,
      });
      gather.say("I understand. On a scale of 1 to 5, how urgent is your concern?");
      twiml.say("Please provide a number from 1 to 5.");
      twiml.redirect(`/api/voice/handle-reason?name=${encodeURIComponent(name)}&SpeechResult=${encodeURIComponent(reason)}`);
    }

    res.type("text/xml");
    res.send(twiml.toString());
  });

  app.post("/api/voice/handle-urgency", async (req, res) => {
    const callSid = req.body.CallSid;
    const name = req.query.name as string;
    const reason = req.query.reason as string;
    const urgencyText = req.body.SpeechResult;
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Simple urgency extraction
    let urgency = parseInt(urgencyText) || 3;
    if (isNaN(urgency)) urgency = 3;

    await logEvent(callSid, "URGENCY_COLLECTED", { name, reason, urgency });

    const gather = twiml.gather({
      input: ["speech"],
      action: `/api/voice/handle-slot?name=${encodeURIComponent(name)}&reason=${encodeURIComponent(reason)}&urgency=${urgency}`,
      timeout: 3,
    });
    
    gather.say("Got it. We have slots available at 10 AM, 1:30 PM, and 3 PM. Which one works for you?");
    twiml.say("Please pick a time.");
    twiml.redirect(`/api/voice/handle-urgency?name=${encodeURIComponent(name)}&reason=${encodeURIComponent(reason)}&SpeechResult=${urgency}`);

    res.type("text/xml");
    res.send(twiml.toString());
  });

  app.post("/api/voice/handle-slot", async (req, res) => {
    const callSid = req.body.CallSid;
    const name = req.query.name as string;
    const reason = req.query.reason as string;
    const urgency = parseInt(req.query.urgency as string);
    const slotText = req.body.SpeechResult || "3:00 PM";
    const twiml = new twilio.twiml.VoiceResponse();
    
    await logEvent(callSid, "SLOT_COLLECTED", { name, reason, urgency, slot: slotText });

    // Save to Firestore
    try {
      await db.collection("appointments").add({
        patientName: name,
        patientPhone: req.body.From || "Unknown",
        reason: reason,
        urgency: urgency,
        preferredTime: slotText,
        status: "pending",
        createdAt: new Date().toISOString(),
      });
      
      await logEvent(callSid, "APPOINTMENT_CREATED", { name, slot: slotText });

      twiml.say(`Perfect. Your appointment for ${slotText} has been requested. You will receive a confirmation shortly. Thank you for calling!`);
      twiml.hangup();
    } catch (error) {
      console.error("Error saving appointment:", error);
      await logEvent(callSid, "APPOINTMENT_FAILED", { error: (error as Error).message });
      twiml.say("I'm sorry, I encountered an error while booking. Please try again later.");
      twiml.hangup();
    }

    res.type("text/xml");
    res.send(twiml.toString());
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

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `\n[MediVoice] Port ${PORT} is already in use (another npm run dev?).\n` +
          `  Fix: close that terminal, or set PORT=3001 in .env and run again → http://localhost:3001\n`
      );
      process.exit(1);
    }
    throw err;
  });
}

startServer();
