import mongoose from "mongoose";
import dotenv from "dotenv";
import Case from "../models/Case";
import { getCoordinatesForVillage, getVillageNames } from "../utils/geocode";

dotenv.config({ path: "../../.env" });

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/sevak-dashboard";

const symptoms = [
  "Fever", "Cough", "Headache", "Diarrhea", "Vomiting", "Rash",
  "Fatigue", "Body ache", "Sore throat", "Breathlessness",
  "Chest pain", "Abdominal pain", "Dehydration", "Malaria symptoms",
  "Dengue symptoms", "Typhoid symptoms", "Skin infection", "Eye infection",
  "Joint pain", "Loss of appetite",
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

function randomSymptoms(): string[] {
  const count = Math.floor(Math.random() * 4) + 1;
  const picked = new Set<string>();
  while (picked.size < count) {
    picked.add(randomPick(symptoms));
  }
  return Array.from(picked);
}

function randomUrgency(): "CRITICAL" | "MODERATE" | "LOW" {
  const r = Math.random();
  if (r < 0.15) return "CRITICAL";
  if (r < 0.5) return "MODERATE";
  return "LOW";
}

async function seed() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB");

    await Case.deleteMany({});
    console.log("Cleared existing cases");

    const cases = [];

    for (let i = 0; i < 200; i++) {
      const location = randomPick(locations);
      const coords = getCoordinatesForVillage(location);
      const lat = coords.lat + (Math.random() - 0.5) * 0.05;
      const lng = coords.lng + (Math.random() - 0.5) * 0.05;

      let state = "India";
      if (location === "Hartford" || location === "Stamford" || location === "New Haven") state = "Connecticut";
      if (location === "Austin" || location === "Houston" || location === "Dallas" || location === "San Antonio") state = "Texas";

      cases.push({
        worker_phone: "SEED-TEST-ACCOUNT",
        patientName: randomPick(names),
        age: Math.floor(Math.random() * 70) + 5,
        gender: randomPick(["Male", "Female", "Other"] as const),
        symptoms: randomSymptoms(),
        village: location,
        district: location,
        state,
        urgency: randomUrgency(),
        latitude: parseFloat(lat.toFixed(4)),
        longitude: parseFloat(lng.toFixed(4)),
        status: "PENDING",
        notes: "Automated test case",
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
