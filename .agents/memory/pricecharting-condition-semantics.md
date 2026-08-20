---
name: PriceCharting condition semantics
description: Truthful normalization rules for provider price fields whose meaning changes by collectible category.
---

PriceCharting condition fields are category-overloaded: the same field can describe a video-game condition, comic grade, or card grade. Do not turn an overloaded field into a numeric card grade unless the provider record carries durable product-category provenance. Generic graded values may remain generic, and exact portfolio valuation must use only provider fields that explicitly identify the holding's grade.

**Why:** Treating a field name as a universal grade can attach a real provider price to the wrong condition, creating a fabricated grade-specific value even though the numeric amount itself came from the provider.

**How to apply:** Keep provider-native payloads inside the adapter, normalize only semantically attested conditions, and return unavailable for unsupported exact grades rather than falling back to raw or a nearby generic bucket. Tests should prove overloaded fields cannot become numeric grade keys or exact holding valuations.