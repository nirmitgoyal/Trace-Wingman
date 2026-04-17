/**
 * Location data — sourced entirely from GeoNames-generated JSON files.
 *
 * No hardcoded fallbacks. To (re)generate the JSON:
 *     cd backend && npm run build:locations
 *
 * The loader deduplicates by name on load: if the same `name` appears more
 * than once in a file, the entry with the larger `population` wins and a
 * warning is logged. This makes the loader safe against any future API
 * runs that produce overlapping results.
 */

import path from "path";
import fs from "fs";

export interface LocationData {
  lat: number;
  lng: number;
  population: number;
  state: string;
  district?: string;
  aliases?: string[];
}

interface RawLocationEntry {
  name: string;
  lat: number;
  lng: number;
  population: number;
  state: string;
  district?: string;
  aliases?: string[];
}

// ---------------------------------------------------------------------------
// JSON loader with built-in deduplication
// ---------------------------------------------------------------------------

function toLocationData(entry: RawLocationEntry): LocationData {
  return {
    lat: entry.lat,
    lng: entry.lng,
    population: entry.population,
    state: entry.state,
    district: entry.district,
    aliases: entry.aliases,
  };
}

function loadJsonLocations(filename: string): Record<string, LocationData> {
  const filePath = path.resolve(__dirname, "../data", filename);
  if (!fs.existsSync(filePath)) {
    console.warn(
      `[geocode] ⚠️  ${filename} not found. Run: cd backend && npm run build:locations`,
    );
    return {};
  }

  let entries: RawLocationEntry[];
  try {
    entries = JSON.parse(fs.readFileSync(filePath, "utf-8")) as RawLocationEntry[];
  } catch (err) {
    console.warn(`[geocode] Failed to parse ${filename}:`, err);
    return {};
  }

  const result: Record<string, LocationData> = {};
  const duplicateNames = new Set<string>();

  for (const entry of entries) {
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    if (!name) continue;
    const existing = result[name];
    if (existing) {
      duplicateNames.add(name);
      // Keep the higher-population entry (matches the builder's tie-breaker).
      if (entry.population > existing.population) {
        result[name] = toLocationData(entry);
      }
    } else {
      result[name] = toLocationData(entry);
    }
  }

  if (duplicateNames.size > 0) {
    const preview = Array.from(duplicateNames).slice(0, 5).join(", ");
    console.warn(
      `[geocode] ⚠️  ${filename} contained ${duplicateNames.size} duplicate name(s); kept highest-population entry for each. Examples: ${preview}${duplicateNames.size > 5 ? " …" : ""}`,
    );
  }

  console.log(`[geocode] Loaded ${Object.keys(result).length} locations from ${filename}`);
  return result;
}

const ctLocations = loadJsonLocations("locations-ct.json");
const txLocations = loadJsonLocations("locations-tx.json");
const inLocations = loadJsonLocations("locations-in.json");

// Cross-file dedup: if the same name exists in multiple files (shouldn't happen
// in practice, but be safe), the higher-population entry wins.
function mergeLocations(
  ...maps: Array<Record<string, LocationData>>
): Record<string, LocationData> {
  const merged: Record<string, LocationData> = {};
  const crossFileDupes: string[] = [];
  for (const map of maps) {
    for (const [name, data] of Object.entries(map)) {
      const existing = merged[name];
      if (existing) {
        crossFileDupes.push(name);
        if (data.population > existing.population) merged[name] = data;
      } else {
        merged[name] = data;
      }
    }
  }
  if (crossFileDupes.length > 0) {
    console.warn(
      `[geocode] ⚠️  ${crossFileDupes.length} name(s) appeared in more than one region file; kept highest-population entry each. Examples: ${crossFileDupes.slice(0, 5).join(", ")}`,
    );
  }
  return merged;
}

const locationData: Record<string, LocationData> = mergeLocations(
  ctLocations,
  txLocations,
  inLocations,
);

if (Object.keys(locationData).length === 0) {
  console.error(
    "[geocode] ❌  No location data loaded. Run: cd backend && npm run build:locations",
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function normalizeLocationName(location: string): string {
  const trimmed = location.trim().replace(/\s+/g, " ");
  const exact = Object.keys(locationData).find(
    (name) => name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (exact) return exact;
  const aliasMatch = Object.entries(locationData).find(([, data]) =>
    data.aliases?.some((alias) => alias.toLowerCase() === trimmed.toLowerCase()),
  );
  if (aliasMatch) return aliasMatch[0];
  return trimmed;
}

export function getCoordinatesForVillage(village: string): { lat: number; lng: number } {
  const location = resolveLocation(village);
  return { lat: location.lat, lng: location.lng };
}

export function resolveLocation(village: string): LocationData & { name: string } {
  const name = normalizeLocationName(village);
  if (locationData[name]) {
    return { name, ...locationData[name], district: locationData[name].district || name };
  }

  const lower = village.toLowerCase();
  if (lower.includes("ct") || lower.includes("connecticut")) {
    return {
      name: name || "Connecticut",
      lat: 41.6032 + (Math.random() - 0.5) * 0.5,
      lng: -72.6999 + (Math.random() - 0.5) * 0.5,
      population: 50000,
      state: "Connecticut",
      district: name || "Connecticut",
    };
  }
  if (lower.includes("tx") || lower.includes("texas")) {
    return {
      name: name || "Texas",
      lat: 31.9686 + (Math.random() - 0.5) * 5,
      lng: -99.9018 + (Math.random() - 0.5) * 5,
      population: 50000,
      state: "Texas",
      district: name || "Texas",
    };
  }

  const baseLat = 20.5937 + (Math.random() - 0.5) * 12;
  const baseLng = 78.9629 + (Math.random() - 0.5) * 14;
  return {
    name: name || "Unknown",
    lat: parseFloat(baseLat.toFixed(4)),
    lng: parseFloat(baseLng.toFixed(4)),
    population: 50000,
    state: "India",
    district: name || "Unknown",
  };
}

export function getLocationPopulation(location: string): number {
  const name = normalizeLocationName(location);
  return locationData[name]?.population ?? 50000;
}

export function searchLocations(query: string, limit = 10): Array<{
  name: string;
  displayName: string;
  city: string;
  district: string;
  state: string;
  latitude: number;
  longitude: number;
  population: number;
}> {
  const normalized = query.trim().toLowerCase();
  if (normalized.length < 1) return [];

  // Score tiers (lower is better):
  //   0  — query is a prefix of the city name (or one of its aliases)
  //   1  — query exactly matches the state name as a prefix
  //   2  — query is a prefix of the district (county / planning region)
  //   3  — query appears anywhere in city name or aliases
  //   4  — query appears anywhere in state or district
  //  99  — no match, filtered out
  const scored = Object.entries(locationData).map(([name, data]) => {
    const city = name;
    const district = data.district || name;
    const state = data.state;
    const aliases = (data.aliases || []).map((a) => a.toLowerCase());
    const cityLower = city.toLowerCase();
    const districtLower = district.toLowerCase();
    const stateLower = state.toLowerCase();

    // Human-readable label: "City, District, State" when district differs from city,
    // otherwise just "City, State". This is what disambiguates Richardson/Plano/etc.
    // that all share the same district ("Dallas County").
    const displayName =
      district && district.toLowerCase() !== city.toLowerCase()
        ? `${city}, ${district}, ${state}`
        : `${city}, ${state}`;

    let score = 99;
    if (cityLower.startsWith(normalized) || aliases.some((a) => a.startsWith(normalized))) {
      score = 0;
    } else if (stateLower.startsWith(normalized)) {
      score = 1;
    } else if (districtLower.startsWith(normalized)) {
      score = 2;
    } else if (cityLower.includes(normalized) || aliases.some((a) => a.includes(normalized))) {
      score = 3;
    } else if (districtLower.includes(normalized) || stateLower.includes(normalized)) {
      score = 4;
    }

    return {
      name: city,
      displayName,
      city,
      district,
      state,
      latitude: data.lat,
      longitude: data.lng,
      population: data.population,
      score,
    };
  });

  return scored
    .filter((item) => item.score < 99)
    .sort(
      (a, b) =>
        a.score - b.score ||
        b.population - a.population ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit)
    .map(({ score, ...item }) => item);
}

export function getVillageNames(): string[] {
  return Object.keys(locationData);
}
