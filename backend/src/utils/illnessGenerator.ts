/**
 * LLM-driven illness scenario generator.
 *
 * Ask the local Ollama model to produce diverse illness "scenarios" at
 * runtime. Scenarios carry only symptoms + patient/region hints — they never
 * include a disease name, urgency, or other field the pipeline is supposed
 * to decide. Those fields are filled in later when a case is actually
 * classified via `analyzeSymptoms()`.
 *
 * The generator validates every field against existing project constants
 * (e.g. `SYMPTOM_DURATIONS`), so invalid LLM output is discarded, not stored.
 */

import { NON_EMPTY_SYMPTOM_DURATIONS, SYMPTOM_DURATIONS, SymptomDuration, isValidSymptomDuration } from "./symptomDuration";

export type RegionHint = "CT" | "TEXAS" | "INDIA";
export const REGION_HINTS: RegionHint[] = ["CT", "TEXAS", "INDIA"];

export type SuggestedTier = "OUTBREAK" | "REGIONAL_ALERT" | "PANDEMIC_ALERT" | "BASELINE";
export const SUGGESTED_TIERS: SuggestedTier[] = ["OUTBREAK", "REGIONAL_ALERT", "PANDEMIC_ALERT", "BASELINE"];

export type GenderBias = "Male" | "Female" | "Any";
export const GENDER_BIASES: GenderBias[] = ["Male", "Female", "Any"];

export interface IllnessScenario {
  symptoms: string[];
  regionHints: RegionHint[];
  typicalDurations: SymptomDuration[];
  ageRange: [number, number];
  genderBias: GenderBias;
  suggestedTier: SuggestedTier;
}

export interface OddCaseBundle {
  symptoms: string[];
  symptomDuration: SymptomDuration;
  age: number;
  gender: "Male" | "Female" | "Other";
  regionHint: RegionHint;
}

const OLLAMA_URL = process.env.GEMMA_LOCAL_URL || "http://localhost:11434/api/chat";
const MODEL = process.env.GEMMA_MODEL || "gemma4:e2b";
const KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || "30m";
const NUM_CTX = Number(process.env.GEMMA_NUM_CTX || 4096);
const NUM_PREDICT = Number(process.env.ILLNESS_GEN_NUM_PREDICT || 2800);
const TIMEOUT_MS = Number(process.env.ILLNESS_GEN_TIMEOUT_MS || 120_000);

// ---------------------------------------------------------------------------
// LLM call + JSON extraction
// ---------------------------------------------------------------------------

function extractJson(raw: string): string {
  const withoutFence = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const firstBrace = withoutFence.indexOf("{");
  const firstBracket = withoutFence.indexOf("[");
  // Prefer whichever comes first
  const start =
    firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)
      ? firstBracket
      : firstBrace;
  if (start === -1) return withoutFence;
  const endChar = withoutFence[start] === "{" ? "}" : "]";
  const end = withoutFence.lastIndexOf(endChar);
  if (end <= start) return withoutFence;
  return withoutFence.slice(start, end + 1);
}

async function callLlm(system: string, user: string): Promise<string> {
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      format: "json",
      keep_alive: KEEP_ALIVE,
      options: { temperature: 0.6, top_p: 0.9, num_ctx: NUM_CTX, num_predict: NUM_PREDICT },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status}`);
  const data = (await res.json()) as { message?: { content?: unknown }; response?: unknown };
  const text =
    (data.message && typeof data.message.content === "string" ? data.message.content : undefined) ??
    (typeof data.response === "string" ? data.response : undefined);
  if (!text) throw new Error("LLM response missing content");
  return text;
}

// ---------------------------------------------------------------------------
// Scenario validation
// ---------------------------------------------------------------------------

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string" && v.trim().length > 0);
}

function normaliseRegions(value: unknown): RegionHint[] | null {
  if (!Array.isArray(value)) return null;
  const out: RegionHint[] = [];
  for (const raw of value) {
    const s = String(raw).trim().toUpperCase();
    if (s === "CT" || s === "TEXAS" || s === "INDIA") {
      if (!out.includes(s as RegionHint)) out.push(s as RegionHint);
    }
  }
  return out.length > 0 ? out : null;
}

function normaliseDurations(value: unknown): SymptomDuration[] | null {
  if (!Array.isArray(value)) return null;
  const out: SymptomDuration[] = [];
  for (const raw of value) {
    if (isValidSymptomDuration(raw) && raw !== "" && !out.includes(raw)) {
      out.push(raw);
    }
  }
  return out.length > 0 ? out : null;
}

function normaliseAgeRange(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const min = Number(value[0]);
  const max = Number(value[1]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min < 0 || max > 120 || min > max) return null;
  return [Math.floor(min), Math.floor(max)];
}

function normaliseGender(value: unknown): GenderBias | null {
  const s = String(value || "").trim();
  const mapped = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return GENDER_BIASES.includes(mapped as GenderBias) ? (mapped as GenderBias) : null;
}

function normaliseTier(value: unknown): SuggestedTier | null {
  const s = String(value || "").trim().toUpperCase();
  return SUGGESTED_TIERS.includes(s as SuggestedTier) ? (s as SuggestedTier) : null;
}

function validateScenario(raw: any): IllnessScenario | null {
  if (!raw || typeof raw !== "object") return null;
  if (!isNonEmptyStringArray(raw.symptoms)) return null;
  const symptoms = raw.symptoms.map((s: string) => s.trim()).filter(Boolean);
  if (symptoms.length === 0) return null;
  const regionHints = normaliseRegions(raw.regionHints);
  if (!regionHints) return null;
  const typicalDurations = normaliseDurations(raw.typicalDurations);
  if (!typicalDurations) return null;
  const ageRange = normaliseAgeRange(raw.ageRange);
  if (!ageRange) return null;
  const genderBias = normaliseGender(raw.genderBias);
  if (!genderBias) return null;
  const suggestedTier = normaliseTier(raw.suggestedTier);
  if (!suggestedTier) return null;
  return { symptoms, regionHints, typicalDurations, ageRange, genderBias, suggestedTier };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const SCENARIOS_SYSTEM_PROMPT = `You are an epidemiology research assistant generating synthetic patient scenarios for stress-testing a community health dashboard.
You output STRICT JSON only — no markdown, no commentary, no reasoning outside the JSON.
Each scenario describes a plausible illness as a patient would report it, not as a clinician would abbreviate it.
You must obey the exact schema described in the user message.
You may NOT include the illness name, diagnosis, urgency, confidence, differential diagnoses, or red flags — those fields are produced downstream by another model.`;

function buildScenariosUserPrompt(count: number): string {
  return `Generate ${count} unique illness scenarios as a JSON object with a single key "scenarios" whose value is an array of length ${count}.

Each element must match this schema exactly:
{
  "symptoms": string[],                          // 2–5 first-person, natural-language phrases a patient would type (may include multiple sentences, punctuation, or \\n line breaks). No clinical shorthand.
  "regionHints": ("CT" | "TEXAS" | "INDIA")[],   // 1–3 entries, only these three values are allowed
  "typicalDurations": string[],                   // non-empty, strictly drawn from: ${JSON.stringify(NON_EMPTY_SYMPTOM_DURATIONS)}
  "ageRange": [number, number],                   // [min, max], 0 ≤ min ≤ max ≤ 120
  "genderBias": "Male" | "Female" | "Any",
  "suggestedTier": "OUTBREAK" | "REGIONAL_ALERT" | "PANDEMIC_ALERT" | "BASELINE"
}

Coverage requirements:
- At least 5 scenarios with regionHints specific to CT (illnesses/exposures plausible in New England tick/woodland/urban contexts, e.g. Lyme, EEE, seasonal respiratory).
- At least 5 scenarios specific to TEXAS (e.g. Valley Fever, West Nile, Gulf-coast enteric, heat illness, Chagas).
- At least 5 scenarios specific to INDIA (e.g. Dengue, Chikungunya, Typhoid, Japanese Encephalitis, Kala-azar, Cholera, TB, monsoon-related gastroenteritis).
- At least 3 scenarios with suggestedTier="OUTBREAK" (acute, clustering-prone illnesses), 3 with "REGIONAL_ALERT", 3 with "PANDEMIC_ALERT" (highly transmissible, multi-state potential).
- Remaining scenarios "BASELINE" (non-clustering, everyday presentations).
- All scenarios must be medically distinct from each other.

Return exactly: {"scenarios": [ ... ${count} entries ... ]}. No other keys.`;
}

/** Generate and validate N illness scenarios. Retries with a reduced target if validation drops too many. */
export async function generateIllnessScenarios(count = 25): Promise<IllnessScenario[]> {
  const attempts = 3;
  let collected: IllnessScenario[] = [];
  for (let i = 0; i < attempts && collected.length < count; i++) {
    const need = count - collected.length;
    const raw = await callLlm(SCENARIOS_SYSTEM_PROMPT, buildScenariosUserPrompt(need + Math.min(5, need)));
    let parsed: any;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch {
      continue;
    }
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.scenarios) ? parsed.scenarios : [];
    for (const entry of list) {
      const s = validateScenario(entry);
      if (s) collected.push(s);
      if (collected.length >= count) break;
    }
  }
  if (collected.length === 0) {
    throw new Error("illnessGenerator: LLM produced no valid scenarios after retries");
  }
  return collected.slice(0, count);
}

const ODD_CASE_SYSTEM_PROMPT = `You are helping stress-test a community-health triage LLM.
Produce deliberately ambiguous, atypical, or overlapping symptom bundles as a patient would describe them.
Output STRICT JSON only. Never include a disease name, urgency, or clinical diagnosis — downstream classification will do that.`;

function buildOddCaseUserPrompt(count: number): string {
  return `Generate ${count} unique "odd case" patient reports as a JSON object with key "oddCases" whose value is an array of length ${count}.

Schema per element:
{
  "symptoms": string[],                           // 2–6 first-person phrases; allow rare combos, overlapping syndromes, or context cues (travel, exposure, pre-existing conditions)
  "symptomDuration": string,                       // exactly one of: ${JSON.stringify(NON_EMPTY_SYMPTOM_DURATIONS)}
  "age": number,                                   // 0–120
  "gender": "Male" | "Female" | "Other",
  "regionHint": "CT" | "TEXAS" | "INDIA"
}

The bundles should push differential-diagnosis reasoning (e.g. rare zoonoses, atypical autoimmune presentations, overlapping metabolic + infectious signs, post-viral sequelae). No disease labels anywhere.
Return exactly: {"oddCases": [ ... ${count} entries ... ]}.`;
}

function validateOddCase(raw: any): OddCaseBundle | null {
  if (!raw || typeof raw !== "object") return null;
  if (!isNonEmptyStringArray(raw.symptoms)) return null;
  const symptoms = raw.symptoms.map((s: string) => s.trim()).filter(Boolean);
  if (symptoms.length === 0) return null;
  const duration = raw.symptomDuration;
  if (!isValidSymptomDuration(duration) || duration === "") return null;
  const age = Number(raw.age);
  if (!Number.isFinite(age) || age < 0 || age > 120) return null;
  const gender = ["Male", "Female", "Other"].includes(raw.gender) ? raw.gender : null;
  if (!gender) return null;
  const regionHint = REGION_HINTS.includes(String(raw.regionHint).toUpperCase() as RegionHint)
    ? (String(raw.regionHint).toUpperCase() as RegionHint)
    : null;
  if (!regionHint) return null;
  return {
    symptoms,
    symptomDuration: duration,
    age: Math.floor(age),
    gender: gender as "Male" | "Female" | "Other",
    regionHint,
  };
}

export async function generateOddCases(count = 20): Promise<OddCaseBundle[]> {
  const attempts = 3;
  let collected: OddCaseBundle[] = [];
  for (let i = 0; i < attempts && collected.length < count; i++) {
    const need = count - collected.length;
    const raw = await callLlm(ODD_CASE_SYSTEM_PROMPT, buildOddCaseUserPrompt(need + Math.min(5, need)));
    let parsed: any;
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch {
      continue;
    }
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.oddCases) ? parsed.oddCases : [];
    for (const entry of list) {
      const b = validateOddCase(entry);
      if (b) collected.push(b);
      if (collected.length >= count) break;
    }
  }
  if (collected.length === 0) {
    throw new Error("illnessGenerator: LLM produced no valid odd cases after retries");
  }
  return collected.slice(0, count);
}

const PARAPHRASE_SYSTEM_PROMPT = `You rewrite symptom phrases while preserving their clinical meaning.
Output STRICT JSON only.`;

export interface ParaphrasePair {
  original: string[];
  paraphrased: string[];
}

/**
 * Ask the LLM to paraphrase each symptom list in `bases` so that the
 * paraphrase means the same thing but uses different wording. Used by the
 * vector-cache stress test to probe semantic similarity hits.
 */
export async function paraphraseSymptomSets(bases: string[][]): Promise<ParaphrasePair[]> {
  if (bases.length === 0) return [];
  const user = `For each entry in the "inputs" array, produce a paraphrased version of the symptoms that means the same thing medically but uses different wording (synonyms, different sentence structure, patient-voice).
Return JSON: {"pairs": [{"original": [...], "paraphrased": [...]}]} with the same length and order as "inputs".

inputs = ${JSON.stringify(bases)}`;
  const raw = await callLlm(PARAPHRASE_SYSTEM_PROMPT, user);
  let parsed: any;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    return bases.map((b) => ({ original: b, paraphrased: b }));
  }
  const pairs = Array.isArray(parsed?.pairs) ? parsed.pairs : [];
  const out: ParaphrasePair[] = [];
  for (let i = 0; i < bases.length; i++) {
    const entry = pairs[i];
    if (
      entry &&
      isNonEmptyStringArray(entry.original) &&
      isNonEmptyStringArray(entry.paraphrased)
    ) {
      out.push({ original: entry.original, paraphrased: entry.paraphrased });
    } else {
      out.push({ original: bases[i], paraphrased: bases[i] });
    }
  }
  return out;
}

// Re-export so callers don't have to import from two places
export { SYMPTOM_DURATIONS, NON_EMPTY_SYMPTOM_DURATIONS };
