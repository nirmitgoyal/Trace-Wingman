/**
 * verify-location-data.ts
 *
 * Scans backend/src/data/locations-*.json and reports any:
 *   - duplicate `name` within a single file
 *   - duplicate `name` across files
 *   - missing or invalid required fields (name/lat/lng/state/population)
 *   - coordinates outside valid ranges
 *
 * Exits non-zero if any duplicates or validation errors are found so it can
 * be wired into CI. Run manually:
 *
 *     cd backend && npm run verify:locations
 */

import fs from "fs";
import path from "path";

interface LocationEntry {
  name: string;
  lat: number;
  lng: number;
  population: number;
  state: string;
  district?: string;
  aliases?: string[];
}

const DATA_DIR = path.resolve(__dirname, "../data");
const FILES = ["locations-ct.json", "locations-tx.json", "locations-in.json"];

interface FileReport {
  file: string;
  count: number;
  duplicateNames: string[];
  invalid: string[];
}

function validateEntry(entry: unknown, idx: number): string | null {
  if (!entry || typeof entry !== "object") return `entry[${idx}]: not an object`;
  const e = entry as Partial<LocationEntry>;
  if (typeof e.name !== "string" || e.name.trim().length === 0) return `entry[${idx}]: missing/invalid name`;
  if (!Number.isFinite(e.lat) || e.lat! < -90 || e.lat! > 90) return `entry[${idx}] ${e.name}: invalid lat`;
  if (!Number.isFinite(e.lng) || e.lng! < -180 || e.lng! > 180) return `entry[${idx}] ${e.name}: invalid lng`;
  if (typeof e.state !== "string" || e.state.trim().length === 0) return `entry[${idx}] ${e.name}: missing state`;
  if (!Number.isFinite(e.population) || e.population! < 0) return `entry[${idx}] ${e.name}: invalid population`;
  return null;
}

function analyseFile(filename: string): FileReport {
  const report: FileReport = { file: filename, count: 0, duplicateNames: [], invalid: [] };
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    report.invalid.push(`${filename}: file does not exist`);
    return report;
  }
  let entries: unknown;
  try {
    entries = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    report.invalid.push(`${filename}: JSON parse error — ${String(err)}`);
    return report;
  }
  if (!Array.isArray(entries)) {
    report.invalid.push(`${filename}: top-level JSON is not an array`);
    return report;
  }

  const seen = new Map<string, number>();
  for (let i = 0; i < entries.length; i++) {
    const err = validateEntry(entries[i], i);
    if (err) {
      report.invalid.push(`${filename}: ${err}`);
      continue;
    }
    const name = (entries[i] as LocationEntry).name.trim();
    seen.set(name, (seen.get(name) ?? 0) + 1);
  }
  for (const [name, count] of seen) {
    if (count > 1) report.duplicateNames.push(`${name} (×${count})`);
  }
  report.count = entries.length;
  return report;
}

function analyseCrossFile(reports: FileReport[]): string[] {
  const byName = new Map<string, string[]>();
  for (const r of reports) {
    const filePath = path.join(DATA_DIR, r.file);
    if (!fs.existsSync(filePath)) continue;
    const entries = JSON.parse(fs.readFileSync(filePath, "utf-8")) as LocationEntry[];
    for (const e of entries) {
      if (!e?.name) continue;
      const list = byName.get(e.name) ?? [];
      list.push(r.file);
      byName.set(e.name, list);
    }
  }
  const conflicts: string[] = [];
  for (const [name, files] of byName) {
    const unique = [...new Set(files)];
    if (unique.length > 1) {
      conflicts.push(`${name} appears in: ${unique.join(", ")}`);
    }
  }
  return conflicts;
}

function main() {
  console.log("Verifying location data in backend/src/data…\n");

  const reports = FILES.map(analyseFile);
  let totalDuplicates = 0;
  let totalInvalid = 0;

  for (const r of reports) {
    console.log(`── ${r.file} ── entries: ${r.count}`);
    if (r.invalid.length > 0) {
      console.log(`   invalid (${r.invalid.length}):`);
      for (const line of r.invalid) console.log(`     - ${line}`);
    }
    if (r.duplicateNames.length > 0) {
      console.log(`   duplicate names (${r.duplicateNames.length}):`);
      for (const d of r.duplicateNames) console.log(`     - ${d}`);
    }
    if (r.invalid.length === 0 && r.duplicateNames.length === 0) {
      console.log("   ✓ clean");
    }
    totalDuplicates += r.duplicateNames.length;
    totalInvalid += r.invalid.length;
  }

  // Cross-file name collisions (e.g. Bridgeport exists in both CT and TX, and
  // Salem exists in CT and India) are legitimate in real-world geography, so
  // we surface them as warnings rather than failing. The runtime loader's
  // `mergeLocations` keeps the highest-population entry to prevent ambiguity.
  const cross = analyseCrossFile(reports);
  if (cross.length > 0) {
    console.log(`\n── cross-file name collisions (${cross.length}) — informational ──`);
    for (const c of cross) console.log(`  - ${c}`);
    console.log(
      "   These are accepted at runtime by the highest-population tie-breaker.",
    );
  } else {
    console.log("\n── cross-file name collisions ── ✓ none");
  }

  if (totalDuplicates > 0 || totalInvalid > 0) {
    console.error(
      `\n❌  Verification failed: ${totalDuplicates} within-file duplicate(s), ${totalInvalid} invalid entrie(s).`,
    );
    process.exit(1);
  }

  console.log(
    `\n✅  All location files are clean. (${cross.length} cross-file name collision(s) accepted.)`,
  );
}

main();
