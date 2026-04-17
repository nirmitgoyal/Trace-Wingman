import { useState } from "react";
import { useCases } from "./hooks/useCases";
import { StatsCards } from "./components/StatsCards";
import { Alerts } from "./components/Alerts";
import { Filters } from "./components/Filters";
import { CaseTable } from "./components/CaseTable";
import { CaseMap } from "./components/CaseMap";
import { SevakPortal } from "./components/SevakPortal";
import { CaseDetails } from "./components/CaseDetails";
import { CaseRecord } from "./types";

type View = "DASHBOARD" | "PORTAL";
type Tab = "table" | "map" | "both";

function App() {
  const {
    cases,
    villageStats,
    stats,
    loading,
    urgencyFilter,
    setUrgencyFilter,
    regionFilter,
    setRegionFilter,
    searchQuery,
    setSearchQuery,
    page,
    setPage,
    totalPages,
    total,
    refetch,
  } = useCases();

  const [activeView, setView] = useState<View>("DASHBOARD");
  const [selectedCase, setSelectedCase] = useState<CaseRecord | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("both");

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <span className="logo-icon">🏥</span>
            <h1>Sevak Dashboard</h1>
          </div>
          <span className="subtitle">High-Volume Surveillance (50k+)</span>
        </div>
        
        <div className="nav-switcher">
           <button className={activeView === "DASHBOARD" ? "active" : ""} onClick={() => setView("DASHBOARD")}>📊 Monitoring</button>
           <button className={activeView === "PORTAL" ? "active" : ""} onClick={() => setView("PORTAL")}>📱 Patient Portal</button>
        </div>

        <div className="header-right">
          <div className="live-indicator"><span className="pulse-dot"></span>LIVE</div>
        </div>
      </header>

      <main className="main">
        {activeView === "PORTAL" ? (
            <SevakPortal onCaseCreated={refetch} />
        ) : (
            <>
                <div className="region-switcher-bar">
                    <div className="region-switcher">
                        <button className={regionFilter === "GLOBAL" ? "active" : ""} onClick={() => setRegionFilter("GLOBAL")}>🌎 Global</button>
                        <button className={regionFilter === "INDIA" ? "active" : ""} onClick={() => setRegionFilter("INDIA")}>🇮🇳 India</button>
                        <button className={regionFilter === "CT" ? "active" : ""} onClick={() => setRegionFilter("CT")}>🇺🇸 CT</button>
                        <button className={regionFilter === "TEXAS" ? "active" : ""} onClick={() => setRegionFilter("TEXAS")}>🇺🇸 TX</button>
                    </div>
                </div>

                <StatsCards stats={stats} />

                <Alerts stats={stats} />

                <Filters
                urgencyFilter={urgencyFilter}
                setUrgencyFilter={setUrgencyFilter}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                onRefresh={refetch}
                />

                <div className="view-tabs">
                <button className={activeTab === "both" ? "tab active" : "tab"} onClick={() => setActiveTab("both")}>📊 Combined</button>
                <button className={activeTab === "table" ? "tab active" : "tab"} onClick={() => setActiveTab("table")}>📋 Table</button>
                <button className={activeTab === "map" ? "tab active" : "tab"} onClick={() => setActiveTab("map")}>🗺️ Map</button>
                </div>

                {(activeTab === "both" || activeTab === "map") && (
                <div className="map-section">
                    <CaseMap cases={cases} villageStats={villageStats} selectedCase={selectedCase} region={regionFilter} />
                </div>
                )}

                {(activeTab === "both" || activeTab === "table") && (
                <CaseTable
                    cases={cases}
                    loading={loading}
                    page={page}
                    totalPages={totalPages}
                    total={total}
                    setPage={setPage}
                    onSelectCase={(c) => {
                        setSelectedCase(c);
                        if (activeTab === "table") setActiveTab("both");
                    }}
                />
                )}
            </>
        )}
      </main>
      <footer className="footer">
        <span>Sevak Platform © 2026 — Optimized for 50,000+ Concurrent Cases</span>
      </footer>
      {selectedCase && (
        <CaseDetails caseRecord={selectedCase} onClose={() => setSelectedCase(null)} />
      )}
    </div>
  );
}

export default App;
