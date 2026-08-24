# Fresh database bootstrap

Use the repository-controlled bootstrap command for a brand-new Verified TCG PostgreSQL database:

```bash
pnpm --filter @workspace/api-server run db:bootstrap
```

The command first creates the three legacy prerequisites required by the historical Drizzle journal (`admin_accounts`, `push_tokens`, and `card_provider_mappings`), then runs the official Drizzle migrations from `lib/db/drizzle`, and finally applies the idempotent current-schema reconciler.

It is safe to repeat on an existing valid installation: all prerequisite statements are additive, Drizzle only runs entries newer than the latest journal entry, and bootstrap deliberately skips application data cleanup and normalisation. Legacy installations that predate the Drizzle journal safely bypass historical replay, apply the unchanged additive Stage 3A canonical-catalogue SQL, and use the additive schema reconciler—no migration records are invented. Use it with the intended target database only; do not point it at production during development verification.

A non-empty application schema with an empty `drizzle.__drizzle_migrations`
table is inconsistent and the command refuses it rather than guessing which
historical migrations ran. For a schema-only compatibility clone of a journalled
installation, copy only the real migration-journal rows in addition to the
schema—never collector or application data.