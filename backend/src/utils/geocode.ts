// Mock geocoding and population data: maps location names to coords and population
export interface LocationData {
  lat: number;
  lng: number;
  population: number;
  state: string;
  district?: string;
  aliases?: string[];
}

const locationData: Record<string, LocationData> = {
  "Patna": { lat: 25.6117, lng: 85.1446, population: 2049000, state: "India" },
  "Danapur": { lat: 25.6242, lng: 85.0489, population: 182000, state: "India" },
  "Hajipur": { lat: 25.6855, lng: 85.2135, population: 147000, state: "India" },
  "Muzaffarpur": { lat: 26.1209, lng: 85.3647, population: 354000, state: "India" },
  "Gaya": { lat: 24.7955, lng: 85.0002, population: 474000, state: "India" },
  "Bhagalpur": { lat: 25.2425, lng: 86.9842, population: 400000, state: "India" },
  "Varanasi": { lat: 25.3176, lng: 82.9739, population: 1201000, state: "India" },
  "Lucknow": { lat: 26.8467, lng: 80.9462, population: 2817000, state: "India" },
  "Jhansi": { lat: 25.4484, lng: 78.5685, population: 505000, state: "India" },
  "Agra": { lat: 27.1767, lng: 78.0081, population: 1585000, state: "India" },
  "Bhopal": { lat: 23.2599, lng: 77.4126, population: 1798000, state: "India" },
  "Indore": { lat: 22.7196, lng: 75.8577, population: 1964000, state: "India" },
  "Nagpur": { lat: 21.1458, lng: 79.0882, population: 2405000, state: "India" },
  "Jaipur": { lat: 26.9124, lng: 75.7873, population: 3046000, state: "India" },
  "Udaipur": { lat: 24.5854, lng: 73.7125, population: 451000, state: "India" },
  "Raipur": { lat: 21.2514, lng: 81.6296, population: 1010000, state: "India" },
  "Ranchi": { lat: 23.3441, lng: 85.3096, population: 1073000, state: "India" },
  "Dhanbad": { lat: 23.7957, lng: 86.4304, population: 1162000, state: "India" },
  "Kolkata": { lat: 22.5726, lng: 88.3639, population: 4496000, state: "India" },
  "Siliguri": { lat: 26.7271, lng: 88.3953, population: 705000, state: "India" },
  "Dehradun": { lat: 30.3165, lng: 78.0322, population: 578000, state: "India" },
  "Shimla": { lat: 31.1048, lng: 77.1734, population: 169000, state: "India" },
  "Chandigarh": { lat: 30.7333, lng: 76.7794, population: 1055000, state: "India" },
  "Amritsar": { lat: 31.634, lng: 74.8723, population: 1132000, state: "India" },
  "Srinagar": { lat: 34.0837, lng: 74.7973, population: 1180000, state: "India" },
  "Jammu": { lat: 32.7266, lng: 74.857, population: 502000, state: "India" },
  "Hyderabad": { lat: 17.385, lng: 78.4867, population: 6731000, state: "India" },
  "Warangal": { lat: 17.9784, lng: 79.5941, population: 615000, state: "India" },
  "Vijayawada": { lat: 16.5062, lng: 80.648, population: 1021000, state: "India" },
  "Chennai": { lat: 13.0827, lng: 80.2707, population: 7088000, state: "India" },
  "Madurai": { lat: 9.9252, lng: 78.1198, population: 1017000, state: "India" },
  "Thiruvananthapuram": { lat: 8.5241, lng: 76.9366, population: 743000, state: "India" },
  "Kochi": { lat: 9.9312, lng: 76.2673, population: 601000, state: "India" },
  "Bengaluru": { lat: 12.9716, lng: 77.5946, population: 8443000, state: "India", aliases: ["Bangalore", "Bangoluru"] },
  "Mangalore": { lat: 12.9141, lng: 74.856, population: 484000, state: "India" },
  "Pune": { lat: 18.5204, lng: 73.8567, population: 3124000, state: "India" },
  "Mumbai": { lat: 19.076, lng: 72.8777, population: 12442000, state: "India" },
  "Ahmedabad": { lat: 23.0225, lng: 72.5714, population: 5577000, state: "India" },
  "Surat": { lat: 21.1702, lng: 72.8311, population: 4466000, state: "India" },
  "Guwahati": { lat: 26.1445, lng: 91.7362, population: 957000, state: "India" },
  "Imphal": { lat: 24.817, lng: 93.9368, population: 268000, state: "India" },
  "Aligarh": { lat: 27.8974, lng: 78.0880, population: 1216000, state: "India" },
  "Khair": { lat: 27.9392, lng: 77.8347, population: 102000, state: "India" },
  "Hartford": { lat: 41.7637, lng: -72.6851, population: 121000, state: "Connecticut" },
  "Stamford": { lat: 41.0534, lng: -73.5387, population: 135000, state: "Connecticut" },
  "New Haven": { lat: 41.3083, lng: -72.9279, population: 134000, state: "Connecticut" },
  "Monroe, Connecticut": { lat: 41.3326, lng: -73.2073, population: 18000, state: "Connecticut", district: "Monroe" },
  "Austin": { lat: 30.2672, lng: -97.7431, population: 961000, state: "Texas" },
  "Houston": { lat: 29.7604, lng: -95.3698, population: 2304000, state: "Texas" },
  "Dallas": { lat: 32.7767, lng: -96.7970, population: 1304000, state: "Texas" },
  "San Antonio": { lat: 29.4241, lng: -98.4936, population: 1434000, state: "Texas" },
  "Monroe, Texas": { lat: 33.1035, lng: -96.6706, population: 50000, state: "Texas", district: "Monroe" },
  "Monroe, India": { lat: 20.5937, lng: 78.9629, population: 50000, state: "India", district: "Monroe" },
};

function normalizeLocationName(location: string) {
  const normalized = location.trim().replace(/\s+/g, " ");
  const exact = Object.keys(locationData).find((name) => name.toLowerCase() === normalized.toLowerCase());
  if (exact) return exact;
  return normalized;
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
  if (village.toUpperCase().includes("CT") || village.toLowerCase().includes("connecticut")) {
    return {
      name: name || "Connecticut",
      lat: 41.6032 + (Math.random() - 0.5) * 0.5,
      lng: -72.6999 + (Math.random() - 0.5) * 0.5,
      population: 50000,
      state: "Connecticut",
      district: name || "Connecticut",
    };
  }
  if (village.toUpperCase().includes("TX") || village.toLowerCase().includes("texas")) {
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
    return locationData[name]?.population || 50000;
}

export function searchLocations(query: string, limit = 8) {
  const normalized = query.trim().toLowerCase();
  if (normalized.length < 1) return [];

  return Object.entries(locationData)
    .map(([name, data]) => {
      const haystack = [name, data.state, data.district, ...(data.aliases || [])].filter(Boolean).join(" ").toLowerCase();
      const cityName = data.district || name.split(",")[0];
      const displayName = name.includes(",") ? name : `${name}, ${data.state}`;
      const startsWithScore =
        name.toLowerCase().startsWith(normalized) ||
        cityName.toLowerCase().startsWith(normalized) ||
        (data.aliases || []).some((alias) => alias.toLowerCase().startsWith(normalized))
          ? 0
          : 1;
      const containsScore = haystack.includes(normalized) ? startsWithScore : 2;

      return {
        name,
        displayName,
        city: cityName,
        district: data.district || cityName,
        state: data.state,
        latitude: data.lat,
        longitude: data.lng,
        population: data.population,
        score: containsScore,
      };
    })
    .filter((item) => item.score < 2 || item.displayName.toLowerCase().includes(normalized))
    .sort((a, b) => a.score - b.score || a.displayName.localeCompare(b.displayName))
    .slice(0, limit)
    .map(({ score, ...item }) => item);
}

export function getVillageNames(): string[] {
  return Object.keys(locationData);
}
