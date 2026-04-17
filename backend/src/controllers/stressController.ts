/**
 * Stress-test controller — powers the `/api/stress/*` endpoints.
 *
 * Every handler reuses the shared utilities:
 *   - `caseFactory.buildCaseDoc`              — builds Case docs from scenarios
 *   - `analyzeSymptoms` / `findCachedAnalysis`/`cacheAnalysis` — LLM + cache
 *   - `illnessGenerator`                       — LLM-produced scenarios
 *   - `resolveLocation` / `getVillageNames`    — geo data
 *   - `getAnalysisFingerprint` / `getAnalysisModelName`
 *
 * Each handler returns `{ ok, durationMs, ...payload }` so Postman can track
 * per-request performance.
 */

import { Request, Response } from "express";
import Case from "../models/Case";
import SymptomCache from "../models/SymptomCache";

import {
  generateIllnessScenarios,
  generateOddCases,
  paraphraseSymptomSets,
  IllnessScenario,
  RegionHint,
  SuggestedTier,
} from "../utils/illnessGenerator";
import {
  buildCaseDoc,
  insertCases,
  pickVillageForRegion,
  villagesForRegion,
  analysisForTemplate,
  clearAnalysisCache,
  ReporterRole,
} from "../utils/caseFactory";
import { findCachedAnalysis, cacheAnalysis } from "../utils/symptomVectorCache";
import { SymptomDuration, NON_EMPTY_SYMPTOM_DURATIONS } from "../utils/symptomDuration";
import { ensureLocalSymptomModel, isSymptomModelReady } from "../utils/localModel";
import { SymptomAnalysis } from "../utils/symptomAnalyzer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summariseLatencies(samples: number[]) {
  if (samples.length === 0) return { count: 0, p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Number(avg.toFixed(2)),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickOne<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function roleFromScenario(scenario: IllnessScenario): ReporterRole {
  // Alternate so both Web-Patient and Web-Caregiver get exercised, with a
  // small random flip — the role itself is metadata, not something the LLM
  // decides.
  return Math.random() < 0.55 ? "PATIENT" : "CAREGIVER";
}

function genderFromBias(bias: IllnessScenario["genderBias"]): "Male" | "Female" | "Other" {
  if (bias === "Male") return "Male";
  if (bias === "Female") return "Female";
  return pickOne(["Male", "Female", "Other"] as const);
}

async function ensureLlmReady(): Promise<void> {
  await ensureLocalSymptomModel();
  if (!isSymptomModelReady() && process.env.SYMPTOM_ANALYZER !== "gemma") {
    throw new Error("LLM is not ready — refusing to run stress seed (cases would be PENDING placeholders)");
  }
}

// ---------------------------------------------------------------------------
// In-memory scenario cache so multi-step runs (seed → outbreak → odd-cases)
// share the same set of illnesses within one stress session.
// ---------------------------------------------------------------------------
let cachedScenarios: IllnessScenario[] | null = null;

async function getScenarios(count: number, force: boolean): Promise<IllnessScenario[]> {
  if (!force && cachedScenarios && cachedScenarios.length >= count) {
    return cachedScenarios.slice(0, count);
  }
  cachedScenarios = await generateIllnessScenarios(count);
  return cachedScenarios;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** POST /api/stress/reset */
export async function resetHandler(_req: Request, res: Response) {
  const start = Date.now();
  try {
    const [cases, cache] = await Promise.all([
      Case.deleteMany({}),
      SymptomCache.deleteMany({}),
    ]);
    clearAnalysisCache();
    cachedScenarios = null;
    res.json({
      ok: true,
      durationMs: Date.now() - start,
      deleted: { cases: cases.deletedCount ?? 0, symptomCache: cache.deletedCount ?? 0 },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err), durationMs: Date.now() - start });
  }
}

/** POST /api/stress/illnesses */
export async function illnessesHandler(req: Request, res: Response) {
  const start = Date.now();
  try {
    await ensureLlmReady();
    const count = Number(req.body?.count ?? 25);
    const force = Boolean(req.body?.force);
    const scenarios = await getScenarios(count, force);
    res.json({
      ok: true,
      durationMs: Date.now() - start,
      count: scenarios.length,
      scenarios,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err), durationMs: Date.now() - start });
  }
}

interface SeedBody {
  total?: number;
  split?: { india?: number; ct?: number; tx?: number };
  scenarios?: IllnessScenario[];
  regenerateScenarios?: boolean;
}

/** POST /api/stress/seed */
export async function seedHandler(req: Request, res: Response) {
  const start = Date.now();
  try {
    await ensureLlmReady();
    const body = (req.body || {}) as SeedBody;
    const total = Number.isFinite(body.total) ? Number(body.total) : 200;
    const split = {
      INDIA: Math.max(0, Math.floor(body.split?.india ?? Math.round(total * 0.6))),
      CT: Math.max(0, Math.floor(body.split?.ct ?? Math.round(total * 0.2))),
      TEXAS: Math.max(0, Math.floor(body.split?.tx ?? Math.round(total * 0.2))),
    } as Record<RegionHint, number>;
    // Rebalance to match total exactly
    const assigned = split.INDIA + split.CT + split.TEXAS;
    if (assigned !== total) split.INDIA += total - assigned;

    const scenarios = body.scenarios && body.scenarios.length > 0
      ? body.scenarios
      : await getScenarios(25, Boolean(body.regenerateScenarios));

    // Partition scenarios by region for deterministic pool selection
    const scenariosByRegion: Record<RegionHint, IllnessScenario[]> = { CT: [], TEXAS: [], INDIA: [] };
    for (const s of scenarios) {
      for (const r of s.regionHints) scenariosByRegion[r].push(s);
    }
    for (const r of ["CT", "TEXAS", "INDIA"] as RegionHint[]) {
      if (scenariosByRegion[r].length === 0) scenariosByRegion[r] = scenarios; // fallback to all
    }

    const perCaseMs: number[] = [];
    const analysisMsSamples: number[] = [];
    const docs: Record<string, unknown>[] = [];
    const byRegion: Record<RegionHint, number> = { CT: 0, TEXAS: 0, INDIA: 0 };
    const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;

    for (const region of ["INDIA", "CT", "TEXAS"] as RegionHint[]) {
      if (villagesForRegion(region).length === 0) continue;
      for (let i = 0; i < split[region]; i++) {
        const caseStart = Date.now();
        const scenario = pickOne(scenariosByRegion[region]);
        const duration = pickOne(scenario.typicalDurations as SymptomDuration[]);
        const age = randomInRange(scenario.ageRange[0], scenario.ageRange[1]);
        const built = await buildCaseDoc({
          symptoms: scenario.symptoms,
          age,
          gender: genderFromBias(scenario.genderBias),
          village: pickVillageForRegion(region),
          symptomDuration: duration,
          role: roleFromScenario(scenario),
          createdAt: new Date(Date.now() - Math.random() * twoWeeksMs),
        });
        docs.push(built.doc);
        byRegion[region]++;
        perCaseMs.push(Date.now() - caseStart);
        if (built.analysisMs > 0) analysisMsSamples.push(built.analysisMs);
      }
    }

    const inserted = await insertCases(docs);
    res.json({
      ok: true,
      durationMs: Date.now() - start,
      inserted,
      byRegion,
      split,
      perCaseMs: summariseLatencies(perCaseMs),
      llmAnalysisMs: summariseLatencies(analysisMsSamples),
      scenariosUsed: scenarios.length,
    });
  } catch (err) {
    console.error("[stress/seed]", err);
    res.status(500).json({ ok: false, error: String(err), durationMs: Date.now() - start });
  }
}

interface OutbreakBody {
  tier?: "village" | "regional" | "pandemic" | "all";
  scenarios?: IllnessScenario[];
}

interface ClusterSummary {
  tier: "OUTBREAK" | "REGIONAL_ALERT" | "PANDEMIC_ALERT";
  size: number;
  predictedDisease: string;
  urgency: string;
  scope: string;
}

async function runCluster(params: {
  scenario: IllnessScenario;
  size: number;
  daysBack: number;
  region: RegionHint;
  state?: string;
  village?: string;
}): Promise<{ docs: Record<string, unknown>[]; analysis: SymptomAnalysis; scope: string }> {
  const duration = pickOne(params.scenario.typicalDurations as SymptomDuration[]);
  const age = randomInRange(params.scenario.ageRange[0], params.scenario.ageRange[1]);
  // Pre-compute the analysis once so every case in the cluster shares the
  // same predictedDisease string (that's how tier aggregation groups them).
  const analysis = await analysisForTemplate(params.scenario.symptoms, {
    age,
    gender: params.scenario.genderBias === "Any" ? undefined : params.scenario.genderBias,
    symptomDuration: duration,
  });

  const docs: Record<string, unknown>[] = [];
  const windowMs = params.daysBack * 24 * 60 * 60 * 1000;
  let scope = params.region as string;

  for (let i = 0; i < params.size; i++) {
    let village: string;
    if (params.village) {
      village = params.village;
    } else if (params.state) {
      // pick any village in this state
      const all = villagesForRegion(params.region);
      // `resolveLocation(name).state` is the canonical state; we filter inline
      const inState = all.filter((v) => {
        const { resolveLocation } = require("../utils/geocode") as typeof import("../utils/geocode");
        return resolveLocation(v).state === params.state;
      });
      const pool = inState.length > 0 ? inState : all;
      village = pickOne(pool);
    } else {
      village = pickVillageForRegion(params.region);
    }

    const built = await buildCaseDoc({
      symptoms: params.scenario.symptoms,
      age,
      gender: genderFromBias(params.scenario.genderBias),
      village,
      symptomDuration: duration,
      role: roleFromScenario(params.scenario),
      createdAt: new Date(Date.now() - Math.random() * windowMs),
      reuseAnalysis: analysis,
    });
    docs.push(built.doc);
    if (i === 0) scope = (built.doc.state as string) || scope;
  }

  if (params.village) scope = params.village;
  return { docs, analysis, scope };
}

/** POST /api/stress/outbreak */
export async function outbreakHandler(req: Request, res: Response) {
  const start = Date.now();
  try {
    await ensureLlmReady();
    const body = (req.body || {}) as OutbreakBody;
    const tier = (body.tier ?? "all") as NonNullable<OutbreakBody["tier"]>;

    const scenarios = body.scenarios && body.scenarios.length > 0
      ? body.scenarios
      : await getScenarios(25, false);

    function pickByTier(t: SuggestedTier, fallbackIdx: number): IllnessScenario {
      const matching = scenarios.filter((s) => s.suggestedTier === t);
      if (matching.length > 0) return pickOne(matching);
      return scenarios[fallbackIdx % scenarios.length];
    }

    const clusters: ClusterSummary[] = [];
    const allDocs: Record<string, unknown>[] = [];

    if (tier === "village" || tier === "all") {
      const scenario = pickByTier("OUTBREAK", 0);
      const region = pickOne(scenario.regionHints);
      const village = pickVillageForRegion(region);
      const { docs, analysis } = await runCluster({
        scenario,
        size: 5,
        daysBack: 3,
        region,
        village,
      });
      allDocs.push(...docs);
      clusters.push({
        tier: "OUTBREAK",
        size: docs.length,
        predictedDisease: analysis.predictedDisease,
        urgency: analysis.urgency,
        scope: village,
      });
    }

    if (tier === "regional" || tier === "all") {
      const scenario = pickByTier("REGIONAL_ALERT", 1);
      // Use a region/scenario that is different from village cluster if "all"
      const region = pickOne(scenario.regionHints);
      // Pick a state deterministically — first village's state in the region pool
      const { resolveLocation } = require("../utils/geocode") as typeof import("../utils/geocode");
      const candidateVillage = pickVillageForRegion(region);
      const state = resolveLocation(candidateVillage).state;
      const { docs, analysis } = await runCluster({
        scenario,
        size: 18,
        daysBack: 5,
        region,
        state,
      });
      allDocs.push(...docs);
      clusters.push({
        tier: "REGIONAL_ALERT",
        size: docs.length,
        predictedDisease: analysis.predictedDisease,
        urgency: analysis.urgency,
        scope: state,
      });
    }

    if (tier === "pandemic" || tier === "all") {
      const scenario = pickByTier("PANDEMIC_ALERT", 2);
      // Spread across 3 distinct states. Prefer India (largest pool) if
      // scenario allows, else fall back to its first regionHint.
      const region: RegionHint = scenario.regionHints.includes("INDIA")
        ? "INDIA"
        : scenario.regionHints[0];
      const { resolveLocation } = require("../utils/geocode") as typeof import("../utils/geocode");
      // Gather 3 distinct states from the region pool
      const all = villagesForRegion(region);
      const seenStates = new Set<string>();
      const stateOrder: string[] = [];
      for (const v of all) {
        const s = resolveLocation(v).state;
        if (!seenStates.has(s)) {
          seenStates.add(s);
          stateOrder.push(s);
        }
        if (stateOrder.length >= 3) break;
      }
      const states = stateOrder.slice(0, 3);
      const perState = [12, 12, 12]; // 36 total

      // First cluster establishes the canonical analysis; reuse it for the others
      const firstAnalysis = await analysisForTemplate(scenario.symptoms, {
        age: randomInRange(scenario.ageRange[0], scenario.ageRange[1]),
        gender: scenario.genderBias === "Any" ? undefined : scenario.genderBias,
        symptomDuration: pickOne(scenario.typicalDurations as SymptomDuration[]),
      });

      let pandemicDocs: Record<string, unknown>[] = [];
      for (let idx = 0; idx < states.length; idx++) {
        const stateName = states[idx];
        // pick villages in this state
        const villagesInState = all.filter((v) => resolveLocation(v).state === stateName);
        const pool = villagesInState.length > 0 ? villagesInState : all;
        const size = perState[idx];
        for (let i = 0; i < size; i++) {
          const built = await buildCaseDoc({
            symptoms: scenario.symptoms,
            age: randomInRange(scenario.ageRange[0], scenario.ageRange[1]),
            gender: genderFromBias(scenario.genderBias),
            village: pickOne(pool),
            symptomDuration: pickOne(scenario.typicalDurations as SymptomDuration[]),
            role: roleFromScenario(scenario),
            createdAt: new Date(Date.now() - Math.random() * 10 * 24 * 60 * 60 * 1000),
            reuseAnalysis: firstAnalysis,
          });
          pandemicDocs.push(built.doc);
        }
      }
      allDocs.push(...pandemicDocs);
      clusters.push({
        tier: "PANDEMIC_ALERT",
        size: pandemicDocs.length,
        predictedDisease: firstAnalysis.predictedDisease,
        urgency: firstAnalysis.urgency,
        scope: states.join(" + "),
      });
    }

    const inserted = await insertCases(allDocs);
    res.json({
      ok: true,
      durationMs: Date.now() - start,
      inserted,
      clusters,
    });
  } catch (err) {
    console.error("[stress/outbreak]", err);
    res.status(500).json({ ok: false, error: String(err), durationMs: Date.now() - start });
  }
}

interface VectorBenchBody {
  seedCount?: number;
  probeCount?: number;
}

/** POST /api/stress/vector-bench */
export async function vectorBenchHandler(req: Request, res: Response) {
  const start = Date.now();
  try {
    await ensureLlmReady();
    const body = (req.body || {}) as VectorBenchBody;
    const seedCount = Math.min(500, Math.max(10, Number(body.seedCount ?? 150)));
    const probeCount = Math.min(200, Math.max(10, Number(body.probeCount ?? 100)));

    // Wipe cache so the bench starts clean
    await SymptomCache.deleteMany({});

    // Get (or generate) enough scenarios to seed the cache. Use the in-memory
    // cache if already populated so this endpoint can run standalone.
    const scenarios = await getScenarios(Math.min(25, seedCount), false);

    // Seed the cache by analysing `seedCount` symptom sets. Scenarios are
    // cycled through; within a scenario we vary the duration to exercise the
    // analysis cache key.
    const seedSets: string[][] = [];
    for (let i = 0; i < seedCount; i++) {
      const scenario = scenarios[i % scenarios.length];
      seedSets.push(scenario.symptoms);
      const duration = scenario.typicalDurations[i % scenario.typicalDurations.length] as SymptomDuration;
      const analysis = await analysisForTemplate(scenario.symptoms, {
        age: randomInRange(scenario.ageRange[0], scenario.ageRange[1]),
        gender: scenario.genderBias === "Any" ? undefined : scenario.genderBias,
        symptomDuration: duration,
      });
      // `analyzeSymptoms()` caches in the background during normal request flow.
      // For benchmarking we need the persistent SymptomCache to be populated
      // deterministically before probes run, so persist it explicitly.
      await cacheAnalysis(scenario.symptoms, analysis, "llm");
    }

    // Build probe pools
    const exactProbes = seedSets
      .slice(0, probeCount)
      .map((s) => [...s].reverse().map((x) => x.toUpperCase()));

    // Semantic probes — paraphrase each seed set via LLM
    const bases = seedSets.slice(0, Math.min(probeCount, 30));
    const paraphrased = await paraphraseSymptomSets(bases);
    const semanticProbes = paraphrased.map((p) => p.paraphrased);

    // Nonsense probes — random token bags
    const nonsenseWords = [
      "xylophone", "quartz", "pelican", "cinnamon", "thunderhead",
      "submarine", "velvet", "neutrino", "pistachio", "rhombus",
      "calligraphy", "basilisk", "mezzanine", "ornithology", "chrysalis",
    ];
    const nonsenseProbes: string[][] = [];
    for (let i = 0; i < probeCount; i++) {
      nonsenseProbes.push([
        pickOne(nonsenseWords),
        pickOne(nonsenseWords),
        pickOne(nonsenseWords),
      ]);
    }

    async function runBatch(label: string, probes: string[][]) {
      const latencies: number[] = [];
      let hits = 0;
      for (const probe of probes) {
        const t = Date.now();
        const result = await findCachedAnalysis(probe);
        latencies.push(Date.now() - t);
        if (result) hits++;
      }
      return {
        label,
        count: probes.length,
        hits,
        hitRate: probes.length > 0 ? Number((hits / probes.length).toFixed(3)) : 0,
        latencyMs: summariseLatencies(latencies),
      };
    }

    const exact = await runBatch("exact", exactProbes);
    const semantic = await runBatch("semantic", semanticProbes);
    const nonsense = await runBatch("nonsense", nonsenseProbes);

    res.json({
      ok: true,
      durationMs: Date.now() - start,
      seedCount,
      probeCount,
      exact,
      semantic,
      nonsense,
      cacheSize: await SymptomCache.countDocuments({}),
    });
  } catch (err) {
    console.error("[stress/vector-bench]", err);
    res.status(500).json({ ok: false, error: String(err), durationMs: Date.now() - start });
  }
}

/** POST /api/stress/odd-cases */
export async function oddCasesHandler(req: Request, res: Response) {
  const start = Date.now();
  try {
    await ensureLlmReady();
    const count = Math.min(50, Math.max(1, Number(req.body?.count ?? 20)));
    const bundles = await generateOddCases(count);

    const docs: Record<string, unknown>[] = [];
    const latencies: number[] = [];
    const observations: Array<{
      symptoms: string[];
      predictedDisease: string;
      urgency: string;
      confidence?: string;
      region: RegionHint;
      age: number;
      duration: SymptomDuration;
    }> = [];

    for (const bundle of bundles) {
      const caseStart = Date.now();
      const village = pickVillageForRegion(bundle.regionHint);
      const built = await buildCaseDoc({
        symptoms: bundle.symptoms,
        age: bundle.age,
        gender: bundle.gender,
        village,
        symptomDuration: bundle.symptomDuration,
        role: Math.random() < 0.5 ? "PATIENT" : "CAREGIVER",
      });
      docs.push(built.doc);
      latencies.push(Date.now() - caseStart);
      observations.push({
        symptoms: bundle.symptoms,
        predictedDisease: built.analysis.predictedDisease,
        urgency: built.analysis.urgency,
        confidence: built.analysis.confidence,
        region: bundle.regionHint,
        age: bundle.age,
        duration: bundle.symptomDuration,
      });
    }

    const inserted = await insertCases(docs);
    res.json({
      ok: true,
      durationMs: Date.now() - start,
      inserted,
      perCaseMs: summariseLatencies(latencies),
      observations,
    });
  } catch (err) {
    console.error("[stress/odd-cases]", err);
    res.status(500).json({ ok: false, error: String(err), durationMs: Date.now() - start });
  }
}

/** POST /api/stress/full-run — chains reset → illnesses → seed → outbreak → odd → vector-bench */
export async function fullRunHandler(req: Request, res: Response) {
  const start = Date.now();
  const report: Record<string, unknown> = { ok: true, steps: {} };
  try {
    await ensureLlmReady();
    const total = Number(req.body?.total ?? 200);

    // Step 1 — reset
    let stepStart = Date.now();
    const [casesDel, cacheDel] = await Promise.all([Case.deleteMany({}), SymptomCache.deleteMany({})]);
    clearAnalysisCache();
    cachedScenarios = null;
    (report.steps as any).reset = {
      durationMs: Date.now() - stepStart,
      deleted: { cases: casesDel.deletedCount ?? 0, symptomCache: cacheDel.deletedCount ?? 0 },
    };

    // Step 2 — illnesses
    stepStart = Date.now();
    const scenarios = await getScenarios(25, true);
    (report.steps as any).illnesses = {
      durationMs: Date.now() - stepStart,
      count: scenarios.length,
    };

    // Step 3 — seed
    await seedInternal(total, scenarios, report);

    // Step 4 — outbreak (all tiers)
    await outbreakInternal(scenarios, report);

    // Step 5 — odd cases
    await oddCasesInternal(20, report);

    // Step 6 — vector bench
    await vectorBenchInternal(scenarios, report);

    report.durationMs = Date.now() - start;
    res.json(report);
  } catch (err) {
    console.error("[stress/full-run]", err);
    res.status(500).json({
      ok: false,
      error: String(err),
      durationMs: Date.now() - start,
      partialReport: report,
    });
  }
}

async function seedInternal(total: number, scenarios: IllnessScenario[], report: Record<string, unknown>) {
  const stepStart = Date.now();
  const split = {
    INDIA: Math.round(total * 0.6),
    CT: Math.round(total * 0.2),
    TEXAS: Math.round(total * 0.2),
  } as Record<RegionHint, number>;
  const assigned = split.INDIA + split.CT + split.TEXAS;
  if (assigned !== total) split.INDIA += total - assigned;

  const scenariosByRegion: Record<RegionHint, IllnessScenario[]> = { CT: [], TEXAS: [], INDIA: [] };
  for (const s of scenarios) for (const r of s.regionHints) scenariosByRegion[r].push(s);
  for (const r of ["CT", "TEXAS", "INDIA"] as RegionHint[]) {
    if (scenariosByRegion[r].length === 0) scenariosByRegion[r] = scenarios;
  }

  const perCaseMs: number[] = [];
  const docs: Record<string, unknown>[] = [];
  const byRegion: Record<RegionHint, number> = { CT: 0, TEXAS: 0, INDIA: 0 };
  const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;

  for (const region of ["INDIA", "CT", "TEXAS"] as RegionHint[]) {
    if (villagesForRegion(region).length === 0) continue;
    for (let i = 0; i < split[region]; i++) {
      const caseStart = Date.now();
      const scenario = pickOne(scenariosByRegion[region]);
      const duration = pickOne(scenario.typicalDurations as SymptomDuration[]);
      const age = randomInRange(scenario.ageRange[0], scenario.ageRange[1]);
      const built = await buildCaseDoc({
        symptoms: scenario.symptoms,
        age,
        gender: genderFromBias(scenario.genderBias),
        village: pickVillageForRegion(region),
        symptomDuration: duration,
        role: roleFromScenario(scenario),
        createdAt: new Date(Date.now() - Math.random() * twoWeeksMs),
      });
      docs.push(built.doc);
      byRegion[region]++;
      perCaseMs.push(Date.now() - caseStart);
    }
  }
  const inserted = await insertCases(docs);
  (report.steps as any).seed = {
    durationMs: Date.now() - stepStart,
    inserted,
    byRegion,
    split,
    perCaseMs: summariseLatencies(perCaseMs),
  };
}

async function outbreakInternal(scenarios: IllnessScenario[], report: Record<string, unknown>) {
  const stepStart = Date.now();
  const clusters: ClusterSummary[] = [];
  const allDocs: Record<string, unknown>[] = [];

  function pickByTier(t: SuggestedTier, idx: number) {
    const matching = scenarios.filter((s) => s.suggestedTier === t);
    return matching.length > 0 ? pickOne(matching) : scenarios[idx % scenarios.length];
  }

  // Village
  {
    const scenario = pickByTier("OUTBREAK", 0);
    const region = pickOne(scenario.regionHints);
    const village = pickVillageForRegion(region);
    const { docs, analysis } = await runCluster({ scenario, size: 5, daysBack: 3, region, village });
    allDocs.push(...docs);
    clusters.push({ tier: "OUTBREAK", size: docs.length, predictedDisease: analysis.predictedDisease, urgency: analysis.urgency, scope: village });
  }

  // Regional
  {
    const scenario = pickByTier("REGIONAL_ALERT", 1);
    const region = pickOne(scenario.regionHints);
    const { resolveLocation } = require("../utils/geocode") as typeof import("../utils/geocode");
    const candidateVillage = pickVillageForRegion(region);
    const state = resolveLocation(candidateVillage).state;
    const { docs, analysis } = await runCluster({ scenario, size: 18, daysBack: 5, region, state });
    allDocs.push(...docs);
    clusters.push({ tier: "REGIONAL_ALERT", size: docs.length, predictedDisease: analysis.predictedDisease, urgency: analysis.urgency, scope: state });
  }

  // Pandemic — spread across 3 states
  {
    const scenario = pickByTier("PANDEMIC_ALERT", 2);
    const region: RegionHint = scenario.regionHints.includes("INDIA") ? "INDIA" : scenario.regionHints[0];
    const { resolveLocation } = require("../utils/geocode") as typeof import("../utils/geocode");
    const all = villagesForRegion(region);
    const seenStates = new Set<string>();
    const stateOrder: string[] = [];
    for (const v of all) {
      const s = resolveLocation(v).state;
      if (!seenStates.has(s)) { seenStates.add(s); stateOrder.push(s); }
      if (stateOrder.length >= 3) break;
    }
    const firstAnalysis = await analysisForTemplate(scenario.symptoms, {
      age: randomInRange(scenario.ageRange[0], scenario.ageRange[1]),
      gender: scenario.genderBias === "Any" ? undefined : scenario.genderBias,
      symptomDuration: pickOne(scenario.typicalDurations as SymptomDuration[]),
    });
    const docs: Record<string, unknown>[] = [];
    for (const stateName of stateOrder) {
      const pool = all.filter((v) => resolveLocation(v).state === stateName);
      const bucket = pool.length > 0 ? pool : all;
      for (let i = 0; i < 12; i++) {
        const built = await buildCaseDoc({
          symptoms: scenario.symptoms,
          age: randomInRange(scenario.ageRange[0], scenario.ageRange[1]),
          gender: genderFromBias(scenario.genderBias),
          village: pickOne(bucket),
          symptomDuration: pickOne(scenario.typicalDurations as SymptomDuration[]),
          role: roleFromScenario(scenario),
          createdAt: new Date(Date.now() - Math.random() * 10 * 24 * 60 * 60 * 1000),
          reuseAnalysis: firstAnalysis,
        });
        docs.push(built.doc);
      }
    }
    allDocs.push(...docs);
    clusters.push({ tier: "PANDEMIC_ALERT", size: docs.length, predictedDisease: firstAnalysis.predictedDisease, urgency: firstAnalysis.urgency, scope: stateOrder.join(" + ") });
  }

  const inserted = await insertCases(allDocs);
  (report.steps as any).outbreak = {
    durationMs: Date.now() - stepStart,
    inserted,
    clusters,
  };
}

async function oddCasesInternal(count: number, report: Record<string, unknown>) {
  const stepStart = Date.now();
  const bundles = await generateOddCases(count);
  const docs: Record<string, unknown>[] = [];
  const observations: unknown[] = [];
  const latencies: number[] = [];
  for (const bundle of bundles) {
    const caseStart = Date.now();
    const built = await buildCaseDoc({
      symptoms: bundle.symptoms,
      age: bundle.age,
      gender: bundle.gender,
      village: pickVillageForRegion(bundle.regionHint),
      symptomDuration: bundle.symptomDuration,
      role: Math.random() < 0.5 ? "PATIENT" : "CAREGIVER",
    });
    docs.push(built.doc);
    latencies.push(Date.now() - caseStart);
    observations.push({
      symptoms: bundle.symptoms,
      predictedDisease: built.analysis.predictedDisease,
      urgency: built.analysis.urgency,
      confidence: built.analysis.confidence,
      region: bundle.regionHint,
      age: bundle.age,
      duration: bundle.symptomDuration,
    });
  }
  const inserted = await insertCases(docs);
  (report.steps as any).oddCases = {
    durationMs: Date.now() - stepStart,
    inserted,
    perCaseMs: summariseLatencies(latencies),
    observations,
  };
}

async function vectorBenchInternal(scenarios: IllnessScenario[], report: Record<string, unknown>) {
  const stepStart = Date.now();
  await SymptomCache.deleteMany({});
  const seedCount = 80;
  const probeCount = 40;

  const seedSets: string[][] = [];
  for (let i = 0; i < seedCount; i++) {
    const scenario = scenarios[i % scenarios.length];
    seedSets.push(scenario.symptoms);
    const duration = scenario.typicalDurations[i % scenario.typicalDurations.length] as SymptomDuration;
    const analysis = await analysisForTemplate(scenario.symptoms, {
      age: randomInRange(scenario.ageRange[0], scenario.ageRange[1]),
      gender: scenario.genderBias === "Any" ? undefined : scenario.genderBias,
      symptomDuration: duration,
    });
    await cacheAnalysis(scenario.symptoms, analysis, "llm");
  }

  const exactProbes = seedSets.slice(0, probeCount).map((s) => [...s].reverse().map((x) => x.toUpperCase()));
  const bases = seedSets.slice(0, Math.min(probeCount, 20));
  const paraphrased = await paraphraseSymptomSets(bases);
  const semanticProbes = paraphrased.map((p) => p.paraphrased);
  const nonsenseWords = [
    "xylophone", "quartz", "pelican", "cinnamon", "thunderhead",
    "submarine", "velvet", "neutrino", "pistachio", "rhombus",
  ];
  const nonsenseProbes: string[][] = [];
  for (let i = 0; i < probeCount; i++) {
    nonsenseProbes.push([pickOne(nonsenseWords), pickOne(nonsenseWords), pickOne(nonsenseWords)]);
  }

  async function runBatch(label: string, probes: string[][]) {
    const latencies: number[] = [];
    let hits = 0;
    for (const probe of probes) {
      const t = Date.now();
      const result = await findCachedAnalysis(probe);
      latencies.push(Date.now() - t);
      if (result) hits++;
    }
    return { label, count: probes.length, hits, hitRate: Number((hits / Math.max(1, probes.length)).toFixed(3)), latencyMs: summariseLatencies(latencies) };
  }

  const exact = await runBatch("exact", exactProbes);
  const semantic = await runBatch("semantic", semanticProbes);
  const nonsense = await runBatch("nonsense", nonsenseProbes);

  (report.steps as any).vectorBench = {
    durationMs: Date.now() - stepStart,
    seedCount,
    probeCount,
    exact,
    semantic,
    nonsense,
    cacheSize: await SymptomCache.countDocuments({}),
  };
}

/** GET /api/stress/status */
export async function statusHandler(_req: Request, res: Response) {
  const start = Date.now();
  try {
    const [caseCount, cacheCount] = await Promise.all([
      Case.countDocuments({}),
      SymptomCache.countDocuments({}),
    ]);
    res.json({
      ok: true,
      durationMs: Date.now() - start,
      cases: caseCount,
      symptomCache: cacheCount,
      scenariosCached: cachedScenarios?.length ?? 0,
      llmReady: isSymptomModelReady(),
      supportedRegions: ["CT", "TEXAS", "INDIA"] as RegionHint[],
      supportedDurations: NON_EMPTY_SYMPTOM_DURATIONS,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err), durationMs: Date.now() - start });
  }
}
