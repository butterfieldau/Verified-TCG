---
name: Trust operations truthfulness
description: Cross-surface review rule for moderation, events, certifications, vendors, trades, and drops.
---

Trust and safety work must be reviewed across both staff tooling and every consumer endpoint or screen that can expose the same operational state. Unsupported capabilities, failed fetches, unpublished lifecycle states, and unavailable provider results must remain explicitly unavailable; they must never become sample records, fallback counts, or optimistic success state. Treat moderation state as an access-control boundary, not merely a feed filter: non-visible content must be non-enumerable and non-interactive across every consumer route.

**Why:** A staff workflow can be internally correct while a legacy consumer route, seed, or mock fallback still leaks unpublished records or presents fabricated safety/event state. Those inconsistencies undermine the operational trust contract even when the Command Centre itself is accurate.

**How to apply:** For future trust-domain changes, trace each durable record through admin APIs, consumer APIs, mobile/web presentation, lifecycle transitions, and failure states. Include marketing copy, badges, enabled navigation, and direct routes: sending users to an unavailable screen does not make an affirmative capability claim truthful. Derive status-history and audit predecessor state only after locking the current row inside the same mutation transaction. When a multi-step consumer operation depends on lifecycle eligibility, hold a shared lock on that row through every related read or write. Reuse one eligibility predicate where possible, and add negative tests for unpublished, removed, unavailable, provider-unconfirmed, and concurrent-transition states.