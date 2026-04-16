import { Request, Response } from "express";
import Case, { Urgency } from "../models/Case";
import User from "../models/User";
import { caseEvents } from "../utils/events";
import { notifyAdmin } from "../utils/notifications";

const POPULATIONS: Record<string, number> = {
  "GLOBAL": 8000000000,
  "INDIA": 1400000000,
  "CT": 3600000,
  "TEXAS": 30000000,
};

function triage(symptoms: string[]): Urgency {
    const criticalKeywords = ['breathing', 'chest pain', 'unconscious', 'seizure', 'tuberculosis', 'malaria', 'cholera', 'dengue'];
    const symStr = symptoms.join(' ').toLowerCase();
    if (criticalKeywords.some(k => symStr.includes(k))) return 'CRITICAL';
    return 'MODERATE';
}

export async function getCases(req: Request, res: Response) {
  try {
    const { urgency, district, search, region, page = "1", limit = "50" } = req.query;
    const filter: Record<string, any> = {};
    if (urgency && urgency !== "ALL") filter.urgency = urgency as Urgency;
    if (district) filter.district = { $regex: district as string, $options: "i" };
    
    if (region === "CT") {
      filter.$or = [{ state: { $regex: "CT|Connecticut", $options: "i" } }, { village: { $regex: "CT|Connecticut", $options: "i" } }];
    } else if (region === "TEXAS") {
       filter.$or = [{ state: { $regex: "TX|Texas", $options: "i" } }, { village: { $regex: "TX|Texas", $options: "i" } }];
    } else if (region === "INDIA") {
       filter.longitude = { $gt: 60, $lt: 100 };
    }

    if (search) {
      filter.$or = [
        { patientName: { $regex: search as string, $options: "i" } },
        { village: { $regex: search as string, $options: "i" } },
        { predictedDisease: { $regex: search as string, $options: "i" } }
      ];
    }

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const [cases, total] = await Promise.all([
      Case.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Case.countDocuments(filter),
    ]);

    res.json({ cases, total, page: pageNum, totalPages: Math.ceil(total / limitNum) });
  } catch (error) {
    res.status(500).json({ error: "Failed" });
  }
}

export async function createCase(req: Request, res: Response) {
    try {
        const { symptoms, ...rest } = req.body;
        const urgency = triage(symptoms || []);
        
        const newCase = new Case({
            ...rest,
            symptoms: symptoms || [],
            urgency,
            status: "PENDING"
        });
        
        const saved = await newCase.save();
        caseEvents.emit("new-case", saved);
        
        const alertMsg = `🏥 NEW CASE: ${saved.patientName} (${saved.age})\nVillage: ${saved.village}\nSymptoms: ${saved.symptoms.join(", ")}\nUrgency: ${saved.urgency}`;
        notifyAdmin(alertMsg);
        
        res.status(201).json(saved);
    } catch (err) {
        console.error("CREATE_ERROR:", err);
        res.status(400).json({ error: "Validation failed" });
    }
}

export async function getStats(req: Request, res: Response) {
  try {
    const { region } = req.query;
    const filter: Record<string, any> = {};
    if (region === "CT") filter.$or = [{ state: { $regex: "CT|Connecticut", $options: "i" } }, { village: { $regex: "CT|Connecticut", $options: "i" } }];
    else if (region === "TEXAS") filter.$or = [{ state: { $regex: "TX|Texas", $options: "i" } }, { village: { $regex: "TX|Texas", $options: "i" } }];
    else if (region === "INDIA") filter.longitude = { $gt: 60, $lt: 100 };

    const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [total, critical, moderate, low, outbreaks] = await Promise.all([
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
      ])
    ]);

    const regionName = (region as string) || "GLOBAL";
    res.json({ total, critical, moderate, low, population: POPULATIONS[regionName] || 0, outbreaks: outbreaks.map(o => ({ location: o._id.village, disease: o._id.disease, count: o.count, severity: "HIGH" })) });
  } catch (error) {
    res.status(500).json({ error: "Failed" });
  }
}

export async function getVillageStats(req: Request, res: Response) {
    const { region } = req.query;
    const filter: any = {};
    if (region === "CT") filter.$or = [{ state: { $regex: "CT|Connecticut", $options: "i" } }];
    else if (region === "TEXAS") filter.$or = [{ state: { $regex: "TX|Texas", $options: "i" } }];
    else if (region === "INDIA") filter.longitude = { $gt: 60, $lt: 100 };

    const stats = await Case.aggregate([
      { $match: filter },
      { $group: { _id: "$village", caseCount: { $sum: 1 }, criticalCount: { $sum: { $cond: [{ $eq: ["$urgency", "CRITICAL"] }, 1, 0] } }, lat: { $first: "$latitude" }, lng: { $first: "$longitude" } }}
    ]);
    const { getLocationPopulation } = require("../utils/geocode");
    res.json(stats.map(s => ({ village: s._id, caseCount: s.caseCount, criticalCount: s.criticalCount, lat: s.lat, lng: s.lng, population: getLocationPopulation(s._id) })));
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
    res.json(caseDoc);
}

export async function claimCase(req: Request, res: Response) {
    const updated = await Case.findByIdAndUpdate(req.params.id, { status: "IN_PROGRESS" }, { new: true });
    res.json(updated);
}

export async function resolveCase(req: Request, res: Response) {
    const updated = await Case.findByIdAndUpdate(req.params.id, { status: "RESOLVED" }, { new: true });
    res.json(updated);
}
