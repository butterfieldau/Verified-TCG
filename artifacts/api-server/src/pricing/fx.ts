/**
 * Server-attributed FX converter using Frankfurter (https://www.frankfurter.app).
 *
 * - Caches rates for 24 hours.
 * - No illustrative fallback: if conversion unavailable, returns null.
 * - Never fabricates rates.
 */
import { logger } from "../lib/logger.js";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface RateCache {
  base: string;
  rates: Record<string, number>;
  fetchedAt: number;
}

// Cache keyed by base currency
const rateCache = new Map<string, RateCache>();

/**
 * Get the exchange rate from `from` to `to`.
 * Returns null if conversion is unavailable (network error, unknown pair, etc.).
 * Never throws.
 */
export async function getExchangeRate(from: string, to: string): Promise<number | null> {
  if (from === to) return 1;

  const cached = rateCache.get(from);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    const rate = cached.rates[to];
    return rate != null && rate > 0 ? rate : null;
  }

  try {
    const res = await fetch(
      `https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}`,
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) {
      logger.warn({ status: res.status, from }, "Frankfurter FX fetch failed");
      return null;
    }
    const json = (await res.json()) as { base?: string; rates?: Record<string, number> };
    if (!json.rates || typeof json.rates !== "object") {
      logger.warn({ from }, "Frankfurter FX response missing rates");
      return null;
    }

    rateCache.set(from, {
      base: from,
      rates: json.rates,
      fetchedAt: Date.now(),
    });

    const rate = json.rates[to];
    return rate != null && rate > 0 ? rate : null;
  } catch (err) {
    logger.warn({ err, from, to }, "Frankfurter FX request error");
    return null;
  }
}

/**
 * Convert an amount in minor units from one currency to another.
 * Returns null if the rate is unavailable.
 *
 * @param amountCents - amount in minor units (integer cents)
 * @param from        - source ISO 4217 currency code
 * @param to          - target ISO 4217 currency code
 */
export async function convertCents(
  amountCents: number,
  from: string,
  to: string,
): Promise<number | null> {
  if (from === to) return amountCents;
  const rate = await getExchangeRate(from, to);
  if (rate == null) return null;
  return Math.round(amountCents * rate);
}

/**
 * Build a conversion provenance object for response payloads.
 */
export function buildConversionProvenance(
  originalCurrency: string,
  displayCurrency: string,
  rate: number | null,
) {
  if (originalCurrency === displayCurrency) return undefined;
  if (rate == null) {
    return {
      originalCurrency,
      displayCurrency,
      available: false as const,
      message: "FX rate unavailable — original currency preserved",
    };
  }
  return {
    originalCurrency,
    displayCurrency,
    rate,
    available: true as const,
    source: "frankfurter",
  };
}

/** Force-expire all cached rates (for testing). */
export function clearFxCache(): void {
  rateCache.clear();
}
