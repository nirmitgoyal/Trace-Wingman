# Sevak — Health Surveillance System

A real-time health surveillance platform for monitoring patient cases across multi-region deployments (India, Connecticut, Texas, and global). Built with a Node.js/Express/TypeScript backend, MongoDB Atlas, and a React + Leaflet frontend.

---

## Features

### Dashboard
- **Stats Overview** — Total, Critical, Moderate, and Low case counts with district-level breakdown
- **Interactive Heatmap** — Leaflet map with color-coded markers and heatmap layer
- **Patient Case Table** — Paginated, searchable list with urgency filtering
- **Case Detail Panel** — Full patient record with AI analysis, differential diagnoses, red flags, and location info
- **Regional Filtering** — Scope the dashboard to Global / India / Connecticut / Texas
- **Auto-Refresh** — Live updates via Server-Sent Events (SSE)

### AI Symptom Analysis
- **Local LLM triage** — Symptom classification via a locally-hosted Gemma model (Ollama)
- **Auto-detection** — Backend connects to Ollama automatically at startup; no manual env flag needed when Ollama is running
- **Structured output** — Urgency level, predicted illness, plain-language summary, differential diagnoses, red flags, callback window, and confidence rating
- **Safety overrides** — Hard rules escalate to CRITICAL for seizures, meningitis signs, DKA patterns, and similar emergencies regardless of LLM output

### Vector Symptom Cache (MongoDB)
- **LLM results cached as embeddings** — Every Ollama response is stored in a `SymptomCache` collection with a dense vector (via `nomic-embed-text`)
- **Semantic fallback** — When the LLM is warming up or unreachable, the system embeds incoming symptoms and finds the closest cached result (cosine similarity ≥ 0.88)
- **Exact + fuzzy matching** — SHA-256 hash for instant exact hits; vector search for semantically similar cases
- **New patterns always go to the LLM** — The cache is only used when the LLM is unavailable; fresh cases always get a live LLM analysis

### Patient Portal (Sevak Portal)
- **Role-based submission** — Patients or caregivers submit symptom reports via a simple form
- **Location autocomplete** — Type a city/village and the form auto-fills district and state from the geocode database
- **Instant AI feedback** — After submission, the portal shows the AI analysis, predicted illness, callback window, and action steps
- **Reference number** — Every submission gets an 8-character case reference

### Bulk Reclassification
- CLI job to backfill AI analysis on existing cases in MongoDB
- Groups cases by symptom fingerprint to minimize redundant LLM calls
- Supports dry-run (default) and `--apply` modes

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express, TypeScript |
| Database | MongoDB Atlas (Mongoose) |
| AI / LLM | Ollama (`gemma4:e2b` by default) |
| Embeddings | Ollama (`nomic-embed-text`) |
| Frontend | React 18, TypeScript, Vite |
| Maps | Leaflet + React-Leaflet + leaflet.heat |
| Styling | Custom CSS (dark theme) |

---

## Project Structure

```
sevak/
├── .env                                  # Environment variables
├── backend/
│   └── src/
│       ├── index.ts                      # Express server entry point
│       ├── controllers/caseController.ts # Request handlers
│       ├── routes/caseRoutes.ts          # API routes
│       ├── models/
│       │   ├── Case.ts                   # Patient case schema (GeoJSON location)
│       │   ├── User.ts                   # User schema
│       │   └── SymptomCache.ts           # Vector cache schema
│       ├── utils/
│       │   ├── symptomAnalyzer.ts        # LLM triage + rule-based fallback
│       │   ├── symptomVectorCache.ts     # Embedding store + similarity search
│       │   ├── analysisFingerprint.ts    # SHA-256 symptom fingerprinting
│       │   ├── localModel.ts             # Ollama startup + warmup management
│       │   ├── geocode.ts                # Location database + autocomplete
│       │   ├── events.ts                 # SSE event emitter
│       │   └── notifications.ts         # Admin notification helper
│       ├── seed/
│       │   ├── seed.ts                   # Seed ~100 sample cases
│       │   └── seed_bulk.ts              # Seed larger datasets
│       ├── jobs/
│       │   └── reclassify_cases.ts       # Backfill AI analysis on existing cases
│       └── __tests__/api.test.ts         # Jest API tests
└── frontend/
    └── src/
        ├── App.tsx                       # Main app + layout
        ├── components/
        │   ├── CaseMap.tsx               # Leaflet map + heatmap
        │   ├── CaseTable.tsx             # Paginated case list
        │   ├── CaseDetails.tsx           # Case detail panel (AI fields, location)
        │   ├── SevakPortal.tsx           # Patient/caregiver submission portal
        │   ├── StatsCards.tsx            # Summary stat cards
        │   ├── Filters.tsx               # Urgency + region filters
        │   └── Alerts.tsx                # Outbreak alerts
        ├── hooks/useCases.ts             # Data fetching hook (SSE + REST)
        ├── types/index.ts                # TypeScript interfaces
        └── index.css                     # Full dark-theme stylesheet
```

---

## Setup

### 1. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in your values:

```env
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster.mongodb.net/sevak-dashboard
PORT=4000

# LLM — Ollama runs locally; the backend auto-detects it at startup
SYMPTOM_ANALYZER=gemma
GEMMA_LOCAL_URL=http://localhost:11434/api/chat
GEMMA_MODEL=gemma4:e2b
OLLAMA_BASE_URL=http://localhost:11434
AUTO_START_OLLAMA=true
AUTO_PULL_GEMMA=true
LOCAL_LLM_STARTUP=background   # or "blocking" to wait for model before accepting requests
OLLAMA_KEEP_ALIVE=30m

# Vector cache
EMBED_MODEL=nomic-embed-text
VECTOR_SIMILARITY_THRESHOLD=0.88
VECTOR_CACHE_SCAN_LIMIT=500
```

### 3. Install Ollama models

```bash
ollama pull gemma4:e2b          # symptom analysis LLM
ollama pull nomic-embed-text    # embedding model for vector cache
```

> The backend will attempt to pull `gemma4:e2b` automatically on first start if `AUTO_PULL_GEMMA=true`.

### 4. Seed the database (optional)

```bash
cd backend && npm run seed          # ~100 sample cases
cd backend && npm run seed:bulk     # larger dataset
```

### 5. Run

**Two terminals:**

```bash
# Terminal 1 — backend (http://localhost:4000)
cd backend && npm run dev

# Terminal 2 — frontend (http://localhost:5173)
cd frontend && npm run dev
```

The Vite dev server proxies `/api` requests to the backend automatically.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cases` | List cases — `?urgency=`, `?region=`, `?search=`, `?page=`, `?limit=` |
| GET | `/api/cases/stats` | Aggregate stats including `byDistrict` breakdown |
| GET | `/api/cases/village-stats` | Per-village case counts + coordinates |
| GET | `/api/cases/locations` | Location autocomplete — `?query=` |
| GET | `/api/cases/stream` | SSE stream for live case updates |
| GET | `/api/cases/:id` | Single case detail |
| POST | `/api/cases` | Submit a new case (triggers AI analysis) |
| POST | `/api/cases/:id/claim` | Assign a case to a caregiver |
| POST | `/api/cases/:id/resolve` | Mark a case resolved |

---

## AI Analysis Pipeline

```
Incoming symptoms
       │
       ▼
 Is Ollama ready?
  ├── Yes → Gemma LLM analysis ──→ cache result in MongoDB (background)
  │                                └─→ return LLM result
  └── No  → Check vector cache (cosine similarity ≥ 0.88)
             ├── Hit  → return cached analysis
             └── Miss → rule-based fallback → cache result → return
```

The safety override layer runs after every LLM response to catch cases where the model misses a hard red flag (seizure, DKA pattern, meningitis signs, etc.).

---

## Bulk Reclassification

To re-run AI analysis on existing cases (e.g. after upgrading the model):

```bash
# Dry run — preview changes, no writes
cd backend && npm run reclassify:cases

# Apply changes (first 25 cases)
npm run reclassify:cases -- --apply

# Apply to all cases, skip ones that already have analysis
npm run reclassify:cases -- --apply --all --skip-existing

# Force rerun even if fingerprint matches
npm run reclassify:cases -- --apply --limit=100 --force
```

---

## MongoDB Atlas Vector Search (optional upgrade)

The vector cache currently scans up to `VECTOR_CACHE_SCAN_LIMIT` recent entries in JavaScript. For larger deployments, create a vector search index in Atlas for native ANN search:

1. Go to **Atlas → Search → Create Search Index**
2. Select the `symptomcaches` collection
3. Choose **Vector Search**, set:
   - Field: `embedding`
   - Dimensions: `768`
   - Similarity: `cosine`

No code changes needed — the existing query structure is compatible with an Atlas `$vectorSearch` upgrade.
