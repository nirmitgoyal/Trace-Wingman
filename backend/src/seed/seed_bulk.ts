import mongoose from "mongoose";
import dotenv from "dotenv";
import Case from "../models/Case";
import { getCoordinatesForVillage, getVillageNames } from "../utils/geocode";
import { getAnalysisFingerprint, getAnalysisModelName } from "../utils/analysisFingerprint";
import { ensureLocalSymptomModel } from "../utils/localModel";
import { analyzeSymptoms, SymptomAnalysis } from "../utils/symptomAnalyzer";

dotenv.config({ path: "../.env" });
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/sevak-dashboard";

const DISEASES = [
  { name: "Common Cold", symptoms: ["Cough", "Runny nose", "Sore throat"], urgency: "LOW", serious: false },
  { name: "Influenza", symptoms: ["High fever", "Body ache", "Fatigue"], urgency: "MODERATE", serious: false },
  { name: "Tuberculosis", symptoms: ["Persistent cough", "Weight loss", "Night sweats"], urgency: "CRITICAL", serious: true },
  { name: "Malaria", symptoms: ["Chills", "High fever", "Sweating"], urgency: "CRITICAL", serious: true },
  { name: "Dengue", symptoms: ["Severe headache", "Rash", "Joint pain"], urgency: "CRITICAL", serious: true },
  { name: "Cholera", symptoms: ["Severe diarrhea", "Vomiting", "Dehydration"], urgency: "CRITICAL", serious: true },
  { name: "Lyme Disease", symptoms: ["Bullseye rash", "Fatigue", "Joint pain"], urgency: "MODERATE", serious: true },
  { name: "Diabetes (Type 2)", symptoms: ["Thirsty", "Frequent urination", "Blurred vision"], urgency: "MODERATE", serious: false }
];

const NAMES = ["Aarav", "Priya", "John", "Sarah", "Manoj", "Linda", "Raj", "Anita", "James", "Meena"];
const LOCATIONS = getVillageNames();
const totalToGenerate = Number(process.env.SEED_CASE_COUNT || 50000);
const batchSize = Number(process.env.SEED_BATCH_SIZE || 5000);

function point(longitude: number, latitude: number) {
  return {
    type: "Point" as const,
    coordinates: [parseFloat(longitude.toFixed(6)), parseFloat(latitude.toFixed(6))] as [number, number],
  };
}

function symptomKey(symptoms: string[]) {
  return symptoms.map((symptom) => symptom.trim().toLowerCase()).sort().join("|");
}

async function seed() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB for Bulk Seed");
    await ensureLocalSymptomModel();

    const analysisCache = new Map<string, SymptomAnalysis>();
    for (const disease of DISEASES) {
      console.log(`Classifying template: ${disease.symptoms.join(", ")}`);
      analysisCache.set(symptomKey(disease.symptoms), await analyzeSymptoms(disease.symptoms));
    }

    console.log("Clearing existing data...");
    await Case.deleteMany({});

    for (let i = 0; i < totalToGenerate; i += batchSize) {
      const cases = [];
      const currentBatchSize = Math.min(batchSize, totalToGenerate - i);
      for (let j = 0; j < currentBatchSize; j++) {
        const disease = DISEASES[Math.floor(Math.random() * DISEASES.length)];
        const location = LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];
        const coords = getCoordinatesForVillage(location);
        const key = symptomKey(disease.symptoms);
        const analysis = analysisCache.get(key);
        if (!analysis) throw new Error(`Missing analysis for symptoms: ${disease.symptoms.join(", ")}`);
        
        let state = "India";
        if (["Hartford", "Stamford", "New Haven"].includes(location)) state = "Connecticut";
        if (["Austin", "Houston", "Dallas", "San Antonio"].includes(location)) state = "Texas";

        cases.push({
          worker_phone: Math.random() > 0.5 ? "Web-Patient" : "Field-Caregiver-" + Math.floor(Math.random() * 100),
          patientName: NAMES[Math.floor(Math.random() * NAMES.length)] + " " + (i + j),
          age: Math.floor(Math.random() * 80) + 1,
          gender: Math.random() > 0.5 ? "Male" : "Female",
          symptoms: disease.symptoms,
          predictedDisease: analysis.predictedDisease,
          village: location,
          district: location + " District",
          state,
          urgency: analysis.urgency,
          aiAnalysis: analysis.summary,
          recommendedAction: analysis.actionRequired,
          callbackWindow: analysis.callbackWindow,
          differentialDiagnoses: analysis.differentialDiagnoses || [],
          redFlags: analysis.redFlags || [],
          aiConfidence: analysis.confidence,
          aiAnalysisHash: getAnalysisFingerprint(disease.symptoms),
          aiModel: getAnalysisModelName(),
          aiAnalyzedAt: new Date(),
          reporterRole: Math.random() > 0.5 ? "PATIENT" : "CAREGIVER",
          location: point(
            coords.lng + (Math.random() - 0.5) * 0.1,
            coords.lat + (Math.random() - 0.5) * 0.1,
          ),
          status: "PENDING",
          notes: "Automated AI-classified test case",
          createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000)
        });
      }
      await Case.insertMany(cases);
      console.log(`Inserted batch ${(i / batchSize) + 1}`);
    }

    console.log(`${totalToGenerate.toLocaleString()} cases successfully generated.`);
    await mongoose.disconnect();
  } catch (error) {
    console.error("Seed failed:", error);
    process.exit(1);
  }
}

seed();
