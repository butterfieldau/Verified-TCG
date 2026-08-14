/**
 * Currency formatting utilities.
 *
 * Formats price values using the collector's stored currency preference.
 * All prices in the app are stored in AUD; when another currency is selected,
 * approximate conversion rates are applied for display purposes.
 *
 * Note: These are illustrative exchange rates for UI display only.
 * Production would call a live rates API.
 */
import type { CurrencyCode } from '@/services/settingsStore';

export interface CurrencyConfig {
  code: CurrencyCode;
  symbol: string;
  locale: string;
  /** Approximate rate from AUD (1 AUD = X of this currency) */
  rateFromAUD: number;
}

export const CURRENCY_CONFIGS: Record<CurrencyCode, CurrencyConfig> = {
  AUD: { code: 'AUD', symbol: 'A$', locale: 'en-AU', rateFromAUD: 1.0 },
  USD: { code: 'USD', symbol: '$',  locale: 'en-US', rateFromAUD: 0.65 },
  GBP: { code: 'GBP', symbol: '£',  locale: 'en-GB', rateFromAUD: 0.51 },
  EUR: { code: 'EUR', symbol: '€',  locale: 'de-DE', rateFromAUD: 0.59 },
  CAD: { code: 'CAD', symbol: 'C$', locale: 'en-CA', rateFromAUD: 0.88 },
  NZD: { code: 'NZD', symbol: 'NZ$',locale: 'en-NZ', rateFromAUD: 1.08 },
};

/**
 * Format a price value (stored in AUD) for display in the selected currency.
 *
 * @param audValue - The price value in AUD
 * @param currency - The display currency code
 * @param compact  - If true, use compact notation for large values (e.g. "A$1.2k")
 */
export function formatPrice(
  audValue: number,
  currency: CurrencyCode = 'AUD',
  compact = false,
): string {
  const config = CURRENCY_CONFIGS[currency];
  const converted = audValue * config.rateFromAUD;

  if (compact && converted >= 1000) {
    const k = converted / 1000;
    return `${config.symbol}${k.toFixed(1)}k`;
  }

  const formatted = converted.toLocaleString(config.locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  return `${config.symbol}${formatted}`;
}

/**
 * Format a price with full currency code label (e.g. "A$1,234 AUD").
 */
export function formatPriceWithCode(audValue: number, currency: CurrencyCode = 'AUD'): string {
  return `${formatPrice(audValue, currency)} ${currency}`;
}

/**
 * Get just the currency symbol for a given code.
 */
export function getCurrencySymbol(currency: CurrencyCode = 'AUD'): string {
  return CURRENCY_CONFIGS[currency].symbol;
}

export const CURRENCY_OPTIONS: { code: CurrencyCode; label: string; flag: string }[] = [
  { code: 'AUD', label: 'Australian Dollar', flag: '🇦🇺' },
  { code: 'USD', label: 'US Dollar',         flag: '🇺🇸' },
  { code: 'GBP', label: 'British Pound',     flag: '🇬🇧' },
  { code: 'EUR', label: 'Euro',              flag: '🇪🇺' },
  { code: 'CAD', label: 'Canadian Dollar',   flag: '🇨🇦' },
  { code: 'NZD', label: 'New Zealand Dollar',flag: '🇳🇿' },
];
