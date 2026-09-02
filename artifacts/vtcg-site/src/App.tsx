import { useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import LandingPage from '@/pages/landing';
import PrivacyPolicy from '@/pages/privacy';
import SubscriptionTerms from '@/pages/subscription-terms';
import CollectorWishlistPage from '@/pages/collector-wishlist';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';
import { buildSiteUrl } from '@/lib/public-config';
import { isPublicWishlistPath, PUBLIC_ROUTES } from '@/lib/public-routes';

const queryClient = new QueryClient();

function Router() {
  const [location] = useLocation();
  usePageMetadata(location);
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path={PUBLIC_ROUTES.home} component={LandingPage} />
        <Route path={PUBLIC_ROUTES.privacy} component={PrivacyPolicy} />
        <Route path={PUBLIC_ROUTES.subscriptionTerms} component={SubscriptionTerms} />
        <Route path={PUBLIC_ROUTES.wishlistPattern} component={CollectorWishlistPage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

const DEFAULT_DESCRIPTION =
  'Verified TCG helps collectors scan cards, track collections, review pricing evidence, and find relevant trades.';

function usePageMetadata(location: string): void {
  useEffect(() => {
    const isWishlist = isPublicWishlistPath(location);
    const title =
      location === PUBLIC_ROUTES.privacy
        ? 'Privacy Policy | Verified TCG'
        : location === PUBLIC_ROUTES.subscriptionTerms
          ? 'Subscription Terms | Verified TCG'
          : isWishlist
            ? 'Public Wishlist | Verified TCG'
            : 'Verified TCG | Collection and Trade Tools';
    const description = isWishlist
      ? 'View a collector wishlist when its owner has made it public on Verified TCG.'
      : DEFAULT_DESCRIPTION;
    const canonical = buildSiteUrl(location);

    document.title = title;
    setMeta('meta[name="description"]', 'content', description);
    setMeta('meta[property="og:title"]', 'content', title);
    setMeta('meta[property="og:description"]', 'content', description);
    setMeta('meta[property="og:url"]', 'content', canonical);
    setMeta('meta[name="twitter:title"]', 'content', title);
    setMeta('meta[name="twitter:description"]', 'content', description);
    setMeta('link[rel="canonical"]', 'href', canonical);
  }, [location]);
}

function setMeta(selector: string, attribute: string, value: string): void {
  document.querySelector(selector)?.setAttribute(attribute, value);
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
