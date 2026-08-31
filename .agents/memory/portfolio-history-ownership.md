---
name: Portfolio history follows ownership
description: Rules for reconstructing honest portfolio value history across acquisitions and disposals.
---

Historical portfolio valuation must follow the full ownership lifecycle, not just currently active collection rows. Include archived sold quantities from acquisition until disposal, exclude them on and after the sale date, and emit a zero endpoint after final liquidation.

**Why:** Recomputing old points from only active holdings rewrites the past after a sale, while omitting a zero endpoint leaves charts ending at a value the collector no longer owns.

**How to apply:** Any portfolio-history source or chart must account for acquisitions, partial sales, full sales, and restores. Never let a disposal retroactively erase pre-sale value or leave a stale nonzero final point.