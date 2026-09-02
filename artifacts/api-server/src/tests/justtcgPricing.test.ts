import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  extractJustTcgRawQuote,
  preferredProviderKeyForGrade,
  selectPreferredQuote,
} from "../pricing/justtcg.js";

describe("JustTCG primary raw pricing", () => {
  test("uses the explicit Near Mint normal quote and provider history", () => {
    const quote = extractJustTcgRawQuote(
      {
        id: "pokemon-test-card",
        uuid: "provider-product-1",
        variants: [
          {
            condition: "Lightly Played",
            price: 3.25,
            priceHistory: [{ t: 1_786_320_000, p: 3.25 }],
          },
          {
            condition: "Near Mint",
            printing: "Normal",
            price: 12.34,
            markets: [{ currency: "usd" }],
            lastUpdated: 1_786_406_400,
            priceHistory: [{ t: 1_786_320_000, p: 11.11 }],
          },
        ],
      },
      new Date("2026-08-01T00:00:00.000Z"),
    );

    assert.ok(quote);
    assert.equal(quote.priceCents, 1234);
    assert.equal(quote.currency, "USD");
    assert.equal(quote.providerProductId, "provider-product-1");
    assert.deepEqual(quote.history.map((point) => point.priceCents), [1111]);
  });

  test("treats missing, zero, and malformed prices as unavailable", () => {
    for (const variants of [
      [],
      [{ condition: "Near Mint", price: 0 }],
      [{ condition: "Near Mint", price: "invalid" }],
    ]) {
      assert.equal(
        extractJustTcgRawQuote({ id: "pokemon-test-card", variants }),
        null,
      );
    }
  });

  test("prefers JustTCG only for raw values and never substitutes it for a slab", () => {
    const quotes = [
      { providerKey: "pricecharting", gradeKey: "raw", value: "pc-raw" },
      { providerKey: "justtcg", gradeKey: "raw", value: "just-raw" },
      { providerKey: "pricecharting", gradeKey: "psa_10", value: "pc-psa" },
    ];
    assert.equal(preferredProviderKeyForGrade("raw"), "justtcg");
    assert.equal(preferredProviderKeyForGrade("psa_10"), "pricecharting");
    assert.equal(selectPreferredQuote(quotes, "raw")?.value, "just-raw");
    assert.equal(selectPreferredQuote(quotes, "psa_10")?.value, "pc-psa");
    assert.equal(selectPreferredQuote(quotes, "bgs_10"), null);
  });
});
