import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const suffix = process.argv[2] || "883e5782";
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI not set");
  process.exit(1);
}

await mongoose.connect(uri);
const col = mongoose.connection.collection("cases");

// _id suffix match — render _id to hex string then regex
const docs = await col
  .aggregate([
    { $addFields: { idStr: { $toString: "$_id" } } },
    { $match: { idStr: { $regex: suffix + "$" } } },
    {
      $project: {
        _id: 1,
        patientName: 1,
        age: 1,
        gender: 1,
        symptoms: 1,
        symptomDuration: 1,
        village: 1,
        district: 1,
        state: 1,
        urgency: 1,
        predictedDisease: 1,
        aiAnalysis: 1,
        recommendedAction: 1,
        aiConfidence: 1,
        aiModel: 1,
        aiAnalysisHash: 1,
        aiAnalyzedAt: 1,
        reporterRole: 1,
        createdAt: 1,
        updatedAt: 1,
        callbackWindow: 1,
        differentialDiagnoses: 1,
        redFlags: 1,
        status: 1,
      },
    },
  ])
  .toArray();

console.log(JSON.stringify(docs, null, 2));
await mongoose.disconnect();
