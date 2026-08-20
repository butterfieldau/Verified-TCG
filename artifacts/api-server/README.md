# API Server

## JustTCG catalogue allowance

Catalogue reads use a durable Postgres cache shared by consumer, scanner, and
read-only staff endpoints. Configure the non-secret UTC outbound-call budget
with:

```text
JUSTTCG_DAILY_CALL_BUDGET=1000
```

If unset, the server permits 1,000 actual JustTCG requests per UTC day. Cache
responses do not count. The budget is atomically reserved immediately before
an outbound call, so an exhausted budget never sends another provider request.

Freshness policy:

- games: fresh for 24 hours; stale data may be served for 7 days;
- card and search responses: fresh for 30 minutes; stale data may be served
  for 7 days;
- composed market feeds: fresh for 30 minutes; stale data may be served for
  24 hours.

Stale entries return immediately with `cache_status: "stale"` and schedule one
controlled background revalidation. Simultaneous cold misses across API
processes use a short-lived Postgres lease: one process fetches while the
others wait for its durable result. A cold cache miss at the budget boundary
returns HTTP 429 with `CATALOGUE_DAILY_BUDGET_EXHAUSTED`. Responses include
safe cache/outbound metadata but never credentials or search terms.