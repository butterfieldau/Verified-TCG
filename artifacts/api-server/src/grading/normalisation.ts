import { normalizeCollectorNumber, normalizeForMatching, normalizeGameSlug } from "../catalogue/internal/catalogueNormalisation.js";
import type { GraderKey, PopulationGrade } from "./types.js";

export { normalizeCollectorNumber, normalizeForMatching, normalizeGameSlug };

export function normaliseGrader(value: string): GraderKey | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "psa") return "psa";
  if (normalized === "beckett" || normalized === "bgs") return "bgs";
  if (normalized === "cgc") return "cgc";
  return null;
}

/** Preserve the provider grade key and never collapse grader-specific tens. */
export function normaliseGemRateGrade(grader: GraderKey, rawCode: string): PopulationGrade {
  const code = rawCode.trim().toLowerCase();
  const suffix = code.replace(/^(?:psa|beckett|bgs|cgc)_/, "");
  const numeric = suffix.replace(/_/g, ".");
  if (grader === "bgs") {
    if (/10_black|black.*10/.test(suffix)) return { code: "black_label_10", label: "BGS Black Label 10", rawLabel: rawCode, population: null };
    if (/10_pristine|pristine.*10/.test(suffix)) return { code: "pristine_10", label: "BGS Pristine 10", rawLabel: rawCode, population: null };
    return { code: suffix, label: `BGS ${numeric}`, rawLabel: rawCode, population: null };
  }
  if (grader === "cgc") {
    if (/10_perfect|perfect.*10/.test(suffix)) return { code: "perfect_10", label: "CGC Perfect 10", rawLabel: rawCode, population: null };
    if (/10_pristine|pristine.*10/.test(suffix)) return { code: "pristine_10", label: "CGC Pristine 10", rawLabel: rawCode, population: null };
    if (/10_gem|gem.*10/.test(suffix)) return { code: "gem_mint_10", label: "CGC Gem Mint 10", rawLabel: rawCode, population: null };
    return { code: suffix, label: `CGC ${numeric}`, rawLabel: rawCode, population: null };
  }
  return { code: suffix, label: `PSA ${numeric}`, rawLabel: rawCode, population: null };
}

export function structuredGemRateQuery(input: { releaseYear?: string | null; setName: string; name: string; variant?: string | null; collectorNumber?: string | null }): string {
  return [input.releaseYear, input.setName, input.name, input.variant, normalizeCollectorNumber(input.collectorNumber)]
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => part.trim())
    .join(" ")
    .slice(0, 200);
}
