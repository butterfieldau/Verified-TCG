---
name: Auth Architecture
description: How authentication works in Verified TCG — custom JWT auth on Replit Postgres, replacing Supabase
---

# Auth Architecture

## The rule
Auth is entirely on Replit — no Supabase. JWT access tokens (15 min) + rotating refresh tokens (30 days, stored hashed in `user_sessions` table).

**Why:** User explicitly migrated away from Supabase mid-project. All Supabase env vars (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`) are removed.

## How to apply
- API endpoints live at `/api/auth/*` on the API server (`artifacts/api-server/src/routes/auth.ts`)
- JWT secret is `SESSION_SECRET` (already in Replit secrets)
- DB tables: `users` and `user_sessions` — defined in `lib/db/src/schema/users.ts` and `lib/db/src/schema/sessions.ts`
- Mobile auth service (`artifacts/verified-tcg/services/auth.ts`) calls `EXPO_PUBLIC_API_BASE_URL + /api/auth/*`
- `AuthSession` shape is preserved exactly — `AppContext` and all screens need no changes
- OAuth (Google/Apple) shows a "coming soon" alert — not implemented (requires external OAuth provider)
- Password reset (`/api/auth/recover`) stubs to 200 — no mail service configured yet
- Uses `bcryptjs` (pure JS) not `bcrypt` (requires native build approval in Replit)

## Database identity
The app's primary connection is Replit's runtime-managed `DATABASE_URL`, with separate development and production databases. A production database may report an internal name such as `neondb`; that does not mean it is the creator's separate Neon dashboard project.

**Why:** The production Replit database contained the app's users, collection rows, PriceCharting mappings, and quotes even though the separately inspected Neon account appeared empty.

**How to apply:** Diagnose the app through Replit's development/production database tools and `DATABASE_URL` environment binding. Do not switch to similarly named external connection secrets without comparing row counts and runtime configuration first.
