---
name: Guide reconciliation durability
description: Durable rules for bulk catalogue-to-provider identity reconciliation and quote retention.
---

Bulk guide reconciliation must use database-backed leases and persisted cursors, with a strict bound on each transaction. Accept mappings only from exact normalized name and compatible collector-number evidence; use set, language, region, and printing signals to disambiguate rather than fuzzy similarity alone. Preserve a valid existing mapping and its last-known quotes when a later guide omits the product or individual price fields.

**Why:** Provider guides are large, API instances overlap, collector-number formatting varies, and temporary omissions are common. Process-local work can duplicate or stop permanently, while permissive matching can silently assign a convincing price from the wrong printing.

**How to apply:** Any bulk pricing importer or scheduled rematcher must claim work in the database, checkpoint bounded pages, reconsider prior failure states when identity inputs change, retain ambiguous evidence without assigning a product, and never turn absent provider fields into zeroes or delete retained quotes.