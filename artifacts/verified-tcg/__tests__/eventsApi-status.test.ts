/**
 * eventsApi.fetchActiveEvents contract tests
 *
 * The Home banner and Event Mode labels rely on the real `status` field
 * ('live' | 'upcoming') returned by GET /api/events. These tests lock in that
 * the client passes the API's status through untouched, so consumer screens
 * can label LIVE vs UPCOMING truthfully instead of inferring from mock data.
 */
import { fetchActiveEvents } from '../services/eventsApi';

describe('fetchActiveEvents — surfaces the real status field', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.verified.test';
  });

  afterEach(() => {
    // @ts-expect-error test cleanup
    delete global.fetch;
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
  });

  it('passes through live and upcoming statuses from the API', async () => {
    const apiPayload = [
      {
        id: 'ev-live', name: 'TCXPO Sydney 2026', venue: 'Sydney Olympic Park',
        city: 'Sydney, NSW', eventDate: 'Aug 15–17, 2026', isActive: true,
        status: 'live', eventModeEnabled: true, participantCount: 42,
      },
      {
        id: 'ev-soon', name: 'Melbourne TCG Fest', venue: 'MCEC',
        city: 'Melbourne, VIC', eventDate: 'Sep 20–21, 2026', isActive: true,
        status: 'upcoming', eventModeEnabled: true, participantCount: 3,
      },
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => apiPayload,
    }) as unknown as typeof fetch;

    const events = await fetchActiveEvents();

    expect(events).toHaveLength(2);
    expect(events[0].status).toBe('live');
    expect(events[0].participantCount).toBe(42);
    expect(events[1].status).toBe('upcoming');
    expect(events[1].participantCount).toBe(3);
  });

  it('rejects on a non-OK response rather than returning fabricated data', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: () => 'application/json' },
      json: async () => ({ message: 'Service unavailable' }),
    }) as unknown as typeof fetch;

    await expect(fetchActiveEvents()).rejects.toThrow('Service unavailable');
  });
});
