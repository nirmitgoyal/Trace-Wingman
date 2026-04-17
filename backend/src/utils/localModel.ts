import { spawn } from "child_process";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const GEMMA_MODEL = process.env.GEMMA_MODEL || "gemma4:e2b";

let warmupStarted = false;

async function canReachOllama() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}

function startOllamaServer() {
  if (process.env.AUTO_START_OLLAMA === "false") return;

  const child = spawn("ollama", ["serve"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function waitForOllama(maxAttempts = 20) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await canReachOllama()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function modelExists(model: string) {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (!res.ok) return false;
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const models = Array.isArray(data.models) ? data.models : [];
    return models.some((item: { name?: string }) => item.name === model);
  } catch {
    return false;
  }
}

function runOllama(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("ollama", args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ollama ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function warmModel(model: string) {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      keep_alive: process.env.OLLAMA_KEEP_ALIVE || "30m",
      messages: [{ role: "user", content: "Return OK." }],
      options: {
        num_ctx: Number(process.env.GEMMA_NUM_CTX || 2048),
        num_predict: 4,
      },
    }),
  });

  if (!res.ok) throw new Error(`Ollama warmup failed with status ${res.status}`);
}

export async function ensureLocalSymptomModel() {
  if (process.env.SYMPTOM_ANALYZER !== "gemma") return;
  if (warmupStarted) return;
  warmupStarted = true;

  try {
    if (!(await canReachOllama())) {
      console.log("Ollama is not reachable. Starting local Ollama server...");
      startOllamaServer();
    }

    if (!(await waitForOllama())) {
      console.warn("Ollama did not become reachable. Sevak will use local rule-based fallback until it is available.");
      return;
    }

    if (!(await modelExists(GEMMA_MODEL))) {
      if (process.env.AUTO_PULL_GEMMA === "false") {
        console.warn(`Gemma model ${GEMMA_MODEL} is missing and AUTO_PULL_GEMMA=false. Using fallback analyzer.`);
        return;
      }

      console.log(`Gemma model ${GEMMA_MODEL} is missing. Downloading with Ollama...`);
      await runOllama(["pull", GEMMA_MODEL]);
    }

    await warmModel(GEMMA_MODEL);
    console.log(`Local symptom analyzer ready: ${GEMMA_MODEL}`);
  } catch (error) {
    console.warn("Local symptom analyzer is not ready. Sevak will continue with fallback analysis.", error);
  }
}

export function ensureLocalSymptomModelInBackground() {
  void ensureLocalSymptomModel();
}
