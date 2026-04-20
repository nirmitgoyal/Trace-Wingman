import { Urgency } from "../models/Case";
import { ensureLocalSymptomModel, isSymptomModelReady } from "./localModel";
import { findCachedAnalysis, cacheAnalysis } from "./symptomVectorCache";

export interface PatientContext {
  age?: number;
  gender?: string;
  symptomDuration?: string;
  /** Summary of recent cases in the same area, e.g. "12 dengue cases in this district in the last 7 days" */
  clusterContext?: string;
}

export interface SymptomAnalysis {
  urgency: Urgency;
  predictedDisease: string;
  summary: string;
  actionRequired: string;
  callbackWindow: string;
  differentialDiagnoses?: string[];
  redFlags?: string[];
  confidence?: "LOW" | "MEDIUM" | "HIGH";
}

// ---------------------------------------------------------------------------
// Symptom cleaning — strips leading noise like "and a", "also", "with a"
// so the LLM receives clean terms (e.g. "and a fever" → "fever")
// ---------------------------------------------------------------------------
function cleanSymptom(s: string): string {
  return s
    .trim()
    .replace(/^(and\s+a?\s*|also\s+|with\s+a?\s*|plus\s+|,\s*)/i, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Pending placeholder — returned when LLM is starting up AND no cached
// result exists.  Urgency is deliberately LOW so it doesn't falsely alarm,
// but it signals clearly that re-analysis is needed.
// ---------------------------------------------------------------------------
const PENDING_ANALYSIS: SymptomAnalysis = {
  urgency: "LOW",
  predictedDisease: "Pending — AI analysis in progress",
  summary:
    "The AI symptom analysis service is still starting up and no similar case was found in the cache. This case has been logged and will be re-analyzed once the service is ready.",
  actionRequired:
    "Case has been logged. A clinician will review it. If symptoms are severe, worsening, or include difficulty breathing, loss of consciousness, or chest pain — seek emergency care immediately.",
  callbackWindow: "within 24 hours",
  differentialDiagnoses: [],
  redFlags: [],
  confidence: "LOW",
};

// ---------------------------------------------------------------------------
// Safety overrides — hard escalation rules that run on top of every LLM
// response to catch cases where the model misses a clear emergency pattern.
// These are a safety net, not a classifier.
// ---------------------------------------------------------------------------
function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function applySafetyOverrides(analysis: SymptomAnalysis, symptoms: string[]): SymptomAnalysis {
  const normalized = symptoms.map(cleanSymptom).join(" ").toLowerCase();

  // Neurological emergency
  if (includesAny(normalized, ["seizure", "seizures", "loss of consciousness", "unconscious"])) {
    return {
      ...analysis,
      urgency: "CRITICAL",
      callbackWindow: "within 2 hours",
      predictedDisease: analysis.predictedDisease.toLowerCase().includes("neuro")
        ? analysis.predictedDisease
        : "Acute Neurological Emergency",
      redFlags: Array.from(new Set([
        ...(analysis.redFlags || []),
        "Seizure activity",
        "Loss of consciousness",
      ])),
    };
  }

  // Meningitis signs
  if (
    includesAny(normalized, ["stiff neck", "neck stiffness"]) &&
    includesAny(normalized, ["fever", "high fever", "severe headache"])
  ) {
    return {
      ...analysis,
      urgency: "CRITICAL",
      callbackWindow: "within 2 hours",
      redFlags: Array.from(new Set([
        ...(analysis.redFlags || []),
        "Stiff neck with fever",
        "Possible meningitis",
      ])),
    };
  }

  // DKA / metabolic emergency
  if (
    includesAny(normalized, ["fruity breath"]) &&
    includesAny(normalized, ["rapid breathing", "confusion"])
  ) {
    return {
      ...analysis,
      urgency: "CRITICAL",
      callbackWindow: "within 2 hours",
      predictedDisease: "Possible Diabetic Ketoacidosis or Acute Metabolic Emergency",
      redFlags: Array.from(new Set([
        ...(analysis.redFlags || []),
        "Fruity breath",
        "Rapid breathing",
        "Confusion",
      ])),
    };
  }

  // Sepsis pattern
  if (
    includesAny(normalized, ["confusion"]) &&
    includesAny(normalized, ["rapid breathing", "rapid heart rate"])
  ) {
    return {
      ...analysis,
      urgency: "CRITICAL",
      callbackWindow: "within 2 hours",
      redFlags: Array.from(new Set([
        ...(analysis.redFlags || []),
        "Confusion with rapid breathing — possible sepsis",
      ])),
    };
  }

  return analysis;
}

// ---------------------------------------------------------------------------
// LLM response parsing
// ---------------------------------------------------------------------------
function extractJson(raw: string): string {
  const withoutThought = raw.replace(/<\|channel\>thought[\s\S]*?<channel\|>/g, "").trim();
  const withoutFence = withoutThought.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return withoutFence;
  return withoutFence.slice(firstBrace, lastBrace + 1);
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 5);
}

function parseGemmaResponse(raw: string): SymptomAnalysis | null {
  try {
    const parsed = JSON.parse(extractJson(raw));
    if (!["CRITICAL", "MODERATE", "LOW"].includes(parsed.urgency)) return null;
    return {
      urgency: parsed.urgency as Urgency,
      predictedDisease: String(parsed.predictedDisease || "").trim() || "Unspecified illness",
      summary: String(parsed.summary || "").trim() || "No summary provided.",
      actionRequired: String(parsed.actionRequired || "").trim() || "Seek clinical review.",
      callbackWindow: ["within 2 hours", "within 24 hours", "within 48 hours"].includes(parsed.callbackWindow)
        ? parsed.callbackWindow
        : "within 24 hours",
      differentialDiagnoses: asStringArray(parsed.differentialDiagnoses),
      redFlags: asStringArray(parsed.redFlags),
      confidence: ["LOW", "MEDIUM", "HIGH"].includes(parsed.confidence)
        ? (parsed.confidence as "LOW" | "MEDIUM" | "HIGH")
        : "MEDIUM",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// LLM call
// ---------------------------------------------------------------------------
async function analyzeWithGemma(symptoms: string[], ctx: PatientContext = {}): Promise<SymptomAnalysis | null> {
  const url = process.env.GEMMA_LOCAL_URL || "http://localhost:11434/api/chat";
  const model = process.env.GEMMA_MODEL || "gemma4:e2b";
  const keepAlive = process.env.OLLAMA_KEEP_ALIVE || "30m";
  const numCtx = Number(process.env.GEMMA_NUM_CTX || 2048);
  // 600 minimum — a full JSON response with differentials + redFlags runs 500-700 tokens.
  // 360 caused silent truncation → JSON parse failure → wrong results.
  const numPredict = Number(process.env.GEMMA_NUM_PREDICT || 600);
  const timeoutMs = Number(process.env.GEMMA_TIMEOUT_MS || 45000);

  const cleanedSymptoms = symptoms.map(cleanSymptom).filter(Boolean);

  // Build patient context lines for the prompt
  const patientLines: string[] = [];
  if (ctx.age !== undefined && ctx.gender) {
    patientLines.push(`Patient: ${ctx.age}-year-old ${ctx.gender}`);
  } else if (ctx.age !== undefined) {
    patientLines.push(`Patient age: ${ctx.age}`);
  } else if (ctx.gender) {
    patientLines.push(`Patient gender: ${ctx.gender}`);
  }
  if (ctx.symptomDuration) {
    patientLines.push(`Symptom duration: ${ctx.symptomDuration}`);
  }
  if (ctx.clusterContext) {
    patientLines.push(`Local disease activity (last 7 days): ${ctx.clusterContext}`);
  }

  try {
    const system = `You are Sevak's local symptom triage assistant.
Classify possible illness from symptom reports for community health surveillance.
Be medically cautious, concise, and specific to the supplied symptoms.
Use the patient's age, gender, and symptom duration to refine your diagnosis — age and sex affect disease likelihood significantly.
If local disease activity is provided, treat it as an epidemiological clue but do not anchor to it without supporting symptoms.
Do not force TB, malaria, dengue, or diabetes unless the symptoms clearly support them.
Return strict JSON only — no markdown, no extra text, no reasoning outside the JSON.
Schema:
{
  "urgency": "CRITICAL" | "MODERATE" | "LOW",
  "predictedDisease": "most likely illness or syndrome",
  "differentialDiagnoses": ["2-5 plausible alternatives"],
  "summary": "2 sentences: what pattern these symptoms suggest and why",
  "actionRequired": "practical immediate next steps for the patient/caregiver",
  "callbackWindow": "within 2 hours" | "within 24 hours" | "within 48 hours",
  "redFlags": ["symptoms that should trigger emergency care"],
  "confidence": "LOW" | "MEDIUM" | "HIGH"
}`;

    const contextBlock = patientLines.length > 0 ? `\n${patientLines.join("\n")}\n` : "";
    const user = `${contextBlock}
Symptoms: ${cleanedSymptoms.join(", ")}

Urgency rules:
- CRITICAL: breathing trouble, unconsciousness, seizure, chest pain, severe dehydration, meningitis signs, stroke signs, severe bleeding, sepsis, or serious infectious disease pattern.
- MODERATE: patient needs clinical review but is not currently in immediate danger.
- LOW: mild symptoms with no red flags.`;

    const isChatEndpoint = url.endsWith("/api/chat");
    const payload = isChatEndpoint
      ? {
          model,
          stream: false,
          format: "json",
          keep_alive: keepAlive,
          options: { temperature: 0.2, top_p: 0.85, top_k: 30, num_ctx: numCtx, num_predict: numPredict },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }
      : {
          model,
          stream: false,
          format: "json",
          keep_alive: keepAlive,
          options: { temperature: 0.2, top_p: 0.85, top_k: 30, num_ctx: numCtx, num_predict: numPredict },
          prompt: `${system}\n\n${user}`,
        };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      console.warn(`[LLM] Ollama returned HTTP ${res.status} for: ${cleanedSymptoms.join(", ")}`);
      return null;
    }

    const data = await res.json();
    let responseText = "";
    if (typeof data === "object" && data !== null && "message" in data) {
      responseText = String((data as { message?: { content?: unknown } }).message?.content || "");
    } else if (typeof data === "object" && data !== null && "response" in data) {
      responseText = String((data as { response?: unknown }).response || "");
    }

    const parsed = parseGemmaResponse(responseText);
    if (!parsed) {
      console.warn(`[LLM] Response unparseable — likely truncated (num_predict=${numPredict}). Raw snippet: ${responseText.slice(0, 200)}`);
      return null;
    }

    const result = applySafetyOverrides(parsed, symptoms);
    console.log(`[LLM] ${model}: ${result.predictedDisease} (${result.urgency}, confidence=${result.confidence})`);
    return result;
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    console.warn(`[LLM] ${isTimeout ? "Timed out" : "Error"} for: ${cleanedSymptoms.join(", ")}`, isTimeout ? "" : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// buildPortalResponse helper
// ---------------------------------------------------------------------------
function patientActionText(actionRequired: string): string {
  if (actionRequired.toLowerCase().includes("emergency")) {
    return "Please seek emergency care immediately. Call emergency services or go to the nearest hospital now.";
  }
  if (actionRequired.toLowerCase().includes("urgent")) {
    return "Please seek urgent medical care today. If symptoms worsen rapidly, call emergency services.";
  }
  return actionRequired;
}

export function buildPortalResponse(params: {
  role: "PATIENT" | "CAREGIVER";
  reference: string;
  analysis: SymptomAnalysis;
}) {
  const heading =
    params.role === "PATIENT" && params.analysis.urgency === "CRITICAL"
      ? "SEVAK ALERT — CRITICAL CASE LOGGED"
      : "SEVAK — Case Logged";

  return {
    heading,
    reference: params.reference,
    urgency: params.analysis.urgency,
    callbackMessage: `A clinician callback has been scheduled ${params.analysis.callbackWindow}.`,
    analysis: params.analysis.summary,
    actionRequired:
      params.role === "PATIENT"
        ? patientActionText(params.analysis.actionRequired)
        : params.analysis.actionRequired,
    predictedDisease: params.analysis.predictedDisease,
    differentialDiagnoses: params.analysis.differentialDiagnoses || [],
    redFlags: params.analysis.redFlags || [],
    confidence: params.analysis.confidence || "MEDIUM",
  };
}

// ---------------------------------------------------------------------------
// Main entry point — may return PENDING_ANALYSIS if LLM unavailable and
// cache has no neighbour. Used by batch/seed paths where a placeholder is
// acceptable. Interactive submissions must use `analyzeSymptomsStrict`.
// ---------------------------------------------------------------------------
export async function analyzeSymptoms(symptoms: string[], ctx: PatientContext = {}): Promise<SymptomAnalysis> {
  const llmReady = process.env.SYMPTOM_ANALYZER === "gemma" || isSymptomModelReady();

  if (llmReady) {
    const result = await analyzeWithGemma(symptoms, ctx);
    if (result) {
      void cacheAnalysis(symptoms, result, "llm");
      return result;
    }
    // LLM failed — fall through to cache
    console.warn("[Analyzer] LLM call failed, checking vector cache as fallback.");
  }

  // Check vector cache for a semantically similar past result (context not used for cache key)
  const cached = await findCachedAnalysis(symptoms);
  if (cached) {
    console.log("[Analyzer] Serving result from vector cache.");
    return cached as SymptomAnalysis;
  }

  // Nothing available — return pending placeholder
  console.warn("[Analyzer] LLM unavailable and no cache hit — returning pending placeholder.");
  return PENDING_ANALYSIS;
}

// ---------------------------------------------------------------------------
// Strict entry point — used by interactive patient/caregiver submissions.
// Blocks on LLM warmup and keeps retrying the LLM (with exponential backoff)
// until it returns a real classification. NEVER returns PENDING_ANALYSIS and
// NEVER throws: the caller can rely on always getting a real SymptomAnalysis
// from Gemma (or from a semantically equivalent cached LLM result).
// ---------------------------------------------------------------------------
export async function analyzeSymptomsStrict(
  symptoms: string[],
  ctx: PatientContext = {},
): Promise<SymptomAnalysis> {
  const baseDelayMs = Math.max(100, Number(process.env.GEMMA_STRICT_RETRY_MS || 750));
  const maxDelayMs = Math.max(baseDelayMs, Number(process.env.GEMMA_STRICT_MAX_DELAY_MS || 15000));

  // Block on warmup so the very first submission after boot still gets real AI.
  try {
    await ensureLocalSymptomModel();
  } catch (err) {
    console.warn("[Analyzer] ensureLocalSymptomModel threw — will still attempt LLM.", err);
  }

  let attempt = 0;
  // Unbounded retry loop: the request blocks until the LLM classifies the
  // case. This is intentional — the frontend stays in its "Logging..."
  // state and we never persist a pending placeholder.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    try {
      const result = await analyzeWithGemma(symptoms, ctx);
      if (result) {
        void cacheAnalysis(symptoms, result, "llm");
        if (attempt > 1) {
          console.log(`[Analyzer] Strict: classified on attempt ${attempt}.`);
        }
        return result;
      }
      console.warn(`[Analyzer] Strict attempt ${attempt} produced no result — retrying.`);
    } catch (err) {
      console.warn(`[Analyzer] Strict attempt ${attempt} errored — retrying.`, err);
    }

    // If we have a cached analysis from a previous semantically similar case,
    // we can short-circuit on the second attempt onwards. This lets us avoid
    // burning time on an LLM that's clearly down while still surfacing a
    // real classification.
    if (attempt >= 2) {
      const cached = await findCachedAnalysis(symptoms);
      if (cached) {
        console.log(`[Analyzer] Strict: LLM unavailable after ${attempt} attempts, serving cached result from a similar prior case.`);
        return cached as SymptomAnalysis;
      }
    }

    // Exponential backoff, capped — keeps us polite to a struggling LLM but
    // never gives up. While warmup is still in progress `ensureLocalSymptomModel`
    // will also cheaply await the in-flight warmup promise on next call.
    const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, Math.min(attempt - 1, 6)));
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Re-await warmup in case Ollama was restarted mid-flight.
    try {
      await ensureLocalSymptomModel();
    } catch {
      // Swallow — next LLM attempt will surface the real error.
    }
  }
}
