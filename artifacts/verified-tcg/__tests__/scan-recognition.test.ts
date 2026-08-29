import { ApiClientError } from '../services/apiClient';
import {
  mapScanError,
  parseScanResponse,
  scanCardToAppCard,
} from '../services/scanRecognition';

describe('scan recognition response handling', () => {
  it('validates candidates and makes the top match selectable', () => {
    const result = parseScanResponse({
      recognitionStatus: 'ambiguous',
      topMatch: null,
      matches: [
        { card: { id: 'op01-001', name: 'Roronoa Zoro', game: 'One Piece' }, confidence: 84 },
        { card: { id: 'op01-002', name: 'Usopp', game: 'One Piece' }, confidence: 70 },
      ],
      lowConfidence: true,
      extracted: { name: 'Zoro', set_name: 'Romance Dawn', number: '001', game: 'One Piece' },
    });

    expect(result.matches).toHaveLength(2);
    expect(result.topMatch).toBeNull();
    expect(result.extracted).toEqual({ name: 'Zoro', setName: 'Romance Dawn', number: '001', game: 'One Piece' });
  });

  it('rejects malformed recognition results instead of presenting them as matches', () => {
    expect(() => parseScanResponse({
      recognitionStatus: 'matched',
      topMatch: { card: { id: 'missing-name' }, confidence: 80 },
    })).toThrow('invalid match');
  });

  it.each([
    {
      recognitionStatus: 'matched',
      topMatch: { card: { id: 'p-1', name: 'Pikachu' }, confidence: 99 },
      matches: [],
    },
    {
      recognitionStatus: 'ambiguous',
      topMatch: null,
      matches: [{ card: { id: 'p-1', name: 'Pikachu' }, confidence: 60 }],
    },
    { recognitionStatus: 'unreadable', topMatch: null, matches: [] },
    { recognitionStatus: 'unsupported', topMatch: null, matches: [] },
    { recognitionStatus: 'insufficient_evidence', topMatch: null, matches: [] },
    { recognitionStatus: 'no_canonical_match', topMatch: null, matches: [] },
    {
      recognitionStatus: 'insufficient_evidence',
      topMatch: null,
      matches: [{ card: { id: 'grookey-1', name: 'Grookey' }, confidence: 75 }],
    },
  ])('accepts the live %s recognition status contract', (response) => {
    expect(parseScanResponse(response).recognitionStatus).toBe(response.recognitionStatus);
  });

  it.each([
    { recognitionStatus: 'matched', topMatch: null, matches: [] },
    { recognitionStatus: 'ambiguous', topMatch: { card: { id: 'x', name: 'X' }, confidence: 80 }, matches: [] },
    { recognitionStatus: 'unreadable', topMatch: null, matches: [{ card: { id: 'x', name: 'X' }, confidence: 80 }] },
    { recognitionStatus: 'unsupported', topMatch: null, matches: [{ card: { id: 'x', name: 'X' }, confidence: 80 }] },
    { recognitionStatus: 'insufficient_evidence', topMatch: { card: { id: 'x', name: 'X' }, confidence: 80 }, matches: [] },
    { recognitionStatus: 'no_canonical_match', topMatch: { card: { id: 'x', name: 'X' }, confidence: 80 }, matches: [] },
  ])('rejects inconsistent recognition statuses', (response) => {
    expect(() => parseScanResponse(response)).toThrow();
  });

  it.each([
    ['unauthorized', 'auth'],
    ['rate_limited', 'quota'],
    ['network', 'offline'],
    ['timeout', 'timeout'],
    ['provider_unavailable', 'provider'],
  ] as const)('maps API %s errors to actionable scan errors', (kind, code) => {
    expect(mapScanError(new ApiClientError(kind, 'Service error')).code).toBe(code);
  });

  it.each([
    ['One Piece TCG', 'onepiece'],
    ['Magic: The Gathering', 'magic'],
    ['Pokemon', 'pokemon'],
  ] as const)('preserves supported %s TCG IDs', (game, tcg) => {
    const card = scanCardToAppCard({
      id: 'op01-001',
      name: 'Roronoa Zoro',
      game,
      set: 'OP-01',
      set_name: 'Romance Dawn',
      number: '001',
    });

    expect(card.tcg).toBe(tcg);
    expect(card.year).toBe(0);
    expect(card.price).toEqual({ raw: 0, currency: 'AUD', updatedAt: null });
  });

  it('rejects unknown games instead of labelling them Pokemon', () => {
    expect(() => scanCardToAppCard({ id: 'x', name: 'Unknown', game: 'Flesh and Blood' }))
      .toThrow('not supported');
  });
});
