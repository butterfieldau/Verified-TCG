/**
 * Mock data for Verified TCG match & event features.
 * All data is static prototype-only — no real matching logic.
 */

// ── Trade Matches ─────────────────────────────────────────────────────────────

export interface TradeMatch {
  id: string;
  matchPercent: number;
  collector: {
    username: string;
    displayName: string;
    initials: string;
    avatarColor: string;
    isVerified: boolean;
    location: string;
    rating: number;
    tradesCount: number;
  };
  youWant: {
    name: string;
    set: string;
    grade: string;
    value: number;
    color: string;
  };
  theyWant: {
    name: string;
    set: string;
    grade: string;
    value: number;
    color: string;
  };
}

export const MOCK_TRADE_MATCHES: TradeMatch[] = [
  {
    id: 'tm-001',
    matchPercent: 98,
    collector: {
      username: 'cardvaultsydney',
      displayName: 'CardVault Sydney',
      initials: 'CS',
      avatarColor: '#3B82F6',
      isVerified: true,
      location: 'Sydney, NSW',
      rating: 4.9,
      tradesCount: 67,
    },
    youWant: { name: 'Pikachu & Zekrom GX', set: 'Sun & Moon', grade: 'PSA 10', value: 1200, color: '#FFD700' },
    theyWant: { name: 'Charizard ex', set: 'Obsidian Flames', grade: 'TAG 10', value: 1150, color: '#E0540F' },
  },
  {
    id: 'tm-002',
    matchPercent: 91,
    collector: {
      username: 'prismatic_priya',
      displayName: 'Priya K.',
      initials: 'PK',
      avatarColor: '#8B5CF6',
      isVerified: true,
      location: 'Brisbane, QLD',
      rating: 5.0,
      tradesCount: 23,
    },
    youWant: { name: 'Umbreon ex SIR', set: 'Prismatic Evolutions', grade: 'PSA 10', value: 1450, color: '#1A1B4B' },
    theyWant: { name: 'Rayquaza VMAX', set: 'Evolving Skies', grade: 'BGS 9.5', value: 890, color: '#3AE374' },
  },
  {
    id: 'tm-003',
    matchPercent: 85,
    collector: {
      username: 'melbournetcg',
      displayName: 'Melbourne TCG',
      initials: 'MT',
      avatarColor: '#22C55E',
      isVerified: false,
      location: 'Melbourne, VIC',
      rating: 4.7,
      tradesCount: 41,
    },
    youWant: { name: 'Lugia V SIR', set: 'Silver Tempest', grade: 'CGC 10', value: 680, color: '#B0C4DE' },
    theyWant: { name: 'Pikachu ex', set: 'SV: 151', grade: 'PSA 9', value: 340, color: '#FFCC00' },
  },
  {
    id: 'tm-004',
    matchPercent: 78,
    collector: {
      username: 'omarcollects',
      displayName: 'Omar M.',
      initials: 'OM',
      avatarColor: '#F59E0B',
      isVerified: true,
      location: 'Perth, WA',
      rating: 4.8,
      tradesCount: 12,
    },
    youWant: { name: 'Eevee ex SIR', set: 'Prismatic Evolutions', grade: 'PSA 10', value: 520, color: '#F5A623' },
    theyWant: { name: 'Luffy OP01', set: 'Romance Dawn', grade: 'CGC 10', value: 320, color: '#E63946' },
  },
];

// ── Events ────────────────────────────────────────────────────────────────────

export interface TCGEvent {
  id: string;
  name: string;
  venue: string;
  city: string;
  dates: string;
  isActive: boolean;
  collectorsPresent: number;
  stats: {
    collectorsWithYourWants: number;
    tradeMatches: number;
    wishlistForSale: number;
    wantYourCards: number;
  };
  tradeMatchesAtEvent: TradeMatch[];
  wishlistNearby: WishlistNearbyItem[];
  wantYourCards: WantYourCardItem[];
  forSaleAtEvent: ForSaleAtEventItem[];
  trending: TrendingAtEventItem[];
  vendors: EventVendor[];
}

export interface WishlistNearbyItem {
  id: string;
  cardName: string;
  set: string;
  grade: string;
  value: number;
  color: string;
  availableCount: number;
  sellerUsername: string;
  sellerVerified: boolean;
}

export interface WantYourCardItem {
  id: string;
  cardName: string;
  grade: string;
  color: string;
  collectors: { username: string; initials: string; color: string }[];
}

export interface ForSaleAtEventItem {
  id: string;
  cardName: string;
  set: string;
  grade: string;
  askingPrice: number;
  color: string;
  sellerUsername: string;
  sellerVerified: boolean;
  booth?: string;
  /** Vendor ID from MOCK_EVENT.vendors — present only for registered event vendors */
  vendorId?: string;
}

export interface TrendingAtEventItem {
  id: string;
  cardName: string;
  set: string;
  grade: string;
  color: string;
  watchers: number;
  change: string;
}

export interface EventVendor {
  id: string;
  name: string;
  booth: string;
  initials: string;
  avatarColor: string;
  isVerifiedVendor: boolean;
  location: string;
  cardsForSale: number;
  wantedCards: number;
  tradeAccepted: boolean;
  rating: number;
  reviewCount: number;
  topCards: { name: string; grade: string; price: number; color: string }[];
}

export const MOCK_EVENT: TCGEvent = {
  id: 'ev-tcxpo-syd-2026',
  name: 'TCXPO Sydney 2026',
  venue: 'Sydney Olympic Park',
  city: 'Sydney, NSW',
  dates: 'Aug 15–17, 2026',
  isActive: true,
  collectorsPresent: 342,
  stats: {
    collectorsWithYourWants: 17,
    tradeMatches: 6,
    wishlistForSale: 11,
    wantYourCards: 8,
  },
  tradeMatchesAtEvent: [
    {
      id: 'etm-001',
      matchPercent: 96,
      collector: {
        username: 'cardvaultsydney',
        displayName: 'CardVault Sydney',
        initials: 'CS',
        avatarColor: '#3B82F6',
        isVerified: true,
        location: 'Sydney, NSW',
        rating: 4.9,
        tradesCount: 67,
      },
      youWant: { name: 'Umbreon ex SIR', set: 'Prismatic Evolutions', grade: 'PSA 10', value: 1450, color: '#1A1B4B' },
      theyWant: { name: 'Charizard ex', set: 'Obsidian Flames', grade: 'PSA 10', value: 1380, color: '#E0540F' },
    },
    {
      id: 'etm-002',
      matchPercent: 88,
      collector: {
        username: 'sydtradingpost',
        displayName: 'Syd Trading Post',
        initials: 'ST',
        avatarColor: '#22C55E',
        isVerified: true,
        location: 'Sydney, NSW',
        rating: 4.8,
        tradesCount: 31,
      },
      youWant: { name: 'Pikachu & Zekrom GX', set: 'Sun & Moon', grade: 'PSA 10', value: 1200, color: '#FFD700' },
      theyWant: { name: 'Rayquaza VMAX', set: 'Evolving Skies', grade: 'BGS 9.5', value: 890, color: '#3AE374' },
    },
  ],
  wishlistNearby: [
    { id: 'wn-001', cardName: 'Umbreon ex SIR', set: 'Prismatic Evolutions', grade: 'PSA 10', value: 1450, color: '#1A1B4B', availableCount: 2, sellerUsername: 'cardvaultsydney', sellerVerified: true },
    { id: 'wn-002', cardName: 'Pikachu & Zekrom GX', set: 'Sun & Moon', grade: 'PSA 10', value: 1200, color: '#FFD700', availableCount: 1, sellerUsername: 'sydtradingpost', sellerVerified: true },
    { id: 'wn-003', cardName: 'Eevee ex SIR', set: 'Prismatic Evolutions', grade: 'PSA 9', value: 320, color: '#F5A623', availableCount: 3, sellerUsername: 'prismaticcards', sellerVerified: false },
  ],
  wantYourCards: [
    { id: 'wyc-001', cardName: 'Charizard ex PSA 10', grade: 'PSA 10', color: '#E0540F', collectors: [{ username: 'omarcollects', initials: 'OC', color: '#F59E0B' }, { username: 'cardking_syd', initials: 'CK', color: '#8B5CF6' }, { username: 'pikachumax', initials: 'PM', color: '#FFD700' }] },
    { id: 'wyc-002', cardName: 'Luffy OP01 CGC 10', grade: 'CGC 10', color: '#E63946', collectors: [{ username: 'onepiece_au', initials: 'OP', color: '#E63946' }, { username: 'animecards99', initials: 'AC', color: '#3B82F6' }] },
  ],
  forSaleAtEvent: [
    { id: 'fse-001', cardName: 'Umbreon ex SIR', set: 'Prismatic Evolutions', grade: 'PSA 10', askingPrice: 1420, color: '#1A1B4B', sellerUsername: 'cardvaultsydney', sellerVerified: true, booth: 'Booth 12' },
    { id: 'fse-002', cardName: 'Charizard ex', set: 'Obsidian Flames', grade: 'PSA 9', askingPrice: 380, color: '#E0540F', sellerUsername: 'anythingtcg', sellerVerified: true, booth: 'Booth 42', vendorId: 'vendor-001' },
    { id: 'fse-003', cardName: 'Pikachu ex', set: 'SV: 151', grade: 'PSA 10', askingPrice: 310, color: '#FFCC00', sellerUsername: 'sydtradingpost', sellerVerified: true, booth: 'Booth 7', vendorId: 'vendor-002' },
    { id: 'fse-004', cardName: 'Rayquaza VMAX', set: 'Evolving Skies', grade: 'BGS 9.5', askingPrice: 710, color: '#3AE374', sellerUsername: 'melbournetcg', sellerVerified: false, vendorId: 'vendor-003' },
  ],
  trending: [
    { id: 'tr-001', cardName: 'Umbreon ex SIR', set: 'Prismatic Evolutions', grade: 'PSA 10', color: '#1A1B4B', watchers: 48, change: '+12.4%' },
    { id: 'tr-002', cardName: 'Pikachu & Zekrom GX', set: 'Sun & Moon', grade: 'PSA 10', color: '#FFD700', watchers: 31, change: '+8.1%' },
    { id: 'tr-003', cardName: 'Charizard ex', set: 'Obsidian Flames', grade: 'PSA 10', color: '#E0540F', watchers: 27, change: '+5.2%' },
    { id: 'tr-004', cardName: 'Luffy OP01', set: 'Romance Dawn', grade: 'PSA 9', color: '#E63946', watchers: 19, change: '+3.8%' },
  ],
  vendors: [
    {
      id: 'vendor-001',
      name: 'Anything TCG',
      booth: 'Booth 42',
      initials: 'AT',
      avatarColor: '#FF1E2D',
      isVerifiedVendor: true,
      location: 'Sydney, NSW',
      cardsForSale: 284,
      wantedCards: 47,
      tradeAccepted: true,
      rating: 4.9,
      reviewCount: 312,
      topCards: [
        { name: 'Charizard ex PSA 9', grade: 'PSA 9', price: 380, color: '#E0540F' },
        { name: 'Umbreon ex Raw', grade: 'Near Mint', price: 195, color: '#1A1B4B' },
        { name: 'Pikachu ex PSA 10', grade: 'PSA 10', price: 310, color: '#FFCC00' },
      ],
    },
    {
      id: 'vendor-002',
      name: 'Syd Trading Post',
      booth: 'Booth 7',
      initials: 'ST',
      avatarColor: '#22C55E',
      isVerifiedVendor: true,
      location: 'Sydney, NSW',
      cardsForSale: 156,
      wantedCards: 23,
      tradeAccepted: false,
      rating: 4.7,
      reviewCount: 88,
      topCards: [
        { name: 'Pikachu ex PSA 10', grade: 'PSA 10', price: 310, color: '#FFCC00' },
        { name: 'Lugia V SIR Raw', grade: 'Near Mint', price: 82, color: '#B0C4DE' },
      ],
    },
    {
      id: 'vendor-003',
      name: 'PrismaticCards AU',
      booth: 'Booth 19',
      initials: 'PC',
      avatarColor: '#8B5CF6',
      isVerifiedVendor: false,
      location: 'Brisbane, QLD',
      cardsForSale: 93,
      wantedCards: 15,
      tradeAccepted: true,
      rating: 4.5,
      reviewCount: 42,
      topCards: [
        { name: 'Eevee ex SIR PSA 9', grade: 'PSA 9', price: 320, color: '#F5A623' },
        { name: 'Sylveon ex Raw', grade: 'Near Mint', price: 65, color: '#FF9EB5' },
      ],
    },
  ],
};

// ── Looking For / I Have This ─────────────────────────────────────────────────

export interface LookingForResult {
  id: string;
  collectorUsername: string;
  collectorInitials: string;
  collectorColor: string;
  isVerified: boolean;
  grade: string;
  estimatedValue: number;
  type: 'for_sale' | 'for_trade';
  booth?: string;
  section?: string;
}

export const MOCK_LOOKING_FOR_RESULTS: LookingForResult[] = [
  { id: 'lf-001', collectorUsername: 'cardvaultsydney', collectorInitials: 'CS', collectorColor: '#3B82F6', isVerified: true, grade: 'PSA 10', estimatedValue: 1420, type: 'for_sale', booth: 'Booth 12' },
  { id: 'lf-002', collectorUsername: 'anythingtcg', collectorInitials: 'AT', collectorColor: '#FF1E2D', isVerified: true, grade: 'PSA 9', estimatedValue: 880, type: 'for_sale', booth: 'Booth 42' },
  { id: 'lf-003', collectorUsername: 'sydtradingpost', collectorInitials: 'ST', collectorColor: '#22C55E', isVerified: true, grade: 'BGS 9.5', estimatedValue: 1100, type: 'for_trade', section: 'Hall B' },
  { id: 'lf-004', collectorUsername: 'prismatic_priya', collectorInitials: 'PK', collectorColor: '#8B5CF6', isVerified: true, grade: 'CGC 10', estimatedValue: 1380, type: 'for_trade' },
];

export interface IHaveThisResult {
  id: string;
  collectorUsername: string;
  collectorInitials: string;
  collectorColor: string;
  isVerified: boolean;
  hasTradeMatch: boolean;
  wantedGrade: string;
}

export const MOCK_I_HAVE_THIS_RESULTS: IHaveThisResult[] = [
  { id: 'iht-001', collectorUsername: 'cardking_syd', collectorInitials: 'CK', collectorColor: '#8B5CF6', isVerified: true, hasTradeMatch: true, wantedGrade: 'PSA 10' },
  { id: 'iht-002', collectorUsername: 'omarcollects', collectorInitials: 'OC', collectorColor: '#F59E0B', isVerified: false, hasTradeMatch: true, wantedGrade: 'Any Grade' },
  { id: 'iht-003', collectorUsername: 'pikachumax', collectorInitials: 'PM', collectorColor: '#FFCC00', isVerified: true, hasTradeMatch: false, wantedGrade: 'PSA 9+' },
  { id: 'iht-004', collectorUsername: 'onepiece_au', collectorInitials: 'OP', collectorColor: '#E63946', isVerified: false, hasTradeMatch: false, wantedGrade: 'Near Mint+' },
  { id: 'iht-005', collectorUsername: 'sydtradingpost', collectorInitials: 'ST', collectorColor: '#22C55E', isVerified: true, hasTradeMatch: true, wantedGrade: 'PSA 10' },
];

// ── Wanted Board ──────────────────────────────────────────────────────────────

export interface WantedBoardItem {
  id: string;
  collectorUsername: string;
  collectorInitials: string;
  collectorColor: string;
  isVerified: boolean;
  cardName: string;
  set: string;
  grade: string;
  maxBudget?: number;
  color: string;
}

export const MOCK_WANTED_BOARD: WantedBoardItem[] = [
  { id: 'wb-001', collectorUsername: 'omarcollects', collectorInitials: 'OC', collectorColor: '#F59E0B', isVerified: false, cardName: 'Pikachu & Zekrom GX', set: 'Sun & Moon', grade: 'PSA 10', maxBudget: 1300, color: '#FFD700' },
  { id: 'wb-002', collectorUsername: 'cardking_syd', collectorInitials: 'CK', collectorColor: '#8B5CF6', isVerified: true, cardName: 'Umbreon ex SIR', set: 'Prismatic Evolutions', grade: 'TAG 10', color: '#1A1B4B' },
  { id: 'wb-003', collectorUsername: 'pikachumax', collectorInitials: 'PM', collectorColor: '#FFCC00', isVerified: false, cardName: 'Eevee ex SIR', set: 'Prismatic Evolutions', grade: 'PSA 9+', maxBudget: 350, color: '#F5A623' },
  { id: 'wb-004', collectorUsername: 'onepiece_au', collectorInitials: 'OP', collectorColor: '#E63946', isVerified: false, cardName: 'Monkey D. Luffy OP01', set: 'Romance Dawn', grade: 'PSA 10', color: '#E63946' },
  { id: 'wb-005', collectorUsername: 'animecards99', collectorInitials: 'AC', collectorColor: '#3B82F6', isVerified: true, cardName: 'Boa Hancock OP04', set: 'Kingdoms of Intrigue', grade: 'CGC 10', maxBudget: 120, color: '#FF8FAB' },
  { id: 'wb-006', collectorUsername: 'cardvaultsydney', collectorInitials: 'CS', collectorColor: '#3B82F6', isVerified: true, cardName: 'Rayquaza VMAX SIR', set: 'Evolving Skies', grade: 'BGS 9.5+', color: '#3AE374' },
];

// ── Complete My Set ───────────────────────────────────────────────────────────

export interface SetCompletion {
  setName: string;
  setId: string;
  owned: number;
  total: number;
  missingCount: number;
  atThisEvent: number;
  tradeMatches: number;
  marketplaceListings: number;
  color: string;
  missingCards: MissingCard[];
}

export interface MissingCard {
  id: string;
  name: string;
  number: string;
  rarity: string;
  estimatedValue: number;
  color: string;
  availableAtEvent: boolean;
  availableOnMarket: boolean;
}

export const MOCK_SET_COMPLETION: SetCompletion = {
  setName: 'Prismatic Evolutions',
  setId: 'sv-pe',
  owned: 142,
  total: 180,
  missingCount: 38,
  atThisEvent: 18,
  tradeMatches: 7,
  marketplaceListings: 11,
  color: '#8B5CF6',
  missingCards: [
    { id: 'ms-001', name: 'Umbreon ex SIR', number: '161/131', rarity: 'Special Illustration Rare', estimatedValue: 1450, color: '#1A1B4B', availableAtEvent: true, availableOnMarket: true },
    { id: 'ms-002', name: 'Eevee ex SIR', number: '147/131', rarity: 'Special Illustration Rare', estimatedValue: 340, color: '#F5A623', availableAtEvent: true, availableOnMarket: true },
    { id: 'ms-003', name: 'Sylveon ex SIR', number: '163/131', rarity: 'Special Illustration Rare', estimatedValue: 285, color: '#FF9EB5', availableAtEvent: false, availableOnMarket: true },
    { id: 'ms-004', name: 'Jolteon ex SIR', number: '149/131', rarity: 'Special Illustration Rare', estimatedValue: 210, color: '#FFCC00', availableAtEvent: true, availableOnMarket: false },
    { id: 'ms-005', name: 'Flareon ex SIR', number: '148/131', rarity: 'Special Illustration Rare', estimatedValue: 195, color: '#FF6B35', availableAtEvent: false, availableOnMarket: true },
    { id: 'ms-006', name: 'Vaporeon ex SIR', number: '164/131', rarity: 'Special Illustration Rare', estimatedValue: 175, color: '#4A90D9', availableAtEvent: true, availableOnMarket: true },
  ],
};

// ── Card Passport ─────────────────────────────────────────────────────────────

export interface CardPassport {
  cardId: string;
  cardName: string;
  set: string;
  number: string;
  grade: number | string;
  gradingCompany: string;
  certNumber: string;
  gradedAt: string;
  color: string;
  currentOwner: string;
  ownerVerified: boolean;
  population: number;
  purchaseHistory: PassportTransaction[];
  verifiedTCGHistory: PassportEvent[];
}

export interface PassportTransaction {
  id: string;
  date: string;
  type: 'purchase' | 'sale' | 'trade';
  price?: number;
  from?: string;
  to?: string;
  platform: string;
  verifiedOnChain: boolean;
}

export interface PassportEvent {
  id: string;
  date: string;
  description: string;
  type: 'added' | 'listed' | 'traded' | 'graded' | 'verified';
}

export const MOCK_CARD_PASSPORT: CardPassport = {
  cardId: 'umbreon-ex-pe',
  cardName: 'Umbreon ex',
  set: 'Prismatic Evolutions',
  number: '161/131',
  grade: 10,
  gradingCompany: 'PSA',
  certNumber: '88245612',
  gradedAt: '2025-04-15',
  color: '#1A1B4B',
  currentOwner: 'omar_tcg',
  ownerVerified: true,
  population: 847,
  purchaseHistory: [
    { id: 'pt-001', date: '2025-02-18', type: 'purchase', price: 680, from: 'cardvault_au', platform: 'Verified TCG', verifiedOnChain: true },
    { id: 'pt-002', date: '2024-11-30', type: 'sale', price: 620, to: 'cardvault_au', platform: 'Verified TCG', verifiedOnChain: true },
    { id: 'pt-003', date: '2024-09-05', type: 'purchase', price: 420, from: 'auction_house', platform: 'External', verifiedOnChain: false },
  ],
  verifiedTCGHistory: [
    { id: 've-001', date: '2025-02-18', description: 'Added to collection by @omar_tcg', type: 'added' },
    { id: 've-002', date: '2025-04-15', description: 'Graded PSA 10 · Cert #88245612', type: 'graded' },
    { id: 've-003', date: '2026-01-10', description: 'Ownership verified by Verified TCG', type: 'verified' },
    { id: 've-004', date: '2026-07-22', description: 'Listed For Trade at $1,450 AUD', type: 'listed' },
  ],
};

// ── Smart Sell / Smart Trade ──────────────────────────────────────────────────

export interface DemandStats {
  cardName: string;
  totalWant: number;
  exactGradeWant: number;
  atCurrentEvent: number;
  tradeMatchCount: number;
  ownWishlistCount: number;
  atEventTradeCount: number;
}

export const MOCK_SMART_SELL_STATS: DemandStats = {
  cardName: 'Charizard ex (PSA 10)',
  totalWant: 23,
  exactGradeWant: 6,
  atCurrentEvent: 2,
  tradeMatchCount: 18,
  ownWishlistCount: 5,
  atEventTradeCount: 3,
};

// ── Collection Match (for public profiles) ────────────────────────────────────

export interface CollectionMatchSummary {
  cardsYouHaveThatTheyWant: number;
  cardsTheyHaveThatYouWant: number;
  matchCards: {
    youHave: { name: string; grade: string; value: number; color: string }[];
    theyHave: { name: string; grade: string; value: number; color: string }[];
  };
}

export const COLLECTION_MATCH_CARDVAULT: CollectionMatchSummary = {
  cardsYouHaveThatTheyWant: 14,
  cardsTheyHaveThatYouWant: 7,
  matchCards: {
    youHave: [
      { name: 'Charizard ex', grade: 'PSA 10', value: 580, color: '#E0540F' },
      { name: 'Rayquaza VMAX', grade: 'BGS 9.5', value: 890, color: '#3AE374' },
      { name: 'Luffy OP01', grade: 'CGC 10', value: 320, color: '#E63946' },
      { name: 'Pikachu ex', grade: 'Near Mint', value: 45, color: '#FFCC00' },
    ],
    theyHave: [
      { name: 'Umbreon ex SIR', grade: 'PSA 10', value: 1480, color: '#1A1B4B' },
      { name: 'Pikachu & Zekrom GX', grade: 'PSA 10', value: 1200, color: '#FFD700' },
      { name: 'Eevee ex SIR', grade: 'PSA 9', value: 320, color: '#F5A623' },
    ],
  },
};

export const COLLECTION_MATCH_PRIYA: CollectionMatchSummary = {
  cardsYouHaveThatTheyWant: 5,
  cardsTheyHaveThatYouWant: 3,
  matchCards: {
    youHave: [
      { name: 'Charizard ex', grade: 'PSA 10', value: 580, color: '#E0540F' },
      { name: 'Luffy OP01', grade: 'CGC 10', value: 320, color: '#E63946' },
    ],
    theyHave: [
      { name: 'Pikachu ex', grade: 'Near Mint', value: 248, color: '#FFCC00' },
      { name: 'Eevee ex SIR', grade: 'PSA 9', value: 320, color: '#F5A623' },
    ],
  },
};

/** Card-specific passport data. Returns the detailed Umbreon passport for its card ID;
 *  for any other graded card produces a passport seeded from the card's known details. */
export function getCardPassport(cardId: string): CardPassport | null {
  if (cardId === 'umbreon-ex-pe') return MOCK_CARD_PASSPORT;

  // Minimal per-card seed data so each graded card gets a distinct, coherent passport.
  const SEEDS: Record<string, Partial<CardPassport>> = {
    'charizard-ex-ob': {
      cardName: 'Charizard ex', set: 'Obsidian Flames', number: '215/197',
      grade: 10, gradingCompany: 'PSA', certNumber: '77301284', gradedAt: '2024-06-22',
      color: '#E0540F', currentOwner: 'cardvault_au', ownerVerified: true, population: 2341,
    },
    'pikachu-ex-151': {
      cardName: 'Pikachu ex', set: 'SV: 151', number: '172/165',
      grade: 10, gradingCompany: 'CGC', certNumber: '5823917', gradedAt: '2024-02-10',
      color: '#FFCC00', currentOwner: 'pikachumax', ownerVerified: true, population: 1890,
    },
    'rayquaza-vmax-es': {
      cardName: 'Rayquaza VMAX', set: 'Evolving Skies', number: '217/203',
      grade: '9.5', gradingCompany: 'BGS', certNumber: '0013426718', gradedAt: '2023-11-05',
      color: '#3AE374', currentOwner: 'cardking_syd', ownerVerified: false, population: 512,
    },
    'luffy-op01': {
      cardName: 'Monkey D. Luffy', set: 'Romance Dawn', number: 'OP01-060',
      grade: 10, gradingCompany: 'CGC', certNumber: '6201442', gradedAt: '2024-09-18',
      color: '#E63946', currentOwner: 'onepiece_au', ownerVerified: true, population: 344,
    },
  };

  const seed = SEEDS[cardId];
  if (!seed) return null; // ungraded / no passport data — caller should hide entry point

  return {
    cardId,
    cardName: seed.cardName!,
    set: seed.set!,
    number: seed.number!,
    grade: seed.grade!,
    gradingCompany: seed.gradingCompany!,
    certNumber: seed.certNumber!,
    gradedAt: seed.gradedAt!,
    color: seed.color!,
    currentOwner: seed.currentOwner!,
    ownerVerified: seed.ownerVerified!,
    population: seed.population!,
    purchaseHistory: [
      { id: 'pt-g1', date: '2024-03-10', type: 'purchase', price: Math.round((seed.population ?? 500) * 0.6), from: 'prior_owner', platform: 'Verified TCG', verifiedOnChain: true },
      { id: 'pt-g2', date: '2023-08-22', type: 'purchase', price: Math.round((seed.population ?? 500) * 0.4), from: 'auction_house', platform: 'External', verifiedOnChain: false },
    ],
    verifiedTCGHistory: [
      { id: 've-g1', date: seed.gradedAt!, description: `Graded ${seed.gradingCompany} ${seed.grade} · Cert #${seed.certNumber}`, type: 'graded' },
      { id: 've-g2', date: '2025-01-15', description: `Added to collection by @${seed.currentOwner}`, type: 'added' },
      { id: 've-g3', date: '2025-06-01', description: 'Ownership verified by Verified TCG', type: 'verified' },
    ],
  };
}

export function getCollectionMatch(username: string): CollectionMatchSummary | null {
  if (username === 'cardvault_au' || username === 'cardvaultsydney') return COLLECTION_MATCH_CARDVAULT;
  if (username === 'prismatic_collector' || username === 'prismatic_priya') return COLLECTION_MATCH_PRIYA;
  return COLLECTION_MATCH_CARDVAULT; // fallback for any mock profile
}
