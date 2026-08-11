import type { Listing } from '@/types';
import { MOCK_CARDS } from './cards';

export const MOCK_LISTINGS: Listing[] = [
  {
    id: 'lst-001', sellerId: 'usr-042', sellerName: 'CardVaultAU', sellerRating: 4.9,
    isVerifiedSeller: true, card: MOCK_CARDS[1],
    grading: { company: 'PSA', grade: 10, certNumber: '88123456', gradedAt: '2025-05-10', population: 847 },
    askingPrice: 1480, currency: 'AUD', listedAt: '2026-08-08T10:00:00Z',
    condition: 'mint', shippingNotes: 'Registered post with tracking. Fully insured.',
    description: 'Pristine PSA 10 Umbreon ex alt art. Centering 60/40. Full cert verification included.',
    watchCount: 47, views: 892,
  },
  {
    id: 'lst-002', sellerId: 'usr-089', sellerName: 'PrismaticCards', sellerRating: 4.7,
    isVerifiedSeller: true, card: MOCK_CARDS[0],
    grading: { company: 'PSA', grade: 10, certNumber: '75100823', gradedAt: '2024-10-22' },
    askingPrice: 595, currency: 'AUD', listedAt: '2026-08-09T14:30:00Z',
    condition: 'mint', watchCount: 28, views: 441,
  },
  {
    id: 'lst-003', sellerId: 'usr-015', sellerName: 'Melbourne_TCG', sellerRating: 4.5,
    isVerifiedSeller: false, card: MOCK_CARDS[8],
    askingPrice: 52, currency: 'AUD', listedAt: '2026-08-10T08:00:00Z',
    condition: 'near_mint', watchCount: 12, views: 178,
  },
  {
    id: 'lst-004', sellerId: 'usr-203', sellerName: 'PokeInvestorAU', sellerRating: 5.0,
    isVerifiedSeller: true, card: MOCK_CARDS[3],
    grading: { company: 'BGS', grade: 9.5, certNumber: '0099812345', gradedAt: '2023-07-15' },
    askingPrice: 720, currency: 'AUD', listedAt: '2026-08-07T11:00:00Z',
    condition: 'mint', description: 'BGS 9.5 — low pop for BGS graded copies. Perfect for investors.',
    watchCount: 34, views: 621,
  },
];

export function getListings(): Listing[] {
  return MOCK_LISTINGS;
}

export function getListingById(id: string): Listing | undefined {
  return MOCK_LISTINGS.find(l => l.id === id);
}
