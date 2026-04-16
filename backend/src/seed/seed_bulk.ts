import mongoose from "mongoose";
import dotenv from "dotenv";
import Case from "../models/Case";
import { getCoordinatesForVillage, getVillageNames } from "../utils/geocode";

dotenv.config({ path: "../../.env" });
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

async function seed() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB for Bulk Seed");

    console.log("Clearing existing data...");
    await Case.deleteMany({});

    const totalToGenerate = 50000;
    const batchSize = 5000;
    
    for (let i = 0; i < totalToGenerate; i += batchSize) {
      const cases = [];
      for (let j = 0; j < batchSize; j++) {
        const disease = DISEASES[Math.floor(Math.random() * DISEASES.length)];
        const location = LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];
        const coords = getCoordinatesForVillage(location);
        
        let state = "India";
        if (["Hartford", "Stamford", "New Haven"].includes(location)) state = "Connecticut";
        if (["Austin", "Houston", "Dallas", "San Antonio"].includes(location)) state = "Texas";

        cases.push({
          worker_phone: Math.random() > 0.5 ? "Web-Patient" : "Field-Caregiver-" + Math.floor(Math.random() * 100),
          patientName: NAMES[Math.floor(Math.random() * NAMES.length)] + " " + (i + j),
          age: Math.floor(Math.random() * 80) + 1,
          gender: Math.random() > 0.5 ? "Male" : "Female",
          symptoms: disease.symptoms,
          predictedDisease: disease.name,
          village: location,
          district: location + " District",
          state,
          urgency: disease.urgency,
          latitude: coords.lat + (Math.random() - 0.5) * 0.1,
          longitude: coords.lng + (Math.random() - 0.5) * 0.1,
          status: "PENDING",
          createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000)
        });
      }
      await Case.insertMany(cases);
      console.log(`Inserted batch ${(i / batchSize) + 1}`);
    }

    console.log("50,000 cases successfully generated.");
    await mongoose.disconnect();
  } catch (error) {
    console.error("Seed failed:", error);
    process.exit(1);
  }
}

seed();
