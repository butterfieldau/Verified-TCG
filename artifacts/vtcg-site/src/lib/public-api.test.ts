import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchPublicWishlist,
  parsePublicWishlist,
  PublicApiError,
  selectWishlistForUsername,
} from "./public-api.ts";

const validWishlist = {
  username: "collector",
  displayName: "Collector",
  items: [
    {
      id: "item-1",
      cardId: "card-1",
      card: { id: "card-1", name: "Card", setName: "Set" },
      addedAt: "2026-08-01T00:00:00.000Z",
    },
  ],
};

test("validates public wishlist responses", () => {
  assert.deepEqual(parsePublicWishlist(validWishlist), validWishlist);
  assert.equal(parsePublicWishlist({ ...validWishlist, items: [{ card: null }] }), null);
  assert.equal(parsePublicWishlist({ username: "collector", items: [] }), null);
});

test("sends the app version and accepts a valid response", async () => {
  const originalFetch = globalThis.fetch;
  let request: { input?: RequestInfo | URL; init?: RequestInit } = {};
  globalThis.fetch = async (input, init) => {
    request = { input, init };
    return new Response(JSON.stringify(validWishlist), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const result = await fetchPublicWishlist("collector");
    assert.equal(result.username, "collector");
    assert.match(String(request.input), /\/api\/collectors\/collector\/wishlist$/);
    assert.equal(new Headers(request.init?.headers).get("x-app-version"), "1.0.0");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves private and missing states", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [status, kind] of [[403, "private"], [404, "not_found"]] as const) {
      globalThis.fetch = async () => new Response("{}", { status });
      await assert.rejects(
        () => fetchPublicWishlist("collector"),
        (error: unknown) => error instanceof PublicApiError && error.kind === kind,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("never reuses cached wishlist data for another route identity", () => {
  const alice = parsePublicWishlist({
    ...validWishlist,
    username: "alice",
    displayName: "Alice",
  });
  assert.ok(alice);
  assert.equal(selectWishlistForUsername(alice, "alice"), alice);
  assert.equal(selectWishlistForUsername(alice, "bob"), null);

  const destinationFailure = new PublicApiError("private", 403);
  assert.equal(destinationFailure.kind, "private");
  assert.equal(selectWishlistForUsername(alice, "bob"), null);
});