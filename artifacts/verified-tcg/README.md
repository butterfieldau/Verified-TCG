# Verified TCG — Frontend Prototype

**COLLECT. VERIFY. TRADE.**

[verifiedtcg.co](https://verifiedtcg.co)

---

## Overview

Verified TCG is a modern trading card platform for collectors, traders, investors, buyers and sellers across multiple TCG ecosystems. This repository contains the initial **UI/UX frontend prototype** — a high-quality, production-structured React Native / Expo application that establishes the design language, navigation, screens, and component architecture for the product.

This is **not** a production application. It uses mock data and prototype interactions. The codebase is structured so that real APIs and backend systems can be connected later without redesigning the app.

---

## Technology

| Technology | Version | Purpose |
|---|---|---|
| React Native | 0.76+ | Mobile framework |
| Expo (SDK 52) | 52.x | Cross-platform tooling |
| Expo Router | 4.x | File-based navigation |
| TypeScript | 5.x | Type safety |
| TanStack Query | 5.x | Data-fetching layer (wired to mock services now) |
| @expo/vector-icons | Feather | Icons |
| expo-google-fonts | Inter, Rajdhani | Typography |
| react-native-safe-area-context | — | Safe area handling |
| react-native-gesture-handler | — | Gesture support |

---

## Folder Structure

```
artifacts/verified-tcg/
├── app/                          # Expo Router screens (file-based routing)
│   ├── _layout.tsx               # Root layout — fonts, providers, stack config
│   ├── index.tsx                 # Entry redirect (→ splash or tabs)
│   ├── splash.tsx                # Animated splash/launch screen
│   ├── welcome.tsx               # Welcome screen with sign-in/create account
│   ├── onboarding.tsx            # 3-screen onboarding flow
│   ├── sign-in.tsx               # Sign in screen
│   ├── create-account.tsx        # Create account screen
│   ├── forgot-password.tsx       # Forgot password screen
│   ├── search.tsx                # Global search (cards, sets, sealed, users)
│   ├── add-card.tsx              # Add card to collection (modal)
│   ├── settings.tsx              # Settings screen
│   ├── portfolio.tsx             # Dedicated portfolio view with allocation charts
│   ├── verification-info.tsx     # Verification badge types explanation screen
│   ├── sell.tsx                  # 7-step sell flow (modal)
│   ├── trade.tsx                 # Trade offer comparison UI (modal)
│   ├── watchlist.tsx             # Watchlist page with price targets & alerts
│   ├── notifications.tsx         # Notification centre
│   ├── (tabs)/                   # Bottom tab screens
│   │   ├── _layout.tsx           # Tab bar configuration
│   │   ├── index.tsx             # Home screen
│   │   ├── market.tsx            # Market / price movements
│   │   ├── scan.tsx              # Scanner UI
│   │   ├── collection.tsx        # My collection
│   │   └── profile.tsx           # My profile
│   ├── card/
│   │   └── [id].tsx              # Card detail screen (dynamic route)
│   └── collector/
│       └── [username].tsx        # Public collector profile (dynamic route)
│
├── components/
│   ├── ErrorBoundary.tsx         # Top-level error boundary
│   ├── ErrorFallback.tsx         # Error fallback UI
│   ├── Logo.tsx                  # Brand logo component
│   ├── KeyboardAwareScrollViewCompat.tsx
│   └── ui/                       # Reusable primitive components
│       ├── Badge.tsx             # Status, grade, and verification badges
│       ├── Button.tsx            # Primary, secondary, ghost buttons
│       ├── CardThumbnail.tsx     # Card image with grade overlay
│       ├── Chip.tsx              # Filter chip
│       ├── EmptyState.tsx        # Empty state with icon, text, CTA
│       ├── ErrorState.tsx        # Error state with retry action
│       ├── Input.tsx             # Text input with label/error
│       └── SkeletonLoader.tsx    # Skeleton loading placeholders
│
├── constants/
│   └── colors.ts                 # Central design tokens (palette, radius, all colours)
│
├── context/
│   └── AppContext.tsx            # Global app state (React Context)
│
├── hooks/
│   └── useColors.ts              # Theme-aware colour hook
│
├── services/                     # Mock service layer (replace with real APIs later)
│   ├── cards.ts                  # Card and set mock data + lookup helpers
│   ├── collection.ts             # Collection and portfolio mock data
│   ├── listings.ts               # Marketplace listings mock data
│   ├── market.ts                 # Market movers, trending, chart data
│   └── profile.ts                # User profile and watchlist mock data
│
├── types/
│   └── index.ts                  # All TypeScript interfaces and enums
│
└── assets/
    └── images/                   # App icon, logos
```

---

## How to Run Locally

### Prerequisites

- Node.js 20+
- pnpm 9+
- Expo Go app (iOS/Android) or iOS Simulator / Android emulator

### Install dependencies

```bash
pnpm install
```

### Start the development server

```bash
pnpm --filter @workspace/verified-tcg run dev
```

Then:
- Scan the QR code with **Expo Go** to run on a real device
- Press `i` for iOS Simulator, `a` for Android emulator
- Press `w` for a web preview (limited native features)

---

## Design System

### Brand Colours

| Token | Value | Usage |
|---|---|---|
| `primary` | `#FF1E2D` | CTAs, selected state, verification accent |
| `background` | `#0A0A0A` | App background |
| `card` / `surface` | `#1A1A1A` | Card surfaces |
| `foreground` | `#FFFFFF` | Primary text |
| `muted` | `#2A2A2A` | Secondary surfaces |
| `mutedForeground` | `#888888` | Secondary text |
| `positive` | `#22C55E` | Price up, verified |
| `negative` | `#FF1E2D` | Price down, destructive |
| `warning` | `#F59E0B` | Alerts, warnings |

All tokens are defined in `constants/colors.ts`. Never hardcode hex values in screen files — always import from `colors`.

### Typography

- **Display / Titles**: Rajdhani 700 (brand feel, uppercase-friendly)
- **Body / UI**: Inter (400, 500, 600, 700)

### Design Principles

- Dark-first interface (Apple × StockX × fintech aesthetic)
- Red used sparingly: CTAs, verification, selected states, market highlights
- Generous whitespace, strong typography hierarchy
- Minimal borders, subtle shadows
- No excessive gradients or glassmorphism

---

## Navigation

Five primary tabs (bottom navigation):

| Tab | Route | Purpose |
|---|---|---|
| Home | `(tabs)/index` | Portfolio overview, market movers, quick actions |
| Market | `(tabs)/market` | Price movements, trending, movers |
| Scan | `(tabs)/scan` | Card scanner UI |
| Collection | `(tabs)/collection` | Personal card collection |
| Profile | `(tabs)/profile` | User profile, watchlist, menu |

The **Scan** tab is visually elevated in the tab bar.

Additional stack screens: Card Detail, Search, Add Card, Settings, Portfolio, Sell, Trade, Watchlist, Notifications, Collector Profile, Verification Info.

---

## Mock Services

All data is served from `services/`. Each file exports mock arrays and helper functions that match the shape real APIs will use.

| Service | Key exports |
|---|---|
| `services/cards.ts` | `MOCK_CARDS`, `CARD_SETS`, `getCardById()`, `searchCards()` |
| `services/collection.ts` | `MOCK_COLLECTION`, `MOCK_PORTFOLIO`, `getCollection()` |
| `services/listings.ts` | `MOCK_LISTINGS`, `getListings()`, `getListingById()` |
| `services/market.ts` | `getMarketMovers()`, `getTrendingCards()`, `getChartData()` |
| `services/profile.ts` | `MOCK_USER`, `MOCK_WATCHLIST`, `getWatchlist()` |

When connecting real APIs, replace the return value inside each helper — **screen code should not need to change**.

---

## Currently Completed Screens

### Auth & Onboarding
- Splash / launch screen (animated)
- Welcome screen
- 3-screen onboarding
- Sign In, Create Account, Forgot Password

### Core App
- Home (portfolio overview, market movers, quick actions, trending)
- Market (TCG filter, movers, trending, most watched)
- Scanner (camera UI, simulated scan result)
- Collection (grid/list view, tabs: Cards / Sealed / Sets / Graded)
- Card Detail (price history chart, grading options, marketplace listings, collection actions)
- Global Search (cards, sets, sealed, users)
- Add Card (manual entry flow)
- Settings

### Supporting Flows
- Portfolio (allocation charts by TCG, condition, grading company, value tier)
- Verification Info (all 4 badge types explained with careful non-guarantee wording)
- Sell Flow (7-step: select → details → condition → price → photos → preview → publish)
- Trade Offer (you-offer vs they-offer comparison, value difference, send offer)
- Watchlist (wired to session state, sortable, empty state)
- Notifications Centre (price alerts, trade offers, watchlist, market, verification types)
- Public Collector Profile (privacy-respecting, tabs: collection / for sale / activity / about)
- Profile (own profile, menu navigation, watchlist preview)

---

## Prototype Limitations

- **All data is mocked.** No real card database, prices, or user accounts exist.
- **Auth requires configuration.** Supabase email/password auth is wired, but the public environment variables must be configured before sign-in works.
- **Scanner is UI-only.** No real camera permission or card recognition.
- **Sell/Trade flows are mock.** No real listings or trades are created.
- **Notifications are static.** No real push notification infrastructure.
- **Portfolio values are fixed.** No live price feed.
- **Prices are in AUD** (currency selection in Settings is UI-only).
- **Card images are placeholder** (gradient backgrounds with initials). Real image URLs can be supplied via `card.imageUrl`.

---

## Future API Integration Points

Each service function is the integration boundary:

| Function | Future integration |
|---|---|
| `getCardById(id)` | Supabase / card database API |
| `searchCards(query)` | Full-text search API (e.g. Typesense) |
| `getMarketMovers()` | Price aggregation service |
| `getCollection()` | User collection API (per-authenticated-user) |
| `getWatchlist()` | Watchlist API with real-time price alert subscriptions |
| Authentication flow | Supabase Auth (Apple / Google / Email) |
| Scan result | Card recognition AI / image matching API |
| Listings | Real marketplace backend |
| Trade offers | Trade management backend |
| Notifications | Push notification service (FCM / APNs) |

---

## Known TODOs

- [ ] Real card images (replace gradient placeholders)
- [ ] Supabase Auth integration
- [ ] Real card database + search API
- [ ] Live price feed
- [ ] Camera permission + card recognition
- [ ] Real marketplace listing creation
- [ ] Trade backend
- [ ] Push notifications
- [ ] Payment / checkout flow (Stripe)
- [ ] Admin / moderation panel
- [ ] Tablet layout optimisation
- [ ] Accessibility audit
