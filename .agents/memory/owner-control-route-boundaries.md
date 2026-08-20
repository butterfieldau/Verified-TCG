---
name: Owner-control route boundaries
description: Safe scoping for maintenance and app-version enforcement around operational and provider callbacks.
---

Maintenance and app-version controls apply to consumer behavior, not infrastructure health, owner recovery, authentication recovery, public runtime-policy discovery, or verified third-party lifecycle callbacks. Exemptions must use exact paths or slash-boundary prefixes and must not bypass the callback's own signature checks or general rate limits.

**Why:** External providers cannot attach an app build version, and blocking a marketplace account-deletion callback during maintenance creates an availability and compliance failure. Signed callbacks also need their exact raw bytes preserved before any JSON parser runs.

**How to apply:** Audit every new global owner-control middleware against all server-to-server and recovery routes. Keep the exemption narrow, install any raw-body parser before the global JSON parser, retain cryptographic verification, and add tests with maintenance and version policies active.