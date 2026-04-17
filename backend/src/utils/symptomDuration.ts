/**
 * Canonical symptomDuration values.
 *
 * The source of truth for these strings lives in the Sevak Portal dropdown
 * (frontend/src/components/SevakPortal.tsx). They are re-declared here so
 * backend code (seeds, stress-test API, LLM context builders) can import a
 * single typed list instead of retyping the literals.
 *
 * IMPORTANT: the day-range entries use the Unicode EN DASH (U+2013 "–"), not
 * the ASCII hyphen. Case documents in MongoDB are written with en-dashes and
 * the Portal emits en-dashes, so string comparisons must match exactly.
 */

export const SYMPTOM_DURATIONS = [
  "",
  "Less than 24 hours",
  "1\u20132 days",
  "3\u20135 days",
  "About a week",
  "1\u20132 weeks",
  "More than 2 weeks",
  "More than a month",
] as const;

export type SymptomDuration = (typeof SYMPTOM_DURATIONS)[number];

export function isValidSymptomDuration(value: unknown): value is SymptomDuration {
  return typeof value === "string" && (SYMPTOM_DURATIONS as readonly string[]).includes(value);
}

/** Non-empty durations only — useful for seeds that must supply a real value. */
export const NON_EMPTY_SYMPTOM_DURATIONS = SYMPTOM_DURATIONS.filter((d) => d !== "") as readonly SymptomDuration[];
