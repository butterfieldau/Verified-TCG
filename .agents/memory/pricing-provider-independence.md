---
name: Pricing provider independence
description: Availability rule for cached pricing when catalog and pricing providers are separate dependencies.
---

Serve persisted provider mappings and normalized quotes before consulting a separate catalog provider. Refresh an established mapping by its persisted provider product ID.

**Why:** A catalog outage must not hide valid cached or stale pricing from a different provider, and normal card-detail reads should not acquire an unrelated live dependency.

**How to apply:** Resolve catalog identity only for first-time matching or deliberate rematching. If that identity cannot be resolved, preserve any existing pricing state and return an explicit unavailable state only when no stored pricing exists.

All raw-value surfaces, including market movement and recently-added feeds, use JustTCG first and PriceCharting only when no usable JustTCG observation exists.

**Why:** Mixing a PriceCharting raw snapshot on a summary card with a JustTCG raw quote on Card Passport showed collectors two materially different current values for the same card.

**How to apply:** Provider choice must happen before ranking or display conversion. Never show a lower-priority provider's current amount merely because it has movement history; omit that card from the movement feed when the authoritative provider lacks a comparable pair.