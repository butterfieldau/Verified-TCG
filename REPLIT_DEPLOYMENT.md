# Replit deployment

Replit hosts the Node/Express API. Supabase remains the authentication and
PostgreSQL provider. Do not create a Replit Auth integration or move the data
to Replit Database.

## Preview Secrets

Add these in Replit's Secrets tool for the development/preview environment:

- `DATABASE_URL` — the Supabase Session Pooler connection string
- `SUPABASE_URL` — `https://mzwqvpnohvompuavdhhw.supabase.co`
- `SUPABASE_ANON_KEY` — the Supabase publishable or legacy anon key
- `API_ALLOWED_ORIGINS` — the web origins allowed to call the API

The API uses `PORT` supplied by Replit and listens on `0.0.0.0`.

## Production Secrets

Add the same values again in the Publishing/Production Secrets panel. Replit
does not automatically copy editor Secrets into the published deployment.

## Mobile API URL

Set `EXPO_PUBLIC_API_BASE_URL` in the mobile build environment to the public
Replit API origin, without a trailing slash:

```text
https://your-app.replit.app
```

Do not commit this value if it changes between environments. The Supabase URL
and publishable key may be bundled into the mobile app; database credentials
and server secrets must never be bundled.

## Run commands

- Preview: `pnpm run dev`
- Production start: `pnpm run start`
- API build: `pnpm --filter @workspace/api-server run build`

The Replit deployment is configured to build and start only the API. It does
not run the Expo mobile build as part of publishing.

The API's health endpoint is available at `/api/healthz`.
