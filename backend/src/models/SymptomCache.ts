import mongoose, { Document, Schema } from "mongoose";
import { Urgency } from "./Case";

export interface ICachedAnalysis {
  urgency: Urgency;
  predictedDisease: string;
  summary: string;
  actionRequired: string;
  callbackWindow: string;
  differentialDiagnoses?: string[];
  redFlags?: string[];
  confidence?: "LOW" | "MEDIUM" | "HIGH";
}

export interface ISymptomCache extends Document {
  symptomHash: string;
  symptoms: string[];
  embedding: number[];
  analysis: ICachedAnalysis;
  source: "llm" | "rules";
  modelName: string;
  hitCount: number;
  lastUsedAt: Date;
  createdAt: Date;
}

const AnalysisSchema = new Schema<ICachedAnalysis>(
  {
    urgency: { type: String, required: true, enum: ["CRITICAL", "MODERATE", "LOW"] },
    predictedDisease: { type: String, required: true },
    summary: { type: String, required: true },
    actionRequired: { type: String, required: true },
    callbackWindow: { type: String, required: true },
    differentialDiagnoses: { type: [String], default: [] },
    redFlags: { type: [String], default: [] },
    confidence: { type: String, enum: ["LOW", "MEDIUM", "HIGH"] },
  },
  { _id: false }
);

const SymptomCacheSchema = new Schema<ISymptomCache>(
  {
    // SHA-256 of sorted, normalized symptom strings — unique key for exact lookup
    symptomHash: { type: String, required: true, unique: true },
    symptoms: { type: [String], required: true },
    // Dense embedding vector from Ollama (e.g. nomic-embed-text, 768-dim)
    // To enable Atlas Vector Search, create an index in Atlas UI:
    //   Field: "embedding", Type: "vector", Dimensions: 768, Similarity: "cosine"
    embedding: { type: [Number], default: [] },
    analysis: { type: AnalysisSchema, required: true },
    source: { type: String, enum: ["llm", "rules"], required: true },
    modelName: { type: String, required: true },
    hitCount: { type: Number, default: 0 },
    lastUsedAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

SymptomCacheSchema.index({ lastUsedAt: -1 });
SymptomCacheSchema.index({ source: 1 });

export default mongoose.model<ISymptomCache>("SymptomCache", SymptomCacheSchema);
