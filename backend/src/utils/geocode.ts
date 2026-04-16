// Mock geocoding and population data: maps location names to coords and population
export interface LocationData {
  lat: number;
  lng: number;
  population: number;
}

const locationData: Record<string, LocationData> = {
  "Patna": { lat: 25.6117, lng: 85.1446, population: 2049000 },
  "Danapur": { lat: 25.6242, lng: 85.0489, population: 182000 },
  "Hajipur": { lat: 25.6855, lng: 85.2135, population: 147000 },
  "Muzaffarpur": { lat: 26.1209, lng: 85.3647, population: 354000 },
  "Gaya": { lat: 24.7955, lng: 85.0002, population: 474000 },
  "Bhagalpur": { lat: 25.2425, lng: 86.9842, population: 400000 },
  "Varanasi": { lat: 25.3176, lng: 82.9739, population: 1201000 },
  "Lucknow": { lat: 26.8467, lng: 80.9462, population: 2817000 },
  "Jhansi": { lat: 25.4484, lng: 78.5685, population: 505000 },
  "Agra": { lat: 27.1767, lng: 78.0081, population: 1585000 },
  "Bhopal": { lat: 23.2599, lng: 77.4126, population: 1798000 },
  "Indore": { lat: 22.7196, lng: 75.8577, population: 1964000 },
  "Nagpur": { lat: 21.1458, lng: 79.0882, population: 2405000 },
  "Jaipur": { lat: 26.9124, lng: 75.7873, population: 3046000 },
  "Udaipur": { lat: 24.5854, lng: 73.7125, population: 451000 },
  "Raipur": { lat: 21.2514, lng: 81.6296, population: 1010000 },
  "Ranchi": { lat: 23.3441, lng: 85.3096, population: 1073000 },
  "Dhanbad": { lat: 23.7957, lng: 86.4304, population: 1162000 },
  "Kolkata": { lat: 22.5726, lng: 88.3639, population: 4496000 },
  "Siliguri": { lat: 26.7271, lng: 88.3953, population: 705000 },
  "Dehradun": { lat: 30.3165, lng: 78.0322, population: 578000 },
  "Shimla": { lat: 31.1048, lng: 77.1734, population: 169000 },
  "Chandigarh": { lat: 30.7333, lng: 76.7794, population: 1055000 },
  "Amritsar": { lat: 31.634, lng: 74.8723, population: 1132000 },
  "Srinagar": { lat: 34.0837, lng: 74.7973, population: 1180000 },
  "Jammu": { lat: 32.7266, lng: 74.857, population: 502000 },
  "Hyderabad": { lat: 17.385, lng: 78.4867, population: 6731000 },
  "Warangal": { lat: 17.9784, lng: 79.5941, population: 615000 },
  "Vijayawada": { lat: 16.5062, lng: 80.648, population: 1021000 },
  "Chennai": { lat: 13.0827, lng: 80.2707, population: 7088000 },
  "Madurai": { lat: 9.9252, lng: 78.1198, population: 1017000 },
  "Thiruvananthapuram": { lat: 8.5241, lng: 76.9366, population: 743000 },
  "Kochi": { lat: 9.9312, lng: 76.2673, population: 601000 },
  "Bengaluru": { lat: 12.9716, lng: 77.5946, population: 8443000 },
  "Mangalore": { lat: 12.9141, lng: 74.856, population: 484000 },
  "Pune": { lat: 18.5204, lng: 73.8567, population: 3124000 },
  "Mumbai": { lat: 19.076, lng: 72.8777, population: 12442000 },
  "Ahmedabad": { lat: 23.0225, lng: 72.5714, population: 5577000 },
  "Surat": { lat: 21.1702, lng: 72.8311, population: 4466000 },
  "Guwahati": { lat: 26.1445, lng: 91.7362, population: 957000 },
  "Imphal": { lat: 24.817, lng: 93.9368, population: 268000 },
  "Aligarh": { lat: 27.8974, lng: 78.0880, population: 1216000 },
  "Khair": { lat: 27.9392, lng: 77.8347, population: 102000 },
  "Hartford": { lat: 41.7637, lng: -72.6851, population: 121000 },
  "Stamford": { lat: 41.0534, lng: -73.5387, population: 135000 },
  "New Haven": { lat: 41.3083, lng: -72.9279, population: 134000 },
  "Austin": { lat: 30.2672, lng: -97.7431, population: 961000 },
  "Houston": { lat: 29.7604, lng: -95.3698, population: 2304000 },
  "Dallas": { lat: 32.7767, lng: -96.7970, population: 1304000 },
  "San Antonio": { lat: 29.4241, lng: -98.4936, population: 1434000 },
};

export function getCoordinatesForVillage(village: string): { lat: number; lng: number } {
  if (locationData[village]) {
    return { lat: locationData[village].lat, lng: locationData[village].lng };
  }
  if (village.toUpperCase().includes("CT") || village.toLowerCase().includes("connecticut")) {
    return { lat: 41.6032 + (Math.random() - 0.5) * 0.5, lng: -72.6999 + (Math.random() - 0.5) * 0.5 };
  }
  if (village.toUpperCase().includes("TX") || village.toLowerCase().includes("texas")) {
    return { lat: 31.9686 + (Math.random() - 0.5) * 5, lng: -99.9018 + (Math.random() - 0.5) * 5 };
  }
  const baseLat = 20.5937 + (Math.random() - 0.5) * 12;
  const baseLng = 78.9629 + (Math.random() - 0.5) * 14;
  return { lat: parseFloat(baseLat.toFixed(4)), lng: parseFloat(baseLng.toFixed(4)) };
}

export function getLocationPopulation(location: string): number {
    return locationData[location]?.population || 50000;
}

export function getVillageNames(): string[] {
  return Object.keys(locationData);
}
