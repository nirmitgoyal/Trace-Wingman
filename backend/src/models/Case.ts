import mongoose, { Schema, Document } from "mongoose";

export type Urgency = "CRITICAL" | "MODERATE" | "LOW";

export interface ICase extends Document {
  worker_phone: string;
  patientName: string;
  age: number;
  gender: "Male" | "Female" | "Other";
  symptoms: string[];
  village: string;
  district: string;
  state: string;
  urgency: Urgency;
  latitude: number;
  longitude: number;
  status: "PENDING" | "IN_PROGRESS" | "RESOLVED";
  assignedCaregiver?: string;
  predictedDisease?: string;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

const CaseSchema = new Schema<ICase>(
  {
    worker_phone: { type: String, required: true, trim: true },
    patientName: { type: String, required: true, trim: true },
    age: { type: Number, required: true, min: 0, max: 150 },
    gender: { type: String, required: true, enum: ["Male", "Female", "Other"] },
    symptoms: { type: [String], required: true },
    village: { type: String, required: true, trim: true },
    district: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true, default: "Unknown" },
    urgency: {
      type: String,
      required: true,
      enum: ["CRITICAL", "MODERATE", "LOW"],
    },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    status: { type: String, enum: ["PENDING", "IN_PROGRESS", "RESOLVED"], default: "PENDING" },
    assignedCaregiver: { type: String },
    predictedDisease: { type: String },
    notes: { type: String, default: "" },
  },
  {
    timestamps: true,
  }
);

CaseSchema.index({ urgency: 1 });
CaseSchema.index({ district: 1 });
CaseSchema.index({ createdAt: -1 });

export default mongoose.model<ICase>("Case", CaseSchema);
