import { StatsResponse } from "../types";

interface Props {
  stats: StatsResponse | null;
}

export function Alerts({ stats }: Props) {
  if (!stats || !stats.outbreaks || stats.outbreaks.length === 0) return null;

  return (
    <div className="alerts-container">
      <div className="alerts-header">
        <span className="alert-icon">⚠️</span>
        <h3>Active Outbreak Alerts</h3>
      </div>
      <div className="alerts-list">
        {stats.outbreaks.map((alert, i) => (
          <div key={i} className="alert-item high-severity">
            <span className="alert-location">{alert.location}</span>
            <span className="alert-disease">{alert.disease} Cluster</span>
            <span className="alert-count">{alert.count} cases in 7 days</span>
          </div>
        ))}
      </div>
    </div>
  );
}
