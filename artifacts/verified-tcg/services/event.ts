// ── Shared event card shape ───────────────────────────────────────────────────

export interface EventCard {
  id: string;
  name: string;
  set: string;
  grade: string;
  color: string;
}

// ── "I Have This" — cards user offers at an event ────────────────────────────

const MOCK_HAVE_THIS_CARDS: EventCard[] = [
  { id: 'hv-c1', name: 'Charizard ex',  set: 'Obsidian Flames',    grade: 'PSA 10',   color: '#E0540F' },
  { id: 'hv-c2', name: 'Rayquaza VMAX', set: 'Evolving Skies',     grade: 'BGS 9.5',  color: '#3AE374' },
  { id: 'hv-c3', name: 'Luffy OP01',    set: 'Romance Dawn',       grade: 'CGC 10',   color: '#E63946' },
  { id: 'hv-c4', name: 'Pikachu ex',    set: 'SV: 151',            grade: 'Near Mint', color: '#FFCC00' },
];

/** Returns the cards the user is offering to match against at an event. */
export function getHaveThisCards(): EventCard[] {
  return MOCK_HAVE_THIS_CARDS;
}

// ── "Looking For" — cards user wants to find at an event ─────────────────────

const MOCK_LOOKING_FOR_CARDS: EventCard[] = [
  { id: 'lf-c1', name: 'Umbreon ex SIR',       set: 'Prismatic Evolutions', grade: 'PSA 10',   color: '#1A1B4B' },
  { id: 'lf-c2', name: 'Pikachu & Zekrom GX',  set: 'Sun & Moon',           grade: 'PSA 10',   color: '#FFD700' },
  { id: 'lf-c3', name: 'Eevee ex SIR',          set: 'Prismatic Evolutions', grade: 'PSA 9',    color: '#F5A623' },
  { id: 'lf-c4', name: 'Charizard ex',           set: 'Obsidian Flames',      grade: 'Raw NM',   color: '#E0540F' },
];

/** Returns the user's wishlist cards to search for at an event. */
export function getLookingForCards(): EventCard[] {
  return MOCK_LOOKING_FOR_CARDS;
}

// ── Vendor wanted cards ───────────────────────────────────────────────────────

export interface VendorWantedCard {
  id: string;
  name: string;
  set: string;
  grade: string;
  color: string;
  maxBuy: number;
}

const MOCK_VENDOR_WANTED_CARDS: VendorWantedCard[] = [
  { id: 'wc-1', name: 'Umbreon ex SIR',      set: 'Prismatic Evolutions', grade: 'PSA 10',  color: '#1A1B4B', maxBuy: 1350 },
  { id: 'wc-2', name: 'Pikachu & Zekrom GX', set: 'Sun & Moon',           grade: 'PSA 10',  color: '#FFD700', maxBuy: 1100 },
  { id: 'wc-3', name: 'Eevee ex SIR',         set: 'Prismatic Evolutions', grade: 'PSA 9+', color: '#F5A623', maxBuy: 300  },
];

/** Returns the buy-list cards a vendor is seeking at an event. */
export function getVendorWantedCards(): VendorWantedCard[] {
  return MOCK_VENDOR_WANTED_CARDS;
}

// ── Vendor extra inventory items ──────────────────────────────────────────────

export interface VendorInventoryExtra {
  name: string;
  grade: string;
  price: number;
  color: string;
}

const MOCK_VENDOR_INVENTORY_EXTRAS: VendorInventoryExtra[] = [
  { name: 'Mewtwo ex',        grade: 'PSA 9',    price: 160, color: '#9B59B6' },
  { name: 'Lugia V SIR',      grade: 'Near Mint', price: 78,  color: '#B0C4DE' },
  { name: 'Boa Hancock OP04', grade: 'CGC 10',   price: 95,  color: '#FF8FAB' },
];

/**
 * Returns the extra inventory items appended to a vendor's top cards.
 * Combine with vendor.topCards in the screen: [...vendor.topCards, ...getVendorInventoryExtras()]
 */
export function getVendorInventoryExtras(): VendorInventoryExtra[] {
  return MOCK_VENDOR_INVENTORY_EXTRAS;
}
