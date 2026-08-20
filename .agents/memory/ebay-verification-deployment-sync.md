---
name: eBay verification deployment sync
description: Runtime and production propagation requirements for eBay endpoint challenge secrets.
---

When eBay endpoint challenge secrets change, restart the development API workflow before testing. Production will continue to use its previously deployed configuration until the app is published again.

**Why:** A running API process retains its startup environment, and the deployed callback can return a valid-looking challenge hash for an earlier token while failing eBay's comparison against the newly registered one.

**How to apply:** After setting or rotating the verification token or callback URL, restart the API workflow, validate a non-sensitive challenge response locally, then publish and repeat the challenge check against the production callback.