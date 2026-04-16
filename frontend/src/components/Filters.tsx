import { Urgency } from "../types";

interface Props {
  urgencyFilter: Urgency | "ALL";
  setUrgencyFilter: (v: Urgency | "ALL") => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  onRefresh: () => void;
}

export function Filters({
  urgencyFilter,
  setUrgencyFilter,
  searchQuery,
  setSearchQuery,
  onRefresh,
}: Props) {
  return (
    <div className="filters-bar">
      <div className="filter-group">
        <label>Urgency</label>
        <div className="urgency-buttons">
          {(["ALL", "CRITICAL", "MODERATE", "LOW"] as const).map((level) => (
            <button
              key={level}
              className={`urgency-btn urgency-btn-${level.toLowerCase()} ${
                urgencyFilter === level ? "active" : ""
              }`}
              onClick={() => setUrgencyFilter(level)}
            >
              {level}
            </button>
          ))}
        </div>
      </div>
      <div className="filter-group search-group">
        <label>Search</label>
        <input
          type="text"
          placeholder="Patient, village, or symptom..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="search-input"
        />
      </div>
      <button className="refresh-btn" onClick={onRefresh} title="Refresh data">
        ↻ Refresh
      </button>
    </div>
  );
}
