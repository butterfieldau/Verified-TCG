jest.mock('../services/auth', () => ({
  getAccessToken: jest.fn(() => Promise.resolve('fake-access-token')),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

import { commitImport, previewImport, resolveImport } from '../services/collectionImport';

beforeEach(() => {
  mockFetch.mockReset();
});

describe('collection import service', () => {
  it('previews CSV content with the signed-in collector token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jobId: 'job-1',
        source: 'collectr',
        schemaVersion: 1,
        contentSha256: 'a'.repeat(64),
        summary: {
          total: 1, matched: 1, watchlistOnly: 0, invalid: 0,
          ambiguous: 0, unmatched: 0, duplicate: 0, priced: 0,
        },
        rows: [],
      }),
    } as Response);

    await previewImport({
      content: 'header\\nrow',
      filename: 'collectr.csv',
      sourceCurrency: 'USD',
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/collection/import/preview');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer fake-access-token');
    expect(JSON.parse(init.body as string)).toEqual({
      content: 'header\\nrow',
      filename: 'collectr.csv',
      sourceCurrency: 'USD',
    });
  });

  it('commits the fingerprint and selected acquisition currency', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jobId: 'job-1',
        status: 'committed',
        summary: {
          holdingsAdded: 1, wishlistAdded: 0, skipped: 0,
          duplicates: 0, unsupportedGrades: 0,
        },
        rows: [],
      }),
    } as Response);

    await commitImport('job-1', {
      contentSha256: 'b'.repeat(64),
      sourceCurrency: 'AUD',
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/collection/import/job-1/commit');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      contentSha256: 'b'.repeat(64),
      sourceCurrency: 'AUD',
    });
  });

  it('submits hash-bound ambiguous row decisions', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        jobId: 'job-1',
        source: 'collectr',
        schemaVersion: 1,
        contentSha256: 'c'.repeat(64),
        summary: {
          total: 2, matched: 1, watchlistOnly: 0, invalid: 0,
          ambiguous: 0, unmatched: 1, duplicate: 0, priced: 0,
        },
        rows: [],
      }),
    } as Response);

    await resolveImport('job-1', 'c'.repeat(64), [
      { rowNumber: 2, cardId: 'provider-card-1' },
      { rowNumber: 3, cardId: null },
    ]);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/collection/import/job-1/resolve');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      contentSha256: 'c'.repeat(64),
      resolutions: [
        { rowNumber: 2, cardId: 'provider-card-1' },
        { rowNumber: 3, cardId: null },
      ],
    });
  });
});