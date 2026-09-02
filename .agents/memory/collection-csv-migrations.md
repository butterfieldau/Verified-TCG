---
name: Collection CSV migrations
description: Safety and compatibility rules for collection CSV import and export.
---

Collection CSV formats are exact, ordered, and versioned. Preview jobs bind normalized row decisions to a user and content fingerprint, while commits serialize per collector and save holdings, wishlist additions, and organization records in one transaction. Organization-aware files require one unique list definition per referenced name and one unique holding identifier per holding.

**Why:** Loose format detection can misclassify files, and job-scoped locking still allows two different previews to insert the same holding concurrently. Lossless round trips require complete grading semantics and stable holding identity; otherwise identical holdings can collapse onto one list membership.

**How to apply:** Treat format changes as a new explicit version, reject contradictory identity or organization references, use account-owned holding IDs before one-to-one fallback matching, preserve unsupported grades without raw-price fallback, and keep committed results replayable independently of preview expiry.