/**
 * Unit tests for catalog route helper functions.
 * Run with: pnpm --filter @workspace/api-server test
 *
 * Tests cover:
 *  - capByGameFromSorted: per-game cap with global sort preserved
 *  - extractData: 2xx success path, non-2xx failure path, anyOk tracking
 *  - mergePool: deduplication across multiple arrays
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateSnapshotMovement,
  capByGameFromSorted,
  extractData,
  enrichCardsWithQuoteRows,
  mergePool,
  normalizeTcgName,
} from "./catalog.js";

test("search quote enrichment joins PriceCharting quotes to exact external IDs", () => {
  const cards = [
    { id: "justtcg-one-piece-luffy", name: "Monkey.D.Luffy", game: "One Piece", variants: [] },
    { id: "justtcg-pokemon-pikachu", name: "Pikachu", game: "Pokemon", variants: [] },
    { id: "unmatched", name: "No quote", game: "Pokemon", variants: [{ condition: "Near Mint", price: 99 }] },
  ];
  const enriched: Record<string, unknown>[] = enrichCardsWithQuoteRows<Record<string, unknown>>(cards, [
    { card_id: "justtcg-one-piece-luffy", price_cents: 12_345, currency: "AUD", fetched_at: new Date("2026-09-01T00:00:00Z") },
    { card_id: "justtcg-pokemon-pikachu", price_cents: 6_789, currency: "AUD", fetched_at: new Date("2026-09-01T00:00:00Z") },
  ]);

  assert.equal(enriched[0]!.market_price, 123.45);
  assert.equal(enriched[0]!.pricing_source, "PriceCharting");
  assert.equal((enriched[0]!.variants as Array<{ price: number }>)[0]!.price, 123.45);
  assert.equal(enriched[1]!.market_price, 67.89);
  assert.equal(enriched[1]!.pricing_source, "PriceCharting");
  assert.equal(enriched[2]!.pricing_source, undefined);
  assert.equal((enriched[2]!.variants as Array<{ price: number }>)[0]!.price, 99);
});

// ---------------------------------------------------------------------------
// Persisted market movement
// ---------------------------------------------------------------------------

test("snapshot market movement uses comparable non-zero observations", () => {
  assert.deepEqual(calculateSnapshotMovement(10_000, 12_000), {
    absoluteCents: 2_000,
    percent: 20,
    trend: "up",
  });
  assert.deepEqual(calculateSnapshotMovement(10_000, 8_000), {
    absoluteCents: -2_000,
    percent: -20,
    trend: "down",
  });
});

test("snapshot market movement rejects zero, missing, and invalid prices", () => {
  assert.equal(calculateSnapshotMovement(0, 12_000), null);
  assert.equal(calculateSnapshotMovement(10_000, 0), null);
  assert.equal(calculateSnapshotMovement(Number.NaN, 12_000), null);
  assert.equal(calculateSnapshotMovement(100, 601), null, "rejects a >500% spike");
});

test("snapshot market movement retains a genuine zero change", () => {
  assert.deepEqual(calculateSnapshotMovement(10_000, 10_000), {
    absoluteCents: 0,
    percent: 0,
    trend: "neutral",
  });
});

test("TCG preference aliases normalize to canonical catalogue families", () => {
  assert.equal(normalizeTcgName("Pokémon"), "pokemon");
  assert.equal(normalizeTcgName("Pokemon TCG"), "pokemon");
  assert.equal(normalizeTcgName("One Piece TCG"), "onepiece");
  assert.equal(normalizeTcgName("MTG"), "magic");
  assert.equal(normalizeTcgName("Magic: The Gathering"), "magic");
});

// ---------------------------------------------------------------------------
// capByGameFromSorted
// ---------------------------------------------------------------------------

test("capByGameFromSorted: returns up to totalLimit items", () => {
  const items = [
    { game: "Pokemon", score: 10 },
    { game: "One Piece", score: 9 },
    { game: "MTG", score: 8 },
    { game: "Yu-Gi-Oh!", score: 7 },
    { game: "Disney Lorcana", score: 6 },
    { game: "Dragon Ball Super", score: 5 },
    { game: "Pokemon", score: 4 },
    { game: "One Piece", score: 3 },
    { game: "MTG", score: 2 },
  ];
  const result = capByGameFromSorted(items, 3, 8);
  assert.equal(result.length, 8);
});

test("capByGameFromSorted: respects per-game cap", () => {
  const items = [
    { game: "Pokemon", score: 10 },
    { game: "Pokemon", score: 9 },
    { game: "Pokemon", score: 8 },
    { game: "Pokemon", score: 7 }, // should be excluded (cap = 3)
    { game: "One Piece", score: 6 },
  ];
  const result = capByGameFromSorted(items, 3, 8);
  const pokemonCount = result.filter((r) => r.game === "Pokemon").length;
  assert.equal(pokemonCount, 3, "Pokemon should be capped at 3");
  assert.equal(result.length, 4, "Only 4 items qualify (3 Poke + 1 OP)");
});

test("capByGameFromSorted: preserves global sort order", () => {
  // Pokemon has highest scores but is capped at 2;
  // the next highest non-Pokemon card should appear in position 3
  const items = [
    { game: "Pokemon", score: 100 },
    { game: "Pokemon", score: 90 },
    { game: "MTG",     score: 80 },  // should be slot 3
    { game: "Pokemon", score: 70 },  // blocked by cap
    { game: "One Piece", score: 60 },
  ];
  const result = capByGameFromSorted(items, 2, 4);
  assert.equal(result[0]!.game, "Pokemon");
  assert.equal(result[1]!.game, "Pokemon");
  assert.equal(result[2]!.game, "MTG",      "MTG slot 3 — highest available after cap");
  assert.equal(result[3]!.game, "One Piece");
});

test("capByGameFromSorted: returns empty array for empty input", () => {
  assert.deepEqual(capByGameFromSorted([], 3, 8), []);
});

test("capByGameFromSorted: all 6 supported TCGs can appear in result", () => {
  const games = ["Pokemon", "One Piece", "Magic: The Gathering", "Yu-Gi-Oh!", "Disney Lorcana", "Dragon Ball Super"];
  const items = games.map((game, i) => ({ game, score: games.length - i }));
  const result = capByGameFromSorted(items, 1, 6);
  const resultGames = result.map((r) => r.game);
  for (const game of games) {
    assert.ok(resultGames.includes(game), `${game} should appear in result`);
  }
});

// ---------------------------------------------------------------------------
// extractData
// ---------------------------------------------------------------------------

test("extractData: returns data array and sets anyOk on 200", () => {
  const anyOk = { value: false };
  const cards = [{ id: "a", game: "Pokemon" }];
  const result = extractData({ status: 200, body: { data: cards } }, anyOk);
  assert.deepEqual(result, cards);
  assert.equal(anyOk.value, true);
});

test("extractData: returns empty array and leaves anyOk false on 400", () => {
  const anyOk = { value: false };
  const result = extractData({ status: 400, body: { error: "bad request" } }, anyOk);
  assert.deepEqual(result, []);
  assert.equal(anyOk.value, false);
});

test("extractData: returns empty array and leaves anyOk false on 503", () => {
  const anyOk = { value: false };
  const result = extractData({ status: 503, body: null }, anyOk);
  assert.deepEqual(result, []);
  assert.equal(anyOk.value, false);
});

test("extractData: anyOk stays true if at least one query succeeded", () => {
  const anyOk = { value: false };
  extractData({ status: 200, body: { data: [{ id: "1" }] } }, anyOk);
  extractData({ status: 503, body: null }, anyOk);
  assert.equal(anyOk.value, true, "anyOk should remain true after one success + one failure");
});

test("extractData: returns empty array when body.data is missing", () => {
  const anyOk = { value: false };
  const result = extractData({ status: 200, body: {} }, anyOk);
  assert.deepEqual(result, []);
  assert.equal(anyOk.value, true, "anyOk still set on 2xx even when data is empty");
});

// ---------------------------------------------------------------------------
// mergePool
// ---------------------------------------------------------------------------

test("mergePool: deduplicates by id across arrays", () => {
  const a = [{ id: "1", game: "Pokemon" }, { id: "2", game: "Pokemon" }];
  const b = [{ id: "2", game: "Pokemon" }, { id: "3", game: "One Piece" }]; // id "2" is duplicate
  const result = mergePool(a, b);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((c) => c["id"]), ["1", "2", "3"]);
});

test("mergePool: first occurrence of a duplicate id wins", () => {
  const a = [{ id: "1", game: "Pokemon", name: "Charizard" }];
  const b = [{ id: "1", game: "One Piece", name: "Luffy" }]; // same id, different game
  const result = mergePool(a, b);
  assert.equal(result.length, 1);
  assert.equal(result[0]!["name"], "Charizard", "first occurrence should win");
});

test("mergePool: cards without an id are excluded", () => {
  const a = [{ game: "Pokemon" }, { id: "1", game: "MTG" }]; // first card has no id
  const result = mergePool(a);
  assert.equal(result.length, 1);
  assert.equal(result[0]!["id"], "1");
});

test("mergePool: handles empty arrays", () => {
  assert.deepEqual(mergePool([], []), []);
  assert.deepEqual(mergePool(), []);
});

test("mergePool: merges cards from all 6 TCGs without cross-game deduplication", () => {
  const games = ["Pokemon", "One Piece", "Magic: The Gathering", "Yu-Gi-Oh!", "Disney Lorcana", "Dragon Ball Super"];
  const arrays = games.map((game, i) => [{ id: String(i + 1), game }]);
  const result = mergePool(...arrays);
  assert.equal(result.length, 6, "all 6 games should be present");
  const resultGames = result.map((c) => c["game"]);
  for (const game of games) {
    assert.ok(resultGames.includes(game), `${game} should be in merged pool`);
  }
});
