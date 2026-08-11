import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import type {
  CollectionItem,
  WatchlistItem,
  PortfolioRange,
  TCGId,
  CollectionFilters,
  MarketFilters,
  User,
  PortfolioSummary,
} from '@/types';
import { MOCK_COLLECTION, MOCK_PORTFOLIO, getItemCurrentValue } from '@/services/collection';
import { MOCK_WATCHLIST, MOCK_USER } from '@/services/profile';

interface AppState {
  user: User | null;
  isAuthenticated: boolean;
  collection: CollectionItem[];
  portfolio: PortfolioSummary;
  collectionFilters: CollectionFilters;
  watchlist: WatchlistItem[];
  portfolioRange: PortfolioRange;
  marketFilters: MarketFilters;
  activeTCG: TCGId | null;
}

interface AppActions {
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  addToCollection: (item: CollectionItem) => void;
  removeFromCollection: (id: string) => void;
  addToWatchlist: (item: WatchlistItem) => void;
  removeFromWatchlist: (id: string) => void;
  setPortfolioRange: (range: PortfolioRange) => void;
  setCollectionFilters: (filters: Partial<CollectionFilters>) => void;
  setMarketFilters: (filters: Partial<MarketFilters>) => void;
  setActiveTCG: (tcg: TCGId | null) => void;
}

type AppContextType = AppState & AppActions;

const AppContext = createContext<AppContextType | null>(null);

const DEFAULT_COLLECTION_FILTERS: CollectionFilters = {
  sortBy: 'value',
  sortOrder: 'desc',
};

const DEFAULT_MARKET_FILTERS: MarketFilters = {
  sortBy: 'popularity',
  sortOrder: 'desc',
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(MOCK_USER);
  const [isAuthenticated, setIsAuthenticated] = useState(true); // mock: pre-authenticated
  const [collection, setCollection] = useState<CollectionItem[]>(MOCK_COLLECTION);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(MOCK_WATCHLIST);
  const [portfolioRange, setPortfolioRange] = useState<PortfolioRange>('7D');
  const [collectionFilters, setCollectionFiltersState] = useState<CollectionFilters>(DEFAULT_COLLECTION_FILTERS);
  const [marketFilters, setMarketFiltersState] = useState<MarketFilters>(DEFAULT_MARKET_FILTERS);
  const [activeTCG, setActiveTCG] = useState<TCGId | null>(null);

  const signIn = useCallback(async (_email: string, _password: string) => {
    await Promise.resolve(); // simulate async
    setUser(MOCK_USER);
    setIsAuthenticated(true);
  }, []);

  const signOut = useCallback(() => {
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  const addToCollection = useCallback((item: CollectionItem) => {
    setCollection(prev => [...prev, item]);
  }, []);

  const removeFromCollection = useCallback((id: string) => {
    setCollection(prev => prev.filter(i => i.id !== id));
  }, []);

  const addToWatchlist = useCallback((item: WatchlistItem) => {
    setWatchlist(prev => [...prev, item]);
  }, []);

  const removeFromWatchlist = useCallback((id: string) => {
    setWatchlist(prev => prev.filter(i => i.id !== id));
  }, []);

  const setCollectionFilters = useCallback((filters: Partial<CollectionFilters>) => {
    setCollectionFiltersState(prev => ({ ...prev, ...filters }));
  }, []);

  const setMarketFilters = useCallback((filters: Partial<MarketFilters>) => {
    setMarketFiltersState(prev => ({ ...prev, ...filters }));
  }, []);

  const portfolio = useMemo<PortfolioSummary>(() => {
    const totalValue = collection.reduce(
      (sum, item) => sum + getItemCurrentValue(item) * item.quantity,
      0,
    );
    const totalCost = collection.reduce(
      (sum, item) => sum + item.acquiredPrice * item.quantity,
      0,
    );
    const totalGain = totalValue - totalCost;
    const totalGainPercent = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
    const cardCount = collection.reduce((sum, item) => sum + item.quantity, 0);
    const uniqueCardCount = new Set(collection.map(item => item.cardId)).size;

    return {
      totalValue,
      totalCost,
      totalGain,
      totalGainPercent,
      currency: 'AUD',
      cardCount,
      uniqueCardCount,
      // Keep static chart history — no real time-series data available in mock
      chartData: MOCK_PORTFOLIO.chartData,
    };
  }, [collection]);

  return (
    <AppContext.Provider
      value={{
        user, isAuthenticated,
        collection, portfolio, collectionFilters,
        watchlist, portfolioRange, marketFilters, activeTCG,
        signIn, signOut,
        addToCollection, removeFromCollection,
        addToWatchlist, removeFromWatchlist,
        setPortfolioRange, setCollectionFilters, setMarketFilters, setActiveTCG,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
