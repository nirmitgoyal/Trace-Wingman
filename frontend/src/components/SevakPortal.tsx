import { KeyboardEvent, useEffect, useState } from "react";

interface Props {
  onCaseCreated: () => void;
}

interface PortalResponse {
  heading: string;
  reference: string;
  urgency: "CRITICAL" | "MODERATE" | "LOW";
  callbackMessage: string;
  analysis: string;
  actionRequired: string;
  predictedDisease?: string;
  differentialDiagnoses?: string[];
  redFlags?: string[];
  confidence?: "LOW" | "MEDIUM" | "HIGH";
}

interface LocationSuggestion {
  name: string;
  displayName: string;
  city: string;
  district: string;
  state: string;
  latitude: number;
  longitude: number;
}

export function SevakPortal({ onCaseCreated }: Props) {
  const [role, setRole] = useState<"NONE" | "PATIENT" | "CAREGIVER">("NONE");
  const [formData, setBody] = useState({
    patientName: "",
    age: "",
    gender: "Male",
    village: "",
    district: "",
    state: "",
    symptoms: "",
    notes: ""
  });
  const [submitting, setSubmitting] = useState(false);
  const [submissionResponse, setSubmissionResponse] = useState<PortalResponse | null>(null);
  const [error, setError] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [activeLocationIndex, setActiveLocationIndex] = useState(0);
  const [locationOpen, setLocationOpen] = useState(false);

  function resetForm() {
    setBody({
      patientName: "",
      age: "",
      gender: "Male",
      village: "",
      district: "",
      state: "",
      symptoms: "",
      notes: "",
    });
    setSubmissionResponse(null);
    setError("");
    setLocationSuggestions([]);
    setLocationOpen(false);
  }

  useEffect(() => {
    const query = formData.village.trim();
    if (query.length < 1) {
      setLocationSuggestions([]);
      setLocationOpen(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/cases/locations?query=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        setLocationSuggestions(data.locations || []);
        setActiveLocationIndex(0);
        setLocationOpen((data.locations || []).length > 0);
      } catch (err) {
        if (!controller.signal.aborted) setLocationSuggestions([]);
      }
    }, 120);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [formData.village]);

  function selectLocation(location: LocationSuggestion) {
    setBody({
      ...formData,
      village: location.name,
      district: location.district,
      state: location.state,
    });
    setLocationOpen(false);
    setLocationSuggestions([]);
  }

  function handleLocationKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!locationOpen || locationSuggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveLocationIndex((current) => Math.min(current + 1, locationSuggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveLocationIndex((current) => Math.max(current - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      selectLocation(locationSuggestions[activeLocationIndex]);
    } else if (e.key === "Escape") {
      setLocationOpen(false);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSubmissionResponse(null);
    try {
      const payload = {
        ...formData,
        reporterRole: role,
        worker_phone: role === "PATIENT" ? "Web-Patient" : "Web-Caregiver",
        age: parseInt(formData.age),
        symptoms: formData.symptoms.split(",").map(s => s.trim()).filter(Boolean),
      };

      const res = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (res.ok && data.response) {
        setSubmissionResponse(data.response);
        onCaseCreated();
      } else {
        setError(data.error || "Unable to log case. Please check the patient details and try again.");
      }
    } catch (err) {
      console.error(err);
      setError("Unable to reach Sevak services. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (role === "NONE") {
    return (
      <div className="portal-choice">
        <h2>Welcome to Sevak</h2>
        <p>Please select your role to continue:</p>
        <div className="choice-buttons">
          <button className="choice-btn patient" onClick={() => setRole("PATIENT")}>
             I am a Patient
          </button>
          <button className="choice-btn caregiver" onClick={() => setRole("CAREGIVER")}>
             I am a Health Worker
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="portal-form-container">
      <button className="back-btn" onClick={() => setRole("NONE")}>← Back</button>
      <h3>{role === "PATIENT" ? "Report Your Symptoms" : "Log a New Patient Case"}</h3>
      
      {error && <div className="error-banner">{error}</div>}

      {submissionResponse && (
        <div className={`submission-result submission-${submissionResponse.urgency.toLowerCase()}`}>
          <h4>{submissionResponse.heading}</h4>
          <p><strong>Ref:</strong> {submissionResponse.reference}</p>
          <p><strong>Urgency:</strong> {submissionResponse.urgency}</p>
          <p>{submissionResponse.callbackMessage}</p>
          {submissionResponse.predictedDisease && (
            <p><strong>Likely illness:</strong> {submissionResponse.predictedDisease}</p>
          )}
          {submissionResponse.confidence && (
            <p><strong>Confidence:</strong> {submissionResponse.confidence}</p>
          )}
          <p><strong>AI Symptom Analysis:</strong></p>
          <p>{submissionResponse.analysis}</p>
          {!!submissionResponse.differentialDiagnoses?.length && (
            <>
              <p><strong>Other possibilities:</strong></p>
              <ul className="analysis-list">
                {submissionResponse.differentialDiagnoses.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
          {!!submissionResponse.redFlags?.length && (
            <>
              <p><strong>Watch for:</strong></p>
              <ul className="analysis-list">
                {submissionResponse.redFlags.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
          <p><strong>Action required:</strong> {submissionResponse.actionRequired}</p>
          <button className="secondary-action-btn" type="button" onClick={resetForm}>
            Submit another report
          </button>
        </div>
      )}

      {!submissionResponse && (
      <form className="portal-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Full Name</label>
          <input 
            required 
            value={formData.patientName} 
            onChange={e => setBody({...formData, patientName: e.target.value})} 
          />
        </div>
        <div className="form-row">
            <div className="form-group">
            <label>Age</label>
            <input 
                type="number" 
                required 
                value={formData.age} 
                onChange={e => setBody({...formData, age: e.target.value})} 
            />
            </div>
            <div className="form-group">
            <label>Gender</label>
            <select value={formData.gender} onChange={e => setBody({...formData, gender: e.target.value})}>
                <option>Male</option>
                <option>Female</option>
                <option>Other</option>
            </select>
            </div>
        </div>
        <div className="form-group">
          <label>Village/City</label>
          <div className="location-autocomplete">
            <input
              required
              autoComplete="off"
              placeholder="Start typing: Monroe, Bengaluru, Dallas..."
              value={formData.village}
              onChange={e => {
                setBody({...formData, village: e.target.value, district: "", state: ""});
                setLocationOpen(true);
              }}
              onKeyDown={handleLocationKeyDown}
              onFocus={() => setLocationOpen(locationSuggestions.length > 0)}
            />
            {locationOpen && locationSuggestions.length > 0 && (
              <div className="location-suggestions" role="listbox">
                {locationSuggestions.map((location, index) => (
                  <button
                    type="button"
                    key={location.name}
                    className={index === activeLocationIndex ? "active" : ""}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectLocation(location);
                    }}
                    role="option"
                    aria-selected={index === activeLocationIndex}
                  >
                    <span>{location.displayName}</span>
                    <small>{location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>District</label>
            <input
              value={formData.district}
              placeholder="Optional"
              onChange={e => setBody({...formData, district: e.target.value})}
            />
          </div>
          <div className="form-group">
            <label>State</label>
            <input
              value={formData.state}
              placeholder="Optional"
              onChange={e => setBody({...formData, state: e.target.value})}
            />
          </div>
        </div>
        <div className="form-group">
          <label>Symptoms (comma separated)</label>
          <textarea 
            required 
            placeholder="e.g. Fever, Cough, Chest pain" 
            value={formData.symptoms} 
            onChange={e => setBody({...formData, symptoms: e.target.value})}
          />
        </div>
        <button className="submit-btn" disabled={submitting}>
          {submitting ? "Logging..." : "Submit Case"}
        </button>
      </form>
      )}
    </div>
  );
}
