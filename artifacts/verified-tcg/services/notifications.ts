// ── Notification types ────────────────────────────────────────────────────────

export type NotifType = 'price_alert' | 'trade_offer' | 'watchlist' | 'market' | 'verification' | 'system';

export interface Notification {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  isRead: boolean;
  time: string;
  actionLabel?: string;
}

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_NOTIFICATIONS: Notification[] = [
  {
    id: 'n-001',
    type: 'price_alert',
    title: 'Price Alert — Umbreon ex',
    body: 'Umbreon ex (Prismatic Evolutions) has increased 8.4% in the past 24 hours. Current estimated value: $1,285 AUD.',
    isRead: false,
    time: '2m ago',
    actionLabel: 'View Card',
  },
  {
    id: 'n-002',
    type: 'trade_offer',
    title: 'New Trade Offer',
    body: '@cardvault_au sent you a trade offer: Pikachu ex TAG 10 for your Charizard ex PSA 10.',
    isRead: false,
    time: '14m ago',
    actionLabel: 'View Offer',
  },
  {
    id: 'n-003',
    type: 'watchlist',
    title: 'Watchlist — Card Listed',
    body: 'A Charizard ex (Obsidian Flames) PSA 10 was just listed for $550 AUD — close to your target of $500.',
    isRead: false,
    time: '1h ago',
    actionLabel: 'View Listing',
  },
  {
    id: 'n-004',
    type: 'market',
    title: 'Recent Sale Recorded',
    body: 'A Pikachu ex (SV: 151) sold for $248 AUD — 6.2% below the last recorded sale price.',
    isRead: true,
    time: '3h ago',
  },
  {
    id: 'n-005',
    type: 'verification',
    title: 'Seller Verification Approved',
    body: 'Your Verified Seller application has been reviewed. Your account has been granted Verified Seller status.',
    isRead: true,
    time: '2d ago',
  },
  {
    id: 'n-006',
    type: 'price_alert',
    title: 'Price Alert — Pikachu ex',
    body: 'Pikachu ex (SV: 151) has dropped 3.1% this week. Current estimated value: $248 AUD.',
    isRead: true,
    time: '2d ago',
    actionLabel: 'View Card',
  },
  {
    id: 'n-007',
    type: 'system',
    title: 'Welcome to Verified TCG',
    body: 'Your account is set up and ready to go. Start by scanning your first card or browsing the market.',
    isRead: true,
    time: '7d ago',
  },
];

// ── Service helpers ───────────────────────────────────────────────────────────

export function getNotifications(): Notification[] {
  return MOCK_NOTIFICATIONS;
}
