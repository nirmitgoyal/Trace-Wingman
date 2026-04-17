import { Urgency } from "../models/Case";
import { isSymptomModelReady } from "./localModel";
import { findCachedAnalysis, cacheAnalysis } from "./symptomVectorCache";

export interface SymptomAnalysis {
  urgency: Urgency;
  predictedDisease: string;
  summary: string;
  actionRequired: string;
  callbackWindow: string;
  differentialDiagnoses?: string[];
  redFlags?: string[];
  confidence?: "LOW" | "MEDIUM" | "HIGH";
}

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

export function analyzeSymptomsLocally(symptoms: string[]): SymptomAnalysis {
  const normalized = symptoms.join(" ").toLowerCase();

  if (includesAny(normalized, ["seizure", "seizures", "loss of consciousness", "unconscious"])) {
    return {
      urgency: "CRITICAL",
      predictedDisease: "Acute Neurological Emergency",
      summary:
        "Seizures or loss of consciousness are high-risk neurological symptoms and need emergency evaluation. These symptoms can occur with serious infection, seizure disorder, stroke-like events, metabolic problems, or low oxygen.",
      actionRequired:
        "Call emergency services immediately. Keep the person on their side if possible, do not put anything in their mouth, and do not give food or drink while unconscious or confused.",
      callbackWindow: "within 2 hours",
      differentialDiagnoses: ["Seizure disorder", "Meningitis or encephalitis", "Stroke-like event", "Sepsis", "Metabolic emergency"],
      redFlags: ["Seizure activity", "Loss of consciousness", "Difficulty speaking or double vision", "Purplish rash or mottled skin"],
      confidence: "HIGH",
    };
  }

  if (includesAny(normalized, ["fruity breath"]) && includesAny(normalized, ["rapid breathing", "confusion"])) {
    return {
      urgency: "CRITICAL",
      predictedDisease: "Possible Diabetic Ketoacidosis or Acute Metabolic Emergency",
      summary:
        "Fruity breath with rapid breathing and confusion can indicate a dangerous metabolic emergency such as diabetic ketoacidosis. This requires urgent clinical assessment and blood sugar/ketone testing.",
      actionRequired:
        "Call emergency services or go to the nearest emergency department immediately. Do not delay care while waiting for a callback.",
      callbackWindow: "within 2 hours",
      differentialDiagnoses: ["Diabetic ketoacidosis", "Sepsis", "Severe dehydration", "Toxic ingestion"],
      redFlags: ["Confusion", "Rapid breathing", "Fruity breath", "Extreme weakness"],
      confidence: "HIGH",
    };
  }

  if (
    includesAny(normalized, ["excessive thirst", "thirsty", "frequent urination", "increased urination"]) &&
    includesAny(normalized, ["blurred vision", "slow-healing wounds", "weight loss"])
  ) {
    return {
      urgency: "MODERATE",
      predictedDisease: "Possible Diabetes Mellitus or Metabolic Concern",
      summary:
        "Excessive thirst, frequent urination, blurred vision, or slow-healing wounds can suggest high blood sugar or another metabolic problem. This should be reviewed by a clinician and checked with blood glucose testing.",
      actionRequired:
        "Arrange medical review and blood sugar testing. Stay hydrated if able, and seek urgent care if there is confusion, rapid breathing, fruity breath, vomiting, severe weakness, or worsening symptoms.",
      callbackWindow: "within 24 hours",
      differentialDiagnoses: ["Diabetes mellitus", "Urinary tract infection", "Dehydration", "Endocrine disorder"],
      redFlags: ["Confusion", "Rapid breathing", "Fruity breath", "Vomiting", "Severe weakness"],
      confidence: "MEDIUM",
    };
  }

  if (includesAny(normalized, ["confusion"]) && includesAny(normalized, ["rapid breathing", "rapid breathing/heart rate"])) {
    return {
      urgency: "CRITICAL",
      predictedDisease: "Possible Sepsis or Acute Systemic Illness",
      summary:
        "Confusion with rapid breathing or rapid heart rate can indicate a severe systemic illness, including sepsis. This pattern should be treated as urgent until a clinician rules out dangerous causes.",
      actionRequired:
        "Seek urgent medical care immediately. Monitor breathing and consciousness and call emergency services if symptoms worsen.",
      callbackWindow: "within 2 hours",
      differentialDiagnoses: ["Sepsis", "Severe infection", "Metabolic emergency", "Respiratory distress"],
      redFlags: ["Confusion", "Rapid breathing", "High or low temperature", "Cold or mottled skin"],
      confidence: "HIGH",
    };
  }

  if (includesAny(normalized, ["chest pain"])) {
    return {
      urgency: "CRITICAL",
      predictedDisease: "Possible Cardiac or Respiratory Emergency",
      summary:
        "Chest pain can be caused by serious heart or lung conditions and needs urgent assessment. The case should be escalated quickly, especially if there is shortness of breath, sweating, weakness, or fainting.",
      actionRequired:
        "Call emergency services immediately if chest pain is severe, persistent, or occurs with breathing trouble, sweating, fainting, or weakness.",
      callbackWindow: "within 2 hours",
      differentialDiagnoses: ["Heart attack", "Pulmonary embolism", "Pneumonia", "Severe asthma or respiratory distress"],
      redFlags: ["Severe chest pain", "Shortness of breath", "Fainting", "Sweating or severe weakness"],
      confidence: "MEDIUM",
    };
  }

  if (includesAny(normalized, ["breathing", "breathlessness", "shortness of breath"])) {
    return {
      urgency: "CRITICAL",
      predictedDisease: "Acute Respiratory Distress",
      summary:
        "Breathing difficulty can indicate a serious respiratory or systemic problem and needs urgent assessment. This is especially concerning if it is severe, sudden, or occurs with confusion, chest tightness, wheezing, or blue lips.",
      actionRequired:
        "Seek urgent medical care immediately. Keep the person upright if that helps breathing and call emergency services if breathing is severe or worsening.",
      callbackWindow: "within 2 hours",
      differentialDiagnoses: ["Asthma attack", "Pneumonia", "Severe allergic reaction", "Heart or lung emergency"],
      redFlags: ["Severe shortness of breath", "Blue lips", "Confusion", "Chest tightness"],
      confidence: "MEDIUM",
    };
  }

  if (includesAny(normalized, ["persistent cough", "cough"]) && includesAny(normalized, ["night sweat", "night sweats", "weight loss"])) {
    return {
      urgency: "CRITICAL",
      predictedDisease: "Suspected Pulmonary Tuberculosis (TB)",
      summary:
        "Based on your persistent cough, night sweats, and significant weight loss, this case strongly suggests Suspected Pulmonary Tuberculosis (TB).",
      actionRequired:
        "Keep patient resting. Do not give food or water if patient is unconscious. If condition worsens, call emergency services immediately.",
      callbackWindow: "within 2 hours",
    };
  }

  if (includesAny(normalized, ["malaria"]) || (includesAny(normalized, ["chills"]) && includesAny(normalized, ["high fever", "sweating"]))) {
    return {
      urgency: "CRITICAL",
      predictedDisease: "Possible Malaria",
      summary:
        "Symptoms such as chills, high fever, and sweating are consistent with possible Malaria and require urgent clinical review.",
      actionRequired:
        "Keep the patient hydrated if conscious, monitor temperature, and seek urgent medical care if fever persists or confusion develops.",
      callbackWindow: "within 2 hours",
    };
  }

  if (includesAny(normalized, ["dengue", "severe headache", "rash", "joint pain"])) {
    return {
      urgency: "CRITICAL",
      predictedDisease: "Possible Dengue",
      summary:
        "Symptoms such as severe headache, rash, and joint pain may indicate Dengue and need urgent assessment.",
      actionRequired:
        "Avoid aspirin or ibuprofen unless directed by a clinician. Encourage fluids if conscious and seek care if bleeding, severe pain, or weakness appears.",
      callbackWindow: "within 2 hours",
    };
  }

  if (includesAny(normalized, ["cholera", "severe diarrhea", "dehydration", "vomiting"])) {
    return {
      urgency: "CRITICAL",
      predictedDisease: "Possible Acute Gastrointestinal Infection",
      summary:
        "Severe diarrhea, vomiting, or dehydration may indicate a serious gastrointestinal infection requiring rapid review.",
      actionRequired:
        "Use oral rehydration if the patient is conscious and able to drink. Seek emergency care for weakness, confusion, or inability to keep fluids down.",
      callbackWindow: "within 2 hours",
    };
  }

  if (
    includesAny(normalized, ["thirsty", "increased urination", "frequent urination", "blurred vision"]) &&
    includesAny(normalized, ["weight loss", "cloudy urine", "urine", "slow-healing wounds", "excessive thirst"])
  ) {
    return {
      urgency: "MODERATE",
      predictedDisease: "Metabolic concern such as Diabetes Mellitus",
      summary:
        "Symptoms (thirsty, increased urination, weight loss) suggest metabolic concern such as Diabetes Mellitus. Cloudy urine may indicate a concurrent infection.",
      actionRequired:
        "Please monitor the patient and send another report if symptoms worsen before the callback. Ensure they stay hydrated.",
      callbackWindow: "within 24 hours",
    };
  }

  if (
    includesAny(normalized, ["facial pressure", "face pain", "sinus pressure", "sinus pain", "forehead pressure", "forehead pain"]) ||
    (includesAny(normalized, ["nasal discharge", "yellow discharge", "green discharge", "thick discharge", "runny nose", "postnasal drip"]) &&
      includesAny(normalized, ["facial pressure", "face pain", "pressure", "congestion", "blocked nose", "stuffy nose", "headache"]))
  ) {
    const hasRadiating = includesAny(normalized, ["radiating", "ear", "teeth", "tooth", "jaw"]);
    const hasFever = includesAny(normalized, ["fever", "high fever"]);
    const hasVisionChange = includesAny(normalized, ["blurred vision", "double vision", "swelling around eye", "eye swelling", "periorbital"]);

    if (hasVisionChange || includesAny(normalized, ["stiff neck", "severe headache", "confusion"])) {
      return {
        urgency: "CRITICAL",
        predictedDisease: "Possible Complicated Sinusitis or Intracranial Extension",
        summary:
          "Facial pressure or nasal discharge with vision changes, severe headache, stiff neck, or confusion raises concern for a serious sinus complication that has spread to the eye socket or brain structures. This is a medical emergency.",
        actionRequired:
          "Seek emergency care immediately. Do not delay — orbital or intracranial spread from sinus infection can progress rapidly.",
        callbackWindow: "within 2 hours",
        differentialDiagnoses: ["Orbital cellulitis", "Cavernous sinus thrombosis", "Intracranial abscess", "Meningitis", "Severe acute sinusitis"],
        redFlags: ["Vision changes or eye swelling", "Severe headache", "Stiff neck", "Confusion or altered consciousness"],
        confidence: "HIGH",
      };
    }

    return {
      urgency: "MODERATE",
      predictedDisease: "Acute Bacterial Sinusitis",
      summary:
        `Facial pressure or pain, thick nasal discharge${hasRadiating ? ", and pain radiating to the ear or teeth" : ""}${hasFever ? " with fever" : ""} are consistent with acute bacterial sinusitis. This occurs when the sinus cavities become inflamed and infected, often after a cold or upper respiratory illness.`,
      actionRequired:
        "Arrange a clinical review — a clinician should assess whether antibiotics are appropriate. In the meantime, use saline nasal rinses if available, stay hydrated, and use pain relief as needed. Seek urgent care if vision changes, severe headache, swelling around the eyes, high fever, or stiff neck develop.",
      callbackWindow: "within 24 hours",
      differentialDiagnoses: ["Acute bacterial sinusitis", "Viral sinusitis (post-cold)", "Dental abscess with sinus involvement", "Allergic rhinitis with secondary infection", "Nasal polyps with infection"],
      redFlags: ["Swelling around the eye or forehead", "Vision changes", "Severe or worsening headache", "High fever", "Stiff neck"],
      confidence: "HIGH",
    };
  }

  if (includesAny(normalized, ["fever", "cough", "fatigue", "headache", "body ache"])) {
    return {
      urgency: "MODERATE",
      predictedDisease: "Acute febrile or respiratory illness",
      summary:
        "The reported symptoms suggest an acute febrile or respiratory illness that should be reviewed by a clinician.",
      actionRequired:
        "Monitor temperature, maintain hydration, and submit another report if symptoms worsen before the callback.",
      callbackWindow: "within 24 hours",
    };
  }

  return {
    urgency: "LOW",
    predictedDisease: "Non-urgent symptom report",
    summary:
      "The reported symptoms do not currently match a high-risk pattern, but the case has been logged for clinical review.",
    actionRequired:
      "Continue monitoring the patient and submit another report if symptoms worsen or new symptoms appear.",
    callbackWindow: "within 48 hours",
  };
}

function extractJson(raw: string) {
  const withoutThought = raw.replace(/<\|channel\>thought[\s\S]*?<channel\|>/g, "").trim();
  const withoutFence = withoutThought.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return withoutFence;
  return withoutFence.slice(firstBrace, lastBrace + 1);
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 5);
}

function parseGemmaResponse(raw: string, fallback: SymptomAnalysis): SymptomAnalysis {
  try {
    const parsed = JSON.parse(extractJson(raw));
    if (!["CRITICAL", "MODERATE", "LOW"].includes(parsed.urgency)) return fallback;

    return {
      urgency: parsed.urgency,
      predictedDisease: parsed.predictedDisease || fallback.predictedDisease,
      summary: parsed.summary || fallback.summary,
      actionRequired: parsed.actionRequired || fallback.actionRequired,
      callbackWindow: parsed.callbackWindow || fallback.callbackWindow,
      differentialDiagnoses: asStringArray(parsed.differentialDiagnoses),
      redFlags: asStringArray(parsed.redFlags),
      confidence: ["LOW", "MEDIUM", "HIGH"].includes(parsed.confidence) ? parsed.confidence : "MEDIUM",
    };
  } catch {
    return fallback;
  }
}

function applySafetyOverrides(analysis: SymptomAnalysis, symptoms: string[]): SymptomAnalysis {
  const normalized = symptoms.join(" ").toLowerCase();
  const tbUnsupported =
    analysis.predictedDisease.toLowerCase().includes("tuberculosis") &&
    !includesAny(normalized, ["persistent cough", "cough", "night sweat", "night sweats", "weight loss", "tuberculosis", "tb"]);

  if (
    includesAny(normalized, ["seizure", "seizures", "loss of consciousness", "unconscious"]) ||
    (includesAny(normalized, ["stiff neck"]) && includesAny(normalized, ["fever", "high fever", "severe headache"])) ||
    (includesAny(normalized, ["fruity breath"]) && includesAny(normalized, ["rapid breathing", "confusion"])) ||
    (includesAny(normalized, ["confusion"]) && includesAny(normalized, ["rapid breathing", "rapid breathing/heart rate"]))
  ) {
    return {
      ...analysis,
      urgency: "CRITICAL",
      callbackWindow: "within 2 hours",
      predictedDisease: includesAny(normalized, ["fruity breath"])
        ? "Possible Diabetic Ketoacidosis or Acute Metabolic Emergency"
        : includesAny(normalized, ["seizure", "seizures", "loss of consciousness", "unconscious"])
          ? "Acute Neurological Emergency"
          : tbUnsupported
            ? "Possible Sepsis or Acute Systemic Illness"
        : analysis.predictedDisease,
      summary: tbUnsupported
        ? "These symptoms include serious red flags and need urgent clinical assessment. The pattern may reflect a neurological emergency, severe infection, or metabolic problem rather than a routine illness."
        : analysis.summary,
      actionRequired: tbUnsupported
        ? "Seek emergency medical care immediately. Monitor breathing and consciousness and do not give food or drink if the person is unconscious or confused."
        : analysis.actionRequired,
      redFlags: Array.from(new Set([...(analysis.redFlags || []), "Confusion or loss of consciousness", "Rapid breathing", "Seizure activity"])),
    };
  }

  if (
    includesAny(normalized, ["pain behind eyes", "severe headache"]) &&
    includesAny(normalized, ["high fever", "fever"]) &&
    includesAny(normalized, ["rash", "skin rash"])
  ) {
    return {
      ...analysis,
      urgency: "CRITICAL",
      predictedDisease: analysis.predictedDisease.toLowerCase().includes("dengue")
        ? analysis.predictedDisease
        : "Possible Dengue Fever or Acute Viral Hemorrhagic Illness",
      summary:
        "Severe headache or pain behind the eyes with fever and rash can fit Dengue or another serious viral illness. This combination needs urgent clinical review because some cases can worsen quickly.",
      actionRequired:
        "Seek urgent medical review. Avoid aspirin or ibuprofen unless a clinician directs it, use fluids if able, and watch for bleeding, severe abdominal pain, persistent vomiting, or extreme weakness.",
      callbackWindow: "within 2 hours",
      redFlags: Array.from(new Set([...(analysis.redFlags || []), "Bleeding", "Severe abdominal pain", "Persistent vomiting", "Extreme weakness"])),
    };
  }

  if (
    includesAny(normalized, ["excessive thirst", "thirsty", "frequent urination", "increased urination"]) &&
    includesAny(normalized, ["blurred vision", "slow-healing wounds", "weight loss"])
  ) {
    return {
      ...analysis,
      urgency: analysis.urgency === "CRITICAL" ? "CRITICAL" : "MODERATE",
      predictedDisease: analysis.predictedDisease.toLowerCase().includes("diabetes")
        ? analysis.predictedDisease
        : "Possible Diabetes Mellitus or Metabolic Concern",
      summary:
        "Excessive thirst, frequent urination, blurred vision, or slow-healing wounds can suggest high blood sugar or another metabolic problem. This should be reviewed by a clinician and checked with blood glucose testing.",
      actionRequired:
        "Arrange medical review and blood sugar testing. Stay hydrated if able, and seek urgent care if there is confusion, rapid breathing, fruity breath, vomiting, severe weakness, or worsening symptoms.",
      callbackWindow: analysis.urgency === "CRITICAL" ? "within 2 hours" : "within 24 hours",
      redFlags: Array.from(new Set([...(analysis.redFlags || []), "Confusion", "Rapid breathing", "Fruity breath", "Vomiting", "Severe weakness"])),
    };
  }

  return analysis;
}

async function analyzeWithGemma(symptoms: string[], fallback: SymptomAnalysis): Promise<SymptomAnalysis> {
  const url = process.env.GEMMA_LOCAL_URL || "http://localhost:11434/api/chat";
  const model = process.env.GEMMA_MODEL || "gemma4:e2b";
  const keepAlive = process.env.OLLAMA_KEEP_ALIVE || "30m";
  const numCtx = Number(process.env.GEMMA_NUM_CTX || 2048);
  const numPredict = Number(process.env.GEMMA_NUM_PREDICT || 360);
  const timeoutMs = Number(process.env.GEMMA_TIMEOUT_MS || 45000);
  if (!url || !model) return fallback;

  try {
    const system = `You are Sevak's local symptom triage assistant.
Classify possible illness from symptom reports for rural and community health surveillance.
This is not a diagnosis. Be medically cautious, concise, and specific to the supplied symptoms.
Do not reuse examples unless the symptoms support them.
Return strict JSON only. No markdown. No hidden reasoning.
Schema:
{
  "urgency": "CRITICAL" | "MODERATE" | "LOW",
  "predictedDisease": "most likely illness or syndrome",
  "differentialDiagnoses": ["2-5 plausible alternatives"],
  "summary": "2 sentences explaining why these symptoms suggest this illness",
  "actionRequired": "practical immediate next steps while waiting for clinician callback",
  "callbackWindow": "within 2 hours" | "within 24 hours" | "within 48 hours",
  "redFlags": ["symptoms that require emergency care"],
  "confidence": "LOW" | "MEDIUM" | "HIGH"
}`;

    const user = `Symptoms: ${symptoms.join(", ")}

Rules:
- Use CRITICAL for breathing trouble, unconsciousness, seizure, chest pain, severe dehydration, meningitis signs, stroke signs, severe bleeding, suspected sepsis, or dangerous infectious disease patterns.
- Use MODERATE when the patient needs timely clinical review but is not currently unstable.
- Use LOW only for mild symptoms without red flags.
- For vague symptoms, say uncertainty clearly and choose a syndrome rather than forcing TB, malaria, dengue, diabetes, etc.`;

    const isChatEndpoint = url.endsWith("/api/chat");
    const body = isChatEndpoint
      ? {
          model,
          stream: false,
          format: "json",
          keep_alive: keepAlive,
          options: { temperature: 0.2, top_p: 0.85, top_k: 30, num_ctx: numCtx, num_predict: numPredict },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }
      : {
          model,
          stream: false,
          format: "json",
          keep_alive: keepAlive,
          options: { temperature: 0.2, top_p: 0.85, top_k: 30, num_ctx: numCtx, num_predict: numPredict },
          prompt: `${system}\n\n${user}`,
        };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) return fallback;
    const data = await res.json();
    let responseText = "";
    if (typeof data === "object" && data !== null && "message" in data) {
      const message = (data as { message?: { content?: unknown } }).message;
      responseText = String(message?.content || "");
    } else if (typeof data === "object" && data !== null && "response" in data) {
      responseText = String((data as { response?: unknown }).response || "");
    }

    return applySafetyOverrides(parseGemmaResponse(responseText, fallback), symptoms);
  } catch {
    return applySafetyOverrides(fallback, symptoms);
  }
}

export async function analyzeSymptoms(symptoms: string[]): Promise<SymptomAnalysis> {
  const llmReady = process.env.SYMPTOM_ANALYZER === "gemma" || isSymptomModelReady();

  if (llmReady) {
    // LLM is available — use it for best results, then cache in background
    const fallback = analyzeSymptomsLocally(symptoms);
    const result = await analyzeWithGemma(symptoms, fallback);
    void cacheAnalysis(symptoms, result, "llm");
    return result;
  }

  // LLM not ready — check vector cache for a semantically similar past result
  const cached = await findCachedAnalysis(symptoms);
  if (cached) {
    return cached as SymptomAnalysis;
  }

  // Genuinely new pattern with no LLM and no cache — fall back to rules
  const rulesResult = applySafetyOverrides(analyzeSymptomsLocally(symptoms), symptoms);
  void cacheAnalysis(symptoms, rulesResult, "rules");
  return rulesResult;
}

function patientActionText(actionRequired: string) {
  if (actionRequired.includes("Keep patient resting")) {
    return "Please rest and avoid strenuous activity. If you feel faint, confused, unconscious, or your breathing worsens, call emergency services immediately. Do not eat or drink if you feel like you may lose consciousness.";
  }

  if (actionRequired.includes("Keep the patient hydrated")) {
    return "Please drink fluids if you can do so safely, monitor your temperature, and seek urgent medical care if the fever persists or you feel confused or very weak.";
  }

  if (actionRequired.includes("Avoid aspirin or ibuprofen")) {
    return "Please avoid aspirin or ibuprofen unless a clinician tells you to take them. Drink fluids if you can, and seek care quickly if you notice bleeding, severe pain, or unusual weakness.";
  }

  if (actionRequired.includes("Use oral rehydration")) {
    return "Please use oral rehydration if you can drink safely. Seek emergency care if you feel weak, confused, or cannot keep fluids down.";
  }

  if (actionRequired.includes("Please monitor the patient")) {
    return "Please monitor your symptoms and send another report if anything worsens before the callback. Keep drinking fluids if you can do so safely.";
  }

  if (actionRequired.includes("Monitor temperature")) {
    return "Please monitor your temperature, keep drinking fluids if you can, and submit another report if symptoms worsen before the callback.";
  }

  if (actionRequired.includes("Continue monitoring the patient")) {
    return "Please continue monitoring your symptoms and submit another report if they worsen or new symptoms appear.";
  }

  return actionRequired;
}

export function buildPortalResponse(params: {
  role: "PATIENT" | "CAREGIVER";
  reference: string;
  analysis: SymptomAnalysis;
}) {
  const heading =
    params.role === "PATIENT" && params.analysis.urgency === "CRITICAL"
      ? "SEVAK ALERT — CRITICAL CASE LOGGED"
      : "SEVAK — Case Logged";

  return {
    heading,
    reference: params.reference,
    urgency: params.analysis.urgency,
    callbackMessage: `A doctor callback has been scheduled ${params.analysis.callbackWindow}. 🎯`,
    analysis: params.analysis.summary,
    actionRequired: params.role === "PATIENT" ? patientActionText(params.analysis.actionRequired) : params.analysis.actionRequired,
    predictedDisease: params.analysis.predictedDisease,
    differentialDiagnoses: params.analysis.differentialDiagnoses || [],
    redFlags: params.analysis.redFlags || [],
    confidence: params.analysis.confidence || "MEDIUM",
  };
}
