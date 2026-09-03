export type GraderKey = "psa" | "bgs" | "cgc";
export type MatchStatus = "confirmed" | "needs_review" | "unmatched";

export interface CardMatchInput {
  canonicalCardId: string;
  game: string;
  setName: string;
  name: string;
  collectorNumber?: string | null;
  releaseYear?: string | null;
  language?: string | null;
  variant?: string | null;
  rarity?: string | null;
  isPromo?: boolean;
}

export interface GradingCardMatch {
  providerCardId: string;
  description: string;
  matchConfidence: number;
  matchMethod: string;
  status: MatchStatus;
  raw: Record<string, unknown>;
}

export interface PopulationGrade {
  code: string;
  label: string;
  rawLabel?: string | null;
  population: number | null;
}

export interface GraderPopulation {
  label: string;
  totalPopulation: number | null;
  gemRate: number | null;
  grades: Record<string, PopulationGrade>;
}

export interface GradingPopulationResult {
  provider: string;
  providerCardId: string;
  graders: Partial<Record<GraderKey, GraderPopulation>>;
  sourceUpdatedAt: string | null;
}

export interface GradingPopulationProvider {
  searchCard(input: CardMatchInput): Promise<GradingCardMatch | null>;
  getPopulation(providerCardId: string): Promise<GradingPopulationResult>;
  getPopulationHistory?(providerCardId: string): Promise<unknown>;
}

export interface CardGradingResponse {
  cardId: string;
  status: "available" | "unmatched" | "unavailable";
  match?: { confidence: number; method: string; status: MatchStatus };
  graders: Partial<Record<GraderKey, GraderPopulation>>;
  source: { provider: "gemrate"; updatedAt: string | null; stale: boolean };
}
