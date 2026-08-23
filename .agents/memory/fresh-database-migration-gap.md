---
name: Fresh database migration gap
description: Recorded Drizzle migrations currently depend on application runtime schema setup for a fresh database.
---

The recorded Drizzle migration history must be independently runnable on an empty PostgreSQL database. Do not treat a successful application `runMigrations()` execution, a `drizzle-kit push`, or a schema-only clone as proof that the versioned migration chain is valid.

**Why:** Fresh-database verification found that the registered history references tables created only by runtime helpers before those tables exist in the recorded sequence. Existing populated development databases hide that incompatibility.

**How to apply:** Before a release that relies on a fresh install, create a disposable database, apply only the registered migrations in order, and inspect the ledger plus the physical schema. Keep any regression-test schema bootstrap clearly separate from this migration proof.