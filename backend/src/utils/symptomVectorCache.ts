import crypto from "crypto";
import SymptomCache, { ICachedAnalysis } from "../models/SymptomCache";
import { getAnalysisModelName } from "./analysisFingerprint";
import type { SymptomAnalysis } from "./symptomAnalyzer";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
// nomic-embed-text is a compact 768-dim embedding model \u2014 run: ollama pull nomic-embed-text
const EMBED_MODEL = process.env.EMBED_MODEL || "nomic-embed-text";
// Minimum cosine similarity to treat a cached result as a match (0\u20131)
const SIMILARITY_THRESHOLD = Number(process.env.VECTOR_SIMILARITY_THRESHOLD ?? 0.88);
// How many recent cache entries to scan for similarity (bounded for performance)
const CACHE_SCAN_LIMIT = Number(process.env.VECTOR_CACHE_SCAN_LIMIT ?? 500);

/** SHA-256 of sorted, normalised symptoms \u2014 model/version agnostic (just symptom content) */
export function symptomContentHash(symptoms: string[]): string {
  const normalized = symptoms
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .sort();
  return crypto.createHash("sha256").update(normalized.join("|")).digest("hex");
}

/** Calls Ollama /api/embeddings to embed a symptom list as a dense vector. */
async function getEmbedding(symptoms: string[]): Promise<number[] | null> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: symptoms.join(", ") }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embedding?: unknown };
    return Array.isArray(data.embedding) ? (data.embedding as number[]) : null;
  } catch {
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Look up a cached analysis for the given symptoms.
 *
 * Strategy:
 *  1. Exact hash match  \u2014 instant, no embedding needed
 *  2. Vector similarity \u2014 embeds the symptoms and scans recent cache entries
 *
 * Returns null if nothing matches above SIMILARITY_THRESHOLD.
 */
export async function findCachedAnalysis(symptoms: string[]): Promise<ICachedAnalysis | null> {
  const hash = symptomContentHash(symptoms);

  // 1. Exact match (same symptoms, different word order still normalises to same hash)
  const exact = await SymptomCache.findOneAndUpdate(
    { symptomHash: hash },
    { $inc: { hitCount: 1 }, $set: { lastUsedAt: new Date() } },
    { new: true }
  ).lean();
  if (exact) {
    console.log(`[VectorCache] Exact hit for hash ${hash.slice(0, 12)}\u2026`);
    return exact.analysis;
  }

  // 2. Semantic similarity
  const embedding = await getEmbedding(symptoms);
  if (!embedding) {
    console.warn("[VectorCache] Embedding model unavailable \u2014 skipping similarity search.");
    return null;
  }

  const candidates = await SymptomCache.find({
    embedding: { $exists: true, $not: { $size: 0 } },
  })
    .sort({ lastUsedAt: -1 })
    .limit(CACHE_SCAN_LIMIT)
    .select("embedding analysis symptomHash hitCount")
    .lean();

  let bestSim = 0;
  let bestAnalysis: ICachedAnalysis | null = null;
  let bestHash = "";

  for (const entry of candidates) {
    if (!entry.embedding?.length) continue;
    const sim = cosineSimilarity(embedding, entry.embedding);
    if (sim >= SIMILARITY_THRESHOLD && sim > bestSim) {
      bestSim = sim;
      bestAnalysis = entry.analysis;
      bestHash = entry.symptomHash;
    }
  }

  if (bestAnalysis) {
    console.log(
      `[VectorCache] Similarity hit (score=${bestSim.toFixed(4)}) from hash ${bestHash.slice(0, 12)}\u2026`
    );
    // Bump the matched entry's stats in background
    void SymptomCache.updateOne(
      { symptomHash: bestHash },
      { $inc: { hitCount: 1 }, $set: { lastUsedAt: new Date() } }
    );
    return bestAnalysis;
  }

  console.log(`[VectorCache] No cache match for symptoms: ${symptoms.join(", ")}`);
  return null;
}

/**
 * Store an LLM (or rule) analysis result in the vector cache.
 * Upserts by symptomHash \u2014 safe to call multiple times for the same symptoms.
 * Fire-and-forget: always called without await so it never slows down the response.
 */
export async function cacheAnalysis(
  symptoms: string[],
  analysis: SymptomAnalysis,
  source: "llm" | "rules"
): Promise<void> {
  try {
    const hash = symptomContentHash(symptoms);
    const embedding = await getEmbedding(symptoms);

    await SymptomCache.findOneAndUpdate(
      { symptomHash: hash },
      {
        $set: {
          symptoms,
          embedding: embedding ?? [],
          analysis: {
            urgency: analysis.urgency,
            predictedDisease: analysis.predictedDisease,
            summary: analysis.summary,
            actionRequired: analysis.actionRequired,
            callbackWindow: analysis.callbackWindow,
            differentialDiagnoses: analysis.differentialDiagnoses ?? [],
            redFlags: analysis.redFlags ?? [],
            confidence: analysis.confidence,
          },
          source,
          modelName: getAnalysisModelName(),
          lastUsedAt: new Date(),
        },
        $setOnInsert: { hitCount: 0 },
      },
      { upsert: true }
    );
    console.log(`[VectorCache] Cached ${source} analysis for hash ${hash.slice(0, 12)}\u2026`);
  } catch (error) {
    console.warn("[VectorCache] Failed to cache analysis:", error);
  }
}
