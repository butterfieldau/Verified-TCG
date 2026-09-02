/**
 * Card-to-PriceCharting product matching.
 *
 * Scoring dimensions:
 *   - Normalized card name (0–1)
 *   - Set / console name (0–1)
 *   - Card number (0 or 1)
 *   - Game (0 or 1)
 *
 * Mapping rules:
 *   - score >= 0.85  → matched (strong unambiguous)
 *   - score >= 0.60  → review_required
 *   - score <  0.60  → unmatched
 *
 * Only "matched" mappings receive prices.
 */

import type { MappingStatus } from "@workspace/db";

export interface MatchCandidate {
  id: string;          // provider product ID
  name: string;        // product name from provider
  consoleName: string; // set / console from provider
  /** May be absent */
  cardNumber?: string;
  /** Game/category */
  genre?: string;
  /** Explicit language/region evidence parsed from provider labels. */
  language?: string;
  region?: string;
}

export interface MatchInput {
  name: string;
  set?: string;
  number?: string;
  game?: string;
  language?: string;
  region?: string;
}

/**
 * Build conservative provider search queries. A collector number is the
 * strongest available identity signal, so search for it with the card name
 * first. The broader contextual query remains as a fallback for providers
 * whose search index does not include collector numbers.
 */
export function buildMatchSearchQueries(input: MatchInput): string[] {
  const name = input.name.trim();
  const number = input.number?.trim();
  const exact = number ? [name, number].filter(Boolean).join(" ") : "";
  const contextual = [name, input.set?.trim(), input.game?.trim()]
    .filter(Boolean)
    .join(" ");
  return [...new Set([exact, contextual].filter(Boolean))];
}

export interface MatchScore {
  total: number;     // 0–1
  name: number;      // 0–1
  set: number;       // 0–1
  number: number;    // 0 or 1
  game: number;      // 0 or 1
}

export interface MatchResult {
  candidate: MatchCandidate | null;
  status: MappingStatus;
  score: MatchScore;
  level: "strong" | "ambiguous" | "none";
}

const MATCH_STRONG_THRESHOLD = 0.85;
const MATCH_AMBIGUOUS_THRESHOLD = 0.60;

// Weights must sum to 1.0
const W_NAME   = 0.45;
const W_SET    = 0.30;
const W_NUMBER = 0.15;
const W_GAME   = 0.10;

/** Normalize a string for comparison: lowercase, remove punctuation, collapse spaces. */
export function normalizeString(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[''`\-–—]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract a provider card number only from explicit, low-risk product-name forms. */
export function extractCardNumber(name: string): string | undefined {
  const hashMatch = name.match(/(?:^|\s)#\s*([a-z0-9]+(?:[-/][a-z0-9]+)*)(?=\s|$|\))/i);
  if (hashMatch?.[1]) return hashMatch[1];

  const fractionMatch = name.match(/(?:^|\s)([a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$|\))/i);
  if (fractionMatch?.[1]) return fractionMatch[1];

  // Some guide categories use a trailing explicit promo/set identifier without
  // a hash (for example "Monkey.D.Luffy OP01-003"). Requiring both letters and
  // digits avoids mistaking ordinary title words or years for card numbers.
  const promoMatch = name.match(/(?:^|\s|\()([a-z]{1,8}[- ]?\d{1,5}(?:[-/][a-z0-9]{1,8})*)(?=\s|$|\))/i);
  return promoMatch?.[1]?.replace(/\s+/g, "");
}

/** Remove only the explicit card-number fragment used by extractCardNumber. */
export function stripCardNumber(name: string): string {
  const extracted = extractCardNumber(name);
  if (!extracted) return name.replace(/\s+/g, " ").trim();
  const escaped = extracted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return name
    .replace(new RegExp(`(?:^|\\s|\\()#?\\s*${escaped}(?=\\s|$|\\))`, "i"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNumberPart(part: string): string {
  const compact = part.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = /^([A-Z]*)(\d+)([A-Z]*)$/.exec(compact);
  if (!match) return compact;
  return `${match[1]}${match[2]!.replace(/^0+(?=\d)/, "")}${match[3]}`;
}

/** Comparison form that preserves promo prefixes while ignoring display separators. */
export function normalizeCollectorNumberForMatch(value: string | undefined): {
  full: string;
  numerator: string;
} | null {
  if (!value?.trim()) return null;
  const parts = value.trim().split("/").map(normalizeNumberPart).filter(Boolean);
  if (!parts[0]) return null;
  return { full: parts.join("/"), numerator: parts[0] };
}

export function collectorNumbersMatch(input: string | undefined, candidate: string | undefined): boolean {
  const left = normalizeCollectorNumberForMatch(input);
  const right = normalizeCollectorNumberForMatch(candidate);
  if (!left || !right) return false;
  // PriceCharting regularly omits a printed denominator, but a conflicting
  // denominator must not be ignored when both sides provide one.
  return left.full === right.full ||
    (left.numerator === right.numerator && (!left.full.includes("/") || !right.full.includes("/")));
}

/** Simple Jaccard similarity over word sets. */
function wordJaccard(a: string, b: string): number {
  const setA = new Set(normalizeString(a).split(" ").filter(Boolean));
  const setB = new Set(normalizeString(b).split(" ").filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

/** Longest common substring ratio. */
function lcsRatio(a: string, b: string): number {
  const na = normalizeString(a);
  const nb = normalizeString(b);
  if (na === nb) return 1;
  const minLen = Math.min(na.length, nb.length);
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  let best = 0;
  for (let i = 0; i < na.length; i++) {
    for (let j = 0; j < nb.length; j++) {
      let k = 0;
      while (na[i + k] !== undefined && nb[j + k] !== undefined && na[i + k] === nb[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return best / maxLen;
}

/** Score a card name against a candidate name (0–1). */
function scoreName(input: string, candidate: string): number {
  // Canonical catalogue names sometimes include the collector number while
  // PriceCharting exposes it as a separate "#..." suffix. Compare identity
  // names without that explicit identifier so "Umbreon ex - 161/131" and
  // "Umbreon ex #161" do not look like different cards.
  const cleanInput = stripCardNumber(input);
  const cleanCandidate = stripCardNumber(candidate);
  const jacc = wordJaccard(cleanInput, cleanCandidate);
  const lcs  = lcsRatio(cleanInput, cleanCandidate);
  // Weighted average, slightly favour exact word overlap
  return jacc * 0.7 + lcs * 0.3;
}

/** Score a set name against a candidate console/set name (0–1). */
function scoreSet(input: string | undefined, candidate: string): number {
  if (!input) return 0.5; // unknown set — partial credit to avoid penalizing
  return wordJaccard(input, candidate);
}

/** Score a card number match (0 or 1). */
function scoreNumber(input: string | undefined, candidate: string | undefined): number {
  if (!input || !candidate) return 0.5; // unknown — partial credit
  return collectorNumbersMatch(input, candidate) ? 1 : 0;
}

/** Score a game match (0 or 1). */
function scoreGame(input: string | undefined, candidateGenre: string | undefined): number {
  if (!input || !candidateGenre) return 0.5; // unknown — partial credit
  const ni = normalizeString(input);
  const nc = normalizeString(candidateGenre);
  return ni === nc || nc.includes(ni) || ni.includes(nc) ? 1 : 0;
}

/**
 * Variant words are identity evidence for reprints whose provider "console"
 * remains the original set. PriceCharting does this for One Piece PRB01 cards,
 * so set similarity alone cannot distinguish the original manga from its
 * Premium Booster reprint.
 */
function variantMarkers(name: string, set?: string): Set<string> {
  const normalized = normalizeString(`${name} ${set ?? ""}`);
  const markers = new Set<string>();
  if (/\bmanga\b/.test(normalized)) markers.add("manga");
  if (/\balternate art\b/.test(normalized)) markers.add("alternate_art");
  if (/\b(?:prb\s*0?1|premium booster the best)\b/.test(normalized)) markers.add("prb01");
  if (/\bwanted\b/.test(normalized)) markers.add("wanted");
  if (/\bsp gold\b/.test(normalized)) markers.add("sp_gold");
  if (/\bsp silver\b/.test(normalized)) markers.add("sp_silver");
  return markers;
}

function sameVariantIdentity(input: MatchInput, candidate: MatchCandidate): boolean {
  const wanted = variantMarkers(input.name, input.set);
  if (wanted.size === 0) return false;
  const offered = variantMarkers(candidate.name, candidate.consoleName);
  return wanted.size === offered.size && [...wanted].every(marker => offered.has(marker));
}

/** Score a single candidate against the input. */
export function scoreSingle(input: MatchInput, candidate: MatchCandidate): MatchScore {
  const name   = scoreName(input.name, candidate.name);
  const set    = scoreSet(input.set, candidate.consoleName);
  const number = scoreNumber(input.number, candidate.cardNumber);
  const game   = scoreGame(input.game, candidate.genre);
  const total  = name * W_NAME + set * W_SET + number * W_NUMBER + game * W_GAME;
  return { total, name, set, number, game };
}

/** Pick the best match from a list of candidates. */
export function pickBestMatch(
  input: MatchInput,
  candidates: MatchCandidate[],
): MatchResult {
  if (candidates.length === 0) {
    return {
      candidate: null,
      status: "unmatched",
      score: { total: 0, name: 0, set: 0, number: 0, game: 0 },
      level: "none",
    };
  }

  const ranked = candidates
    .map(candidate => ({ candidate, score: scoreSingle(input, candidate) }))
    .sort((a, b) => b.score.total - a.score.total);

  const bestCandidate = ranked[0]!.candidate;
  const bestScore = ranked[0]!.score;
  const runnerUp = ranked[1];
  const normalizedInputNumber = input.number?.trim();
  const identifierIsMissingOrWrong = Boolean(
    !normalizedInputNumber ||
    !bestCandidate.cardNumber ||
    bestScore.number === 0,
  );

  let status: MappingStatus;
  let level: MatchResult["level"];
  const exactIdentityCandidates = ranked.filter(({ candidate, score }) =>
    score.number === 1 &&
    normalizeString(stripCardNumber(input.name)) === normalizeString(stripCardNumber(candidate.name)),
  );
  const bestExactIdentity = exactIdentityCandidates[0];
  const nextExactIdentity = exactIdentityCandidates[1];
  const hasDecisiveExactIdentity =
    Boolean(normalizedInputNumber) &&
    bestExactIdentity?.candidate.id === bestCandidate.id &&
    (!nextExactIdentity || bestExactIdentity.score.total - nextExactIdentity.score.total >= 0.08);
  const exactVariantCandidates = ranked.filter(({ candidate, score }) =>
    score.number === 1 &&
    score.name >= 0.65 &&
    sameVariantIdentity(input, candidate),
  );
  const bestExactVariant = exactVariantCandidates[0];
  const hasDecisiveVariantIdentity =
    Boolean(normalizedInputNumber) &&
    exactVariantCandidates.length === 1 &&
    bestExactVariant?.candidate.id === bestCandidate.id;

  if (identifierIsMissingOrWrong) {
    // Card number evidence is required for an automatic persisted mapping.
    // A missing or conflicting identifier is never made "strong" by fuzzy
    // name/set similarity.
    status = "review_required";
    level = "ambiguous";
  } else if (hasDecisiveExactIdentity || hasDecisiveVariantIdentity) {
    // A unique provider candidate with the same explicit collector number and
    // exact card name, or one that decisively beats another same-number
    // language/set printing, is stronger evidence than fuzzy provider labels
    // such as "SM Promos" versus PriceCharting's "Pokemon Promo".
    status = "matched";
    level = "strong";
  } else if (
    bestScore.total >= MATCH_STRONG_THRESHOLD &&
    (!runnerUp || bestScore.total - runnerUp.score.total >= 0.08)
  ) {
    status = "matched";
    level  = "strong";
  } else if (bestScore.total >= MATCH_AMBIGUOUS_THRESHOLD) {
    status = "review_required";
    level  = "ambiguous";
  } else {
    status = "unmatched";
    level  = "none";
  }

  return {
    candidate: status === "matched" ? bestCandidate : null,
    status,
    score: bestScore,
    level,
  };
}
