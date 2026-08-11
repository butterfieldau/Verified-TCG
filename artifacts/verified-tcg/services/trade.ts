// ── Shared card shape used across trade screens ───────────────────────────────

export interface TradeCard {
  id: string;
  name: string;
  set: string;
  grade: string;
  value: number;
  color: string;
}

// ── Counterparty cards (trade offer flow) ─────────────────────────────────────

const MOCK_THEIR_CARDS: TradeCard[] = [
  { id: 'their-001', name: 'Pikachu ex',             set: 'SV: 151',           grade: 'TAG 10',   value: 875, color: '#FFCC00' },
  { id: 'their-002', name: 'Lugia V',                set: 'Silver Tempest',    grade: 'PSA 10',   value: 340, color: '#4A90D9' },
  { id: 'their-003', name: 'Jace, the Mind Sculptor', set: 'Modern Horizons 3', grade: 'Near Mint', value: 220, color: '#3B82F6' },
];

/** Returns the other collector's cards available to receive in a trade. */
export function getTradeCounterpartyCards(): TradeCard[] {
  return MOCK_THEIR_CARDS;
}

// ── QR scan collector matches ─────────────────────────────────────────────────

export type CollectorMatchType = 'wishlist' | 'for_trade' | 'for_sale';

export interface CollectorMatch {
  id: string;
  cardName: string;
  grade: string;
  value: number;
  color: string;
  type: CollectorMatchType;
}

const MOCK_COLLECTOR_MATCHES: CollectorMatch[] = [
  { id: 'm-001', cardName: 'Umbreon ex SIR',      grade: 'PSA 10',  value: 1450, color: '#1A1B4B', type: 'wishlist'  },
  { id: 'm-002', cardName: 'Eevee ex SIR',         grade: 'PSA 9',   value: 340,  color: '#F5A623', type: 'for_trade' },
  { id: 'm-003', cardName: 'Pikachu & Zekrom GX',  grade: 'Raw NM',  value: 95,   color: '#FFD700', type: 'for_sale'  },
];

/** Returns scanned collector card matches after a QR code scan. */
export function getCollectorMatches(): CollectorMatch[] {
  return MOCK_COLLECTOR_MATCHES;
}

// ── Trade value assistant card pools ──────────────────────────────────────────

export interface OfferCard {
  id: string;
  name: string;
  grade: string;
  value: number;
  color: string;
}

const MOCK_MY_CARDS_POOL: OfferCard[] = [
  { id: 'mc-001', name: 'Charizard ex',  grade: 'PSA 10',   value: 1200, color: '#E0540F' },
  { id: 'mc-002', name: 'Pikachu ex',    grade: 'TAG 10',   value: 850,  color: '#FFCC00' },
  { id: 'mc-003', name: 'Rayquaza VMAX', grade: 'BGS 9.5',  value: 890,  color: '#3AE374' },
  { id: 'mc-004', name: 'Luffy OP01',    grade: 'CGC 10',   value: 320,  color: '#E63946' },
  { id: 'mc-005', name: 'Lugia V',       grade: 'PSA 9',    value: 220,  color: '#B0C4DE' },
];

const MOCK_THEIR_CARDS_POOL: OfferCard[] = [
  { id: 'tc-001', name: 'Umbreon ex SIR',          grade: 'PSA 10',   value: 1900, color: '#1A1B4B' },
  { id: 'tc-002', name: 'Pikachu & Zekrom GX',     grade: 'PSA 10',   value: 1200, color: '#FFD700' },
  { id: 'tc-003', name: 'Eevee ex SIR',             grade: 'PSA 9',    value: 340,  color: '#F5A623' },
  { id: 'tc-004', name: 'Jace, the Mind Sculptor',  grade: 'Near Mint', value: 85,  color: '#1E40AF' },
];

/** Returns the user's selectable card pool for the trade value assistant. */
export function getMyCardsPool(): OfferCard[] {
  return MOCK_MY_CARDS_POOL;
}

/** Returns the counterparty's selectable card pool for the trade value assistant. */
export function getTheirCardsPool(): OfferCard[] {
  return MOCK_THEIR_CARDS_POOL;
}
