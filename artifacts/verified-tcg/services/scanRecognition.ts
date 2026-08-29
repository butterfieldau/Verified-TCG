import type { Card, CardRarity, TCGId } from '@/types';
import { getAccessToken } from './auth';
import { ApiClientError, apiRequest } from './apiClient';

export type ScanErrorCode =
  | 'auth'
  | 'quota'
  | 'offline'
  | 'timeout'
  | 'provider'
  | 'unsupported'
  | 'unreadable'
  | 'no_match'
  | 'invalid_response';

export interface ScanCandidate {
  card: Record<string, unknown>;
  confidence: number;
}

export interface ScanResult {
  recognitionStatus:
    | 'matched'
    | 'ambiguous'
    | 'unreadable'
    | 'unsupported'
    | 'insufficient_evidence'
    | 'no_canonical_match';
  topMatch: ScanCandidate | null;
  matches: ScanCandidate[];
  lowConfidence: boolean;
  imageUnreadable: boolean;
  extracted: { name: string; setName: string; number: string; game: string };
  scansUsed?: number;
  scanLimit?: number | null;
  scansRemaining?: number | null;
}

export class ScanRecognitionError extends Error {
  constructor(
    public readonly code: ScanErrorCode,
    message: string,
    public readonly scansUsed?: number,
  ) {
    super(message);
    this.name = 'ScanRecognitionError';
  }
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

function candidate(value: unknown): ScanCandidate | null {
  const source = record(value);
  const card = source && record(source.card);
  const confidence = source?.confidence;
  if (!card || typeof confidence !== 'number' || !Number.isFinite(confidence)) return null;
  if (!text(card.id) || !text(card.name)) return null;
  return { card, confidence: Math.max(0, Math.min(100, confidence)) };
}

/** Validates the recognition contract before it reaches the capture UI. */
export function parseScanResponse(value: unknown): ScanResult {
  const source = record(value);
  if (!source) throw new ScanRecognitionError('invalid_response', 'The card recognition service returned an invalid response. Please try again.');
  const recognitionStatus = source.recognitionStatus;
  if (
    recognitionStatus !== 'matched' &&
    recognitionStatus !== 'ambiguous' &&
    recognitionStatus !== 'unreadable' &&
    recognitionStatus !== 'unsupported' &&
    recognitionStatus !== 'insufficient_evidence' &&
    recognitionStatus !== 'no_canonical_match'
  ) {
    throw new ScanRecognitionError('invalid_response', 'The card recognition service returned an invalid recognition status. Please try again.');
  }

  const suppliedMatches = source.matches;
  if (suppliedMatches !== undefined && !Array.isArray(suppliedMatches)) {
    throw new ScanRecognitionError('invalid_response', 'The card recognition service returned an invalid response. Please try again.');
  }
  const parsedMatches = (suppliedMatches ?? []).map(candidate);
  if (parsedMatches.some(item => !item)) {
    throw new ScanRecognitionError('invalid_response', 'The card recognition service returned an invalid match. Please try again.');
  }

  const hasTopMatch = Object.prototype.hasOwnProperty.call(source, 'topMatch');
  const explicitTop = source.topMatch === null ? null : candidate(source.topMatch);
  if (!hasTopMatch || (source.topMatch !== null && !explicitTop)) {
    throw new ScanRecognitionError('invalid_response', 'The card recognition service returned an invalid match. Please try again.');
  }
  const matches = parsedMatches as ScanCandidate[];
  const topMatch = explicitTop;
  const allMatches = topMatch && !matches.some(item => item.card.id === topMatch.card.id)
    ? [topMatch, ...matches]
    : matches;
  if (recognitionStatus === 'matched' && !topMatch) {
    throw new ScanRecognitionError('invalid_response', 'A matched recognition result must include a top match.');
  }
  if (recognitionStatus === 'ambiguous' && (topMatch || allMatches.length === 0)) {
    throw new ScanRecognitionError('invalid_response', 'An ambiguous recognition result must include candidates but no top match.');
  }
  if (
    (recognitionStatus === 'unreadable' ||
      recognitionStatus === 'unsupported' ||
      recognitionStatus === 'insufficient_evidence' ||
      recognitionStatus === 'no_canonical_match') &&
    (topMatch || allMatches.length > 0)
  ) {
    throw new ScanRecognitionError('invalid_response', `A ${recognitionStatus} recognition result cannot include card candidates.`);
  }
  const extractedSource = record(source.extracted);
  const numeric = (input: unknown): number | undefined =>
    typeof input === 'number' && Number.isFinite(input) ? input : undefined;

  return {
    recognitionStatus,
    topMatch,
    matches: allMatches,
    lowConfidence: source.lowConfidence === true || recognitionStatus === 'ambiguous',
    imageUnreadable: source.imageUnreadable === true || recognitionStatus === 'unreadable' || recognitionStatus === 'insufficient_evidence',
    extracted: {
      name: text(extractedSource?.name),
      setName: text(extractedSource?.setName ?? extractedSource?.set_name),
      number: text(extractedSource?.number),
      game: text(extractedSource?.game),
    },
    scansUsed: numeric(source.scansUsed),
    scanLimit: source.scanLimit === null ? null : numeric(source.scanLimit),
    scansRemaining: source.scansRemaining === null ? null : numeric(source.scansRemaining),
  };
}

export function mapScanError(error: unknown): ScanRecognitionError {
  if (error instanceof ScanRecognitionError) return error;
  if (error instanceof ApiClientError) {
    const message = error.message.toLowerCase();
    if (error.kind === 'unauthorized') return new ScanRecognitionError('auth', 'Your session has expired. Please sign in again.');
    if (error.kind === 'forbidden' || error.kind === 'rate_limited') return new ScanRecognitionError('quota', 'Your scan limit has been reached. Upgrade or wait for your allowance to reset.');
    if (error.kind === 'network') return new ScanRecognitionError('offline', 'You appear to be offline. Reconnect, then try scanning again.');
    if (error.kind === 'timeout') return new ScanRecognitionError('timeout', 'Recognition timed out. Check your connection and try again.');
    if (error.kind === 'provider_unavailable') return new ScanRecognitionError('provider', 'Card recognition is temporarily unavailable. Please try again shortly.');
    if (error.kind === 'validation' && /unsupported|not supported/.test(message)) return new ScanRecognitionError('unsupported', 'This card game is not supported by the scanner yet.');
    if (error.kind === 'validation') return new ScanRecognitionError('unreadable', 'We could not read this image. Retake it with the whole card in focus.');
  }
  return new ScanRecognitionError('provider', 'Card recognition could not be completed. Please try again.');
}

export async function recognizeCard(base64Image: string): Promise<ScanResult> {
  try {
    const response = await apiRequest('/api/scan/recognize', {
      method: 'POST',
      accessToken: await getAccessToken(),
      body: JSON.stringify({ image: base64Image, mimeType: 'image/jpeg' }),
      timeoutMs: 20_000,
    });
    return parseScanResponse(await response.json());
  } catch (error) {
    throw mapScanError(error);
  }
}

function tcgFromGame(game: unknown): TCGId {
  const normalized = text(game).toLowerCase();
  if (normalized === 'pokemon' || normalized.includes('pokémon')) return 'pokemon';
  if (normalized === 'magic' || normalized.includes('magic: the gathering')) return 'magic';
  if (normalized.includes('one piece') || normalized === 'onepiece') return 'onepiece';
  if (normalized === 'yugioh' || normalized === 'yu-gi-oh') return 'yugioh';
  if (normalized === 'lorcana' || normalized === 'disney lorcana') return 'lorcana';
  if (normalized === 'dragonball' || normalized === 'dragon ball super') return 'dragonball';
  throw new ScanRecognitionError('unsupported', 'This card game is not supported by the scanner yet.');
}

function rarityFromValue(value: unknown): CardRarity {
  const rarity = text(value).toLowerCase();
  if (rarity.includes('hyper')) return 'hyper_rare';
  if (rarity.includes('special illustration') || rarity === 'sir') return 'special_illustration';
  if (rarity.includes('secret')) return 'secret_rare';
  if (rarity.includes('ultra') || rarity.includes('vstar')) return 'ultra_rare';
  if (rarity.includes('holo')) return 'holo_rare';
  if (rarity.includes('uncommon')) return 'uncommon';
  if (rarity.includes('common')) return 'common';
  return 'rare';
}

/** Builds an app card from API facts only; no recognition image/OCR is retained. */
export function scanCardToAppCard(raw: Record<string, unknown>): Card {
  const price = typeof raw.price === 'number' && Number.isFinite(raw.price) ? raw.price : 0;
  const updatedAt = text(raw.price_updated_at ?? raw.updated_at) || null;
  const year = typeof raw.year === 'number' && Number.isInteger(raw.year) ? raw.year : 0;
  return {
    id: text(raw.id),
    name: text(raw.name),
    setId: text(raw.set_id ?? raw.set ?? raw.set_name),
    setName: text(raw.set_name ?? raw.set),
    tcg: tcgFromGame(raw.game ?? raw.tcg),
    number: text(raw.number),
    rarity: rarityFromValue(raw.rarity),
    year,
    imageUrl: text(raw.image_url) || undefined,
    gradientStart: '#202020',
    gradientEnd: '#090909',
    price: { raw: price, currency: text(raw.currency) || 'AUD', updatedAt },
  };
}