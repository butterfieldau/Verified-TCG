import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  extractJustTcgGradedQuotes,
  extractJustTcgRawQuote,
  gradeKeyFromJustTcgGrading,
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

  test("maps only exact supported JustTCG grading identities", () => {
    assert.equal(gradeKeyFromJustTcgGrading({ company: "PSA", grade: 10 }), "psa_10");
    assert.equal(
      gradeKeyFromJustTcgGrading({ company: "BGS", grade: 10, canonical: "BGS Black Label 10" }),
      "bgs_black_label_10",
    );
    assert.equal(
      gradeKeyFromJustTcgGrading({ company: "CGC", grade: 10, canonical: "CGC Pristine 10" }),
      "cgc_pristine_10",
    );
    assert.equal(gradeKeyFromJustTcgGrading({ company: "PSA", grade: 9 }), null);
    assert.equal(gradeKeyFromJustTcgGrading({ company: "Generic", grade: 7.5 }), null);
  });

  test("extracts exact graded quotes and their NA history without raw substitution", () => {
    const quotes = extractJustTcgGradedQuotes(
      {
        id: "v2-card-uuid",
        slug: "pokemon-test-card",
        variants: [
          {
            type: "raw",
            markets: [{ region: "NA", currency: "USD", price: 12.34 }],
          },
          {
            type: "graded",
            grading: { company: "PSA", grade: 10, canonical: "PSA 10" },
            markets: [{
              region: "NA",
              currency: "USD",
              price: 4567.89,
              updated_at: 1_786_406_400,
              price_history: [{ t: 1_786_320_000, p: 4500 }],
            }],
          },
          {
            type: "graded",
            grading: { company: "PSA", grade: 9 },
            markets: [{ region: "NA", currency: "USD", price: 123 }],
          },
        ],
      },
      "pokemon-test-card",
      new Date("2026-08-01T00:00:00.000Z"),
    );

    assert.equal(quotes.length, 1);
    assert.deepEqual(quotes[0], {
      cardId: "pokemon-test-card",
      providerProductId: "v2-card-uuid",
      gradeKey: "psa_10",
      priceCents: 456789,
      currency: "USD",
      fetchedAt: new Date("2026-08-11T00:00:00.000Z"),
      history: [{
        snapshotDate: "2026-08-10",
        priceCents: 450000,
        recordedAt: new Date("2026-08-10T00:00:00.000Z"),
      }],
    });
  });

  test("rejects graded variants that are ambiguous or not for the requested card", () => {
    const ambiguous = {
      id: "v2-card-uuid",
      slug: "pokemon-test-card",
      variants: [
        {
          type: "graded",
          printing: "Normal",
          grading: { company: "PSA", grade: 10 },
          markets: [{ region: "NA", currency: "USD", price: 100 }],
        },
        {
          type: "graded",
          printing: "Holofoil",
          grading: { company: "PSA", grade: 10 },
          markets: [{ region: "NA", currency: "USD", price: 200 }],
        },
      ],
    };
    assert.deepEqual(extractJustTcgGradedQuotes(ambiguous, "pokemon-test-card"), []);
    assert.deepEqual(extractJustTcgGradedQuotes(ambiguous, "another-card"), []);
  });

  test("uses JustTCG raw by default and JustTCG grade values only when the v2 flag is enabled", () => {
    const quotes = [
      { providerKey: "pricecharting", gradeKey: "raw", value: "pc-raw" },
      { providerKey: "justtcg", gradeKey: "raw", value: "just-raw" },
      { providerKey: "justtcg", gradeKey: "psa_10", value: "just-psa" },
      { providerKey: "pricecharting", gradeKey: "psa_10", value: "pc-psa" },
    ];
    assert.equal(preferredProviderKeyForGrade("raw"), "justtcg");
    assert.equal(preferredProviderKeyForGrade("psa_10"), "pricecharting");
    assert.equal(
      preferredProviderKeyForGrade("psa_10", { justTcgGradedPricingEnabled: true }),
      "justtcg",
    );
    assert.equal(selectPreferredQuote(quotes, "raw")?.value, "just-raw");
    assert.equal(selectPreferredQuote(quotes, "psa_10")?.value, "pc-psa");
    assert.equal(
      selectPreferredQuote(quotes, "psa_10", { justTcgGradedPricingEnabled: true })?.value,
      "just-psa",
    );
    assert.equal(selectPreferredQuote(quotes, "bgs_10"), null);
  });
});
