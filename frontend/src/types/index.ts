export type Urgency = "CRITICAL" | "MODERATE" | "LOW";

export interface CaseRecord {
  _id: string;
  worker_phone?: string;
  patientName: string;
  age: number;
  gender: "Male" | "Female" | "Other";
  symptoms: string[];
  predictedDisease?: string;
  village: string;
  district: string;
  state: string;
  urgency: Urgency;
  location?: {
    type: "Point";
    coordinates: [number, number];
  };
  latitude?: number;
  longitude?: number;
  status: "PENDING" | "IN_PROGRESS" | "RESOLVED";
  assignedCaregiver?: string;
  aiAnalysis?: string;
  recommendedAction?: string;
  callbackWindow?: string;
  differentialDiagnoses?: string[];
  redFlags?: string[];
  aiConfidence?: "LOW" | "MEDIUM" | "HIGH";
  aiAnalysisHash?: string;
  aiModel?: string;
  aiAnalyzedAt?: string;
  symptomDuration?: string;
  reporterRole?: "PATIENT" | "CAREGIVER";
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CasesResponse {
  cases: CaseRecord[];
  total: number;
  page: number;
  totalPages: number;
}

export interface StatsResponse {
  total: number;
  critical: number;
  moderate: number;
  low: number;
  population: number;
  region: string;
  outbreaks?: {
    location: string;
    disease: string;
    count: number;
    alertLevel: "OUTBREAK" | "REGIONAL_ALERT" | "PANDEMIC_ALERT";
  }[];
  byDistrict: { district: string; count: number }[];
}

export interface VillageStat {
  village: string;
  caseCount: number;
  criticalCount: number;
  lat: number;
  lng: number;
  population: number;
}
