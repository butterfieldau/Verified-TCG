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
import { capByGameFromSorted, extractData, mergePool } from "./catalog.js";

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
