# Canonical catalogue import and synchronisation

Stage 3B populates the internal canonical catalogue without changing public
catalogue reads. JustTCG remains the public catalogue provider and scanner
source until a separately validated Stage 3C cutover.

## Source and reconciliation

The initial source is the durable `catalogue_cache_entries` JustTCG cache. It
contains real provider response documents already observed by Verified TCG, so
a backfill does not consume new JustTCG budget. Records are streamed in pages
of 100 cache entries; repeated card results are safe because reconciliation
uses the JustTCG external card ID first.

For a disposable database that starts empty, set `DATABASE_URL` to the target
and `CATALOGUE_SOURCE_DATABASE_URL` to a read-only HeliumDB credential. The
source is read inside `BEGIN READ ONLY`; the importer never writes to that
connection. Do not set `CATALOGUE_SOURCE_DATABASE_URL` to a production
credential with write permissions.

Each provider record flows through:

`JustTCG cache record -> normalisation -> external-ID reconciliation -> canonical upsert -> identity/provenance`

When no external ID is known, a card is reconciled only when game, resolved
set, normalised collector number, name, and language yield exactly one
candidate. Ambiguous records become import errors and are never force-merged.
Provider refreshes update safe descriptive fields only. Canonical UUIDs, game
ownership, set ownership, and external-ID ownership are not reassigned.

## Commands

Run only against an isolated development or test database. Never point these
commands at production merely to test an import.

```bash
pnpm --filter @workspace/api-server run catalogue:sync -- --dry-run
pnpm --filter @workspace/api-server run catalogue:sync
pnpm --filter @workspace/api-server run catalogue:sync:incremental
pnpm --filter @workspace/api-server run catalogue:sync:set -- --set <justtcg-set-id>
pnpm --filter @workspace/api-server run catalogue:sync:card -- --card <justtcg-card-id>
pnpm --filter @workspace/api-server run catalogue:sync -- --resume <failed-import-job-uuid>
pnpm --filter @workspace/api-server run catalogue:health
pnpm --filter @workspace/api-server run catalogue:shadow -- --max-records 500
```

`--max-cache-entries` and `--batch-size` bound a development run. Incremental
sync imports cache entries updated since the last completed import. When there
is no prior completed job, it truthfully falls back to a bounded full cache
scan; it does not claim provider updated-since support that the current
JustTCG client does not expose.

Interrupted cache imports checkpoint the last `cache_key:index` cursor after
each batch. `--resume <job-id>` starts a new job after that stored cursor; it
does not modify the original job or replay its successfully processed cards.

## Jobs, errors, and security

Jobs move from `queued` to `running`, then `completed`, `partial`, or
`failed`. The importer checkpoints its source cursor and counters after each
batch. Record failures are written to `catalogue_import_errors` and do not
abort other records. Provider-wide failures fail the job.

Raw provenance and error payloads are sanitised recursively: token, API-key,
authorisation, cookie, password, and secret fields are redacted. Provider API
keys remain server-side and are never stored in an import row.

Images retain provider URLs only; no third-party image library is downloaded
or rehosted. Variants are created only where JustTCG exposes explicit variant,
finish, edition, stamp, or foil evidence.

`catalogue:shadow` is a read-only bounded comparison between durable JustTCG
cache records and canonical mappings. When `CATALOGUE_SOURCE_DATABASE_URL` is
configured, it reads that cache through the same `BEGIN READ ONLY` source
connection as imports; otherwise it compares the local cache. It reports
mapping coverage, missing cards, set mismatches, and collector-number
mismatches for Stage 3C readiness.
