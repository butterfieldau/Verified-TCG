---
name: JustTCG live pricing contract
description: Observed provider requirements and limits for live card-price retrieval.
---

JustTCG card lookups return real USD prices in `variants`, keyed by raw card condition and printing. Near Mint prices can legitimately use Foil, Holofoil, Reverse Holofoil, Limited, and other non-Normal printings. The game query parameter requires provider slugs such as `one-piece-card-game`, not display labels such as `One Piece`.

**Why:** Live probes across every game exposed by the provider succeeded when provider slugs were used. Representative Pokémon and One Piece responses contained condition/printing prices and history, but no grading company or numeric slab-grade fields.

**How to apply:** Treat exact JustTCG IDs as the primary raw-price identity and refresh them independently of PriceCharting. Do not claim JustTCG supplies PSA/BGS/CGC values unless a later provider contract exposes explicit grader and grade fields; keep unsupported graded values unavailable or use a clearly identified secondary provider.