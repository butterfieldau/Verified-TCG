---
name: eBay webhook verification
description: Signature and raw-body constraints for Marketplace Account Deletion notifications.
---

Marketplace Account Deletion signatures must be verified over the exact received JSON bytes using eBay's base64-encoded public-key envelope and Notification API key retrieval; never use the endpoint verification token as a body HMAC.

**Why:** The official Node notification SDK re-serializes parsed JSON before signature verification, which cannot prove the original HTTP representation remained intact.

**How to apply:** Keep the callback's raw-body parser ahead of generic JSON parsing. Retain public-key/OAuth verification server-side, cache key material, and only parse a payload after verification succeeds. Any evidence ledger must persist no eBay account identifiers when no verified linkage exists.