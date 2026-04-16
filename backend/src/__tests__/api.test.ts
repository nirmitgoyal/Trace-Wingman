import mongoose from "mongoose";
import Case from "../models/Case";

const API_BASE = "http://localhost:4000/api";

async function fetchJson(url: string, options?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(url, options);
  const body = await res.json();
  return { status: res.status, body };
}

describe("Sevak Dashboard API", () => {
  beforeAll(async () => {
    await mongoose.connect("mongodb://localhost:27017/sevak-dashboard");
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  test("health endpoint returns ok", async () => {
    const { status, body } = await fetchJson(`${API_BASE}/health`);
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeDefined();
  });

  test("GET /api/cases returns paginated cases", async () => {
    const { status, body } = await fetchJson(`${API_BASE}/cases?limit=5`);
    expect(status).toBe(200);
    expect(body.cases).toEqual(expect.any(Array));
    expect(body.cases.length).toBeLessThanOrEqual(5);
    expect(body.total).toBeGreaterThan(0);
    expect(body.page).toBe(1);
    expect(body.totalPages).toBeGreaterThan(0);
  });

  test("cases have required fields", async () => {
    const { body } = await fetchJson(`${API_BASE}/cases?limit=1`);
    const c = body.cases[0];
    expect(c).toHaveProperty("patientName");
    expect(c).toHaveProperty("age");
    expect(c).toHaveProperty("gender");
    expect(c).toHaveProperty("symptoms");
    expect(c).toHaveProperty("village");
    expect(c).toHaveProperty("district");
    expect(c).toHaveProperty("urgency");
    expect(c).toHaveProperty("latitude");
    expect(c).toHaveProperty("longitude");
    expect(c).toHaveProperty("createdAt");
    expect(["CRITICAL", "MODERATE", "LOW"]).toContain(c.urgency);
  });

  test("filter by urgency CRITICAL", async () => {
    const { body } = await fetchJson(`${API_BASE}/cases?urgency=CRITICAL`);
    for (const c of body.cases) {
      expect(c.urgency).toBe("CRITICAL");
    }
  });

  test("filter by urgency MODERATE", async () => {
    const { body } = await fetchJson(`${API_BASE}/cases?urgency=MODERATE`);
    for (const c of body.cases) {
      expect(c.urgency).toBe("MODERATE");
    }
  });

  test("filter by urgency LOW", async () => {
    const { body } = await fetchJson(`${API_BASE}/cases?urgency=LOW`);
    for (const c of body.cases) {
      expect(c.urgency).toBe("LOW");
    }
  });

  test("search cases by village name", async () => {
    const { body } = await fetchJson(`${API_BASE}/cases?search=Patna`);
    expect(body.cases).toEqual(expect.any(Array));
  });

  test("GET /api/cases/stats returns statistics", async () => {
    const { status, body } = await fetchJson(`${API_BASE}/cases/stats`);
    expect(status).toBe(200);
    expect(body.total).toBeGreaterThan(0);
    expect(typeof body.critical).toBe("number");
    expect(typeof body.moderate).toBe("number");
    expect(typeof body.low).toBe("number");
    expect(body.total).toBe(body.critical + body.moderate + body.low);
    expect(body.byDistrict).toEqual(expect.any(Array));
  });

  test("POST /api/cases creates a new case", async () => {
    const newCase = {
      patientName: "Test Patient",
      age: 30,
      gender: "Male",
      symptoms: ["Fever", "Headache"],
      village: "TestVillage",
      district: "TestDistrict",
      state: "TestState",
      urgency: "MODERATE",
      latitude: 25.0,
      longitude: 80.0,
      notes: "test case",
    };

    const { status, body } = await fetchJson(`${API_BASE}/cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newCase),
    });
    expect(status).toBe(201);
    expect(body.patientName).toBe("Test Patient");
    expect(body._id).toBeDefined();

    await Case.findByIdAndDelete(body._id);
  });

  test("GET /api/cases/:id returns single case", async () => {
    const { body: listBody } = await fetchJson(`${API_BASE}/cases?limit=1`);
    const caseId = listBody.cases[0]._id;
    const { status, body } = await fetchJson(`${API_BASE}/cases/${caseId}`);
    expect(status).toBe(200);
    expect(body._id).toBe(caseId);
  });

  test("GET /api/cases/:id returns 404 for invalid id", async () => {
    const { status } = await fetchJson(`${API_BASE}/cases/000000000000000000000000`);
    expect(status).toBe(404);
  });

  test("pagination works correctly", async () => {
    const { body: data1 } = await fetchJson(`${API_BASE}/cases?page=1&limit=3`);
    const { body: data2 } = await fetchJson(`${API_BASE}/cases?page=2&limit=3`);
    expect(data1.page).toBe(1);
    expect(data2.page).toBe(2);
    if (data1.cases.length > 0 && data2.cases.length > 0) {
      expect(data1.cases[0]._id).not.toBe(data2.cases[0]._id);
    }
  });

  test("Case model validation rejects invalid data", async () => {
    const { status } = await fetchJson(`${API_BASE}/cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patientName: "Incomplete" }),
    });
    expect(status).toBe(400);
  });
});
