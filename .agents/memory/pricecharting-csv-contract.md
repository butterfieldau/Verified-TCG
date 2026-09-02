---
name: PriceCharting CSV contract
description: Non-obvious runtime behavior of PriceCharting bulk guide downloads and their leases.
---

PriceCharting bulk guide downloads can take substantially longer than the interactive JSON API and official CSV prices are dollar-prefixed decimal strings, sometimes with grouped thousands. A downloaded guide with no parsed price maps is invalid cache data, not a successful import.

**Why:** Interactive product requests remained healthy while bulk imports timed out and, after download, an overly strict decimal parser silently produced empty quote maps. A category cooldown could also leak a previously acquired global lease even though no provider request occurred.

**How to apply:** Give bulk downloads their own realistic timeout, parse only the documented currency grammar losslessly, reject all-empty guide caches, and release the global CSV claim immediately when a category claim cannot proceed.