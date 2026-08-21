---
name: Catalogue cache leases
description: Durable revalidation and freshness rules for quota-limited catalogue provider data.
---

Cold misses and stale revalidation for quota-limited provider data must be
claimed atomically in the shared database, not only coalesced in process
memory. A composed feed may be stored as fresh only when every source read is
fresh or newly obtained; stale, failed, or budget-denied inputs must stay
explicit.

**Why:** Multiple API instances can observe the same absent or stale item.
Process-local single-flight state does not prevent duplicate provider calls or
quota spend across replicas. Relabeling stale or partial ingredients as fresh
also hides degraded data from callers.

**How to apply:** For any new provider cache, use a conditional persisted
lease/claim before fetching, and make losing callers await/re-read the cache
rather than issuing a second request. Fence the lease with an owner token:
both publishing and release must match the current owner, so an expired late
owner cannot overwrite or delete a replacement lease. When caching an
aggregation, propagate source freshness and fail or serve an existing stale
composition instead of resetting its fresh window from degraded inputs.