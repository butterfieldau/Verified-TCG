---
name: JustTCG live pricing contract
description: Observed provider requirements and limits for live card-price retrieval.
---

JustTCG card lookups return real USD prices in `variants`, keyed by raw card condition and printing. Near Mint prices can legitimately use Foil, Holofoil, Reverse Holofoil, Limited, and other non-Normal printings. The game query parameter requires provider slugs such as `one-piece-card-game`, not display labels such as `One Piece`. Pokémon has separate `pokemon` and `pokemon-japan` catalogues, but no Chinese catalogue was exposed as of 2026-09-03. Sealed products are returned from the cards endpoint with card number `N/A`.

**Why:** Live probes across every game exposed by the provider succeeded when provider slugs were used. Representative Pokémon and One Piece responses contained condition/printing prices and history, but no grading company or numeric slab-grade fields. Language and sealed-product probes showed that Japanese rows require the Japan slug, Chinese rows have no provider game, and exact ETBs are available through normal card search.

**How to apply:** Treat exact JustTCG IDs as the primary raw-price identity and refresh them independently of PriceCharting. Route Japanese Pokémon evidence to `pokemon-japan`; identify Chinese rows explicitly until a trusted catalogue exists. Treat numberless sealed results as products only with exact name/set evidence. Do not claim JustTCG supplies PSA/BGS/CGC values unless a later provider contract exposes explicit grader and grade fields.