---
name: Null fields in profile API
description: Drizzle skips undefined column values; explicit null must be written when clearing nullable profile fields. Also applies to React state merges.
---

# Nullable Profile Fields — Null vs Undefined

## The Rule
When a user clears a nullable text field (e.g. favourite_tcg, collector_since), the client sends `null`. The API and state layer must preserve that `null`, not convert it to `undefined`.

## Why
Drizzle ORM skips columns set to `undefined` in `.set()` — the existing DB value is unchanged. `null` writes a SQL NULL as intended. The `?? undefined` pattern silently converts client `null` to `undefined`, so "clear this field" becomes a no-op at the database level.

The same issue exists in React state merges: `patch.field ?? current.field` treats `null` as falsy and falls back to the old value, so state diverges from what the server stored.

## How to Apply
API patch object:
```ts
// WRONG — converts null → undefined, Drizzle skips it
if (data.favourite_tcg !== undefined) patch.favouriteTcg = data.favourite_tcg ?? undefined;

// CORRECT — preserves null so Drizzle writes SQL NULL
if ("favourite_tcg" in data) patch.favouriteTcg = data.favourite_tcg ?? null;
```

React state merge:
```ts
// WRONG — null treated as falsy, keeps old value
favouriteTcg: patch.favouriteTcg ?? current.favouriteTcg,

// CORRECT — explicit undefined check so null clears the field
favouriteTcg: patch.favouriteTcg !== undefined ? patch.favouriteTcg : current.favouriteTcg,
```
