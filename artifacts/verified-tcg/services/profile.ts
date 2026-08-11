import type { User, WatchlistItem } from '@/types';
import { MOCK_CARDS } from './cards';

export const MOCK_USER: User = {
  id: 'usr-001',
  username: 'omar_tcg',
  displayName: 'Omar',
  email: 'omar@example.com',
  bio: 'Collector since 2018. Pokémon, One Piece & MTG. Always looking for high grade hits.',
  location: 'Sydney, NSW',
  joinedAt: '2024-01-15',
  isVerifiedSeller: true,
  tcgPreferences: ['pokemon', 'onepiece', 'magic'],
  stats: {
    collectionCount: 127,
    collectionValue: 24850.40,
    listingsCount: 3,
    tradesCount: 18,
    rating: 4.9,
    reviewCount: 67,
  },
};

export const MOCK_WATCHLIST: WatchlistItem[] = [
  {
    id: 'wl-001', cardId: 'charizard-ex-ob', card: MOCK_CARDS[0],
    targetPrice: 500, addedAt: '2026-07-15', priceAlertEnabled: true,
  },
  {
    id: 'wl-002', cardId: 'pikachu-ex-151', card: MOCK_CARDS[2],
    targetPrice: 280, addedAt: '2026-07-28', priceAlertEnabled: true,
  },
  {
    id: 'wl-003', cardId: 'luffy-op01', card: MOCK_CARDS[8],
    addedAt: '2026-08-01', priceAlertEnabled: false,
  },
];

export function getCurrentUser(): User {
  return MOCK_USER;
}

export function getWatchlist(): WatchlistItem[] {
  return MOCK_WATCHLIST;
}
