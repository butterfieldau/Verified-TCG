/**
 * Pro gate component tests
 *
 * Tests the ScanLimitBanner — the primary pro-gate component in the app — which
 * renders nothing for Pro users, an inline counter for low-scan Free users,
 * and an upgrade prompt when all scans are exhausted.
 *
 * useApp is mocked to control subscription state without mounting the full
 * AppProvider.  This exercises the real ScanLimitBanner conditional logic.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/context/AppContext', () => ({
  useApp: jest.fn(),
}));

// @expo/vector-icons uses native modules — replace with a no-op function
jest.mock('@expo/vector-icons', () => ({
  Feather: () => null,
}));

// ProFeaturePreview has its own heavy native deps — replace with a View that
// carries a testID so tests can detect whether it was rendered.
// IMPORTANT: avoid JSX inside jest.mock factories (parsed before transform).
jest.mock('@/components/ui/ProFeaturePreview', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function MockProFeaturePreview(props: any) {
    return React.createElement('View', { testID: 'pro-feature-preview' });
  }
  return { __esModule: true, default: MockProFeaturePreview };
});

jest.mock('@/constants/colors', () => ({
  dark: {
    surface: '#1a1a1a',
    border: '#333',
    mutedForeground: '#888',
    warning: '#f59e0b',
  },
}));

jest.mock('@/services/subscription', () => ({
  SCAN_LIMIT_BANNER_THRESHOLD: 0.8,
  FREE_SCAN_LIMIT: 30,
  FREE_ALERT_LIMIT: 3,
}));

// ── Import under test (after mocks) ──────────────────────────────────────────

import { useApp } from '@/context/AppContext';
import ScanLimitBanner from '../components/ui/ScanLimitBanner';

// ── Helpers ───────────────────────────────────────────────────────────────────

const RESET_DATE = new Date('2026-09-01');

function setAppState(state: {
  subscriptionTier: 'free' | 'pro';
  scansUsed: number;
  scanLimit: number;
  scanResetDate: Date;
}) {
  (useApp as jest.Mock).mockReturnValue(state);
}

function renderBanner(): renderer.ReactTestRenderer {
  let tree!: renderer.ReactTestRenderer;
  act(() => { tree = renderer.create(<ScanLimitBanner />); });
  return tree;
}

function findByTestId(
  node: renderer.ReactTestRendererJSON | renderer.ReactTestRendererJSON[] | null,
  testId: string,
): renderer.ReactTestRendererJSON | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findByTestId(n, testId);
      if (r) return r;
    }
    return null;
  }
  if ((node as renderer.ReactTestRendererJSON).props?.testID === testId) {
    return node as renderer.ReactTestRendererJSON;
  }
  for (const child of ((node as renderer.ReactTestRendererJSON).children ?? [])) {
    if (typeof child !== 'string') {
      const r = findByTestId(child as renderer.ReactTestRendererJSON, testId);
      if (r) return r;
    }
  }
  return null;
}

// ── Pro user tests ────────────────────────────────────────────────────────────

describe('ScanLimitBanner — Pro user is never shown the banner', () => {
  it('renders null for Pro users with 30 scans', () => {
    setAppState({ subscriptionTier: 'pro', scansUsed: 30, scanLimit: 30, scanResetDate: RESET_DATE });
    const tree = renderBanner();
    expect(tree.toJSON()).toBeNull();
  });

  it('renders null for Pro users with 0 scans', () => {
    setAppState({ subscriptionTier: 'pro', scansUsed: 0, scanLimit: 30, scanResetDate: RESET_DATE });
    const tree = renderBanner();
    expect(tree.toJSON()).toBeNull();
  });

  it('renders null for Pro users at any usage level', () => {
    for (const used of [1, 10, 25, 29, 30]) {
      setAppState({ subscriptionTier: 'pro', scansUsed: used, scanLimit: 30, scanResetDate: RESET_DATE });
      expect(renderBanner().toJSON()).toBeNull();
    }
  });
});

// ── Free user — below threshold ───────────────────────────────────────────────

describe('ScanLimitBanner — Free user below threshold (< 80%)', () => {
  it('renders nothing at 0 scans used', () => {
    setAppState({ subscriptionTier: 'free', scansUsed: 0, scanLimit: 30, scanResetDate: RESET_DATE });
    expect(renderBanner().toJSON()).toBeNull();
  });

  it('renders nothing at 23/30 scans (76% — below threshold)', () => {
    setAppState({ subscriptionTier: 'free', scansUsed: 23, scanLimit: 30, scanResetDate: RESET_DATE });
    expect(renderBanner().toJSON()).toBeNull();
  });
});

// ── Free user — warning zone (≥ 80%, not exhausted) ──────────────────────────

describe('ScanLimitBanner — Free user in warning zone (≥ 80% but scans remain)', () => {
  it('renders the banner at 25/30 scans (83%)', () => {
    setAppState({ subscriptionTier: 'free', scansUsed: 25, scanLimit: 30, scanResetDate: RESET_DATE });
    expect(renderBanner().toJSON()).not.toBeNull();
  });

  it('renders the banner at 29/30 scans', () => {
    setAppState({ subscriptionTier: 'free', scansUsed: 29, scanLimit: 30, scanResetDate: RESET_DATE });
    expect(renderBanner().toJSON()).not.toBeNull();
  });

  it('does NOT show the upgrade prompt (ProFeaturePreview) when scans remain', () => {
    setAppState({ subscriptionTier: 'free', scansUsed: 27, scanLimit: 30, scanResetDate: RESET_DATE });
    const tree = renderBanner();
    expect(findByTestId(tree.toJSON(), 'pro-feature-preview')).toBeNull();
  });
});

// ── Free user — exhausted (0 scans remaining) ─────────────────────────────────

describe('ScanLimitBanner — Free user exhausted (0 scans remaining)', () => {
  it('renders the upgrade prompt (ProFeaturePreview) when all 30 scans are used', () => {
    setAppState({ subscriptionTier: 'free', scansUsed: 30, scanLimit: 30, scanResetDate: RESET_DATE });
    const tree = renderBanner();
    expect(findByTestId(tree.toJSON(), 'pro-feature-preview')).not.toBeNull();
  });

  it('renders something (not null) when exhausted', () => {
    setAppState({ subscriptionTier: 'free', scansUsed: 30, scanLimit: 30, scanResetDate: RESET_DATE });
    expect(renderBanner().toJSON()).not.toBeNull();
  });
});
