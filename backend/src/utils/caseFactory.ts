/**
 * Shared case builder for every path that inserts `Case` documents (seed,
 * outbreak trigger, odd-case runner). Routes every field through the
 * existing project utility that owns it — no hardcoded disease names,
 * location strings, model names, or hashes.
 */

import Case from "../models/Case";
import { resolveLocation, getVillageNames } from "./geocode";
import { getAnalysisFingerprint, getAnalysisModelName } from "./analysisFingerprint";
import { analyzeSymptoms, SymptomAnalysis, PatientContext } from "./symptomAnalyzer";
import { SymptomDuration } from "./symptomDuration";
import { RegionHint } from "./illnessGenerator";

// ---------------------------------------------------------------------------
// Worker-phone / reporter-role conventions — mirror the Sevak Portal
// (frontend/src/components/SevakPortal.tsx:134) and the controller
// (backend/src/controllers/caseController.ts:163).
// ---------------------------------------------------------------------------
export const WORKER_PHONE_PATIENT = "Web-Patient";
export const WORKER_PHONE_CAREGIVER = "Web-Caregiver";

export type ReporterRole = "PATIENT" | "CAREGIVER";

export function workerPhoneForRole(role: ReporterRole): string {
  return role === "PATIENT" ? WORKER_PHONE_PATIENT : WORKER_PHONE_CAREGIVER;
}

// ---------------------------------------------------------------------------
// Patient-name generator — pure string assembly, does NOT touch any AI field.
// Names are irrelevant to classification; only `symptoms` + patient context
// influence `analyzeSymptoms()`.
// ---------------------------------------------------------------------------
const FIRST_NAMES = [
  "Aarav", "Priya", "John", "Sarah", "Manoj", "Linda", "Raj", "Anita",
  "James", "Meena", "Rajesh", "Sunita", "Maria", "David", "Vikram",
  "Jennifer", "Pooja", "Ramesh", "Kavita", "Anil", "Lakshmi", "Robert",
  "Rekha", "Dinesh", "Prakash", "Sanjay", "Michelle", "Linda", "Samuel",
];
const LAST_NAMES = [
  "Kumar", "Devi", "Smith", "Garcia", "Shankar", "Johnson", "Miller",
  "Brown", "Yadav", "Kumari", "Patel", "Davis", "Wilson", "Gupta",
  "Chandra", "Tiwari", "Prasad", "Mishra", "Rao", "Taylor", "Obama",
];

export function randomPatientName(): string {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return `${first} ${last}`;
}

// ---------------------------------------------------------------------------
// Location picker — returns real village names for a given RegionHint using
// the JSON-backed geocode data. No hand-written state strings or lat/lng.
// ---------------------------------------------------------------------------

function matchesRegion(state: string, region: RegionHint): boolean {
  if (region === "CT") return /connecticut/i.test(state);
  if (region === "TEXAS") return /texas/i.test(state);
  // India: anything that isn't CT or TX
  return !/connecticut|texas/i.test(state);
}

let cachedByRegion: Record<RegionHint, string[]> | null = null;

export function villagesForRegion(region: RegionHint): string[] {
  if (!cachedByRegion) {
    const all = getVillageNames();
    cachedByRegion = { CT: [], TEXAS: [], INDIA: [] };
    for (const name of all) {
      const loc = resolveLocation(name);
      if (matchesRegion(loc.state, "CT")) cachedByRegion.CT.push(name);
      else if (matchesRegion(loc.state, "TEXAS")) cachedByRegion.TEXAS.push(name);
      else cachedByRegion.INDIA.push(name);
    }
  }
  return cachedByRegion[region];
}

export function pickVillageForRegion(region: RegionHint): string {
  const pool = villagesForRegion(region);
  if (pool.length === 0) {
    throw new Error(`caseFactory: no villages available for region ${region}`);
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------------------------------------------------------------------------
// Analysis cache — keyed on (symptoms, duration). A cluster of cases that
// share the same template therefore reuses one `analyzeSymptoms()` call,
// which is what makes `predictedDisease` stable across the cluster so
// outbreak aggregation can group them correctly.
// ---------------------------------------------------------------------------
const analysisCache = new Map<string, Promise<SymptomAnalysis>>();

function analysisCacheKey(symptoms: string[], duration: SymptomDuration): string {
  return `${duration}::${getAnalysisFingerprint(symptoms)}`;
}

export async function analysisForTemplate(
  symptoms: string[],
  ctx: PatientContext,
): Promise<SymptomAnalysis> {
  const duration = (ctx.symptomDuration || "") as SymptomDuration;
  const key = analysisCacheKey(symptoms, duration);
  const existing = analysisCache.get(key);
  if (existing) return existing;
  const pending = analyzeSymptoms(symptoms, ctx);
  analysisCache.set(key, pending);
  try {
    return await pending;
  } catch (err) {
    analysisCache.delete(key);
    throw err;
  }
}

export function clearAnalysisCache(): void {
  analysisCache.clear();
  cachedByRegion = null;
}

// ---------------------------------------------------------------------------
// Case builder — assembles a Case doc ready for `Case.insertMany` from a
// scenario + location + duration + role. Every field routes through an
// existing utility.
// ---------------------------------------------------------------------------

export interface BuildCaseInput {
  symptoms: string[];
  age: number;
  gender: "Male" | "Female" | "Other";
  village: string;
  symptomDuration: SymptomDuration;
  role: ReporterRole;
  createdAt?: Date;
  /** Optional pre-computed analysis to reuse across a cluster. */
  reuseAnalysis?: SymptomAnalysis;
}

export interface BuildCaseResult {
  doc: Record<string, unknown>;
  analysis: SymptomAnalysis;
  analysisMs: number;
}

export async function buildCaseDoc(input: BuildCaseInput): Promise<BuildCaseResult> {
  const location = resolveLocation(input.village);
  const start = Date.now();
  const analysis =
    input.reuseAnalysis ??
    (await analysisForTemplate(input.symptoms, {
      age: input.age,
      gender: input.gender,
      symptomDuration: input.symptomDuration,
    }));
  const analysisMs = input.reuseAnalysis ? 0 : Date.now() - start;

  const createdAt = input.createdAt ?? new Date();
  const doc: Record<string, unknown> = {
    worker_phone: workerPhoneForRole(input.role),
    patientName: randomPatientName(),
    age: input.age,
    gender: input.gender,
    symptoms: input.symptoms,
    village: location.name,
    district: location.district || location.name,
    state: location.state,
    urgency: analysis.urgency,
    location: {
      type: "Point",
      coordinates: [
        parseFloat(location.lng.toFixed(6)),
        parseFloat(location.lat.toFixed(6)),
      ],
    },
    predictedDisease: analysis.predictedDisease,
    aiAnalysis: analysis.summary,
    recommendedAction: analysis.actionRequired,
    callbackWindow: analysis.callbackWindow,
    differentialDiagnoses: analysis.differentialDiagnoses || [],
    redFlags: analysis.redFlags || [],
    aiConfidence: analysis.confidence,
    aiAnalysisHash: getAnalysisFingerprint(input.symptoms),
    aiModel: getAnalysisModelName(),
    aiAnalyzedAt: new Date(),
    symptomDuration: input.symptomDuration || undefined,
    reporterRole: input.role,
    notes: "",
    createdAt,
    updatedAt: createdAt,
  };
  // `status` intentionally omitted so the schema default ("PENDING") applies.
  return { doc, analysis, analysisMs };
}

export async function insertCases(docs: Record<string, unknown>[]): Promise<number> {
  if (docs.length === 0) return 0;
  const res = await Case.insertMany(docs, { ordered: false });
  return res.length;
}
