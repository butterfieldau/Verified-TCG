---
name: Collection CSV migrations
description: Safety and compatibility rules for collection CSV import and export.
---

Collection CSV formats are exact, ordered, and versioned. Preview jobs bind normalized row decisions to a user and content fingerprint, while commits serialize per collector and save holdings plus wishlist additions in one transaction.

**Why:** Loose format detection can misclassify files, and job-scoped locking still allows two different previews to insert the same holding concurrently. Lossless round trips also require complete grading semantics, not only company and score.

**How to apply:** Treat format changes as a new explicit version, reject contradictory canonical identity evidence, preserve unsupported grades without raw-price fallback, and keep committed results replayable independently of preview expiry.