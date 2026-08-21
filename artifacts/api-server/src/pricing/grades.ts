/**
 * Canonical Verified TCG grade contract.
 *
 * PriceCharting exposes a mixture of generic card conditions and explicitly
 * identified grading-company conditions. Generic conditions must never be
 * labelled as PSA/BGS/CGC/etc.
 */
export interface GradeDefinition {
  key: GradeKey;
  label: string;
  pricechartingField: string;
}

export type GradeKey =
  | "raw"
  | "graded_8_85"
  | "graded_9"
  | "graded_95"
  | "psa_10"
  | "bgs_10"
  | "bgs_black_label_10"
  | "cgc_10"
  | "cgc_pristine_10"
  | "sgc_10"
  | "tag_10"
  | "ace_10";

export const GRADE_DEFINITIONS: readonly GradeDefinition[] = [
  { key: "raw", label: "Raw / Ungraded", pricechartingField: "loose-price" },
  { key: "graded_8_85", label: "Generic Graded 8 / 8.5", pricechartingField: "new-price" },
  { key: "graded_9", label: "Generic Graded 9", pricechartingField: "graded-price" },
  { key: "graded_95", label: "Generic Graded 9.5", pricechartingField: "box-only-price" },
  { key: "psa_10", label: "PSA 10", pricechartingField: "manual-only-price" },
  { key: "bgs_10", label: "BGS 10", pricechartingField: "bgs-10-price" },
  { key: "bgs_black_label_10", label: "BGS 10 Black Label", pricechartingField: "condition-20-price" },
  { key: "cgc_10", label: "CGC 10", pricechartingField: "condition-17-price" },
  { key: "cgc_pristine_10", label: "CGC 10 Pristine", pricechartingField: "condition-19-price" },
  { key: "sgc_10", label: "SGC 10", pricechartingField: "condition-18-price" },
  { key: "tag_10", label: "TAG 10", pricechartingField: "condition-21-price" },
  { key: "ace_10", label: "ACE 10", pricechartingField: "condition-22-price" },
] as const;

export const GRADE_KEYS = new Set<GradeKey>(GRADE_DEFINITIONS.map((grade) => grade.key));
export const GRADE_BY_KEY = new Map<GradeKey, GradeDefinition>(GRADE_DEFINITIONS.map((grade) => [grade.key, grade]));
export const GRADE_BY_PC_FIELD = new Map<string, GradeDefinition>(GRADE_DEFINITIONS.map((grade) => [grade.pricechartingField, grade]));

/** Normalise historical/user-facing spellings at API boundaries. */
const GRADE_ALIASES: Record<string, GradeKey> = {
  raw: "raw",
  ungraded: "raw",
  graded: "graded_9",
  graded9: "graded_9",
  graded_9: "graded_9",
  graded8: "graded_8_85",
  graded85: "graded_8_85",
  graded_8_85: "graded_8_85",
  graded95: "graded_95",
  graded_95: "graded_95",
  psa10: "psa_10",
  psa_10: "psa_10",
  bgs10: "bgs_10",
  bgs_10: "bgs_10",
  bgsblacklabel10: "bgs_black_label_10",
  bgs_black_label_10: "bgs_black_label_10",
  cgc10: "cgc_10",
  cgc_10: "cgc_10",
  cgcpristine10: "cgc_pristine_10",
  cgc_pristine_10: "cgc_pristine_10",
  sgc10: "sgc_10",
  sgc_10: "sgc_10",
  tag10: "tag_10",
  tag_10: "tag_10",
  ace10: "ace_10",
  ace_10: "ace_10",
};

export function normalizeGradeKey(value: unknown): GradeKey | null {
  if (typeof value !== "string") return null;
  const compact = value.trim().toLowerCase().replace(/[\s-]+/g, "");
  return GRADE_ALIASES[compact] ?? GRADE_ALIASES[value.trim().toLowerCase()] ?? null;
}

export function isValidGradeKey(value: string): value is GradeKey {
  return normalizeGradeKey(value) !== null;
}

export function validatePriceCents(value: unknown, fieldName = "price"): string | null {
  if (typeof value !== "number") return `${fieldName} must be a number`;
  if (!Number.isSafeInteger(value)) return `${fieldName} must be an integer (minor units)`;
  if (value <= 0) return `${fieldName} must be a positive integer`;
  return null;
}

/** PriceCharting prices are already integer USD cents. Missing means null. */
export function pcPriceToCents(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const value = typeof raw === "number" ? raw : Number(String(raw).trim());
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
