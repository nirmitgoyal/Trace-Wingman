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
  location: {
    type: "Point";
    coordinates: [number, number];
  };
  status: "PENDING" | "IN_PROGRESS" | "RESOLVED";
  assignedCaregiver?: string;
  predictedDisease?: string;
  aiAnalysis?: string;
  recommendedAction?: string;
  callbackWindow?: string;
  differentialDiagnoses?: string[];
  redFlags?: string[];
  aiConfidence?: "LOW" | "MEDIUM" | "HIGH";
  aiAnalysisHash?: string;
  aiModel?: string;
  aiAnalyzedAt?: Date;
  symptomDuration?: string;
  reporterRole?: "PATIENT" | "CAREGIVER";
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
    location: {
      type: {
        type: String,
        enum: ["Point"],
        required: true,
        default: "Point",
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator(value: number[]) {
            return (
              value.length === 2 &&
              Number.isFinite(value[0]) &&
              Number.isFinite(value[1]) &&
              value[0] >= -180 &&
              value[0] <= 180 &&
              value[1] >= -90 &&
              value[1] <= 90
            );
          },
          message: "location.coordinates must be [longitude, latitude]",
        },
      },
    },
    status: { type: String, enum: ["PENDING", "IN_PROGRESS", "RESOLVED"], default: "PENDING" },
    assignedCaregiver: { type: String },
    predictedDisease: { type: String },
    aiAnalysis: { type: String },
    recommendedAction: { type: String },
    callbackWindow: { type: String },
    differentialDiagnoses: { type: [String], default: [] },
    redFlags: { type: [String], default: [] },
    aiConfidence: { type: String, enum: ["LOW", "MEDIUM", "HIGH"] },
    aiAnalysisHash: { type: String },
    aiModel: { type: String },
    aiAnalyzedAt: { type: Date },
    symptomDuration: { type: String },
    reporterRole: { type: String, enum: ["PATIENT", "CAREGIVER"] },
    notes: { type: String, default: "" },
  },
  {
    timestamps: true,
  }
);

CaseSchema.index({ urgency: 1 });
CaseSchema.index({ district: 1 });
CaseSchema.index({ createdAt: -1 });
CaseSchema.index({ aiAnalysisHash: 1 });
CaseSchema.index({ location: "2dsphere" });

export default mongoose.model<ICase>("Case", CaseSchema);
