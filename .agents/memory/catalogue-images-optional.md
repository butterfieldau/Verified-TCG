---
name: Catalogue images are optional
description: Canonical catalogue and pricing reads must remain usable when an upstream provider supplies card identity and pricing fields but no artwork.
---

Canonical cards must not be rejected solely because they have no primary image. Keep the public image field nullable and let clients render their established no-image treatment.

**Why:** The durable JustTCG cache can contain complete card identities and variants without artwork. Treating artwork as a required public field caused a populated catalogue to produce empty Recently Added, Trending, search, and pricing-identity results.

**How to apply:** Require stable external identity, card name, game, and set for public reads. Consider image availability a presentation-quality attribute, not a catalogue completeness or pricing eligibility gate.