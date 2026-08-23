import {
  normalizeCollectorNumber,
  normalizeForMatching,
  normalizeGameSlug,
} from "./catalogueNormalisation.js";

export interface CandidateCardIdentity {
  game: string;
  setId?: string | null;
  setCode?: string | null;
  collectorNumber?: string | null;
  language?: string | null;
  variantKey?: string | null;
}

/**
 * A reconciliation aid, never a public identifier. It intentionally returns
 * null when there is no resolved set plus collector number: duplicates are
 * safer than false card merges.
 */
export function canonicalIdentitySignature(
  input: CandidateCardIdentity,
): string | null {
  const game = normalizeGameSlug(input.game);
  const set = input.setId?.trim() || normalizeForMatching(input.setCode ?? "");
  const number = normalizeCollectorNumber(input.collectorNumber);
  if (!game || !set || !number) return null;

  const language = normalizeForMatching(input.language ?? "und") || "und";
  const variant =
    normalizeForMatching(input.variantKey ?? "default") || "default";
  return `${game}|${set}|${number}|${language}|${variant}`;
}
