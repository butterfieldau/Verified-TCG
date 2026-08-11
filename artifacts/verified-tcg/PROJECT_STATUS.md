# Verified TCG — Project Status

Last updated: August 2026

This document tracks the current state of every feature area for handoff to Codex. Status labels are honest — do not treat PROTOTYPE ONLY as production-ready.

---

## COMPLETED

These features are fully designed, implemented, and working within the prototype.

- App launch / splash screen (animated logo reveal)
- 3-screen onboarding flow
- Sign In screen (UI complete, mock auth)
- Create Account screen (UI complete)
- Forgot Password screen (UI complete)
- Bottom tab navigation (Home, Market, Scan, Collection, Profile)
- Home screen (portfolio strip, quick actions, market movers, trending, recently added)
- Global search screen (cards, sets, sealed, users filter tabs)
- Card detail screen (price section, grading options, price history chart, collection actions, marketplace listings)
- Collection screen (grid/list view, Cards/Sealed/Sets/Graded tabs, TCG filter chips)
- Market screen (TCG selector, trending, biggest movers, most watched, recent sales)
- Profile screen (own profile with stats, watchlist preview, navigation menu)
- Settings screen (sections: account, currency, notifications, privacy, security, appearance)
- Portfolio screen (total value, P/L, top performers, allocation charts by TCG/condition/grade co/value tier)
- Watchlist screen (wired to session state, sort controls, empty state)
- Notifications centre (price alert, trade offer, watchlist, market, verification types; filter chips; mark read)
- Public collector profile (tabs: collection, for sale, activity, about; privacy-respecting; no financial data)
- Verification info screen (all 4 badge types: Account, Seller, Ownership, Listing; non-guarantee wording)
- Sell flow — 7-step modal (select card → details → condition → price → photos → preview → publish)
- Trade offer UI (you-offer vs they-offer comparison, estimated values, value difference, send offer)
- Scanner screen (camera UI, simulated scan result, confidence %, confirm/retry flow)
- Add Card screen (manual entry: search → select → raw/graded → details)
- Design system (colours, typography, spacing tokens in `constants/colors.ts`)
- Reusable UI components (Badge, Button, CardThumbnail, Chip, EmptyState, ErrorState, Input, SkeletonLoader)
- TypeScript types for all core entities (`types/index.ts`)
- Mock service layer (`services/` directory with realistic mock data)
- React Context state management (`AppContext` with watchlist, collection, portfolio, filters)
- Error boundary and error fallback components

---

## IN PROGRESS

Features that have scaffolding but require more work.

- Seller profile / my listings management (profile menu links to sell modal, full seller dashboard not yet built)
- Tablet layout (renders correctly but not optimised; phone layouts stretch)
- Card images (infrastructure ready via `card.imageUrl`; still using gradient placeholders everywhere)

---

## PROTOTYPE ONLY

These features exist in the UI but are entirely mocked — no real logic, data, or backend.

- Authentication (pre-authenticated in AppContext; no real sign-in/out persistence)
- Card scanner (simulated result only; no real camera permission or AI recognition)
- Sell flow (mock publish; no real listing created anywhere)
- Trade offer (mock send; no real trade system)
- Marketplace listings (static mock data; no real inventory)
- Portfolio value / price history (static mock data; no live price feed)
- Market movers / trending (static mock data)
- Notifications (static array; no real push infrastructure)
- Price alerts (UI flag only; no backend subscription)
- Verification badges (status stored in mock data; no real verification process)
- Currency selection (AUD hardcoded; setting is UI-only)
- Payment methods (menu item links to nothing)

---

## NOT YET BUILT

Planned features with no implementation yet.

- Seller dashboard (listing management, sold items, payout history)
- Trade inbox (received trade offers, accept/reject flow)
- Order / purchase flow (buy button → checkout)
- Completed trade history screen
- Collection item detail / edit screen (view/edit individual collection entry)
- Set completion tracker detail screen
- Sealed product detail screen
- User-to-user messaging / chat
- Wanted list / seeking board
- Price alert management screen (set, edit, delete alerts)
- Grading submission tracker
- Admin / moderation panel
- Report / flag listing flow

---

## BACKEND REQUIRED

These features need a real backend before they can function.

- User authentication (Supabase Auth recommended: email, Apple, Google)
- User database (Supabase PostgreSQL)
- Card collection persistence (per-user in database)
- Watchlist persistence
- Real marketplace listings (create, update, delete)
- Trade offers (create, accept, reject, complete)
- Real-time price data (price aggregation service or third-party API)
- Push notifications (FCM for Android, APNs for iOS)
- In-app notifications (server-side event system)
- File/image storage for listing photos (Supabase Storage or S3)

---

## API REQUIRED

These features depend on third-party APIs.

- Card database (TCGplayer API, Pokémon TCG API, Scryfall for MTG, or custom scraped DB)
- Price data (TCGplayer market data, CardTrader, or aggregated from multiple sources)
- Card image CDN (hosted card imagery with correct aspect ratios)
- Card recognition / scanner AI (TensorFlow Lite model or cloud vision API)
- Grading company population data (PSA, BGS, CGC public pop report APIs)
- Grading certificate lookup (PSA Cert Verification API)
- Address validation for shipping
- Currency conversion (for multi-currency support)

---

## FUTURE PHASE

Long-term features not scoped for current Codex phases.

- Real card authentication / physical verification
- Escrow payment system for high-value trades
- Shipping integration (Australia Post, Sendle)
- Insurance options for high-value cards
- Consignment / vault storage
- Grading submission service integration
- Seller payout system (Stripe Connect)
- Tax reporting tools
- Blockchain proof of ownership / NFT-backed provenance
- Match-making for trade proposals (AI-suggested trades)
- Live auction format
- Multi-currency support (USD, GBP, JPY)
- Offline mode / local collection sync
- iOS widget (collection value widget)
- Apple Watch companion app
- Web application (responsive Expo web or Next.js)
- Social features (follow collectors, community feed)
- Set release calendar and alerts
