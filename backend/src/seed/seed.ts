/**
 * CLI wrapper for the 200-case seed.
 *
 * All real work lives in `utils/caseFactory` and `utils/illnessGenerator` so
 * the CLI path and the stress-test API path (`POST /api/stress/seed`) share
 * identical behaviour. No field is hardcoded here \u2014 illnesses come from the
 * local LLM at runtime, locations come from `resolveLocation`, and every AI
 * field is produced by `analyzeSymptoms`.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import Case from "../models/Case";
import SymptomCache from "../models/SymptomCache";
import { ensureLocalSymptomModel } from "../utils/localModel";
import { generateIllnessScenarios, IllnessScenario, RegionHint } from "../utils/illnessGenerator";
import {
  buildCaseDoc,
  insertCases,
  pickVillageForRegion,
  villagesForRegion,
  clearAnalysisCache,
} from "../utils/caseFactory";
import { SymptomDuration } from "../utils/symptomDuration";

dotenv.config({ path: "../.env" });

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/sevak-dashboard";
const TOTAL = Number(process.env.SEED_CASE_COUNT || 200);

function pickOne<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function roleFlip(): "PATIENT" | "CAREGIVER" {
  return Math.random() < 0.55 ? "PATIENT" : "CAREGIVER";
}
function genderFromBias(bias: IllnessScenario["genderBias"]): "Male" | "Female" | "Other" {
  if (bias === "Male") return "Male";
  if (bias === "Female") return "Female";
  return pickOne(["Male", "Female", "Other"] as const);
}

async function main() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("[seed] Connected to MongoDB");

    await ensureLocalSymptomModel();
    console.log("[seed] LLM ready");

    console.log("[seed] Wiping Case and SymptomCache collections...");
    await Promise.all([Case.deleteMany({}), SymptomCache.deleteMany({})]);
    clearAnalysisCache();

    console.log("[seed] Asking LLM for 25 illness scenarios...");
    const scenarios = await generateIllnessScenarios(25);
    console.log(`[seed] Received ${scenarios.length} validated scenarios`);

    const split: Record<RegionHint, number> = {
      INDIA: Math.round(TOTAL * 0.6),
      CT: Math.round(TOTAL * 0.2),
      TEXAS: Math.round(TOTAL * 0.2),
    };
    const assigned = split.INDIA + split.CT + split.TEXAS;
    if (assigned !== TOTAL) split.INDIA += TOTAL - assigned;

    const byRegion: Record<RegionHint, IllnessScenario[]> = { CT: [], TEXAS: [], INDIA: [] };
    for (const s of scenarios) for (const r of s.regionHints) byRegion[r].push(s);
    for (const r of ["CT", "TEXAS", "INDIA"] as RegionHint[]) {
      if (byRegion[r].length === 0) byRegion[r] = scenarios;
    }

    const docs: Record<string, unknown>[] = [];
    const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;
    const counts: Record<RegionHint, number> = { CT: 0, TEXAS: 0, INDIA: 0 };

    for (const region of ["INDIA", "CT", "TEXAS"] as RegionHint[]) {
      if (villagesForRegion(region).length === 0) {
        console.warn(`[seed] No villages available for region ${region}, skipping`);
        continue;
      }
      for (let i = 0; i < split[region]; i++) {
        const scenario = pickOne(byRegion[region]);
        const duration = pickOne(scenario.typicalDurations as SymptomDuration[]);
        const age = randomInRange(scenario.ageRange[0], scenario.ageRange[1]);
        const built = await buildCaseDoc({
          symptoms: scenario.symptoms,
          age,
          gender: genderFromBias(scenario.genderBias),
          village: pickVillageForRegion(region),
          symptomDuration: duration,
          role: roleFlip(),
          createdAt: new Date(Date.now() - Math.random() * twoWeeksMs),
        });
        docs.push(built.doc);
        counts[region]++;
        if ((counts[region] % 20) === 0) {
          console.log(`[seed]   ${region}: ${counts[region]}/${split[region]}`);
        }
      }
    }

    const inserted = await insertCases(docs);
    console.log(`[seed] Inserted ${inserted} cases`);
    console.log(`[seed] By region: INDIA=${counts.INDIA} CT=${counts.CT} TEXAS=${counts.TEXAS}`);
    await mongoose.disconnect();
    console.log("[seed] Done");
  } catch (err) {
    console.error("[seed] failed:", err);
    try { await mongoose.disconnect(); } catch { /* noop */ }
    process.exit(1);
  }
}

main();
