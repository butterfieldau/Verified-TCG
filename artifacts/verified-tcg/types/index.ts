// ── TCG Ecosystems ────────────────────────────────────────────────────────────

export type TCGId =
  | 'pokemon'
  | 'magic'
  | 'onepiece'
  | 'yugioh'
  | 'lorcana'
  | 'dragonball';

export interface TCG {
  id: TCGId;
  name: string;
  shortName: string;
  accentColor: string;
}

export const TCG_LIST: TCG[] = [
  { id: 'pokemon',     name: 'Pokémon',                shortName: 'PKM', accentColor: '#FFCC00' },
  { id: 'magic',       name: 'Magic: The Gathering',   shortName: 'MTG', accentColor: '#3B82F6' },
  { id: 'onepiece',    name: 'One Piece TCG',          shortName: 'OP',  accentColor: '#EF4444' },
  { id: 'yugioh',      name: 'Yu-Gi-Oh!',              shortName: 'YGO', accentColor: '#7C3AED' },
  { id: 'lorcana',     name: 'Disney Lorcana',         shortName: 'LOR', accentColor: '#F59E0B' },
  { id: 'dragonball',  name: 'Dragon Ball Super',      shortName: 'DBS', accentColor: '#F97316' },
];

// ── Grading ───────────────────────────────────────────────────────────────────

export type GradingCompany = 'PSA' | 'BGS' | 'CGC' | 'Beckett' | 'Raw';

export type CardCondition =
  | 'mint'
  | 'near_mint'
  | 'excellent'
  | 'good'
  | 'light_played'
  | 'played'
  | 'poor';

export const CONDITION_LABELS: Record<CardCondition, string> = {
  mint: 'Mint',
  near_mint: 'Near Mint',
  excellent: 'Excellent',
  good: 'Good',
  light_played: 'Light Played',
  played: 'Played',
  poor: 'Poor',
};

export type VerificationStatus = 'verified' | 'suspicious' | 'counterfeit' | 'unverified';

export type CardRarity =
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'holo_rare'
  | 'ultra_rare'
  | 'secret_rare'
  | 'special_illustration'
  | 'hyper_rare';

export const RARITY_LABELS: Record<CardRarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  holo_rare: 'Holo Rare',
  ultra_rare: 'Ultra Rare',
  secret_rare: 'Secret Rare',
  special_illustration: 'Special Illustration Rare',
  hyper_rare: 'Hyper Rare',
};

export interface GradingRecord {
  company: GradingCompany;
  grade: number | string;
  certNumber: string;
  gradedAt: string; // ISO date
  population?: number; // pop report count
}

// ── Pricing ───────────────────────────────────────────────────────────────────

export interface PriceRecord {
  raw: number;
  /** True only when raw is backed by a verified provider quote. */
  available?: boolean;
  psa9?: number;
  psa10?: number;
  bgs9?: number;
  bgs95?: number;
  cgc9?: number;
  cgc10?: number;
  currency: string;
  /** Null means the source did not provide a price quote timestamp. */
  updatedAt: string | null;
  change24h?: number;  // percentage
  change7d?: number;
  change30d?: number;
}

// ── Card & Set ────────────────────────────────────────────────────────────────

export interface CardSet {
  id: string;
  name: string;
  tcg: TCGId;
  releaseDate: string;
  totalCards: number;
  series?: string;
}

export interface Card {
  id: string;
  name: string;
  setId: string;
  setName: string;
  tcg: TCGId;
  number: string;
  rarity: CardRarity;
  year: number;
  imageUrl?: string;
  gradientStart: string;
  gradientEnd: string;
  price: PriceRecord;
  verificationStatus?: VerificationStatus;
  isHolo?: boolean;
  isFoil?: boolean;
  language?: string;
  description?: string;
}

// ── Collection ────────────────────────────────────────────────────────────────

export interface CollectionItem {
  id: string;
  cardId: string;
  card: Card;
  quantity: number;
  condition: CardCondition;
  grading?: GradingRecord;
  acquiredAt: string;
  acquiredPrice: number;
  currency: string;
  valuation?: {
    priceCents: number;
    price: number;
    currency: string;
    gradeKey: string;
    updatedAt: string;
  } | null;
  notes?: string;
  isForSale?: boolean;
  isForTrade?: boolean;
}

/** Alert types supported by the current price-monitoring model. */
export type PriceAlertType = 'price-drop' | 'price-rise';

export interface WatchlistItem {
  id: string;
  cardId: string;
  card: Card;
  desiredGrade?: string;
  targetPrice?: number;
  addedAt: string;
  priceAlertEnabled?: boolean;
  /** Which condition triggers the alert; defaults to 'price-drop' when omitted. */
  alertType?: PriceAlertType;
}

// ── User & Profile ────────────────────────────────────────────────────────────

export interface User {
  id: string;
  username: string;
  displayName: string;
  email: string;
  avatarUrl?: string | null;
  bio?: string;
  location?: string;
  joinedAt: string;
  isVerifiedSeller?: boolean;
  tcgPreferences: TCGId[];
  // Extended profile
  favouriteTcg?: string | null;
  collectorSince?: string | null; // "YYYY-MM"
  profilePublic?: boolean;
  showCollection?: boolean;
  showWishlist?: boolean;
  showForTrade?: boolean;
  showForSale?: boolean;
  stats: {
    collectionCount: number;
    collectionValue: number;
    listingsCount: number;
    tradesCount: number;
    rating?: number;
    reviewCount?: number;
  };
}

// ── Listings & Trades ─────────────────────────────────────────────────────────

export interface Listing {
  id: string;
  sellerId: string;
  sellerName: string;
  sellerRating?: number;
  isVerifiedSeller: boolean;
  card: Card;
  grading?: GradingRecord;
  askingPrice: number;
  currency: 'AUD';
  listedAt: string;
  condition: CardCondition;
  shippingNotes?: string;
  description?: string;
  watchCount: number;
  views: number;
}

export interface Trade {
  id: string;
  initiatorId: string;
  receiverId: string;
  initiatorCards: CollectionItem[];
  receiverCards: CollectionItem[];
  cashComponent?: number;
  currency?: 'AUD';
  status: 'pending' | 'accepted' | 'rejected' | 'completed' | 'cancelled';
  message?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Notifications ─────────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  type: 'price_alert' | 'listing_sold' | 'trade_offer' | 'verification' | 'system';
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  actionUrl?: string;
}

// ── Portfolio ─────────────────────────────────────────────────────────────────

export interface PortfolioDataPoint {
  date: string;
  value: number;
}

export type PortfolioRange = '1D' | '7D' | '1M' | '3M' | '1Y' | 'ALL';

export interface PortfolioSummary {
  totalValue: number;
  totalCost: number;
  totalGain: number;
  totalGainPercent: number;
  currency: 'AUD';
  cardCount: number;
  uniqueCardCount: number;
  chartData: Record<PortfolioRange, PortfolioDataPoint[]>;
}

// ── Market ────────────────────────────────────────────────────────────────────

export interface MarketMover {
  card: Card;
  currentPrice: number;
  priceChange: number;
  priceChangePercent: number;
  trend: 'up' | 'down' | 'neutral';
  /** Currency supplied by the persisted price snapshot. */
  currency: string;
  /** Timestamp of the latest comparable snapshot. */
  updatedAt: string;
  volume?: number;
}

// ── Filters ───────────────────────────────────────────────────────────────────

export type SearchCategory = 'cards' | 'sets' | 'sealed' | 'users';

export interface CollectionFilters {
  tcg?: TCGId;
  graded?: boolean;
  forSale?: boolean;
  sortBy: 'value' | 'name' | 'added' | 'grade';
  sortOrder: 'asc' | 'desc';
}

export interface MarketFilters {
  tcg?: TCGId;
  gradingCompany?: GradingCompany;
  minPrice?: number;
  maxPrice?: number;
  condition?: CardCondition;
  sortBy: 'price' | 'date' | 'popularity';
  sortOrder: 'asc' | 'desc';
}
