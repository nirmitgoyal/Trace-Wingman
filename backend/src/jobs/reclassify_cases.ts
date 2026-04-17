import mongoose from "mongoose";
import dotenv from "dotenv";
import Case from "../models/Case";
import { getAnalysisFingerprint, getAnalysisModelName } from "../utils/analysisFingerprint";
import { ensureLocalSymptomModel } from "../utils/localModel";
import { analyzeSymptoms } from "../utils/symptomAnalyzer";

dotenv.config({ path: "../.env" });

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/sevak-dashboard";

interface Options {
  apply: boolean;
  limit: number;
  all: boolean;
  skipExisting: boolean;
  force: boolean;
}

function getOptions(): Options {
  const args = process.argv.slice(2);
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const parsedLimit = limitArg ? Number(limitArg.split("=")[1]) : 25;

  return {
    apply: args.includes("--apply"),
    all: args.includes("--all"),
    limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 25,
    skipExisting: args.includes("--skip-existing"),
    force: args.includes("--force"),
  };
}

function changed(before: unknown, after: unknown) {
  return JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
}

async function reclassify() {
  const options = getOptions();

  console.log(options.apply ? "Running reclassification in APPLY mode." : "Running reclassification in DRY-RUN mode.");
  console.log(options.all ? "Limit: all matching cases" : `Limit: ${options.limit}`);
  console.log(`Skip existing AI analyses: ${options.skipExisting ? "yes" : "no"}`);
  console.log(`Force rerun matching fingerprints: ${options.force ? "yes" : "no"}`);

  await ensureLocalSymptomModel();
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB");

  const filter = options.skipExisting ? { aiAnalysis: { $in: [null, ""] } } : {};
  const totalMatching = await Case.countDocuments(filter);
  console.log(`Matching cases in database: ${totalMatching}`);

  const query = Case.find(filter)
    .sort({ createdAt: -1 })
    .select("_id patientName symptoms urgency predictedDisease aiAnalysis recommendedAction callbackWindow differentialDiagnoses redFlags aiConfidence aiAnalysisHash aiModel aiAnalyzedAt")
    .lean();

  if (!options.all) query.limit(options.limit);

  const cases = await query;
  const groups = new Map<string, {
    symptoms: string[];
    cases: typeof cases;
  }>();

  for (const caseRecord of cases) {
    const analysisHash = getAnalysisFingerprint(caseRecord.symptoms || []);
    if (!options.force && caseRecord.aiAnalysisHash === analysisHash) continue;
    const key = analysisHash;
    const existing = groups.get(key);
    if (existing) existing.cases.push(caseRecord);
    else groups.set(key, { symptoms: caseRecord.symptoms || [], cases: [caseRecord] });
  }

  console.log(`Loaded cases: ${cases.length}`);
  console.log(`Cases needing analysis: ${Array.from(groups.values()).reduce((sum, group) => sum + group.cases.length, 0)}`);
  console.log(`Unique symptom groups to analyze: ${groups.size}`);

  let updated = 0;

  for (const [analysisHash, group] of groups) {
    const analysis = await analyzeSymptoms(group.symptoms);
    const update = {
      urgency: analysis.urgency,
      predictedDisease: analysis.predictedDisease,
      aiAnalysis: analysis.summary,
      recommendedAction: analysis.actionRequired,
      callbackWindow: analysis.callbackWindow,
      differentialDiagnoses: analysis.differentialDiagnoses || [],
      redFlags: analysis.redFlags || [],
      aiConfidence: analysis.confidence || "MEDIUM",
      aiAnalysisHash: analysisHash,
      aiModel: getAnalysisModelName(),
      aiAnalyzedAt: new Date(),
    };

    const changedCases = group.cases.filter((caseRecord) =>
      changed(caseRecord.urgency, update.urgency) ||
      changed(caseRecord.predictedDisease, update.predictedDisease) ||
      changed(caseRecord.aiAnalysis, update.aiAnalysis) ||
      changed(caseRecord.recommendedAction, update.recommendedAction) ||
      changed(caseRecord.callbackWindow, update.callbackWindow) ||
      changed(caseRecord.differentialDiagnoses, update.differentialDiagnoses) ||
      changed(caseRecord.redFlags, update.redFlags) ||
      changed(caseRecord.aiConfidence, update.aiConfidence) ||
      changed(caseRecord.aiAnalysisHash, update.aiAnalysisHash) ||
      changed(caseRecord.aiModel, update.aiModel)
    );

    const exampleCase = group.cases[0];

    console.log("\n---");
    console.log(`Symptom group ${analysisHash.slice(0, 12)}...`);
    console.log(`Cases in group: ${group.cases.length}`);
    console.log(`Symptoms: ${group.symptoms.join(", ")}`);
    console.log(`Example before: ${exampleCase.urgency} | ${exampleCase.predictedDisease || "No illness"}`);
    console.log(`After:  ${update.urgency} | ${update.predictedDisease}`);
    console.log(`Model:  ${update.aiModel}`);
    console.log(`Hash:   ${update.aiAnalysisHash.slice(0, 12)}...`);
    console.log(`Summary: ${update.aiAnalysis}`);
    console.log(`Changed cases in group: ${changedCases.length}`);

    if (options.apply && changedCases.length > 0) {
      const ids = changedCases.map((caseRecord) => caseRecord._id);
      const result = await Case.updateMany({ _id: { $in: ids } }, { $set: update });
      updated += result.modifiedCount;
      console.log(`Saved ${result.modifiedCount} update(s).`);
    }
  }

  console.log("\nDone.");
  console.log(options.apply ? `Updated ${updated} case(s).` : "No records changed because this was a dry run.");
  await mongoose.disconnect();
}

reclassify().catch(async (error) => {
  console.error("Reclassification failed:", error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
