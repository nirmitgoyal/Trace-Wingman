/**
 * build-location-data.ts
 *
 * Downloads GeoNames country dumps and extracts all populated places for
 * Connecticut and Texas (from the US dump) and India, then writes:
 *   backend/src/data/locations-ct.json
 *   backend/src/data/locations-tx.json
 *   backend/src/data/locations-in.json
 *
 * Usage:
 *   npx tsx src/scripts/build-location-data.ts           # CT + TX + India
 *   npx tsx src/scripts/build-location-data.ts --country=CT
 *   npx tsx src/scripts/build-location-data.ts --country=CT,TX,IN
 *   npx tsx src/scripts/build-location-data.ts --min-pop=500
 *
 * GeoNames data is public domain: https://www.geonames.org/export/
 */

import fs from "fs";
import path from "path";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { createGunzip } from "zlib";
import readline from "readline";

const DATA_DIR = path.resolve(__dirname, "../data");
const GEONAMES_BASE = "https://download.geonames.org/export/dump";

// GeoNames feature codes we treat as populated places
const POPULATED_PLACE_CODES = new Set([
  "PPL",   // populated place
  "PPLA",  // seat of 1st-order admin div (state capital)
  "PPLA2", // seat of 2nd-order admin div
  "PPLA3", // seat of 3rd-order admin div
  "PPLA4",
  "PPLC",  // capital of a political entity
  "PPLF",  // farm village
  "PPLG",  // seat of government of a political entity
  "PPLL",  // populated locality
  "PPLR",  // religious populated place
  "PPLS",  // populated places
  "PPLW",  // destroyed populated place
  "PPLX",  // section of populated place
]);

// Map US state FIPS/admin1 codes to names
const US_STATE_CODES: Record<string, string> = {
  TX: "Texas",
};

// Map GeoNames admin1 codes (India) to state names
// India's admin1 codes in GeoNames are two-letter codes
const IN_ADMIN1_CODES: Record<string, string> = {
  "01": "Andhra Pradesh",
  "02": "Arunachal Pradesh",
  "03": "Assam",
  "04": "Bihar",
  "05": "Goa",
  "06": "Gujarat",
  "07": "Haryana",
  "08": "Himachal Pradesh",
  "09": "Jammu & Kashmir",
  "10": "Karnataka",
  "11": "Kerala",
  "12": "Madhya Pradesh",
  "13": "Maharashtra",
  "14": "Manipur",
  "15": "Meghalaya",
  "16": "Mizoram",
  "17": "Nagaland",
  "18": "Odisha",
  "19": "Punjab",
  "20": "Rajasthan",
  "21": "Sikkim",
  "22": "Tamil Nadu",
  "23": "Tripura",
  "24": "Uttar Pradesh",
  "25": "West Bengal",
  "26": "Andaman and Nicobar Islands",
  "27": "Chandigarh",
  "28": "Dadra and Nagar Haveli",
  "29": "Daman and Diu",
  "30": "Delhi",
  "31": "Lakshadweep",
  "32": "Puducherry",
  "33": "Chhattisgarh",
  "34": "Uttarakhand",
  "35": "Jharkhand",
  "36": "Telangana",
  "37": "Ladakh",
};

export interface LocationEntry {
  name: string;
  lat: number;
  lng: number;
  population: number;
  state: string;
  district?: string;
  aliases?: string[];
}

/** Download and cache the GeoNames admin2 name lookup table (all countries). */
async function loadAdmin2Names(cacheDir: string): Promise<Map<string, string>> {
  const url = `${GEONAMES_BASE}/admin2Codes.txt`;
  const filePath = path.join(cacheDir, "admin2Codes.txt");

  if (!fs.existsSync(filePath)) {
    console.log("  Downloading admin2Codes.txt for county/district name lookup …");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download admin2Codes.txt: ${res.status}`);
    fs.writeFileSync(filePath, await res.text());
  }

  // Format: "US.TX.227\tMontgomery County\tMontgomery County\t4699701"
  const map = new Map<string, string>();
  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  for (const line of lines) {
    const [code, name] = line.split("\t");
    if (code && name) map.set(code.trim(), name.trim());
  }
  return map;
}

async function downloadAndExtract(countryCode: string, destDir: string): Promise<string> {
  const url = `${GEONAMES_BASE}/${countryCode}.zip`;
  const zipPath = path.join(destDir, `${countryCode}.zip`);
  const txtPath = path.join(destDir, `${countryCode}.txt`);

  if (fs.existsSync(txtPath)) {
    console.log(`  Reusing cached ${countryCode}.txt`);
    return txtPath;
  }

  console.log(`  Downloading ${url} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  if (!res.body) throw new Error("No response body");

  const writer = createWriteStream(zipPath);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, writer);
  console.log(`  Saved ${countryCode}.zip`);

  // Unzip using the system unzip command
  const { execSync } = await import("child_process");
  execSync(`unzip -o -j "${zipPath}" "${countryCode}.txt" -d "${destDir}"`, { stdio: "inherit" });
  fs.unlinkSync(zipPath);
  console.log(`  Extracted ${countryCode}.txt`);

  return txtPath;
}

async function parseGeoNamesFile(
  txtPath: string,
  filter: (fields: string[]) => boolean,
  mapState: (admin1: string) => string,
  minPop: number,
  admin2Names: Map<string, string>,
  countryCode: string
): Promise<LocationEntry[]> {
  const rl = readline.createInterface({ input: fs.createReadStream(txtPath), crlfDelay: Infinity });

  const entries: LocationEntry[] = [];

  for await (const line of rl) {
    if (!line || line.startsWith("#")) continue;
    const fields = line.split("\t");
    // GeoNames columns:
    // 0=geonameid, 1=name, 2=asciiname, 3=alternatenames, 4=lat, 5=lng,
    // 6=feature class, 7=feature code, 8=country, 9=cc2,
    // 10=admin1, 11=admin2, 12=admin3, 13=admin4,
    // 14=population, 15=elevation, 16=dem, 17=timezone, 18=modification
    if (fields.length < 15) continue;
    if (fields[6] !== "P") continue; // only populated places
    if (!POPULATED_PLACE_CODES.has(fields[7])) continue;

    const pop = parseInt(fields[14], 10) || 0;
    if (pop < minPop && minPop > 0) continue;

    if (!filter(fields)) continue;

    const name = fields[1].trim();
    const asciiName = fields[2].trim();
    const altNames = fields[3]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== name && s !== asciiName && /^[a-zA-Z\s\-'.]+$/.test(s))
      .slice(0, 4);

    const lat = parseFloat(fields[4]);
    const lng = parseFloat(fields[5]);
    const admin1 = fields[10].trim();
    const admin2Code = fields[11].trim();

    // Resolve admin2 numeric code → human-readable county/district name
    const admin2Key = `${countryCode}.${admin1}.${admin2Code}`;
    const district = admin2Names.get(admin2Key) || undefined;

    const stateName = mapState(admin1);

    entries.push({
      name,
      lat,
      lng,
      population: pop,
      state: stateName,
      district,
      aliases: altNames.length > 0 ? altNames : undefined,
    });
  }

  return entries;
}

function deduplicateByName(entries: LocationEntry[]): LocationEntry[] {
  const seen = new Map<string, LocationEntry>();
  for (const entry of entries) {
    const key = entry.name.toLowerCase();
    const existing = seen.get(key);
    if (!existing || entry.population > existing.population) {
      seen.set(key, entry);
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.population - a.population);
}

async function buildUSState(
  label: string,
  admin1Code: string,
  stateName: string,
  cacheDir: string,
  minPop: number,
  admin2Names: Map<string, string>
): Promise<LocationEntry[]> {
  console.log(`\n[${label}] Downloading US GeoNames dump …`);
  const txtPath = await downloadAndExtract("US", cacheDir); // reuses cache if already downloaded

  console.log(`[${label}] Parsing …`);
  const entries = await parseGeoNamesFile(
    txtPath,
    (fields) => fields[10] === admin1Code,
    () => stateName,
    minPop,
    admin2Names,
    "US"
  );

  const deduped = deduplicateByName(entries);
  console.log(`[${label}] Found ${deduped.length} places (min-pop=${minPop})`);
  return deduped;
}

function buildTexas(cacheDir: string, minPop: number, admin2Names: Map<string, string>) {
  return buildUSState("Texas", "TX", "Texas", cacheDir, minPop, admin2Names);
}

function buildConnecticut(cacheDir: string, minPop: number, admin2Names: Map<string, string>) {
  // CT towns can be very small — default min-pop of 1000 may skip some hamlets.
  // GeoNames includes all 169 CT municipalities regardless of population.
  return buildUSState("Connecticut", "CT", "Connecticut", cacheDir, minPop, admin2Names);
}

async function buildIndia(cacheDir: string, minPop: number, admin2Names: Map<string, string>): Promise<LocationEntry[]> {
  console.log("\n[India] Downloading India GeoNames dump …");
  const txtPath = await downloadAndExtract("IN", cacheDir);

  console.log("[India] Parsing …");
  const entries = await parseGeoNamesFile(
    txtPath,
    () => true,
    (admin1) => IN_ADMIN1_CODES[admin1] || "India",
    minPop,
    admin2Names,
    "IN"
  );

  const deduped = deduplicateByName(entries);
  console.log(`[India] Found ${deduped.length} places (min-pop=${minPop})`);
  return deduped;
}

async function main() {
  const args = process.argv.slice(2);
  const countriesArg = args.find((a) => a.startsWith("--country="));
  const minPopArg = args.find((a) => a.startsWith("--min-pop="));

  const countries = countriesArg ? countriesArg.split("=")[1].split(",").map(s => s.trim().toUpperCase()) : ["CT", "TX", "IN"];
  const minPop = minPopArg ? parseInt(minPopArg.split("=")[1], 10) : 500;

  const cacheDir = path.join(DATA_DIR, ".cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log("\nLoading admin2 district name lookup table …");
  const admin2Names = await loadAdmin2Names(cacheDir);
  console.log(`  Loaded ${admin2Names.size} admin2 entries`);

  if (countries.includes("CT")) {
    const ctEntries = await buildConnecticut(cacheDir, minPop, admin2Names);
    const outPath = path.join(DATA_DIR, "locations-ct.json");
    fs.writeFileSync(outPath, JSON.stringify(ctEntries, null, 2));
    console.log(`\nWrote ${ctEntries.length} Connecticut locations → ${outPath}`);
  }

  if (countries.includes("TX") || countries.includes("US")) {
    const txEntries = await buildTexas(cacheDir, minPop, admin2Names);
    const outPath = path.join(DATA_DIR, "locations-tx.json");
    fs.writeFileSync(outPath, JSON.stringify(txEntries, null, 2));
    console.log(`Wrote ${txEntries.length} Texas locations → ${outPath}`);
  }

  if (countries.includes("IN")) {
    const inEntries = await buildIndia(cacheDir, minPop, admin2Names);
    const outPath = path.join(DATA_DIR, "locations-in.json");
    fs.writeFileSync(outPath, JSON.stringify(inEntries, null, 2));
    console.log(`Wrote ${inEntries.length} India locations → ${outPath}`);
  }

  console.log("\nDone. Restart the backend to pick up the new data.");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
