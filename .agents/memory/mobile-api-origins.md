---
name: Mobile API origins
description: How development previews and installed release builds choose safe API origins.
---

Development web previews must use the same-origin Replit proxy when the configured API origin is the normal production origin. Explicit custom API origins still win, and an explicitly empty origin remains disabled. Installed release builds use the public production origin.

**Why:** Pointing an Expo web preview at the production host caused browser CORS preflight failures even though the native release origin was valid. Falling back to an editor domain in release builds would instead break physical devices.

**How to apply:** Keep environment-aware origin selection centralized in the shared mobile API client. Test development proxy selection, explicit staging overrides, production fallback, TLS enforcement, and `/api` suffix normalization together.