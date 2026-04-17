import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import caseRoutes from "./routes/caseRoutes";
import stressRoutes from "./routes/stressRoutes";
import { ensureLocalSymptomModel, ensureLocalSymptomModelInBackground } from "./utils/localModel";

dotenv.config({ path: "../.env" });

const app = express();
const PORT = process.env.PORT || 4000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/sevak-dashboard";

// Middleware
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// API Routes
app.use("/api/cases", caseRoutes);

// Stress-test API — only mounted when explicitly enabled, never in prod.
if (process.env.ENABLE_STRESS_API === "true") {
  app.use("/api/stress", stressRoutes);
  console.log("[stress] /api/stress endpoints mounted (ENABLE_STRESS_API=true)");
}

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Serve static frontend
const publicPath = path.join(__dirname, "..", "public");
app.use(express.static(publicPath));
app.get("*", (_req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

// Connect to MongoDB and start server
async function start() {
  try {
    // Always block on LLM warmup so every case gets live AI analysis.
    // New cases submitted before the model is ready return a PENDING placeholder
    // and will need to be reclassified once the LLM is live.
    // Set LOCAL_LLM_STARTUP=background to skip blocking (useful in CI / testing).
    if (process.env.LOCAL_LLM_STARTUP === "background") {
      console.log("[LLM] Starting Ollama warmup in background (LOCAL_LLM_STARTUP=background).");
      console.log("[LLM] ⚠️  Cases submitted before warmup completes will receive a PENDING analysis.");
      ensureLocalSymptomModelInBackground();
    } else {
      console.log("[LLM] Waiting for Ollama to be ready before accepting requests...");
      await ensureLocalSymptomModel();
    }

    await mongoose.connect(MONGODB_URI);
    console.log("✅  Connected to MongoDB");
    app.listen(PORT, () => {
      console.log(`\n🚀  Sevak Dashboard running on http://localhost:${PORT}\n`);
    });
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    process.exit(1);
  }
}

start();

export default app;
