import { Request, Response } from "express";
import Case, { Urgency } from "../models/Case";
import { caseEvents } from "../utils/events";
import { resolveLocation, searchLocations } from "../utils/geocode";
import { notifyAdmin } from "../utils/notifications";
import { getAnalysisFingerprint, getAnalysisModelName } from "../utils/analysisFingerprint";
import { analyzeSymptoms, buildPortalResponse } from "../utils/symptomAnalyzer";

const POPULATIONS: Record<string, number> = {
  "GLOBAL": 8000000000,
  "INDIA": 1400000000,
  "CT": 3600000,
  "TEXAS": 30000000,
};

function locationPoint(longitude: number, latitude: number) {
  return {
    type: "Point" as const,
    coordinates: [longitude, latitude] as [number, number],
  };
}

function addCoordinateAliases<T extends Record<string, any>>(caseDoc: T) {
  const coordinates = caseDoc.location?.coordinates;
  if (Array.isArray(coordinates) && coordinates.length === 2) {
    return {
      ...caseDoc,
      longitude: coordinates[0],
      latitude: coordinates[1],
    };
  }
  return caseDoc;
}

function regionFilter(region: unknown): Record<string, any> | null {
  if (region === "CT") {
    return {
      $or: [
        { state: { $regex: "CT|Connecticut", $options: "i" } },
        { village: { $regex: "CT|Connecticut", $options: "i" } },
      ],
    };
  }
  if (region === "TEXAS") {
    return {
      $or: [
        { state: { $regex: "TX|Texas", $options: "i" } },
        { village: { $regex: "TX|Texas", $options: "i" } },
      ],
    };
  }
  if (region === "INDIA") return { "location.coordinates.0": { $gt: 60, $lt: 100 } };
  return null;
}

function buildCaseFilter(query: Request["query"]) {
  const { urgency, district, search, region } = query;
  const clauses: Record<string, any>[] = [];

  if (urgency && urgency !== "ALL") clauses.push({ urgency: urgency as Urgency });
  if (district) clauses.push({ district: { $regex: district as string, $options: "i" } });

  const scopedRegion = regionFilter(region);
  if (scopedRegion) clauses.push(scopedRegion);

  if (search) {
    clauses.push({
      $or: [
        { patientName: { $regex: search as string, $options: "i" } },
        { village: { $regex: search as string, $options: "i" } },
        { symptoms: { $regex: search as string, $options: "i" } },
        { predictedDisease: { $regex: search as string, $options: "i" } },
      ],
    });
  }

  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

export async function getCases(req: Request, res: Response) {
  try {
    const { page = "1", limit = "50" } = req.query;
    const filter = buildCaseFilter(req.query);

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const [cases, total] = await Promise.all([
      Case.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Case.countDocuments(filter),
    ]);

    res.json({ cases: cases.map(addCoordinateAliases), total, page: pageNum, totalPages: Math.ceil(total / limitNum) });
  } catch (error) {
    res.status(500).json({ error: "Failed" });
  }
}

export function getLocationSuggestions(req: Request, res: Response) {
  const query = String(req.query.query || "");
  res.json({ locations: searchLocations(query) });
}

export async function createCase(req: Request, res: Response) {
    try {
        const { symptoms, role, reporterRole, village, district, state, latitude, longitude, location: requestLocation, ...rest } = req.body;
        const normalizedSymptoms = Array.isArray(symptoms)
          ? symptoms.map((s: unknown) => String(s).trim()).filter(Boolean)
          : String(symptoms || "").split(",").map((s) => s.trim()).filter(Boolean);
        const analysis = await analyzeSymptoms(normalizedSymptoms);
        const analysisHash = getAnalysisFingerprint(normalizedSymptoms);
        const location = resolveLocation(village || "");
        const requestCoordinates = requestLocation?.coordinates;
        const coords = Array.isArray(requestCoordinates) &&
          Number.isFinite(Number(requestCoordinates[0])) &&
          Number.isFinite(Number(requestCoordinates[1]))
          ? { lat: Number(requestCoordinates[1]), lng: Number(requestCoordinates[0]) }
          : Number.isFinite(latitude) && Number.isFinite(longitude)
          ? { lat: Number(latitude), lng: Number(longitude) }
          : { lat: location.lat, lng: location.lng };
        const finalRole = reporterRole || role || (rest.worker_phone === "Web-Patient" ? "PATIENT" : "CAREGIVER");
        
        const newCase = new Case({
            ...rest,
            symptoms: normalizedSymptoms,
            village: location.name,
            district: district || location.district || location.name,
            state: state || location.state,
            urgency: analysis.urgency,
            location: locationPoint(coords.lng, coords.lat),
            predictedDisease: analysis.predictedDisease,
            aiAnalysis: analysis.summary,
            recommendedAction: analysis.actionRequired,
            callbackWindow: analysis.callbackWindow,
            differentialDiagnoses: analysis.differentialDiagnoses || [],
            redFlags: analysis.redFlags || [],
            aiConfidence: analysis.confidence,
            aiAnalysisHash: analysisHash,
            aiModel: getAnalysisModelName(),
            aiAnalyzedAt: new Date(),
            reporterRole: finalRole,
            status: "PENDING"
        });
        
        const saved = await newCase.save();
        const reference = saved._id.toString().slice(-8);
        const response = buildPortalResponse({
          role: finalRole === "PATIENT" ? "PATIENT" : "CAREGIVER",
          reference,
          analysis,
        });
        caseEvents.emit("new-case", saved);
        
        const alertMsg = `${response.heading}
Ref: ${response.reference}
Urgency: ${response.urgency}
Patient: ${saved.patientName} (${saved.age})
Village: ${saved.village}
Symptoms: ${saved.symptoms.join(", ")}
AI Symptom Analysis: ${response.analysis}
Action required: ${response.actionRequired}`;
        notifyAdmin(alertMsg);
        
        res.status(201).json({ ...addCoordinateAliases(saved.toObject()), response });
    } catch (err) {
        console.error("CREATE_ERROR:", err);
        res.status(400).json({ error: "Validation failed" });
    }
}

export async function getStats(req: Request, res: Response) {
  try {
    const { region } = req.query;
    const filter = regionFilter(region) || {};

    const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [total, critical, moderate, low, outbreaks, byDistrict] = await Promise.all([
      Case.countDocuments(filter),
      Case.countDocuments({ ...filter, urgency: "CRITICAL" }),
      Case.countDocuments({ ...filter, urgency: "MODERATE" }),
      Case.countDocuments({ ...filter, urgency: "LOW" }),
      Case.aggregate([
        { $match: { ...filter, createdAt: { $gt: last7Days } } },
        { $group: { 
            _id: { village: "$village", disease: "$predictedDisease" },
            count: { $sum: 1 }
        }},
        { $match: { count: { $gt: 10 } } },
        { $sort: { count: -1 } }
      ]),
      Case.aggregate([
        { $match: filter },
        { $group: { _id: "$district", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $project: { _id: 0, district: "$_id", count: 1 } },
      ]),
    ]);

    const regionName = (region as string) || "GLOBAL";
    res.json({ total, critical, moderate, low, population: POPULATIONS[regionName] || 0, byDistrict, outbreaks: outbreaks.map(o => ({ location: o._id.village, disease: o._id.disease, count: o.count, severity: "HIGH" })) });
  } catch (error) {
    res.status(500).json({ error: "Failed" });
  }
}

export async function getVillageStats(req: Request, res: Response) {
    const { region } = req.query;
    const filter = regionFilter(region) || {};

    const stats = await Case.aggregate([
      { $match: filter },
      { $group: { _id: "$village", caseCount: { $sum: 1 }, criticalCount: { $sum: { $cond: [{ $eq: ["$urgency", "CRITICAL"] }, 1, 0] } }, location: { $first: "$location" } }}
    ]);
    const { getLocationPopulation } = require("../utils/geocode");
    res.json(stats.map(s => ({
      village: s._id,
      caseCount: s.caseCount,
      criticalCount: s.criticalCount,
      lat: s.location?.coordinates?.[1],
      lng: s.location?.coordinates?.[0],
      population: getLocationPopulation(s._id),
    })));
}

export async function getStream(req: Request, res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const onNewCase = (data: any) => { res.write(`data: ${JSON.stringify(data)}\n\n`); };
  caseEvents.on("new-case", onNewCase);
  req.on("close", () => { caseEvents.off("new-case", onNewCase); });
}

export async function getCaseById(req: Request, res: Response) {
    const caseDoc = await Case.findById(req.params.id).lean();
    if (!caseDoc) {
      res.status(404).json({ error: "Case not found" });
      return;
    }
    res.json(addCoordinateAliases(caseDoc));
}

export async function claimCase(req: Request, res: Response) {
    const updated = await Case.findByIdAndUpdate(req.params.id, { status: "IN_PROGRESS" }, { new: true });
    res.json(updated);
}

export async function resolveCase(req: Request, res: Response) {
    const updated = await Case.findByIdAndUpdate(req.params.id, { status: "RESOLVED" }, { new: true });
    res.json(updated);
}
