/** Standard 2.5 × 3.5 inch trading-card proportions. */
export const TRADING_CARD_ASPECT_RATIO = 3.5 / 2.5;

export function tradingCardHeight(width: number): number {
  return width * TRADING_CARD_ASPECT_RATIO;
}

/** Physical cards have a subtle corner radius of roughly 4.5% of their width. */
export function tradingCardRadius(width: number): number {
  return Math.max(4, width * 0.045);
}