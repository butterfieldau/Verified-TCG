export const PUBLIC_ROUTES = {
  home: "/",
  privacy: "/privacy",
  subscriptionTerms: "/subscription-terms",
  wishlistPattern: "/c/:username/wishlist",
} as const;

export function publicWishlistPath(username: string): string {
  return `/c/${encodeURIComponent(username)}/wishlist`;
}

export function isPublicWishlistPath(path: string): boolean {
  return /^\/c\/[^/]+\/wishlist$/.test(path);
}