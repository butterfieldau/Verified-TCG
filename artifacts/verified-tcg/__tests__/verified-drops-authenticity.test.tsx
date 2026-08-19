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
      mutedForeground: '#888',
      muted: '#222',
    },
  },
}));

import VerifiedDropsScreen from '../app/verified-drops';

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

describe('Verified Drops authenticity', () => {
  it('does not fabricate published drops or collector entry actions', () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<VerifiedDropsScreen />);
    });

    const text = collectText(tree.toJSON()).join(' ');
    expect(text).toContain('Drop Feed Unavailable');
    expect(text).toContain('does not currently have a consumer data source');
    expect(text).not.toContain('Enter Drop');
    expect(text).not.toContain('active');
    expect(text).not.toContain('Ends in');
  });
});