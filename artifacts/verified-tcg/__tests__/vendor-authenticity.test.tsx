import React from 'react';
import renderer, { act } from 'react-test-renderer';

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
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
      background: '#000',
      card: '#111',
      foreground: '#fff',
      border: '#333',
      primary: '#CC1826',
      primaryForeground: '#fff',
      mutedForeground: '#888',
      muted: '#222',
    },
  },
}));

import VendorProfileScreen from '../app/vendor/[id]';

function collectText(node: any, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectText(child, out));
    return out;
  }
  if (node.children) collectText(node.children, out);
  return out;
}

describe('Vendor profile authenticity', () => {
  it('shows a truthful unavailable state without fabricated vendor claims', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<VendorProfileScreen />);
    });

    const text = collectText(tree.toJSON()).join(' ');
    expect(text).toContain('Vendor Details Unavailable');
    expect(text).toContain('does not currently receive event vendor profiles');
    expect(text).toContain(
      'Booth details, inventory, wanted cards, prices, ratings, and verification results are not shown',
    );
    expect(text).not.toContain('Verified Vendor');
    expect(text).not.toContain('cards available');
    expect(text).not.toMatch(/\$\d/);
  });
});