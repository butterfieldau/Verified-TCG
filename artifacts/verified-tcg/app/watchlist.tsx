/**
 * Legacy /watchlist route — redirects to the new /wishlist screen.
 * Kept so that any deep links or bookmarks using the old path still work.
 */
import { useEffect } from 'react';
import { router } from 'expo-router';

export default function WatchlistRedirect() {
  useEffect(() => {
    // Replace rather than push so the back button doesn't loop back here
    router.replace('/wishlist' as any);
  }, []);

  return null;
}
