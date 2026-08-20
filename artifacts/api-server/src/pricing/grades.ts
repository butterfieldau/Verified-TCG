/**
 * Canonical grade key definitions for the PriceCharting pricing domain.
 *
 * Grade keys are stable machine identifiers used throughout the system.
 * PriceCharting API field mapping follows official documented fields.
 */

export interface GradeDefinition {
  key: GradeKey;
  label: string;
  /** PriceCharting API response field name */
  pricechartingField: string;
}

export type GradeKey =
  | "raw"
  | "graded"
  | "bgs_10"
  | "cgc_10"
  | "sgc_10";

/**
 * Ordered list of all supported grade definitions.
 *
 * PriceCharting API field mapping:
 *   loose-price      → raw (ungraded)
 *   graded-price     → graded (provider does not identify a numeric grade)
 *   bgs-10-price     → bgs_10
 *   condition-17-price → cgc_10
 *   condition-18-price → sgc_10
 *
 * cib-price, new-price, box-only-price, and manual-only-price are overloaded
 * provider fields whose meaning changes by product category. This adapter does
 * not receive a durable category attestation, so it intentionally does not turn
 * them into numeric card grades. A generic graded quote is never used as an
 * exact numeric-grade value.
 */
export const GRADE_DEFINITIONS: GradeDefinition[] = [
  { key: "raw",      label: "Ungraded (Raw)",   pricechartingField: "loose-price"        },
  { key: "graded",   label: "Graded (unspecified)", pricechartingField: "graded-price"    },
  { key: "bgs_10",   label: "BGS 10",            pricechartingField: "bgs-10-price"       },
  { key: "cgc_10",   label: "CGC 10",            pricechartingField: "condition-17-price" },
  { key: "sgc_10",   label: "SGC 10",            pricechartingField: "condition-18-price" },
];

export const GRADE_KEYS = new Set<GradeKey>(GRADE_DEFINITIONS.map(g => g.key));

export const GRADE_BY_KEY = new Map<GradeKey, GradeDefinition>(
  GRADE_DEFINITIONS.map(g => [g.key, g]),
);

export const GRADE_BY_PC_FIELD = new Map<string, GradeDefinition>(
  GRADE_DEFINITIONS.map(g => [g.pricechartingField, g]),
);

/**
 * Validate that a price is a positive integer minor-unit value.
 * Returns null on success, or an error message on failure.
 */
export function validatePriceCents(value: unknown, fieldName = "price"): string | null {
  if (typeof value !== "number") return `${fieldName} must be a number`;
  if (!Number.isInteger(value)) return `${fieldName} must be an integer (minor units)`;
  if (value <= 0) return `${fieldName} must be a positive integer`;
  return null;
}

/**
 * Validate a PriceCharting price field and return its integer minor-unit value.
 * PriceCharting's documented price fields are already expressed in cents.
 */
export function pcPriceToCents(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === "string" ? Number(raw) : Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

/** Check if a grade key string is a valid GradeKey */
export function isValidGradeKey(k: string): k is GradeKey {
  return GRADE_KEYS.has(k as GradeKey);
}
