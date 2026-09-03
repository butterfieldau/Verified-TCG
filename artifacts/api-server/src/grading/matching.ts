import { normalizeCollectorNumber, normalizeForMatching, normalizeGameSlug } from "./normalisation.js";
import type { CardMatchInput, GradingCardMatch, MatchStatus } from "./types.js";

export interface ProviderCandidate {
  providerCardId: string;
  description: string;
  game?: string | null;
  setName?: string | null;
  name?: string | null;
  collectorNumber?: string | null;
  raw: Record<string, unknown>;
}

/** Conservative: only a set + number match is persisted automatically. */
export function scorePopulationMatch(input: CardMatchInput, candidate: ProviderCandidate): GradingCardMatch {
  const gameMatch = !candidate.game || !normalizeGameSlug(input.game) || normalizeGameSlug(candidate.game) === normalizeGameSlug(input.game);
  const setMatch = Boolean(candidate.setName && normalizeForMatching(candidate.setName) === normalizeForMatching(input.setName));
  const number = normalizeCollectorNumber(input.collectorNumber);
  const numberMatch = Boolean(number && normalizeCollectorNumber(candidate.collectorNumber) === number);
  const nameMatch = Boolean(candidate.name && normalizeForMatching(candidate.name) === normalizeForMatching(input.name));
  const exact = gameMatch && setMatch && numberMatch && nameMatch;
  const strong = gameMatch && setMatch && numberMatch;
  const status: MatchStatus = exact || strong ? "confirmed" : "needs_review";
  return {
    providerCardId: candidate.providerCardId,
    description: candidate.description,
    matchConfidence: exact ? 1 : strong ? 0.95 : gameMatch && setMatch && nameMatch ? 0.7 : 0.2,
    matchMethod: exact ? "game_set_number_name" : strong ? "game_set_number" : "insufficient_identity",
    status,
    raw: candidate.raw,
  };
}
