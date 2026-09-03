---
name: Collection import catalogue fallback
description: Safe identity rules for importing provider CSVs before canonical catalogue reconciliation completes.
---

Collectr imports must use the same cached live JustTCG fallback as catalogue search when the canonical database has no candidates. Require normalized game plus collector number and card-name identity, deduplicate provider IDs, and surface multiple exact records as ambiguous.

**Why:** Catalogue search can legitimately find a current card before background reconciliation has persisted it locally; limiting imports to canonical rows makes valid exports appear entirely unmatched. Provider set, rarity, and finish vocabularies also differ from Collectr.

**How to apply:** Keep Verified TCG round-trip imports strict. For third-party imports, tolerate display-name suffixes and provider vocabulary differences only when stronger game, collector-number, and normalized name evidence agrees. Never choose the first provider result when multiple IDs remain.