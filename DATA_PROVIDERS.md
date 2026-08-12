# Verified TCG data providers

Provider credentials are server-only. Do not use `EXPO_PUBLIC_` variables for them.

## JustTCG

Set `JUSTTCG_API_KEY` in the API server environment. The server sends it as `x-api-key` to JustTCG and exposes:

- `GET /api/catalog/games`
- `GET /api/catalog/cards?q=...&limit=20`

The mobile app uses the catalog endpoint for live card search and falls back to the bundled prototype data when the API server is unavailable.

## PSA

Set `PSA_API_TOKEN` to the bearer token generated from the PSA Public API account. The server exposes:

- `GET /api/certifications/psa/:certNumber`

PSA’s public API currently documents single-item certification lookup by cert number. It is not a bulk market-price feed.

## Required deployment configuration

The API server needs:

```text
JUSTTCG_API_KEY=...
PSA_API_TOKEN=...
```

The Expo app needs `EXPO_PUBLIC_API_BASE_URL` pointing at the API server’s public origin. Never commit either provider secret.
