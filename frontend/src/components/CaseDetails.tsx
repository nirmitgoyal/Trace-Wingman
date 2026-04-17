import { CaseRecord } from "../types";

interface Props {
  caseRecord: CaseRecord;
  onClose: () => void;
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

function DetailRow({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value || "Not provided"}</strong>
    </div>
  );
}

export function CaseDetails({ caseRecord, onClose }: Props) {
  const longitude = caseRecord.location?.coordinates?.[0] ?? caseRecord.longitude;
  const latitude = caseRecord.location?.coordinates?.[1] ?? caseRecord.latitude;

  return (
    <div className="case-details-backdrop" role="dialog" aria-modal="true">
      <section className="case-details-panel">
        <div className="case-details-header">
          <div>
            <span className={`urgency-badge urgency-${caseRecord.urgency.toLowerCase()}`}>
              {caseRecord.urgency}
            </span>
            <h3>{caseRecord.patientName}</h3>
            <p>Ref: {caseRecord._id.slice(-8)}</p>
          </div>
          <button className="details-close-btn" onClick={onClose} aria-label="Close patient details">
            Close
          </button>
        </div>

        <div className="case-details-grid">
          <DetailRow label="Age" value={caseRecord.age} />
          <DetailRow label="Gender" value={caseRecord.gender} />
          <DetailRow label="Status" value={caseRecord.status} />
          <DetailRow label="Reporter Role" value={caseRecord.reporterRole} />
          <DetailRow label="Worker Phone" value={caseRecord.worker_phone} />
          <DetailRow label="Assigned Caregiver" value={caseRecord.assignedCaregiver} />
          <DetailRow label="Village/City" value={caseRecord.village} />
          <DetailRow label="District" value={caseRecord.district} />
          <DetailRow label="State" value={caseRecord.state} />
          <DetailRow label="Latitude" value={latitude} />
          <DetailRow label="Longitude" value={longitude} />
          <DetailRow label="Symptom Duration" value={caseRecord.symptomDuration} />
          <DetailRow label="Callback Window" value={caseRecord.callbackWindow} />
          <DetailRow label="AI Model" value={caseRecord.aiModel} />
          <DetailRow label="AI Analyzed" value={caseRecord.aiAnalyzedAt ? formatDate(caseRecord.aiAnalyzedAt) : undefined} />
          <DetailRow label="Created" value={formatDate(caseRecord.createdAt)} />
          <DetailRow label="Updated" value={formatDate(caseRecord.updatedAt)} />
        </div>

        <div className="detail-section">
          <h4>Symptoms</h4>
          <div className="symptoms-cell">
            {caseRecord.symptoms.map((symptom, index) => (
              <span key={`${symptom}-${index}`} className="symptom-tag">
                {symptom}
              </span>
            ))}
          </div>
        </div>

        <div className="detail-section">
          <h4>AI Symptom Analysis</h4>
          <p>{caseRecord.aiAnalysis || "Not available"}</p>
        </div>

        <div className="detail-section">
          <h4>Predicted Illness</h4>
          <p>{caseRecord.predictedDisease || "Not available"}</p>
        </div>

        {!!caseRecord.differentialDiagnoses?.length && (
          <div className="detail-section">
            <h4>Other Possibilities</h4>
            <ul className="analysis-list">
              {caseRecord.differentialDiagnoses.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {!!caseRecord.redFlags?.length && (
          <div className="detail-section">
            <h4>Red Flags</h4>
            <ul className="analysis-list">
              {caseRecord.redFlags.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="detail-section">
          <h4>AI Confidence</h4>
          <p>{caseRecord.aiConfidence || "Not available"}</p>
        </div>

        <div className="detail-section">
          <h4>Recommended Action</h4>
          <p>{caseRecord.recommendedAction || "Not available"}</p>
        </div>

        <div className="detail-section">
          <h4>Notes</h4>
          <p>{caseRecord.notes || "No notes recorded"}</p>
        </div>
      </section>
    </div>
  );
}
