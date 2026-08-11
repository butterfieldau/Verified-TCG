import type { CollectionItem, PortfolioSummary } from '@/types';
import { MOCK_CARDS } from './cards';
import { PORTFOLIO_CHART_DATA } from './market';

export const MOCK_COLLECTION: CollectionItem[] = [
  {
    id: 'col-001', cardId: 'umbreon-ex-pe', card: MOCK_CARDS[1],
    quantity: 1, condition: 'mint',
    grading: { company: 'PSA', grade: 10, certNumber: '88245612', gradedAt: '2025-04-15', population: 847 },
    acquiredAt: '2025-02-18', acquiredPrice: 680, currency: 'AUD',
    notes: 'Alt art — pristine centering', isForSale: false, isForTrade: false,
  },
  {
    id: 'col-002', cardId: 'charizard-ex-ob', card: MOCK_CARDS[0],
    quantity: 1, condition: 'near_mint',
    grading: { company: 'PSA', grade: 10, certNumber: '75839201', gradedAt: '2024-11-03', population: 2341 },
    acquiredAt: '2024-09-12', acquiredPrice: 420, currency: 'AUD',
    isForSale: true,
  },
  {
    id: 'col-003', cardId: 'rayquaza-vmax-es', card: MOCK_CARDS[3],
    quantity: 1, condition: 'mint',
    grading: { company: 'BGS', grade: 9.5, certNumber: '0012984715', gradedAt: '2023-06-28' },
    acquiredAt: '2023-04-10', acquiredPrice: 340, currency: 'AUD',
  },
  {
    id: 'col-004', cardId: 'luffy-op01', card: MOCK_CARDS[8],
    quantity: 1, condition: 'near_mint',
    grading: { company: 'CGC', grade: 10, certNumber: 'CGC-2024-88841', gradedAt: '2024-08-14' },
    acquiredAt: '2024-05-20', acquiredPrice: 180, currency: 'AUD',
    isForTrade: true,
  },
  {
    id: 'col-005', cardId: 'lugia-v-st', card: MOCK_CARDS[4],
    quantity: 1, condition: 'mint',
    acquiredAt: '2023-12-25', acquiredPrice: 78, currency: 'AUD',
  },
  {
    id: 'col-006', cardId: 'pikachu-ex-151', card: MOCK_CARDS[2],
    quantity: 3, condition: 'near_mint',
    acquiredAt: '2024-01-15', acquiredPrice: 35, currency: 'AUD',
  },
];

export const MOCK_PORTFOLIO: PortfolioSummary = {
  totalValue: 24850.40,
  totalCost: 17200.00,
  totalGain: 7650.40,
  totalGainPercent: 44.48,
  currency: 'AUD',
  cardCount: 10,
  uniqueCardCount: 6,
  chartData: PORTFOLIO_CHART_DATA,
};

export function getCollection(): CollectionItem[] {
  return MOCK_COLLECTION;
}

export function getPortfolioSummary(): PortfolioSummary {
  return MOCK_PORTFOLIO;
}

export function getForSaleItems(): CollectionItem[] {
  return MOCK_COLLECTION.filter(i => i.isForSale);
}

export function getForTradeItems(): CollectionItem[] {
  return MOCK_COLLECTION.filter(i => i.isForTrade);
}
