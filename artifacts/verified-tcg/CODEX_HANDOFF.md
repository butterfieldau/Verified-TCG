# Verified TCG — Codex Handoff Document

This document explains the architecture, decisions, and next steps for continuing Verified TCG development in Codex. Read this before making any significant changes.

---

## What This Project Is

Verified TCG is a React Native / Expo mobile application for trading card collectors. This repository is a **UI/UX prototype** — a production-structured frontend with mock data. The purpose was to establish the design language, component architecture, and screen flows before building the real backend.

**Platform target:** iOS first, then Android. Web via Expo web is functional but not the priority.

**Domain:** verifiedtcg.co

---

## Architecture Overview

```
Expo Router (file-based navigation)
    │
    ├── Stack navigator (root _layout.tsx)
    │       └── Tab navigator ((tabs)/_layout.tsx)
    │
AppProvider (React Context)
    │
    ├── AppState  (user, collection, watchlist, portfolio, filters)
    └── AppActions (signIn, signOut, addToCollection, addToWatchlist, etc.)
         │
         └── Services layer (services/)
                  │
                  └── Mock data (replace with real API calls)
```

The pattern is: **Screen → AppContext → Service function → Mock data**. When connecting real APIs, only the service functions need to change — screens consume the same shape of data.

---

## Navigation Architecture

Expo Router handles all routing via the `app/` directory structure.

### Tab Routes

```
app/(tabs)/
  index.tsx       → Home
  market.tsx      → Market
  scan.tsx        → Scan (elevated in tab bar)
  collection.tsx  → Collection
  profile.tsx     → Profile
```

### Stack Routes (pushed on top of tabs or as modals)

| Route | File | Presentation |
|---|---|---|
| `/card/:id` | `app/card/[id].tsx` | Push (slide right) |
| `/search` | `app/search.tsx` | Fade |
| `/add-card` | `app/add-card.tsx` | Modal (slide up) |
| `/settings` | `app/settings.tsx` | Push |
| `/portfolio` | `app/portfolio.tsx` | Push |
| `/sell` | `app/sell.tsx` | Modal (slide up) |
| `/trade` | `app/trade.tsx` | Modal (slide up) |
| `/watchlist` | `app/watchlist.tsx` | Push |
| `/notifications` | `app/notifications.tsx` | Push |
| `/verification-info` | `app/verification-info.tsx` | Push |
| `/collector/:username` | `app/collector/[username].tsx` | Push |

### Navigation from code

```typescript
import { router } from 'expo-router';

router.push('/portfolio');
router.push(`/card/${cardId}`);
router.push(`/collector/cardvault_au`);
router.back();
```

---

## Theme System

**Never hardcode hex values in screen files.** All colours come from `constants/colors.ts`.

```typescript
import colors from '@/constants/colors';
const C = colors.dark; // Always use dark theme for now

// Usage
C.background      // #0A0A0A — app background
C.foreground      // #FFFFFF — primary text
C.card            // #1A1A1A — card surfaces
C.muted           // #2A2A2A — secondary surfaces
C.mutedForeground // #888888 — secondary text
C.primary         // #FF1E2D — red accent, CTAs
C.positive        // #22C55E — price up, verified
C.negative        // #FF1E2D — price down
C.warning         // #F59E0B — alerts, caution
C.border          // #2A2A2A — dividers
```

**Light mode:** The colour file has a `light` key but the app always uses `dark`. Light mode support is stubbed for future use.

**Grading accent colours:**
```typescript
C.gradeAccents.psa   // #FF1E2D
C.gradeAccents.bgs   // #D4AF37
C.gradeAccents.cgc   // #4A90D9
C.gradeAccents.beckett // #8B5CF6
```

### Typography

```typescript
fontFamily: 'Rajdhani_700Bold'   // Screen titles, large headings
fontFamily: 'Inter_700Bold'      // Subheadings, values, prices
fontFamily: 'Inter_600SemiBold'  // Labels, buttons, tab text
fontFamily: 'Inter_500Medium'    // Secondary labels
fontFamily: 'Inter_400Regular'   // Body text, descriptions
```

Fonts are loaded in `app/_layout.tsx` via `@expo-google-fonts/inter` and `@expo-google-fonts/rajdhani`.

---

## Component System

### UI Primitives (`components/ui/`)

| Component | Props | Purpose |
|---|---|---|
| `Button` | `variant`, `label`, `onPress`, `loading`, `disabled` | All pressable buttons |
| `Badge` / `StatusBadge` / `GradeBadge` | `label`, `color`, `variant` | Inline badge chips |
| `CardThumbnail` | `card`, `grading`, `compact` | Card image with grade overlay |
| `Chip` | `label`, `active`, `onPress` | Filter chip |
| `EmptyState` | `icon`, `title`, `description`, `actionLabel`, `onAction` | Empty screen state |
| `ErrorState` | `title`, `description`, `onRetry` | Error screen state |
| `Input` | `label`, `error`, `...TextInputProps` | Form text input |
| `SkeletonLoader` | `width`, `height`, `borderRadius` | Placeholder shimmer |

### Shared Components

- `Logo` — Brand logo, accepts `variant` and `width/height`
- `ErrorBoundary` — Wraps entire app, catches JS errors

---

## Mock Services

The `services/` directory is the **only place that should know about data sources**. Screens never import raw mock arrays directly (except in a few legacy spots that should be refactored).

### How to replace a mock with a real API

Example — `services/cards.ts`:

```typescript
// Current (mock)
export function getCardById(id: string): Card | undefined {
  return MOCK_CARDS.find(c => c.id === id);
}

// Future (real API)
export async function getCardById(id: string): Promise<Card | undefined> {
  const response = await supabase.from('cards').select('*').eq('id', id).single();
  return response.data ?? undefined;
}
```

Screens use TanStack Query hooks that call these service functions — the query hooks absorb the async/loading/error states so screens stay clean.

### Current Mock Data

| Service | Cards/items |
|---|---|
| `services/cards.ts` | 10 cards, 10 sets across Pokémon, MTG, One Piece |
| `services/collection.ts` | 6 collection items, 1 portfolio summary |
| `services/listings.ts` | 4 marketplace listings |
| `services/market.ts` | 6 market movers, chart data generator |
| `services/profile.ts` | 1 user (omar_tcg), 3 watchlist items |

---

## State Management

**React Context** (`context/AppContext.tsx`) manages all global UI state.

### What's in AppContext

```typescript
// State
user: User | null
isAuthenticated: boolean
collection: CollectionItem[]
portfolio: PortfolioSummary
watchlist: WatchlistItem[]
portfolioRange: PortfolioRange  // '1D' | '7D' | '1M' | '3M' | '1Y' | 'ALL'
collectionFilters: CollectionFilters
marketFilters: MarketFilters
activeTCG: TCGId | null

// Actions
signIn(email, password) → Promise<void>
signOut()
addToCollection(item: CollectionItem)
removeFromCollection(id: string)
addToWatchlist(item: WatchlistItem)
removeFromWatchlist(id: string)
setPortfolioRange(range: PortfolioRange)
setCollectionFilters(filters: Partial<CollectionFilters>)
setMarketFilters(filters: Partial<MarketFilters>)
setActiveTCG(tcg: TCGId | null)
```

### What's Fake in AppContext

- Authentication now restores a Supabase session and starts unauthenticated when no valid session exists.
- `portfolio` is static from `MOCK_PORTFOLIO` — does not recompute from `collection` changes
- `signIn()` calls Supabase email/password authentication and maps the returned user into the current profile shape.

When connecting Supabase Auth, replace the auth actions in AppContext and recalculate `portfolio` from the real collection.

---

## TypeScript Models

All interfaces are in `types/index.ts`. Key types:

```typescript
Card           // card metadata + price
CardSet        // set metadata
CollectionItem // card as owned by a user (with grading, price paid, etc.)
WatchlistItem  // watched card with target price and alert flag
Listing        // marketplace listing with seller info
Trade          // trade offer with initiator/receiver cards
Notification   // notification with type, body, read state
User           // user profile with stats
PortfolioSummary // aggregated value/gain with chart data
GradingRecord  // grade, company, cert number, population
PriceRecord    // multi-grade prices in AUD with change percentages
```

**TCG IDs:** `'pokemon' | 'magic' | 'onepiece' | 'yugioh' | 'lorcana' | 'dragonball'`

**Grading companies:** `'PSA' | 'BGS' | 'CGC' | 'Beckett' | 'Raw'`

The `TCG_LIST` and `CONDITION_LABELS` / `RARITY_LABELS` constants in `types/index.ts` are the source of truth for display names — do not hardcode TCG names or condition labels in screen files.

---

## What's Fake / Prototype-Only

Be clear with users and stakeholders about these limitations:

| Feature | Reality |
|---|---|
| Authentication | Pre-authenticated. No real session or token. |
| Collection | Session-only. Cleared on reload. |
| Portfolio value | Static mock number, not computed from real prices. |
| Scanner | No real camera access or AI. Simulated result only. |
| Sell flow | No listing is created. Mock completion only. |
| Trade offers | No real trade system. Mock send only. |
| Notifications | Static array. No push infrastructure. |
| Price data | Made-up numbers. Not real market data. |
| Verification badges | Mock status field. No real verification process. |
| Marketplace | Static listings. Cannot actually buy anything. |

---

## Important Technical Decisions

### Why Expo Router (not React Navigation)?

Expo Router is file-based and aligns with the eventual GitHub/Codex workflow. It also makes deep linking and web support simpler. The routing structure mirrors a real product's information architecture.

### Why React Context (not Zustand/Redux)?

The prototype scope doesn't justify a third-party state library. Context is sufficient for the number of consumers and update frequency. When the app scales to a real product with complex server state, consider Zustand for client-only state and TanStack Query for server state (already installed).

### Why AUD as the only currency?

The target market is Australia-first. The architecture supports adding more currencies later — `PriceRecord.currency` is typed as `'AUD'` but can be widened to a union. Currency conversion logic belongs in the service layer.

### Dark mode only for now

The `colors.ts` file has both `light` and `dark` keys, but the app reads `colors.dark` everywhere. This was an intentional prototype decision. When adding light mode, components need to read `useColorScheme()` and select the correct token set via `useColors` hook.

### Web support

The app runs on Expo web but with degraded experience (no camera, some native animations differ). The web build is primarily used for development previewing in Replit. iOS/Android are the real targets.

---

## Technical Debt

- `portfolio` in AppContext is not reactive — changes to `collection` (e.g. adding a card) don't update the portfolio value display on Home/Collection. This needs a `useMemo` computation or server-side calculation.
- Some screens import mock data directly (e.g. `SEALED_PRODUCTS`, `SET_PROGRESS` in `collection.tsx`) rather than going through a service function. These should be moved to `services/collection.ts`.
- The `collectors/[username].tsx` screen has inline mock data for public profiles. This should be moved to a `services/collectors.ts` file.
- `notifications.tsx` has inline mock data. Should be moved to `services/notifications.ts`.
- No real form validation on auth screens (sign-in, create-account). TanStack Form or react-hook-form recommended when connecting real auth.
- `card/[id].tsx` uses `MOCK_LISTINGS` to show listings for a card — it doesn't filter correctly by card ID (shows all listings). Fix when connecting real data.

---

## Next Recommended Development Steps

### Phase 1 — Authentication & Persistence (highest priority)

1. Set up Supabase project
2. Connect Supabase Auth (email + Apple + Google via `expo-auth-session`)
3. Create database schema: `users`, `collection_items`, `watchlist_items`
4. Wire `services/collection.ts` and `services/profile.ts` to Supabase
5. Make portfolio value compute from real collection

### Phase 2 — Card Database

1. Integrate a card data source (TCGplayer API, Pokémon TCG API, Scryfall)
2. Populate `services/cards.ts` with real data
3. Replace gradient placeholders with real card image URLs
4. Connect search to a real search index (Typesense or Supabase full-text)

### Phase 3 — Marketplace

1. Create `listings` table in Supabase
2. Wire sell flow to create real listings
3. Build listing detail screen (buyer view)
4. Add buy / checkout flow (Stripe)
5. Seller dashboard (manage listings, track sales)

### Phase 4 — Live Prices

1. Choose price data source (TCGplayer API or aggregator)
2. Create price update pipeline (scheduled function or webhook)
3. Wire market movers, card detail prices, and portfolio value to live data
4. Implement real price alerts (Supabase realtime or push notification trigger)

### Phase 5 — Scanner

1. Integrate camera permission handling (`expo-camera`)
2. Choose card recognition approach (custom TFLite model or cloud API)
3. Connect scan result to real card database lookup

### Phase 6 — Trades & Notifications

1. Create `trade_offers` table
2. Build trade inbox screen
3. Set up push notification infrastructure (Expo Notifications + FCM + APNs)
4. Wire price alert subscriptions to push notifications

---

## Running the Project

```bash
# From repo root
pnpm install
pnpm --filter @workspace/verified-tcg run dev
```

This project is a pnpm workspace monorepo. The Verified TCG app lives in `artifacts/verified-tcg/`.

---

## Key Contacts / Context

- The product is **Verified TCG** targeting Australian TCG collectors
- Primary TCGs: Pokémon, One Piece, Magic: The Gathering (architecture supports more)
- Design aesthetic: Apple × StockX × modern fintech (not gaming/esports)
- Red (`#FF1E2D`) is the accent — use it sparingly (CTAs, verification, selection)
- All prices displayed in AUD
- Privacy: never show another user's portfolio value or cost basis on their public profile
