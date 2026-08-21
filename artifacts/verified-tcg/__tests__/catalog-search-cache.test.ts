process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.test';

const {
  CatalogSearchRequestGate,
  searchCatalog,
  normalizeCatalogQuery,
} = require('@/services/catalogApi') as typeof import('@/services/catalogApi');

function response(data: unknown) {
  return { ok: true, json: async () => ({ data, meta: { hasMore: false } }) } as Response;
}

describe('catalog search reuse', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn(async () => response([{ id: 'card-1' }]));
  });

  it('normalizes equivalent input and shares the one in-flight request', async () => {
    const fetchMock = global.fetch as jest.Mock;
    const [a, b] = await Promise.all([
      searchCatalog('  Charizard   V ', undefined, 1),
      searchCatalog('charizard v', undefined, 1),
    ]);

    expect(normalizeCatalogQuery('  Charizard   V ')).toBe('charizard v');
    expect(a.data).toHaveLength(1);
    expect(b.data).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not request the catalogue for a one-character typing input', async () => {
    const fetchMock = global.fetch as jest.Mock;
    const result = await searchCatalog('c');

    expect(result.data).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reuses an already-seen normalized search page', async () => {
    const fetchMock = global.fetch as jest.Mock;
    await searchCatalog('Pikachu');
    await searchCatalog(' pikachu ');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an obsolete search failure after a newer search has succeeded', () => {
    const gate = new CatalogSearchRequestGate();
    const firstRequest = gate.start();
    const secondRequest = gate.start();

    // In the screen, state changes from a completion are only applied when
    // this guard is true. A late failure from the first request cannot wipe
    // the second request's successful results or loading state.
    expect(gate.isCurrent(secondRequest)).toBe(true);
    expect(gate.isCurrent(firstRequest)).toBe(false);
  });
});