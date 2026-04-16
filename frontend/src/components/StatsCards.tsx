import { StatsResponse } from "../types";

interface Props {
  stats: StatsResponse | null;
}

export function StatsCards({ stats }: Props) {
  if (!stats) return null;

  const prevalence = stats.population > 0 
    ? ((stats.total / stats.population) * 1000000).toFixed(2)
    : "0";

  return (
    <div className="stats-grid">
      <div className="stat-card stat-population">
        <div className="stat-number">{(stats.population / 1000000).toFixed(1)}M</div>
        <div className="stat-label">Total Population</div>
      </div>
      <div className="stat-card stat-total">
        <div className="stat-number">{stats.total}</div>
        <div className="stat-label">Total Cases</div>
      </div>
      <div className="stat-card stat-prevalence">
        <div className="stat-number">{prevalence}</div>
        <div className="stat-label">Cases per 1M</div>
      </div>
      <div className="stat-card stat-critical">
        <div className="stat-number">{stats.critical}</div>
        <div className="stat-label">Critical</div>
      </div>
      <div className="stat-card stat-moderate">
        <div className="stat-number">{stats.moderate}</div>
        <div className="stat-label">Moderate</div>
      </div>
      <div className="stat-card stat-low">
        <div className="stat-number">{stats.low}</div>
        <div className="stat-label">Low</div>
      </div>
    </div>
  );
}
