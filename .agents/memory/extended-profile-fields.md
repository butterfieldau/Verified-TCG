---
name: Extended Profile Fields
description: New columns added to the users table for avatar, favourite TCG, collector since date, and visibility toggles. How they flow through the API and mobile app.
---

# Extended Profile Fields

## Schema (lib/db/src/schema/users.ts)
New nullable columns added to `usersTable`:
- `avatar_url` varchar(2048) — full URL to the stored avatar image
- `favourite_tcg` varchar(100) — value from TCG_OPTIONS (pokemon, onepiece, magic, yugioh, lorcana, dragonball, sports, other)
- `collector_since` varchar(7) — stored as "YYYY-MM" string
- `profile_public` bool default true
- `show_collection` bool default true
- `show_wishlist` bool default true
- `show_for_trade` bool default true
- `show_for_sale` bool default true

## API
- `GET/PUT /api/auth/user` — all new fields included in `user_metadata` response object (snake_case keys)
- `POST /api/auth/change-password` — requires current + new password, invalidates all sessions
- `POST /api/auth/avatar` — accepts `{ base64, mimeType }` JSON (8MB limit), writes to `uploads/avatars/`, returns `{ avatar_url }`
- `GET /api/auth/avatar/:filename` — serves files from disk
- `GET /api/collectors/:username` — respects `profile_public`; returns minimal shape with `isPrivate: true` for private profiles
- Avatar files stored on local disk (NOT durable across redeploys — see task #218)

## Mobile
- `User` type in `types/index.ts` has `favouriteTcg`, `collectorSince`, `profilePublic`, `showCollection`, `showWishlist`, `showForTrade`, `showForSale`
- `userFromSession` in `AppContext.tsx` maps snake_case metadata keys to camel-case User fields
- `updateProfile` in AppContext accepts all new fields, sends them to PUT /api/auth/user
- `changePassword` + `uploadAvatar` exported from `services/auth.ts`
- `app/change-password.tsx` — new screen, navigate to from Settings → Security
- `app/edit-profile.tsx` — photo upload (expo-image-picker base64), TCG picker modal, month/year picker modal, visibility toggles
- `app/collector/[username].tsx` — shows avatar, collectorSince, favouriteTcg; handles isPrivate response

**Why:** Task 178 spec — extended profile, photo upload, change password.

**How to apply:** When extending user fields further, add to schema, run `pnpm --filter @workspace/db push`, add to `userToMetadata()` in auth.ts, add to `userFromSession()` in AppContext.tsx.
