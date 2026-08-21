# Verified TCG data providers

Provider credentials are server-only. Do not use `EXPO_PUBLIC_` variables for them.

## JustTCG

Set `JUSTTCG_API_KEY` in the API server environment. The server sends it as `x-api-key` to JustTCG and exposes:

- `GET /api/catalog/games`
- `GET /api/catalog/cards?q=...&limit=20`

The mobile app uses the catalog endpoint for live card search and falls back to the bundled prototype data when the API server is unavailable.

## PriceCharting

Set `PRICECHARTING_API_TOKEN` in the API server environment. The token is
server-only; it must never be prefixed with `EXPO_PUBLIC_`, returned by an API,
written to the database, or included in logs or telemetry. `PRICECHARTING_TOKEN`
is accepted temporarily as a deprecated deployment fallback and should be
removed after all environments have migrated to the new name.

Current PriceCharting calls are centralised in the API server adapter. The
adapter enforces the documented one-request-per-second limit, retries transient
failures, deduplicates in-flight requests, and caches provider responses.
PriceCharting prices are stored as integer USD cents. Generic card grades remain
generic and are never labelled as a grading company.

## PSA

Set `PSA_API_TOKEN` to the bearer token generated from the PSA Public API account. The server exposes:

- `GET /api/certifications/psa/:certNumber`

PSA’s public API currently documents single-item certification lookup by cert number. It is not a bulk market-price feed.

## Required deployment configuration

The API server needs:

```text
JUSTTCG_API_KEY=...
PSA_API_TOKEN=...
PRICECHARTING_API_TOKEN=...
```

The Expo app needs `EXPO_PUBLIC_API_BASE_URL` pointing at the API server’s public origin. Never commit either provider secret.
