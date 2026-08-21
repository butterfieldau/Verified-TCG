---
name: eBay completed-sales evidence
description: Provider and evidence rules for Marketplace Insights completed-sale pricing.
---

Completed eBay sales use Marketplace Insights client-credentials OAuth with the Buy Marketplace Insights scope. Treat full printed card identity—name, set, game, and complete number including a denominator—as required evidence; resolve snapshot identity from the catalog on the server rather than trusting a client request.

**Why:** Generic OAuth scopes can receive a token that Marketplace Insights rejects. Similar printings share names and sets, and caller-controlled metadata can otherwise attach genuine sales to the wrong persisted price history.

**How to apply:** Keep credentials, search inputs, and provider payloads server-only. For sales display, return no result rather than weakening identity matching. For persistent snapshots, derive the pricing identity from a canonical catalog record and keep legacy/provider-incompatible evidence segregated.