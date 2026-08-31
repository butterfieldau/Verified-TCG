import { apiJson } from './apiClient';
import { getAccessToken } from './auth';

export interface ImportPreviewRequest {
  content: string;
  filename?: string;
  sourceCurrency?: string;
}

export interface ImportPreviewRow {
  rowNumber: number;
  status: 'matched' | 'watchlist_only' | 'ambiguous' | 'unmatched' | 'invalid' | 'duplicate';
  cardId?: string;
  card?: any;
  normalized?: any;
  candidateCount?: number;
  error?: string;
  isWatchlistOnly?: boolean;
  supportedGrade?: boolean;
  pricingAvailable?: boolean;
}

export interface ImportPreviewResponse {
  jobId: string;
  source: string;
  schemaVersion: number;
  contentSha256: string;
  summary: {
    total: number;
    matched: number;
    watchlistOnly: number;
    invalid: number;
    ambiguous: number;
    unmatched: number;
    duplicate: number;
    priced: number;
  };
  rows: ImportPreviewRow[];
}

export interface ImportCommitRequest {
  contentSha256: string;
  sourceCurrency?: string;
}

export interface ImportCommitResponse {
  jobId: string;
  status: string;
  summary: {
    holdingsAdded: number;
    wishlistAdded: number;
    skipped: number;
    duplicates: number;
    unsupportedGrades: number;
  };
  rows: Array<{
    rowNumber: number;
    status: 'holding_added' | 'wishlist_added' | 'wishlist_existing' | 'duplicate' | 'skipped';
    cardId?: string;
    reason?: string;
  }>;
  replayed?: boolean;
}

async function accessToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error('Your session has expired. Please sign in again.');
  return token;
}

export async function previewImport(req: ImportPreviewRequest): Promise<ImportPreviewResponse> {
  return apiJson<ImportPreviewResponse>('/api/collection/import/preview', {
    method: 'POST',
    accessToken: await accessToken(),
    body: JSON.stringify(req),
  });
}

export async function commitImport(jobId: string, req: ImportCommitRequest): Promise<ImportCommitResponse> {
  return apiJson<ImportCommitResponse>(`/api/collection/import/${encodeURIComponent(jobId)}/commit`, {
    method: 'POST',
    accessToken: await accessToken(),
    body: JSON.stringify(req),
  });
}
