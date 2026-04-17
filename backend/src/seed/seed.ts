import mongoose from "mongoose";
import dotenv from "dotenv";
import Case from "../models/Case";
import { getCoordinatesForVillage, getVillageNames } from "../utils/geocode";
import { getAnalysisFingerprint, getAnalysisModelName } from "../utils/analysisFingerprint";
import { ensureLocalSymptomModel } from "../utils/localModel";
import { analyzeSymptoms, SymptomAnalysis } from "../utils/symptomAnalyzer";

dotenv.config({ path: "../.env" });

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/sevak-dashboard";

const symptomTemplates = [
  ["Persistent cough", "Night sweats", "Weight loss"],
  ["Thirsty", "Frequent urination", "Blurred vision"],
  ["Burning urination", "Cloudy urine", "Lower abdominal pain"],
  ["High fever", "Chills", "Sweating"],
  ["Severe headache", "Pain behind eyes", "High fever", "Rash"],
  ["Severe diarrhea", "Vomiting", "Dehydration"],
  ["Chest pain", "Shortness of breath", "Sweating"],
  ["Seizure", "Loss of consciousness", "Confusion"],
  ["Cough", "Runny nose", "Sore throat"],
  ["Itchy rash", "Red bumps", "No fever"],
  ["Stiff neck", "High fever", "Severe headache"],
  ["Fever", "Abdominal pain", "Loss of appetite"],
];

const locations = getVillageNames();

const names = [
  "Rajesh Kumar", "Sunita Devi", "John Smith", "Maria Garcia", "Ravi Shankar",
  "Sarah Johnson", "David Miller", "James Brown", "Suresh Yadav", "Anita Kumari",
  "Vikram Patel", "Robert Davis", "Jennifer Wilson", "Pooja Gupta", "Ramesh Chandra",
  "Kavita Devi", "Anil Kumar", "Lakshmi Devi", "Manoj Tiwari", "Savita Kumari",
  "Prakash Rao", "Linda Taylor", "Sanjay Mishra", "Rekha Devi", "Dinesh Prasad",
];

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function point(longitude: number, latitude: number) {
  return {
    type: "Point" as const,
    coordinates: [parseFloat(longitude.toFixed(6)), parseFloat(latitude.toFixed(6))] as [number, number],
  };
}

function symptomKey(caseSymptoms: string[]) {
  return caseSymptoms.map((symptom) => symptom.trim().toLowerCase()).sort().join("|");
}

async function seed() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB");
    await ensureLocalSymptomModel();

    const analysisCache = new Map<string, SymptomAnalysis>();
    for (const template of symptomTemplates) {
      console.log(`Classifying template: ${template.join(", ")}`);
      analysisCache.set(symptomKey(template), await analyzeSymptoms(template));
    }

    await Case.deleteMany({});
    console.log("Cleared existing cases");

    const cases = [];

    for (let i = 0; i < 200; i++) {
      const location = randomPick(locations);
      const coords = getCoordinatesForVillage(location);
      const lat = coords.lat + (Math.random() - 0.5) * 0.05;
      const lng = coords.lng + (Math.random() - 0.5) * 0.05;
      const caseSymptoms = randomPick(symptomTemplates);
      const key = symptomKey(caseSymptoms);
      const analysis = analysisCache.get(key);
      if (!analysis) throw new Error(`Missing analysis for symptoms: ${caseSymptoms.join(", ")}`);

      let state = "India";
      if (location === "Hartford" || location === "Stamford" || location === "New Haven") state = "Connecticut";
      if (location === "Austin" || location === "Houston" || location === "Dallas" || location === "San Antonio") state = "Texas";

      cases.push({
        worker_phone: "SEED-TEST-ACCOUNT",
        patientName: randomPick(names),
        age: Math.floor(Math.random() * 70) + 5,
        gender: randomPick(["Male", "Female", "Other"] as const),
        symptoms: caseSymptoms,
        village: location,
        district: location,
        state,
        urgency: analysis.urgency,
        predictedDisease: analysis.predictedDisease,
        aiAnalysis: analysis.summary,
        recommendedAction: analysis.actionRequired,
        callbackWindow: analysis.callbackWindow,
        differentialDiagnoses: analysis.differentialDiagnoses || [],
        redFlags: analysis.redFlags || [],
        aiConfidence: analysis.confidence,
        aiAnalysisHash: getAnalysisFingerprint(caseSymptoms),
        aiModel: getAnalysisModelName(),
        aiAnalyzedAt: new Date(),
        reporterRole: "CAREGIVER",
        location: point(lng, lat),
        status: "PENDING",
        notes: "Automated AI-classified test case",
        createdAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
      });
    }

    await Case.insertMany(cases);
    console.log(`Seeded ${cases.length} cases`);

    await mongoose.disconnect();
    console.log("Done");
  } catch (error) {
    console.error("Seed failed:", error);
    process.exit(1);
  }
}

seed();
