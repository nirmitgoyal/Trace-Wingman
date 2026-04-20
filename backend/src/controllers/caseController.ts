import { Request, Response } from "express";
import Case, { Urgency } from "../models/Case";
import { caseEvents } from "../utils/events";
import { resolveLocation, searchLocations } from "../utils/geocode";
import { notifyAdmin } from "../utils/notifications";
import { getAnalysisFingerprint, getAnalysisModelName } from "../utils/analysisFingerprint";
import {
  analyzeSymptomsStrict,
  buildPortalResponse,
  PatientContext,
} from "../utils/symptomAnalyzer";

/**
 * Normalize whatever the user typed into an array of symptom strings.
 * Accepts any format:
 *   - already an array  → trimmed, empty-stripped array
 *   - comma-separated   → split on commas
 *   - newline-separated → split on newlines
 *   - semicolon-separated → split on semicolons
 *   - plain sentence with no delimiter → single-element array, unchanged
 * This mirrors the old "no commas → single-element array" behavior while
 * also accepting the common alternatives the frontend textarea produces.
 */
function normalizeSymptoms(input: unknown): string[] {
  const splitOne = (raw: string): string[] => {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    return trimmed
      .split(/[\n\r,;]+/g)
      .map((s) => s.trim())
      .filter(Boolean);
  };

  if (Array.isArray(input)) {
    return input.flatMap((item) => splitOne(String(item)));
  }
  return splitOne(String(input || ""));
}

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

/** Summarize recent circulating diseases in a district/state for cluster-aware LLM context. */
async function buildClusterContext(districtName: string, stateName: string): Promise<string | undefined> {
  const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const locationFilter = districtName && districtName !== "Unknown"
    ? { district: { $regex: districtName, $options: "i" } }
    : stateName && stateName !== "Unknown"
    ? { state: { $regex: stateName, $options: "i" } }
    : null;

  if (!locationFilter) return undefined;

  const recent = await Case.aggregate([
    { $match: { ...locationFilter, createdAt: { $gt: last7Days }, predictedDisease: { $exists: true, $ne: "" } } },
    { $group: { _id: "$predictedDisease", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 5 },
  ]);

  if (recent.length === 0) return undefined;

  const scope = districtName && districtName !== "Unknown" ? `${districtName} district` : `${stateName} state`;
  const parts = recent.map((r: { _id: string; count: number }) => `${r.count} case${r.count > 1 ? "s" : ""} of ${r._id}`);
  return `${parts.join(", ")} reported in ${scope} in the last 7 days`;
}

export async function createCase(req: Request, res: Response) {
    try {
        const { symptoms, role, reporterRole, village, district, state, latitude, longitude, location: requestLocation, symptomDuration, ...rest } = req.body;
        const normalizedSymptoms = normalizeSymptoms(symptoms);

        if (normalizedSymptoms.length === 0) {
          res.status(400).json({ error: "At least one symptom is required." });
          return;
        }

        const location = resolveLocation(village || "");
        const resolvedDistrict = district || location.district || location.name;
        const resolvedState = state || location.state;

        // Build cluster context from recent cases in this area (fire in parallel with setup)
        const clusterContext = await buildClusterContext(resolvedDistrict, resolvedState);

        const patientCtx: PatientContext = {
          age: Number.isFinite(Number(rest.age)) ? Number(rest.age) : undefined,
          gender: rest.gender || undefined,
          symptomDuration: symptomDuration || undefined,
          clusterContext,
        };

        // Strict analyzer: blocks on LLM warmup and keeps retrying the LLM
        // until it returns a real classification. It never returns the
        // pending placeholder, so the case will always be persisted with a
        // real predictedDisease.
        const analysis = await analyzeSymptomsStrict(normalizedSymptoms, patientCtx);
        const analysisHash = getAnalysisFingerprint(normalizedSymptoms);
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
            district: resolvedDistrict,
            state: resolvedState,
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
            symptomDuration: symptomDuration || undefined,
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
    const last14Days = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const [total, critical, moderate, low, villageOutbreaks, stateOutbreaks, pandemicCheck, byDistrict] = await Promise.all([
      Case.countDocuments(filter),
      Case.countDocuments({ ...filter, urgency: "CRITICAL" }),
      Case.countDocuments({ ...filter, urgency: "MODERATE" }),
      Case.countDocuments({ ...filter, urgency: "LOW" }),
      // Village-level outbreak: ≥3 cases, same disease + village, last 7 days
      Case.aggregate([
        { $match: { ...filter, createdAt: { $gt: last7Days }, predictedDisease: { $exists: true, $ne: "" } } },
        { $group: { _id: { village: "$village", disease: "$predictedDisease" }, count: { $sum: 1 } } },
        { $match: { count: { $gte: 3 } } },
        { $sort: { count: -1 } },
      ]),
      // State-level alert: ≥15 cases, same disease + state, last 7 days
      Case.aggregate([
        { $match: { ...filter, createdAt: { $gt: last7Days }, predictedDisease: { $exists: true, $ne: "" } } },
        { $group: { _id: { state: "$state", disease: "$predictedDisease" }, count: { $sum: 1 }, villages: { $addToSet: "$village" } } },
        { $match: { count: { $gte: 15 } } },
        { $sort: { count: -1 } },
      ]),
      // Pandemic check: same disease across ≥3 distinct states, last 14 days
      Case.aggregate([
        { $match: { ...filter, createdAt: { $gt: last14Days }, predictedDisease: { $exists: true, $ne: "" } } },
        { $group: { _id: "$predictedDisease", states: { $addToSet: "$state" }, count: { $sum: 1 } } },
        { $project: { disease: "$_id", stateCount: { $size: "$states" }, count: 1 } },
        { $match: { stateCount: { $gte: 3 }, count: { $gte: 30 } } },
        { $sort: { count: -1 } },
      ]),
      Case.aggregate([
        { $match: filter },
        { $group: { _id: "$district", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $project: { _id: 0, district: "$_id", count: 1 } },
      ]),
    ]);

    // Merge into unified alerts array with severity tiers
    type AlertLevel = "OUTBREAK" | "REGIONAL_ALERT" | "PANDEMIC_ALERT";
    interface OutbreakAlert {
      location: string;
      disease: string;
      count: number;
      alertLevel: AlertLevel;
    }

    // Pandemic alerts (highest tier, 14-day window)
    const pandemicAlerts: OutbreakAlert[] = pandemicCheck.map((p: any) => ({
      location: "Multiple regions",
      disease: p.disease,
      count: p.count,
      alertLevel: "PANDEMIC_ALERT" as AlertLevel,
    }));

    // State-level regional alerts — exclude diseases already flagged as pandemic
    const pandemicDiseases = new Set(pandemicAlerts.map(a => a.disease));
    const regionalAlerts: OutbreakAlert[] = stateOutbreaks
      .filter((o: any) => !pandemicDiseases.has(o._id.disease))
      .map((o: any) => ({
        location: o._id.state,
        disease: o._id.disease,
        count: o.count,
        alertLevel: "REGIONAL_ALERT" as AlertLevel,
      }));

    // Village-level outbreaks — exclude diseases already at higher tier
    const escalatedDiseases = new Set([...pandemicAlerts, ...regionalAlerts].map(a => a.disease));
    const villageAlerts: OutbreakAlert[] = villageOutbreaks
      .filter((o: any) => !escalatedDiseases.has(o._id.disease))
      .map((o: any) => ({
        location: o._id.village,
        disease: o._id.disease,
        count: o.count,
        alertLevel: "OUTBREAK" as AlertLevel,
      }));

    const outbreaks: OutbreakAlert[] = [...pandemicAlerts, ...regionalAlerts, ...villageAlerts];

    const regionName = (region as string) || "GLOBAL";
    res.json({ total, critical, moderate, low, population: POPULATIONS[regionName] || 0, byDistrict, outbreaks });
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
