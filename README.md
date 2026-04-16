# Sevak Dashboard - Health Surveillance System

A real-time health surveillance dashboard for monitoring and tracking patient cases across rural India. Built with Node.js/Express (TypeScript) backend, MongoDB, and React frontend with Leaflet maps.

## Features

- **Stats Overview**: Total, Critical, Moderate, and Low case counts at a glance
- **Interactive Map**: Leaflet map with color-coded markers (red=Critical, amber=Moderate, green=Low)
- **Patient Case Table**: Sortable, paginated list with all case details
- **Urgency Filters**: Filter by CRITICAL, MODERATE, or LOW urgency
- **Search**: Search across patient names, villages, and symptoms
- **Auto-Refresh**: Dashboard refreshes data every 15 seconds for real-time monitoring
- **Responsive Design**: Works on desktop and mobile

## Tech Stack

- **Backend**: Node.js, Express, TypeScript, Mongoose
- **Database**: MongoDB
- **Frontend**: React 18, TypeScript, Vite
- **Maps**: Leaflet + React-Leaflet
- **Styling**: Custom CSS (dark theme)

## Project Structure

```
sevak-dashboard/
├── .env                    # Environment variables (MONGODB_URI, PORT)
├── backend/
│   ├── src/
│   │   ├── index.ts        # Express server entry point
│   │   ├── models/Case.ts  # Mongoose schema
│   │   ├── routes/         # API routes
│   │   ├── controllers/    # Request handlers
│   │   ├── utils/geocode.ts # Mock geocoding for villages
│   │   ├── seed/seed.ts    # Database seeder (100 sample cases)
│   │   └── __tests__/      # API tests (Jest)
│   └── public/             # Built frontend (served by Express)
├── frontend/
│   ├── src/
│   │   ├── App.tsx         # Main app component
│   │   ├── components/     # StatsCards, Filters, CaseTable, CaseMap
│   │   ├── hooks/          # useCases data hook
│   │   ├── types/          # TypeScript interfaces
│   │   └── index.css       # Full styling
│   └── dist/               # Production build
└── README.md
```

## Setup

1. **Install dependencies**:
   ```bash
   cd backend && npm install
   cd ../frontend && npm install
   ```

2. **Configure environment**:
   Edit `.env` in the project root:
   ```
   MONGODB_URI=mongodb://localhost:27017/sevak-dashboard
   PORT=4000
   ```

3. **Seed database** (optional):
   ```bash
   cd backend && npm run seed
   ```

4. **Build frontend**:
   ```bash
   cd frontend && npm run build
   cp -r dist ../backend/public
   ```

5. **Start server**:
   ```bash
   cd backend && npm run dev
   ```

   The dashboard will be available at `http://localhost:4000`

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/cases` | List cases (supports `?urgency=`, `?search=`, `?page=`, `?limit=`) |
| GET | `/api/cases/stats` | Aggregate statistics |
| GET | `/api/cases/:id` | Single case detail |
| POST | `/api/cases` | Create new case |
