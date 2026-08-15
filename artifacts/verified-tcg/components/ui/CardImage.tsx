import React from 'react';
import { Image, type ImageContentFit } from 'expo-image';
import type { StyleProp, ImageStyle } from 'react-native';
import { resizeTcgPlayerUrl } from '@/services/catalogApi';
import { proxyImageUrl } from '@/services/imageProxy';

/**
 * Soft, card-back-like blurhash used as the placeholder for every card image.
 * It renders as a muted blue-grey blur that fills the card frame instantly,
 * then crossfades into the real art — no spinner, no flash of white/black.
 */
export const CARD_BACK_BLURHASH = 'L35O#0_zNb9C4=NbxYIp9YR*xtxu';

export interface CardImageProps {
  /** Raw CDN image URL (TCGPlayer / pokemontcg.io / etc.). */
  uri: string | undefined | null;
  /**
   * Target render width in px — used to request an appropriately-sized
   * variant from the TCGPlayer CDN. Defaults to 437 (thumbnail tier).
   */
  resizeWidth?: number;
  style?: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
  /** Crossfade duration in ms from blurhash → real art. Default 300. */
  transition?: number;
  /** Override the blurhash placeholder (or pass null to disable). */
  placeholder?: string | null;
  onError?: () => void;
  onLoad?: () => void;
  accessibilityLabel?: string;
}

/**
 * The single image primitive for rendering card art.
 *
 * Wraps expo-image with:
 *  - memory + disk caching (repeat visits load with zero network wait)
 *  - blurhash placeholder that fills the frame with a soft colored blur
 *  - a smooth crossfade from blur to art
 *  - the app's CDN-resize and web image-proxy URL helpers
 */
export function CardImage({
  uri,
  resizeWidth = 437,
  style,
  contentFit = 'contain',
  transition = 300,
  placeholder = CARD_BACK_BLURHASH,
  onError,
  onLoad,
  accessibilityLabel,
}: CardImageProps) {
  if (!uri) return null;
  const resolved = proxyImageUrl(resizeTcgPlayerUrl(uri, resizeWidth) ?? uri);
  return (
    <Image
      source={{ uri: resolved }}
      style={style}
      contentFit={contentFit}
      cachePolicy="disk"
      transition={transition}
      placeholder={placeholder ? { blurhash: placeholder } : undefined}
      placeholderContentFit="cover"
      onError={onError}
      onLoad={onLoad}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
