import type { GradeKey } from "./grades.js";
import type { MatchCandidate } from "./matcher.js";

/**
 * Provider-neutral contract used by the pricing orchestrator. Provider
 * credentials and provider-native payloads stay inside the adapter.
 */
export interface PricingProviderAdapter<TSearchResult, TDetail> {
  readonly key: string;
  readonly label: string;
  readonly currency: string;
  isConfigured(): boolean;
  searchProducts(query: string): Promise<TSearchResult[] | null>;
  getProductDetail(id: string, options?: { bypassCache?: boolean }): Promise<TDetail | null>;
  normalizeQuotes(detail: TDetail): Map<GradeKey, number>;
  toMatchCandidate(product: TSearchResult): MatchCandidate;
}

export interface CanonicalProviderQuote {
  providerKey: string;
  providerLabel: string;
  providerProductId: string | null;
  gradeKey: GradeKey;
  priceCents: number;
  currency: string;
  originalPriceCents: number;
  originalCurrency: string;
  fetchedAt: Date;
}

export interface VerifiedMarketRange {
  lowCents: number;
  highCents: number;
  currency: string;
  sampleCount: number;
  basis: "retained_snapshots";
}

export interface VerifiedMarketConfidence {
  score: number;
  level: "high" | "medium" | "low";
  providerCount: number;
  reasons: string[];
}

export interface VerifiedMarketProvider {
  key: string;
  label: string;
  productId: string | null;
  priceCents: number;
  currency: string;
  originalPriceCents: number;
  originalCurrency: string;
  fetchedAt: string;
}

export interface VerifiedMarketValue {
  gradeKey: GradeKey;
  verifiedMarketValueCents: number;
  verifiedMarketValue: number;
  currency: string;
  range: VerifiedMarketRange | null;
  confidence: VerifiedMarketConfidence;
  providers: VerifiedMarketProvider[];
  insights: string[];
}

function confidenceLevel(score: number): VerifiedMarketConfidence["level"] {
  if (score >= 80) return "high";
  if (score >= 60) return "medium";
  return "low";
}

/**
 * Aggregate normalized quotes into an explainable Verified Market value.
 *
 * The current implementation has one live provider, so its normalized quote is
 * the value. This contract supports more providers without changing API clients.
 * A market range is emitted only from real retained snapshots.
 */
export function aggregateVerifiedMarketValue(input: {
  gradeKey: GradeKey;
  quotes: CanonicalProviderQuote[];
  matchingConfidence: number | null;
  isStale: boolean;
  retainedSnapshotCents: number[];
}): VerifiedMarketValue | null {
  if (input.quotes.length === 0) return null;

  const currency = input.quotes[0]!.currency;
  const comparableQuotes = input.quotes.filter(q => q.currency === currency);
  if (comparableQuotes.length === 0) return null;

  const sorted = comparableQuotes.map(q => q.priceCents).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const valueCents = sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
    : sorted[middle]!;

  const snapshots = input.retainedSnapshotCents.filter(
    value => Number.isSafeInteger(value) && value > 0,
  );
  const range: VerifiedMarketRange | null = snapshots.length >= 2
    ? {
        lowCents: Math.min(...snapshots),
        highCents: Math.max(...snapshots),
        currency,
        sampleCount: snapshots.length,
        basis: "retained_snapshots",
      }
    : null;

  const providerCount = new Set(comparableQuotes.map(q => q.providerKey)).size;
  const reasons: string[] = [];
  let score = Math.round(Math.max(0, Math.min(1, input.matchingConfidence ?? 0)) * 55);

  if ((input.matchingConfidence ?? 0) >= 0.9) {
    reasons.push("Strong catalog identity match");
  } else {
    reasons.push("Catalog identity confidence is limited");
  }

  if (input.isStale) {
    score -= 10;
    reasons.push("Latest quote is older than the freshness target");
  } else {
    score += 25;
    reasons.push("Latest quote is within the freshness target");
  }

  score += Math.min(15, providerCount * 15);
  reasons.push(`Based on ${providerCount} normalized pricing source${providerCount === 1 ? "" : "s"}`);

  if (range) {
    score += 5;
    reasons.push(`Range uses ${range.sampleCount} retained market snapshots`);
  } else {
    reasons.push("Not enough retained snapshots for a market range");
  }

  score = Math.max(0, Math.min(100, score));

  const insights: string[] = [];
  if (range) {
    if (valueCents > range.highCents) {
      insights.push("Current value is above the retained snapshot range");
    } else if (valueCents < range.lowCents) {
      insights.push("Current value is below the retained snapshot range");
    } else {
      insights.push("Current value is within the retained snapshot range");
    }
    insights.push(`Range is based on ${range.sampleCount} retained snapshots`);
  } else {
    insights.push("A market range will appear after more snapshots are retained");
  }

  return {
    gradeKey: input.gradeKey,
    verifiedMarketValueCents: valueCents,
    verifiedMarketValue: valueCents / 100,
    currency,
    range,
    confidence: {
      score,
      level: confidenceLevel(score),
      providerCount,
      reasons,
    },
    providers: comparableQuotes.map(q => ({
      key: q.providerKey,
      label: q.providerLabel,
      productId: q.providerProductId,
      priceCents: q.priceCents,
      currency: q.currency,
      originalPriceCents: q.originalPriceCents,
      originalCurrency: q.originalCurrency,
      fetchedAt: q.fetchedAt.toISOString(),
    })),
    insights,
  };
}