import { apiJson } from './apiClient';

export type PopulationGrader = 'psa' | 'bgs' | 'cgc';

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

export interface CardGradingPopulation {
  cardId: string;
  status: 'available' | 'unmatched' | 'unavailable';
  graders: Partial<Record<PopulationGrader, GraderPopulation>>;
  source: { provider: 'gemrate'; updatedAt: string | null; stale: boolean };
}

export function fetchCardGradingPopulation(cardId: string): Promise<CardGradingPopulation> {
  return apiJson<CardGradingPopulation>(`/cards/${encodeURIComponent(cardId)}/grading`);
}
