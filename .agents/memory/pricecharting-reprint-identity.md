---
name: PriceCharting reprint identity
description: Safe matching rules for reprints whose provider set label remains attached to the original release.
---

An exact collector number is not sufficient when the same card has original, alternate-art, language, and reprint products. When PriceCharting keeps the original set/console label on a reprint, use explicit variant evidence from both the canonical set/name and provider product name, and auto-match only a unique candidate.

**Why:** One Piece Premium Booster reprints can share an `OP` collector number with the original printing while PriceCharting labels both under the original set. Pure set similarity rejects the correct reprint, while number-only matching can attach the original card's price.

**How to apply:** Normalize known reprint aliases (for example Premium Booster -The Best- and PRB01), preserve variant markers such as manga and alternate art, require exact collector-number compatibility, and leave duplicate variant candidates unavailable for review.