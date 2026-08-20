---
name: Append-only evidence ledgers
description: Database lifecycle rule for audit, security, and retained telemetry evidence.
---

Evidence tables described as append-only must reject update, delete, and truncate operations in the database, not only in application routes. Retain actor, user, and session UUIDs as pseudonymous snapshots rather than lifecycle-managed relationships.

**Why:** `ON DELETE SET NULL` and similar foreign-key actions rewrite historical evidence when an account or session is deleted, contradicting immutability even when ordinary application code never updates the row.

**How to apply:** Do not add lifecycle foreign keys to append-only evidence identifiers. Store the UUID snapshot, join opportunistically when the related identity still exists, and fall back to the retained ID after deletion. Drop legacy FKs by table relationship rather than trusting ORM-generated constraint names, and test an upgrade from the original raw-DDL schema. Any new immutable evidence table needs database mutation guards and migration/test cleanup that never disables those guards in runtime code.