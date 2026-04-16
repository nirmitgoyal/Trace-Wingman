import { useState } from "react";

interface Props {
  onCaseCreated: () => void;
}

export function SevakPortal({ onCaseCreated }: Props) {
  const [role, setRole] = useState<"NONE" | "PATIENT" | "CAREGIVER">("NONE");
  const [formData, setBody] = useState({
    patientName: "",
    age: "",
    gender: "Male",
    village: "Aligarh",
    symptoms: "",
    notes: ""
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        ...formData,
        worker_phone: role === "PATIENT" ? "Web-Patient" : "Web-Caregiver",
        age: parseInt(formData.age),
        symptoms: formData.symptoms.split(",").map(s => s.trim()),
        latitude: 27.8974,
        longitude: 78.0880
      };

      const res = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setSuccess(true);
        onCaseCreated();
        setTimeout(() => setSuccess(false), 5000);
      }
    } catch (err) {
      console.error(err);
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
      
      {success && <div className="success-banner">🎯 Case logged successfully! Sevak is notifying the medical team.</div>}

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
          <input 
            required 
            value={formData.village} 
            onChange={e => setBody({...formData, village: e.target.value})} 
          />
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
    </div>
  );
}
