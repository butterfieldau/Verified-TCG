---
name: Pricing provider independence
description: Availability rule for cached pricing when catalog and pricing providers are separate dependencies.
---

Serve persisted provider mappings and normalized quotes before consulting a separate catalog provider. Refresh an established mapping by its persisted provider product ID.

**Why:** A catalog outage must not hide valid cached or stale pricing from a different provider, and normal card-detail reads should not acquire an unrelated live dependency.

**How to apply:** Resolve catalog identity only for first-time matching or deliberate rematching. If that identity cannot be resolved, preserve any existing pricing state and return an explicit unavailable state only when no stored pricing exists.