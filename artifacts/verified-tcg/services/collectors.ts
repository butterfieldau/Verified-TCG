// ── Collector profile types ───────────────────────────────────────────────────

export interface CollectorCard {
  id: string;
  name: string;
  grade: string;
  value: number;
  color: string;
}

export interface CollectorListing {
  id: string;
  name: string;
  grade: string;
  price: number;
  color: string;
}

export interface CollectorActivity {
  id: string;
  text: string;
  time: string;
}

export interface CollectorProfile {
  username: string;
  displayName: string;
  initials: string;
  avatarColor: string;
  bio: string;
  location: string;
  joinedAt: string;
  isVerifiedSeller: boolean;
  isVerifiedAccount: boolean;
  tcgPreferences: string[];
  showCollectionValue: boolean;
  stats: {
    publicCards: number;
    forSale: number;
    completedTrades: number;
    rating: number;
    reviewCount: number;
  };
  publicCollection: CollectorCard[];
  forSaleListings: CollectorListing[];
  recentActivity: CollectorActivity[];
}

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_COLLECTORS: Record<string, CollectorProfile> = {
  cardvault_au: {
    username: 'cardvault_au',
    displayName: 'CardVault AU',
    initials: 'CV',
    avatarColor: '#3B82F6',
    bio: "Australia's premier Pokémon card dealer. Specialising in high-grade slabs and rare holos. Fast shipping, fully insured.",
    location: 'Melbourne, VIC',
    joinedAt: '2023-06-01',
    isVerifiedSeller: true,
    isVerifiedAccount: true,
    tcgPreferences: ['pokemon', 'onepiece'],
    showCollectionValue: false,
    stats: {
      publicCards: 84,
      forSale: 12,
      completedTrades: 43,
      rating: 4.8,
      reviewCount: 43,
    },
    publicCollection: [
      { id: 'p1', name: 'Umbreon ex PSA 10', grade: 'PSA 10', value: 1480, color: '#1A1A2E' },
      { id: 'p2', name: 'Charizard ex PSA 10', grade: 'PSA 10', value: 580, color: '#FF6B35' },
      { id: 'p3', name: 'Rayquaza VMAX BGS 9.5', grade: 'BGS 9.5', value: 720, color: '#4A90D9' },
    ],
    forSaleListings: [
      { id: 'fs1', name: 'Umbreon ex', grade: 'PSA 10', price: 1480, color: '#1A1A2E' },
      { id: 'fs2', name: 'Charizard ex', grade: 'PSA 10', price: 580, color: '#FF6B35' },
    ],
    recentActivity: [
      { id: 'a1', text: 'Listed Umbreon ex PSA 10 for $1,480 AUD', time: '2h ago' },
      { id: 'a2', text: 'Completed trade with @prismatic_collector', time: '1d ago' },
      { id: 'a3', text: 'Added Charizard ex PSA 10 to collection', time: '3d ago' },
    ],
  },
  prismatic_collector: {
    username: 'prismatic_collector',
    displayName: 'Priya K.',
    initials: 'PK',
    avatarColor: '#8B5CF6',
    bio: 'Collector since 2020. Obsessed with Prismatic Evolutions and Special Illustration Rares. Not currently selling.',
    location: 'Brisbane, QLD',
    joinedAt: '2024-03-10',
    isVerifiedSeller: false,
    isVerifiedAccount: true,
    tcgPreferences: ['pokemon'],
    showCollectionValue: false,
    stats: {
      publicCards: 210,
      forSale: 0,
      completedTrades: 7,
      rating: 5.0,
      reviewCount: 7,
    },
    publicCollection: [
      { id: 'q1', name: 'Pikachu ex', grade: 'Near Mint', value: 248, color: '#FFCC00' },
      { id: 'q2', name: 'Eevee ex SIR', grade: 'PSA 9', value: 95, color: '#F5A623' },
    ],
    forSaleListings: [],
    recentActivity: [
      { id: 'b1', text: 'Added Eevee ex SIR to collection', time: '4d ago' },
      { id: 'b2', text: 'Completed trade with @melbourne_tcg', time: '1w ago' },
    ],
  },
};

const FALLBACK_USERNAME = 'cardvault_au';

// ── Service helpers ───────────────────────────────────────────────────────────

/**
 * Returns the public profile for a collector by username.
 * Falls back to the default collector profile when the username is not found.
 */
export function getCollectorProfile(username: string): CollectorProfile {
  return MOCK_COLLECTORS[username] ?? MOCK_COLLECTORS[FALLBACK_USERNAME];
}
