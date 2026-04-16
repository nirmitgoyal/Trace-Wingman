import { CaseRecord } from "../types";

interface Props {
  cases: CaseRecord[];
  loading: boolean;
  page: number;
  totalPages: number;
  total: number;
  setPage: (p: number) => void;
  onSelectCase: (c: CaseRecord) => void;
}

function urgencyBadge(urgency: string) {
  return <span className={`urgency-badge urgency-${urgency.toLowerCase()}`}>{urgency}</span>;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CaseTable({ cases, loading, page, totalPages, total, setPage, onSelectCase }: Props) {
  if (loading) {
    return <div className="loading">Loading cases...</div>;
  }

  return (
    <div className="table-container">
      <div className="table-header">
        <h3>Patient Cases ({total})</h3>
        <div className="pagination">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ← Prev
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Next →
          </button>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Patient</th>
              <th>Age</th>
              <th>Gender</th>
              <th>Symptoms</th>
              <th>Village</th>
              <th>District</th>
              <th>Urgency</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {cases.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty-row">
                  No cases found
                </td>
              </tr>
            ) : (
              cases.map((c) => (
                <tr key={c._id} onClick={() => onSelectCase(c)} className="clickable-row">
                  <td className="patient-name">{c.patientName}</td>
                  <td>{c.age}</td>
                  <td>{c.gender}</td>
                  <td>
                    <div className="symptoms-cell">
                      {c.symptoms.map((s, i) => (
                        <span key={i} className="symptom-tag">
                          {s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>{c.village}</td>
                  <td>{c.district}</td>
                  <td>{urgencyBadge(c.urgency)}</td>
                  <td className="timestamp">{formatDate(c.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
