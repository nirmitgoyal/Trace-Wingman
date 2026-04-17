import { StatsResponse } from "../types";

interface Props {
  stats: StatsResponse | null;
}

const ALERT_CONFIG = {
  PANDEMIC_ALERT: {
    label: "PANDEMIC ALERT",
    icon: "🚨",
    className: "alert-pandemic",
    timeWindow: "14 days",
  },
  REGIONAL_ALERT: {
    label: "Regional Alert",
    icon: "⚠️",
    className: "alert-regional",
    timeWindow: "7 days",
  },
  OUTBREAK: {
    label: "Outbreak",
    icon: "📍",
    className: "alert-outbreak",
    timeWindow: "7 days",
  },
} as const;

export function Alerts({ stats }: Props) {
  if (!stats?.outbreaks?.length) return null;

  const hasPandemic = stats.outbreaks.some(o => o.alertLevel === "PANDEMIC_ALERT");
  const hasRegional = stats.outbreaks.some(o => o.alertLevel === "REGIONAL_ALERT");

  const headerClass = hasPandemic
    ? "alerts-header pandemic"
    : hasRegional
    ? "alerts-header regional"
    : "alerts-header";

  const headerTitle = hasPandemic
    ? "PANDEMIC ALERT — Immediate Action Required"
    : hasRegional
    ? "Regional Disease Alerts Active"
    : "Active Outbreak Alerts";

  return (
    <div className={`alerts-container ${hasPandemic ? "alerts-pandemic-active" : ""}`}>
      <div className={headerClass}>
        <span className="alert-icon">{hasPandemic ? "🚨" : "⚠️"}</span>
        <h3>{headerTitle}</h3>
      </div>
      <div className="alerts-list">
        {stats.outbreaks.map((alert, i) => {
          const cfg = ALERT_CONFIG[alert.alertLevel] ?? ALERT_CONFIG.OUTBREAK;
          return (
            <div key={i} className={`alert-item ${cfg.className}`}>
              <span className="alert-badge">{cfg.icon} {cfg.label}</span>
              <span className="alert-location">{alert.location}</span>
              <span className="alert-disease">{alert.disease}</span>
              <span className="alert-count">{alert.count} cases in {cfg.timeWindow}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
