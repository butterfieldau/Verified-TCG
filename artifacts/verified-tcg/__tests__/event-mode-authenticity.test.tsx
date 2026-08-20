/**
 * Event Mode authenticity tests
 *
 * These tests verify that the Event Mode entry screen never fabricates event
 * state: a failed events fetch renders an explicit, retryable "unavailable"
 * state (no selected event, no LIVE claim), and an empty (but successful)
 * response renders a truthful "no events" state.
 *
 * Heavy native deps (router, safe-area, icons, colors, app context, events
 * API) are mocked so the real screen logic is exercised in isolation.
 *
 * IMPORTANT: avoid JSX inside jest.mock factories (parsed before transform).
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@expo/vector-icons', () => ({
  Feather: () => null,
}));

jest.mock('@/constants/colors', () => ({
  __esModule: true,
  default: {
    dark: {
      background: '#000', card: '#111', foreground: '#fff', border: '#333',
      primary: '#CC1826', primaryForeground: '#fff', mutedForeground: '#888',
      muted: '#222', positive: '#22C55E', negative: '#EF4444',
    },
  },
}));

jest.mock('@/context/AppContext', () => ({
  useApp: jest.fn(),
}));

jest.mock('@/services/eventsApi', () => ({
  fetchActiveEvents: jest.fn(),
  joinEvent: jest.fn(),
  leaveEvent: jest.fn(),
  fetchMyParticipation: jest.fn(),
  fetchTradeMatches: jest.fn(),
}));

// ── Import under test (after mocks) ──────────────────────────────────────────

import { useApp } from '@/context/AppContext';
import {
  fetchActiveEvents,
  fetchMyParticipation,
  fetchTradeMatches,
} from '@/services/eventsApi';
import EventModeScreen from '../app/event-mode';

// ── Helpers ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  (useApp as jest.Mock).mockReturnValue({
    watchlist: [],
    subscriptionTier: 'free',
    isAuthenticated: true,
    setCurrentEventId: jest.fn(),
  });
  (fetchMyParticipation as jest.Mock).mockResolvedValue({ isParticipating: false });
  (fetchTradeMatches as jest.Mock).mockResolvedValue({ matchCount: 0, matches: [], isProRequired: false });
});

async function renderScreen(): Promise<renderer.ReactTestRenderer> {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<EventModeScreen />);
  });
  // flush the pending events promise + effects
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return tree;
}

function collectText(node: any, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach(n => collectText(n, out)); return out; }
  if (node.children) collectText(node.children, out);
  return out;
}

function allText(tree: renderer.ReactTestRenderer): string {
  return collectText(tree.toJSON() as any).join(' ');
}

const LIVE_EVENT = {
  id: 'ev-1', name: 'TCXPO Sydney 2026', venue: 'Sydney Olympic Park',
  city: 'Sydney, NSW', eventDate: 'Aug 15–17, 2026', isActive: true,
  status: 'live', participantCount: 42,
};

const UPCOMING_EVENT = { ...LIVE_EVENT, id: 'ev-2', status: 'upcoming', participantCount: 7 };

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Event Mode — fetch failure shows retryable unavailable state', () => {
  it('renders an explicit unavailable state and no LIVE claim when events fail to load', async () => {
    (fetchActiveEvents as jest.Mock).mockRejectedValue(new Error('network down'));
    const tree = await renderScreen();
    const text = allText(tree);
    expect(text).toContain('Events Unavailable');
    expect(text).toContain('Try Again');
    // No fabricated live-event claim or participant count.
    expect(text).not.toContain('LIVE');
    expect(text).not.toMatch(/collectors registered/);
  });
});

describe('Event Mode — empty success shows truthful no-events state', () => {
  it('renders a "No Active Events" state with no selected event', async () => {
    (fetchActiveEvents as jest.Mock).mockResolvedValue([]);
    const tree = await renderScreen();
    const text = allText(tree);
    expect(text).toContain('No Active Events');
    expect(text).not.toContain('Enter Event Mode');
  });
});

describe('Event Mode — status labels use real EventSummary.status', () => {
  it('shows LIVE for a live event', async () => {
    (fetchActiveEvents as jest.Mock).mockResolvedValue([LIVE_EVENT]);
    const tree = await renderScreen();
    const text = allText(tree);
    expect(text).toContain('LIVE');
    // participant count and label render as separate text nodes
    expect(text).toContain('42');
    expect(text).toContain('collectors registered');
  });

  it('shows UPCOMING (not LIVE) for an upcoming event', async () => {
    (fetchActiveEvents as jest.Mock).mockResolvedValue([UPCOMING_EVENT]);
    const tree = await renderScreen();
    const text = allText(tree);
    expect(text).toContain('UPCOMING');
    // The hero badge must not assert LIVE for a non-live event.
    expect(text).not.toMatch(/\bLIVE\b/);
    expect(text).toContain('7');
    expect(text).toContain('collectors registered');
  });
});

describe('Event Mode — entry card advertises only backed capabilities', () => {
  it('describes participation-based matching without unsupported vendor, board, or set claims', async () => {
    (fetchActiveEvents as jest.Mock).mockResolvedValue([LIVE_EVENT]);
    const tree = await renderScreen();
    const text = allText(tree);

    expect(text).toContain('trade matches from collectors participating in this event');
    expect(text).toContain('wishlist and For Trade cards');
    expect(text).not.toContain('Browse vendor inventory');
    expect(text).not.toContain('Post to the Wanted Board');
    expect(text).not.toContain('Track set completion');
    expect(text).not.toContain('on the floor in real time');
  });
});

describe('Event Mode — joined dashboard exposes only backed capabilities', () => {
  it('does not render navigation to legacy mock matching screens', async () => {
    (fetchActiveEvents as jest.Mock).mockResolvedValue([LIVE_EVENT]);
    (fetchMyParticipation as jest.Mock).mockResolvedValue({
      isParticipating: true,
      joinedAt: '2026-08-19T09:00:00.000Z',
      leftAt: null,
      isVisible: true,
    });

    const tree = await renderScreen();
    const text = allText(tree);

    expect(text).not.toContain("I'm Looking For");
    expect(text).not.toContain('I Have This');
    expect(text).not.toContain('Wanted Board');
    expect(text).not.toContain('Complete My Set');
  });
});
