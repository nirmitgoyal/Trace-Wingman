import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet.heat";
import { CaseRecord, VillageStat } from "../types";

interface Props {
  cases: CaseRecord[];
  villageStats: VillageStat[];
  selectedCase: CaseRecord | null;
  region: string;
}

const URGENCY_COLORS: Record<string, string> = {
  CRITICAL: "#ef4444",
  MODERATE: "#f59e0b",
  LOW: "#22c55e",
};

const REGION_CENTERS: Record<string, { center: [number, number], zoom: number }> = {
  "INDIA": { center: [22.5, 80.0], zoom: 5 },
  "CT": { center: [41.6, -72.7], zoom: 9 },
  "TEXAS": { center: [31.9, -99.9], zoom: 6 },
};

function caseLatLng(caseRecord: CaseRecord): [number, number] | null {
  const longitude = caseRecord.location?.coordinates?.[0] ?? caseRecord.longitude;
  const latitude = caseRecord.location?.coordinates?.[1] ?? caseRecord.latitude;
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  return [latitude, longitude];
}

export function CaseMap({ cases, villageStats, selectedCase, region }: Props) {
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const heatRef = useRef<any>(null);
  const [mapMode, setMapMode] = useState<"POINTS" | "HEATMAP">("POINTS");

  useEffect(() => {
    if (mapRef.current) return;

    mapRef.current = L.map("map-container", {
      center: REGION_CENTERS[region]?.center || [22.5, 80.0],
      zoom: REGION_CENTERS[region]?.zoom || 5,
      scrollWheelZoom: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      maxZoom: 18,
    }).addTo(mapRef.current);

    markersRef.current = L.layerGroup().addTo(mapRef.current);

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !region) return;
    const config = REGION_CENTERS[region] || REGION_CENTERS["INDIA"];
    mapRef.current.setView(config.center, config.zoom, { animate: true });
  }, [region]);

  useEffect(() => {
    if (!markersRef.current || !mapRef.current) return;
    
    markersRef.current.clearLayers();
    if (heatRef.current) {
        mapRef.current.removeLayer(heatRef.current);
        heatRef.current = null;
    }

    if (mapMode === "POINTS") {
      cases.forEach((c) => {
        const latLng = caseLatLng(c);
        if (!latLng) return;
        const color = URGENCY_COLORS[c.urgency] || "#6b7280";
        const marker = L.circleMarker(latLng, {
          radius: c.urgency === "CRITICAL" ? 10 : 7,
          fillColor: color,
          color: "#fff",
          weight: 2,
          opacity: 1,
          fillOpacity: 0.85,
        });

        marker.bindPopup(
          `<div class="map-popup">
            <strong>${c.patientName}</strong><br/>
            <span class="popup-urgency popup-${c.urgency.toLowerCase()}">${c.urgency}</span><br/>
            Age: ${c.age} | ${c.gender}<br/>
            <b>Symptoms:</b> ${c.symptoms.join(", ")}<br/>
            <b>Village/City:</b> ${c.village}
          </div>`
        );
        markersRef.current!.addLayer(marker);
      });

      villageStats.forEach((v) => {
          const prevalence = (v.caseCount / v.population) * 1000;
          const marker = L.circleMarker([v.lat, v.lng], {
              radius: Math.min(Math.max(v.caseCount * 2, 12), 40),
              fillColor: "#3b82f6",
              color: "#fff",
              weight: 1,
              opacity: 0.5,
              fillOpacity: 0.3
          });
          
          marker.bindPopup(
              `<div class="map-popup">
                <strong>${v.village}</strong><br/>
                <b>Total Population:</b> ${(v.population / 1000).toFixed(1)}k<br/>
                <b>Total Cases:</b> ${v.caseCount}<br/>
                <b>Critical Cases:</b> ${v.criticalCount}<br/>
                <b>Prevalence:</b> ${prevalence.toFixed(2)} per 1k
              </div>`
          );
          markersRef.current!.addLayer(marker);
      });
    } else {
        const points = cases
          .map(c => {
            const latLng = caseLatLng(c);
            return latLng ? [latLng[0], latLng[1], c.urgency === "CRITICAL" ? 1.0 : 0.5] : null;
          })
          .filter((point): point is [number, number, number] => Boolean(point));
        // @ts-ignore
        heatRef.current = L.heatLayer(points, {
            radius: 25,
            blur: 15,
            maxZoom: 10,
            gradient: { 0.4: 'blue', 0.65: 'lime', 1: 'red' }
        }).addTo(mapRef.current);
    }
  }, [cases, villageStats, mapMode]);

  useEffect(() => {
    if (selectedCase && mapRef.current) {
      const latLng = caseLatLng(selectedCase);
      if (!latLng) return;
      mapRef.current.setView(latLng, 10, {
        animate: true,
      });
    }
  }, [selectedCase]);

  return (
      <div className="map-wrapper">
          <div className="map-controls">
              <button 
                  className={mapMode === "POINTS" ? "active" : ""} 
                  onClick={() => setMapMode("POINTS")}
              >
                  🎯 Points View
              </button>
              <button 
                  className={mapMode === "HEATMAP" ? "active" : ""} 
                  onClick={() => setMapMode("HEATMAP")}
              >
                  🔥 Heatmap
              </button>
          </div>
          <div id="map-container" className="map-container" />
      </div>
  );
}
