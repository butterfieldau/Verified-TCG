---
name: Fresh database bootstrap policy
description: Fresh installs need a journal-preserving bootstrap; legacy unjournalled schemas must never receive fabricated history.
---

Use the repository-controlled database bootstrap for a fresh install: create its documented historical prerequisites, run the genuine Drizzle journal, then reconcile schema only. Never modify historical migration files or invent journal entries. Existing legacy schemas with no journal must use the schema-only bypass and apply only the known additive catalogue migration.

**Why:** The registered history references objects that predate the journal, while legacy installations may have a valid schema with no migration ledger. Replaying or fabricating history could damage an existing installation; normal startup data backfills are also not safe bootstrap work.

**How to apply:** Verify a disposable empty database reaches the exact source-derived journal entries and zero application records. Also exercise the unjournalled legacy branch and an inconsistent empty-journal rejection. Keep data seeds, backfills, and cleanup separate from bootstrap reconciliation.