---
name: Catalogue source validation
description: Keep disposable catalogue acceptance runs from mutating the populated source database.
---

Run catalogue imports with a unique disposable target database and a separately configured source connection that begins a read-only transaction. Do not restart the ordinary API process as part of that validation unless its startup is explicitly schema-only.

**Why:** The ordinary API startup path can run unrelated, idempotent legacy data maintenance against its configured database. That defeats a strict promise that the populated catalogue source remains untouched, even when the importer itself is read-only.

**How to apply:** For fresh import acceptance, use the bootstrap/import CLI with explicit target and source URLs, and verify the source transaction’s read-only setting. Use a dedicated schema-only startup or validation mode before restarting services that point at the source database.