import crypto from "crypto";

export const ANALYSIS_PROMPT_VERSION = "symptom-triage-v5";

export function getAnalysisModelName() {
  if (process.env.SYMPTOM_ANALYZER === "gemma") {
    return process.env.GEMMA_MODEL || "gemma4:e2b";
  }
  return "local-rules";
}

export function getAnalysisFingerprint(symptoms: string[]) {
  const normalizedSymptoms = symptoms.map((symptom) => symptom.trim().toLowerCase()).filter(Boolean).sort();
  const payload = {
    version: ANALYSIS_PROMPT_VERSION,
    analyzer: process.env.SYMPTOM_ANALYZER || "local",
    model: getAnalysisModelName(),
    symptoms: normalizedSymptoms,
  };

  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
