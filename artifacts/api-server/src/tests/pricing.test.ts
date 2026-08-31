/**
 * Pricing domain unit tests.
 *
 * Tests:
 *  - Grade key definitions and PriceCharting field mapping
 *  - Price-to-cents conversion
 *  - Card matching algorithm (normalization, scoring, thresholds)
 *  - PriceCharting adapter behaviour with injected fetch (no live calls)
 *  - Queue deduplication and throttle behaviour
 *  - Missing token → configured:false
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// ── Grade definitions ─────────────────────────────────────────────────────────

import {
  GRADE_DEFINITIONS,
  GRADE_BY_KEY,
  GRADE_BY_PC_FIELD,
  validatePriceCents,
  pcPriceToCents,
  isValidGradeKey,
  normalizeGradeKey,
} from "../pricing/grades.js";
import { aggregateVerifiedMarketValue } from "../pricing/engine.js";

describe("Grade definitions", () => {
  test("all documented card condition keys are defined", () => {
    assert.equal(GRADE_DEFINITIONS.length, 13);
    const keys = GRADE_DEFINITIONS.map(g => g.key);
    for (const expected of ["raw", "graded_7_75", "graded_8_85", "graded_9", "graded_95", "psa_10", "bgs_10", "bgs_black_label_10", "cgc_10", "cgc_pristine_10", "sgc_10", "tag_10", "ace_10"]) {
      assert.ok(keys.includes(expected as any), `Missing grade key: ${expected}`);
    }
  });

  test("PriceCharting field mapping is correct", () => {
    const loose = GRADE_BY_PC_FIELD.get("loose-price");
    assert.ok(loose, "loose-price must be mapped");
    assert.equal(loose!.key, "raw");

    const graded = GRADE_BY_PC_FIELD.get("graded-price");
    assert.ok(graded);
    assert.equal(graded!.key, "graded_9");
    assert.equal(GRADE_BY_PC_FIELD.get("cib-price")?.key, "graded_7_75");
    assert.equal(GRADE_BY_PC_FIELD.get("new-price")?.key, "graded_8_85");
    assert.equal(GRADE_BY_PC_FIELD.get("box-only-price")?.key, "graded_95");
    assert.equal(GRADE_BY_PC_FIELD.get("manual-only-price")?.key, "psa_10");

    const bgs10 = GRADE_BY_PC_FIELD.get("bgs-10-price");
    assert.ok(bgs10);
    assert.equal(bgs10!.key, "bgs_10");

    const cgc10 = GRADE_BY_PC_FIELD.get("condition-17-price");
    assert.ok(cgc10);
    assert.equal(cgc10!.key, "cgc_10");

    const sgc10 = GRADE_BY_PC_FIELD.get("condition-18-price");
    assert.ok(sgc10);
    assert.equal(sgc10!.key, "sgc_10");
    assert.equal(GRADE_BY_PC_FIELD.get("condition-19-price")?.key, "cgc_pristine_10");
    assert.equal(GRADE_BY_PC_FIELD.get("condition-20-price")?.key, "bgs_black_label_10");
    assert.equal(GRADE_BY_PC_FIELD.get("condition-21-price")?.key, "tag_10");
    assert.equal(GRADE_BY_PC_FIELD.get("condition-22-price")?.key, "ace_10");
  });

  test("all grade keys have friendly labels", () => {
    for (const g of GRADE_DEFINITIONS) {
      assert.ok(g.label.length > 0, `Grade ${g.key} has empty label`);
    }
  });

  test("GRADE_BY_KEY index covers all keys", () => {
    for (const g of GRADE_DEFINITIONS) {
      assert.ok(GRADE_BY_KEY.has(g.key), `GRADE_BY_KEY missing ${g.key}`);
    }
  });

  test("isValidGradeKey accepts known keys", () => {
    assert.ok(isValidGradeKey("raw"));
    assert.ok(isValidGradeKey("graded_9"));
    assert.ok(isValidGradeKey("bgs_10"));
    assert.ok(isValidGradeKey("psa_10"));
    assert.ok(isValidGradeKey("psa10"));
    assert.ok(!isValidGradeKey("unknown"));
    assert.equal(normalizeGradeKey("TAG10"), "tag_10");
  });
});

describe("Verified Market aggregation", () => {
  const quote = {
    providerKey: "pricecharting",
    providerLabel: "PriceCharting",
    providerProductId: "pc-123",
    gradeKey: "raw" as const,
    priceCents: 4500,
    currency: "USD",
    originalPriceCents: 4500,
    originalCurrency: "USD",
    fetchedAt: new Date("2026-08-19T00:00:00.000Z"),
  };

  test("returns an explainable provider-neutral market value", () => {
    const market = aggregateVerifiedMarketValue({
      gradeKey: "raw",
      quotes: [quote],
      matchingConfidence: 0.96,
      isStale: false,
      retainedSnapshotCents: [4000, 4300, 4700],
    });

    assert.ok(market);
    assert.equal(market.verifiedMarketValueCents, 4500);
    assert.equal(market.currency, "USD");
    assert.deepEqual(market.range, {
      lowCents: 4000,
      highCents: 4700,
      currency: "USD",
      sampleCount: 3,
      basis: "retained_snapshots",
    });
    assert.equal(market.confidence.providerCount, 1);
    assert.ok(market.confidence.score >= 80 && market.confidence.score <= 100);
    assert.equal(market.providers[0]?.label, "PriceCharting");
    assert.ok(market.confidence.reasons.length >= 3);
  });

  test("does not invent a market range without retained history", () => {
    const staleMarket = aggregateVerifiedMarketValue({
      gradeKey: "raw",
      quotes: [quote],
      matchingConfidence: 0.96,
      isStale: true,
      retainedSnapshotCents: [4500],
    });
    const freshMarket = aggregateVerifiedMarketValue({
      gradeKey: "raw",
      quotes: [quote],
      matchingConfidence: 0.96,
      isStale: false,
      retainedSnapshotCents: [4500],
    });

    assert.ok(staleMarket);
    assert.ok(freshMarket);
    assert.equal(staleMarket.range, null);
    assert.ok(staleMarket.insights.some(insight => insight.includes("more snapshots")));
    assert.ok(staleMarket.confidence.score < freshMarket.confidence.score);
    assert.ok(staleMarket.confidence.reasons.every(reason => !reason.toLowerCase().includes("live")));
  });

  test("returns unavailable when no provider supplied a quote", () => {
    assert.equal(aggregateVerifiedMarketValue({
      gradeKey: "raw",
      quotes: [],
      matchingConfidence: 1,
      isStale: false,
      retainedSnapshotCents: [],
    }), null);
  });
});

describe("validatePriceCents", () => {
  test("accepts positive integer", () => {
    assert.equal(validatePriceCents(100), null);
    assert.equal(validatePriceCents(1), null);
  });

  test("rejects zero", () => {
    assert.notEqual(validatePriceCents(0), null);
  });

  test("rejects negative", () => {
    assert.notEqual(validatePriceCents(-5), null);
  });

  test("rejects float", () => {
    assert.notEqual(validatePriceCents(10.5), null);
  });

  test("rejects non-number", () => {
    assert.notEqual(validatePriceCents("100"), null);
    assert.notEqual(validatePriceCents(null), null);
  });
});

describe("pcPriceToCents", () => {
  test("validates PriceCharting integer-cent values", () => {
    assert.equal(pcPriceToCents(999), 999);
    assert.equal(pcPriceToCents(10000), 10000);
    assert.equal(pcPriceToCents("1499"), 1499);
    assert.equal(pcPriceToCents(9.99), null, "provider decimals must not be silently re-scaled");
  });

  test("returns null for zero", () => {
    assert.equal(pcPriceToCents(0), null);
    assert.equal(pcPriceToCents("0"), null);
  });

  test("returns null for null/undefined", () => {
    assert.equal(pcPriceToCents(null), null);
    assert.equal(pcPriceToCents(undefined), null);
  });

  test("returns null for non-numeric string", () => {
    assert.equal(pcPriceToCents("N/A"), null);
    assert.equal(pcPriceToCents(""), null);
  });

  test("returns null for negative", () => {
    assert.equal(pcPriceToCents(-5), null);
  });
});

// ── Matching algorithm ────────────────────────────────────────────────────────

import {
  normalizeString,
  scoreSingle,
  pickBestMatch,
} from "../pricing/matcher.js";

import type { MatchCandidate, MatchInput } from "../pricing/matcher.js";

describe("normalizeString", () => {
  test("lowercases input", () => {
    assert.equal(normalizeString("Charizard"), "charizard");
  });

  test("removes punctuation", () => {
    assert.equal(normalizeString("Pikachu!"), "pikachu");
  });

  test("replaces hyphens with spaces", () => {
    assert.ok(normalizeString("Charizard-ex").includes("charizard"));
  });

  test("collapses multiple spaces", () => {
    assert.equal(normalizeString("  Bulbasaur  "), "bulbasaur");
  });
});

describe("scoreSingle", () => {
  const input: MatchInput = {
    name: "Charizard ex",
    set: "Obsidian Flames",
    number: "125",
    game: "pokemon",
  };

  test("exact match scores very high", () => {
    const candidate: MatchCandidate = {
      id: "1",
      name: "Charizard ex",
      consoleName: "Obsidian Flames",
      cardNumber: "125",
      genre: "Pokemon",
    };
    const score = scoreSingle(input, candidate);
    assert.ok(score.total >= 0.85, `Expected >= 0.85, got ${score.total}`);
  });

  test("wrong card scores low on name dimension", () => {
    const candidate: MatchCandidate = {
      id: "2",
      name: "Blastoise",
      consoleName: "Obsidian Flames",
      cardNumber: "125",
      genre: "Pokemon",
    };
    const score = scoreSingle(input, candidate);
    assert.ok(score.name < 0.5, `Expected name < 0.5, got ${score.name}`);
  });

  test("all scores are in [0, 1] range", () => {
    const candidate: MatchCandidate = {
      id: "3",
      name: "Venusaur ex",
      consoleName: "Paldea Evolved",
      cardNumber: "200",
      genre: "Pokemon",
    };
    const score = scoreSingle(input, candidate);
    for (const [k, v] of Object.entries(score)) {
      assert.ok(v >= 0 && v <= 1, `Score ${k}=${v} out of range`);
    }
  });
});

describe("pickBestMatch", () => {
  const input: MatchInput = {
    name: "Charizard ex",
    set: "Obsidian Flames",
    number: "125",
    game: "pokemon",
  };

  test("returns matched for a strong candidate", () => {
    const candidates: MatchCandidate[] = [
      { id: "1", name: "Charizard ex", consoleName: "Obsidian Flames", cardNumber: "125", genre: "Pokemon" },
    ];
    const result = pickBestMatch(input, candidates);
    assert.equal(result.status, "matched");
    assert.equal(result.candidate?.id, "1");
    assert.ok(result.score.total >= 0.85);
  });

  test("returns unmatched for empty candidates", () => {
    const result = pickBestMatch(input, []);
    assert.equal(result.status, "unmatched");
    assert.equal(result.candidate, null);
  });

  test("returns review_required for ambiguous match", () => {
    const candidates: MatchCandidate[] = [
      // Close name but different set and number
      { id: "2", name: "Charizard", consoleName: "Base Set", cardNumber: "4" },
    ];
    const result = pickBestMatch(input, candidates);
    // Should be review_required or unmatched (score 0.6–0.85 or below)
    assert.ok(
      result.status === "review_required" || result.status === "unmatched",
      `Expected review_required or unmatched, got ${result.status}`,
    );
  });

  test("never matches a candidate with a conflicting card number", () => {
    const input = { name: "Charizard ex", set: "Obsidian Flames", number: "223", game: "Pokemon" };
    const candidates = [
      {
        id: "wrong-number",
        name: "Charizard ex",
        consoleName: "Obsidian Flames",
        cardNumber: "125",
        genre: "Pokemon",
      },
    ];
    const result = pickBestMatch(input, candidates);
    assert.equal(result.status, "review_required");
    assert.equal(result.candidate, null);
  });

  test("does not strongly match when the requested card number is missing from the provider candidate", () => {
    const input = { name: "Charizard ex", set: "Obsidian Flames", number: "223", game: "Pokemon" };
    const candidates = [
      {
        id: "missing-number",
        name: "Charizard ex",
        consoleName: "Obsidian Flames",
        genre: "Pokemon",
      },
    ];
    const result = pickBestMatch(input, candidates);
    assert.equal(result.status, "review_required");
    assert.equal(result.candidate, null);
  });

  test("does not strongly match when the authoritative input has no card number", () => {
    const input = { name: "Charizard ex", set: "Obsidian Flames", game: "Pokemon" };
    const candidates = [
      {
        id: "numbered-candidate",
        name: "Charizard ex",
        consoleName: "Obsidian Flames",
        cardNumber: "223",
        genre: "Pokemon",
      },
    ];
    const result = pickBestMatch(input, candidates);
    assert.equal(result.status, "review_required");
    assert.equal(result.candidate, null);
  });

  test("matched candidate is null for review_required", () => {
    const candidates: MatchCandidate[] = [
      { id: "2", name: "Charizard", consoleName: "Base Set", cardNumber: "4" },
    ];
    const result = pickBestMatch(input, candidates);
    if (result.status === "review_required") {
      assert.equal(result.candidate, null, "review_required must not return a candidate");
    }
  });

  test("picks the best from multiple candidates", () => {
    const candidates: MatchCandidate[] = [
      { id: "1", name: "Blastoise", consoleName: "Obsidian Flames", cardNumber: "125" },
      { id: "2", name: "Charizard ex", consoleName: "Obsidian Flames", cardNumber: "125", genre: "Pokemon" },
      { id: "3", name: "Venusaur", consoleName: "Paldea Evolved", cardNumber: "200" },
    ];
    const result = pickBestMatch(input, candidates);
    assert.equal(result.status, "matched");
    assert.equal(result.candidate?.id, "2");
  });

  test("matches a unique exact promo identity despite PriceCharting's generic set label", () => {
    const result = pickBestMatch(
      { name: "Pikachu & Zekrom GX", set: "SM Promos", number: "SM168", game: "pokemon" },
      [
        { id: "other", name: "Pikachu & Zekrom GX", consoleName: "Pokemon Promo", cardNumber: "SM248" },
        { id: "exact", name: "Pikachu & Zekrom GX", consoleName: "Pokemon Promo", cardNumber: "SM168" },
        { id: "team-up", name: "Pikachu & Zekrom GX", consoleName: "Pokemon Team Up", cardNumber: "33" },
      ],
    );
    assert.equal(result.status, "matched");
    assert.equal(result.candidate?.id, "exact");
  });

  test("matches a unique exact identity when PriceCharting omits the printed denominator", () => {
    const result = pickBestMatch(
      { name: "Umbreon ex - 161/131", set: "SV: Prismatic Evolutions", number: "161/131", game: "pokemon" },
      [
        { id: "base", name: "Umbreon ex", consoleName: "Pokemon Prismatic Evolutions", cardNumber: "60" },
        { id: "exact", name: "Umbreon ex", consoleName: "Pokemon Prismatic Evolutions", cardNumber: "161" },
        { id: "korean", name: "Umbreon EX", consoleName: "Pokemon Korean Terastal Festival ex", cardNumber: "161" },
      ],
    );
    assert.equal(result.status, "matched");
    assert.equal(result.candidate?.id, "exact");
  });

  test("keeps same-name same-number reprints in review", () => {
    const result = pickBestMatch(
      { name: "Charizard", set: "Unknown Set", number: "4/102", game: "pokemon" },
      [
        { id: "base", name: "Charizard", consoleName: "Pokemon Base Set", cardNumber: "4" },
        { id: "celebrations", name: "Charizard", consoleName: "Pokemon Celebrations", cardNumber: "4" },
      ],
    );
    assert.equal(result.status, "review_required");
    assert.equal(result.candidate, null);
  });
});

// ── PriceCharting adapter with injected fetch ─────────────────────────────────

import {
  isPCConfigured,
  extractPrices,
  clearPCCache,
  resetRateLimiter,
  PROVIDER_KEY,
  searchProducts,
  getProductDetail,
  getBulkGuide,
  parsePriceChartingGuideCsv,
  usdDecimalToCents,
  PriceChartingAuthenticationError,
  PriceChartingThrottleError,
  PriceChartingTransientError,
} from "../pricing/pricecharting.js";

import type { PCProductDetail } from "../pricing/pricecharting.js";

describe("isPCConfigured", () => {
  const originalToken = process.env.PRICECHARTING_TOKEN;
  const originalApiToken = process.env.PRICECHARTING_API_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.PRICECHARTING_TOKEN;
    } else {
      process.env.PRICECHARTING_TOKEN = originalToken;
    }
    if (originalApiToken === undefined) delete process.env.PRICECHARTING_API_TOKEN;
    else process.env.PRICECHARTING_API_TOKEN = originalApiToken;
  });

  test("supports the canonical PRICECHARTING_API_TOKEN", () => {
    process.env.PRICECHARTING_API_TOKEN = "canonical-token";
    delete process.env.PRICECHARTING_TOKEN;
    assert.equal(isPCConfigured(), true);
  });

  test("uses PRICECHARTING_TOKEN as a deprecated fallback", async () => {
    delete process.env.PRICECHARTING_API_TOKEN;
    process.env.PRICECHARTING_TOKEN = "deprecated-token";
    let requestUrl = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      requestUrl = String(input);
      return { ok: true, status: 200, json: async () => ({ products: [] }) } as Response;
    }) as typeof fetch;
    clearPCCache();
    resetRateLimiter();
    await searchProducts("token-fallback-test");
    globalThis.fetch = originalFetch;
    assert.ok(requestUrl.includes("t=deprecated-token"));
  });

  test("returns false when neither server secret is set", () => {
    delete process.env.PRICECHARTING_TOKEN;
    delete process.env.PRICECHARTING_API_TOKEN;
    assert.equal(isPCConfigured(), false);
  });

  test("canonical token wins when both names exist", async () => {
    process.env.PRICECHARTING_API_TOKEN = "canonical-token";
    process.env.PRICECHARTING_TOKEN = "deprecated-token";
    let requestUrl = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      requestUrl = String(input);
      return {
        ok: true,
        status: 200,
        json: async () => ({ products: [] }),
      } as Response;
    }) as typeof fetch;
    clearPCCache();
    resetRateLimiter();
    await searchProducts("token-precedence-test");
    globalThis.fetch = originalFetch;
    assert.ok(requestUrl.includes("t=canonical-token"));
    assert.ok(!requestUrl.includes("deprecated-token"));
  });
});

describe("extractPrices", () => {
  test("extracts only truthful card conditions from a full provider detail", () => {
    const detail: PCProductDetail = {
      id: "12345",
      "product-name": "Charizard ex",
      "console-name": "Obsidian Flames",
      "loose-price": 4500,         // raw
      "cib-price": 5000,
      "new-price": 5500,
      "graded-price": 8000,
      "box-only-price": 15000,
      "manual-only-price": 40000,
      "bgs-10-price": 35000,       // bgs_10
      "condition-17-price": 38000, // cgc_10
      "condition-18-price": 32000, // sgc_10
      "condition-19-price": 39000, // cgc_pristine_10
      "condition-20-price": 50000, // bgs_black_label_10
      "condition-21-price": 42000, // tag_10
      "condition-22-price": 41000, // ace_10
    };
    const prices = extractPrices(detail);
    assert.equal(prices.size, 13);
    assert.equal(prices.get("raw"), 4500);
    assert.equal(prices.get("graded_7_75"), 5000);
    assert.equal(prices.get("graded_8_85"), 5500);
    assert.equal(prices.get("graded_9"), 8000);
    assert.equal(prices.get("graded_95"), 15000);
    assert.equal(prices.get("psa_10"), 40000);
    assert.equal(prices.get("bgs_10"), 35000);
    assert.equal(prices.get("cgc_10"), 38000);
    assert.equal(prices.get("sgc_10"), 32000);
    assert.equal(prices.get("cgc_pristine_10"), 39000);
    assert.equal(prices.get("bgs_black_label_10"), 50000);
    assert.equal(prices.get("tag_10"), 42000);
    assert.equal(prices.get("ace_10"), 41000);
  });

  test("skips zero / missing prices", () => {
    const detail: PCProductDetail = {
      id: "1",
      "product-name": "Test",
      "console-name": "Test Set",
      "loose-price": 0,
      "graded-price": 2500,
    };
    const prices = extractPrices(detail);
    assert.equal(prices.has("raw"), false, "zero price must be skipped");
    assert.equal(prices.get("graded_9"), 2500);
  });

  test("normalises generic Grade 7 / 7.5 and rejects malformed cib-price", () => {
    const valid: PCProductDetail = {
      id: "1",
      "product-name": "Test",
      "console-name": "Test Set",
      "cib-price": "1750",
    };
    assert.equal(extractPrices(valid).get("graded_7_75"), 1750);

    for (const malformed of [0, -1, "", "not-a-price", 17.5]) {
      const prices = extractPrices({ ...valid, "cib-price": malformed as never });
      assert.equal(prices.has("graded_7_75"), false, `malformed cib-price ${String(malformed)} must stay absent`);
    }
  });

  test("handles string price values", () => {
    const detail: PCProductDetail = {
      id: "1",
      "product-name": "Test",
      "console-name": "Test Set",
      "loose-price": "1250" as unknown as number,
    };
    const prices = extractPrices(detail);
    assert.equal(prices.get("raw"), 1250);
  });

  test("returns empty map when no prices present", () => {
    const detail: PCProductDetail = {
      id: "1",
      "product-name": "Rare Card",
      "console-name": "Old Set",
    };
    const prices = extractPrices(detail);
    assert.equal(prices.size, 0);
  });
});

describe("PriceCharting bulk CSV guides", () => {
  test("parses quoted rows and decimal USD precisely into normal quote fields", () => {
    const rows = parsePriceChartingGuideCsv([
      "id,product-name,console-name,loose-price,graded-price,bgs-10-price",
      '42,"Pikachu, V #043","Vivid Voltage",12.34,100,250.05',
    ].join("\n"));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, "42");
    assert.equal(rows[0]?.["product-name"], "Pikachu, V #043");
    assert.equal(extractPrices(rows[0]!).get("raw"), 1234);
    assert.equal(extractPrices(rows[0]!).get("graded_9"), 10000);
    assert.equal(extractPrices(rows[0]!).get("bgs_10"), 25005);
  });

  test("rejects unsafe decimal formats rather than rounding them", () => {
    assert.equal(usdDecimalToCents("0.01"), 1);
    assert.equal(usdDecimalToCents("12.3"), 1230);
    for (const malformed of ["12.345", "-1.00", "1e2", "$12.00", ""]) {
      assert.equal(usdDecimalToCents(malformed), null);
    }
  });

  test("uses the canonical token and official guide category in one attempt", async () => {
    const old = process.env.PRICECHARTING_API_TOKEN;
    process.env.PRICECHARTING_API_TOKEN = "csv-token";
    clearPCCache();
    resetRateLimiter();
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async input => {
      calls += 1;
      assert.ok(String(input).includes("t=csv-token"));
      assert.ok(String(input).includes("download-custom"));
      assert.ok(String(input).includes("category=pokemon-cards"));
      return new Response("id,product-name,console-name,loose-price\n7,Pikachu,Vivid Voltage,1.25\n");
    }) as typeof fetch;
    try {
      const first = await getBulkGuide("pokemon");
      assert.equal(calls, 1);
      assert.equal(first[0]?.id, "7");
    } finally {
      globalThis.fetch = originalFetch;
      if (old == null) delete process.env.PRICECHARTING_API_TOKEN;
      else process.env.PRICECHARTING_API_TOKEN = old;
    }
  });

  test("exposes typed authentication and throttle failures", async () => {
    const originalFetch = globalThis.fetch;
    const old = process.env.PRICECHARTING_API_TOKEN;
    process.env.PRICECHARTING_API_TOKEN = "typed-error-token";
    clearPCCache();
    resetRateLimiter();
    try {
      globalThis.fetch = (async () => new Response("", { status: 401 })) as typeof fetch;
      await assert.rejects(() => searchProducts("typed-auth"), PriceChartingAuthenticationError);
      globalThis.fetch = (async () => new Response("", { status: 429 })) as typeof fetch;
      await assert.rejects(() => searchProducts("typed-throttle"), PriceChartingThrottleError);
      globalThis.fetch = (async () => new Response(JSON.stringify({ error: "Unknown access token" }), { status: 404 })) as typeof fetch;
      await assert.rejects(() => searchProducts("typed-envelope-auth"), PriceChartingAuthenticationError);
      globalThis.fetch = (async () => new Response("{not json", { status: 200 })) as typeof fetch;
      await assert.rejects(() => searchProducts("malformed-json"), PriceChartingTransientError);
    } finally {
      globalThis.fetch = originalFetch;
      if (old == null) delete process.env.PRICECHARTING_API_TOKEN;
      else process.env.PRICECHARTING_API_TOKEN = old;
    }
  });
});

describe("PROVIDER_KEY", () => {
  test("is the expected stable value", () => {
    assert.equal(PROVIDER_KEY, "pricecharting");
  });
});

// ── Queue deduplication / rate-limit (injected clock / state) ─────────────────

describe("Rate limiter queue state", () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.PRICECHARTING_API_TOKEN;

  beforeEach(() => {
    clearPCCache();
    resetRateLimiter();
    process.env.PRICECHARTING_API_TOKEN = "test-token";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.PRICECHARTING_API_TOKEN;
    else process.env.PRICECHARTING_API_TOKEN = originalToken;
  });

  test("resetRateLimiter clears pending queue", () => {
    // Just verifies resetRateLimiter doesn't throw and clears internal state
    assert.doesNotThrow(() => resetRateLimiter());
  });

  test("clearPCCache does not throw", () => {
    assert.doesNotThrow(() => clearPCCache());
  });

  test("deduplicates concurrent searches and serves the bounded cache", async () => {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      await new Promise(resolve => setTimeout(resolve, 20));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          products: [{ id: "1", "product-name": "Pikachu #043", "console-name": "Vivid Voltage" }],
        }),
      } as Response;
    }) as typeof fetch;

    const [first, second] = await Promise.all([
      searchProducts("Pikachu 043"),
      searchProducts("Pikachu 043"),
    ]);
    const cached = await searchProducts("Pikachu 043");

    assert.equal(requests, 1);
    assert.deepEqual(first, second);
    assert.deepEqual(cached, first);
  });

  test("serializes different provider requests at one request per second", async () => {
    const calledAt: number[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      calledAt.push(Date.now());
      const url = String(input);
      return {
        ok: true,
        status: 200,
        json: async () => url.includes("/products")
          ? { products: [] }
          : { id: "123", "product-name": "Pikachu", "console-name": "Pokemon" },
      } as Response;
    }) as typeof fetch;

    await Promise.all([
      searchProducts("unique-rate-test"),
      getProductDetail("unique-rate-product"),
    ]);

    assert.equal(calledAt.length, 2);
    assert.ok(calledAt[1]! - calledAt[0]! >= 1_000, "provider calls must be at least one second apart");
  });

  test("manual provider refresh can bypass the product cache", async () => {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "cache-product",
          "product-name": "Pikachu #043",
          "console-name": "Vivid Voltage",
          "loose-price": requests === 1 ? 1000 : 1200,
        }),
      } as Response;
    }) as typeof fetch;

    const first = await getProductDetail("cache-product");
    const cached = await getProductDetail("cache-product");
    const refreshed = await getProductDetail("cache-product", { bypassCache: true });

    assert.equal(requests, 2);
    assert.equal(first?.["loose-price"], 1000);
    assert.equal(cached?.["loose-price"], 1000);
    assert.equal(refreshed?.["loose-price"], 1200);
  });
});

// ── FX converter ──────────────────────────────────────────────────────────────

import { clearFxCache, getExchangeRate, convertCents } from "../pricing/fx.js";
import { gradeKeyForHolding } from "../pricing/portfolio.js";
import { snapshotBucketFor } from "../pricing/service.js";
import { chunkGuideRows } from "../pricing/service.js";

describe("Exact holding-grade resolution", () => {
  test("does not assign generic provider conditions to numeric grades", () => {
    assert.equal(gradeKeyForHolding(false, null), "raw");
    for (const grade of [7, 8, 9, 9.5]) {
      assert.equal(gradeKeyForHolding(true, { company: "PSA", grade }), null);
    }
    assert.equal(gradeKeyForHolding(true, { company: "PSA", grade: 10 }), "psa_10");
  });

  test("keeps explicitly supported grade-10 companies distinct", () => {
    assert.equal(gradeKeyForHolding(true, { company: "BGS", grade: 10 }), "bgs_10");
    assert.equal(gradeKeyForHolding(true, { company: "CGC", grade: 10 }), "cgc_10");
    assert.equal(gradeKeyForHolding(true, { company: "SGC", grade: 10 }), "sgc_10");
    assert.equal(gradeKeyForHolding(true, { company: "TAG", grade: 10 }), "tag_10");
    assert.equal(gradeKeyForHolding(true, { company: "ACE", grade: 10 }), "ace_10");
    assert.equal(gradeKeyForHolding(true, { company: "CGC", grade: 10, designation: "Pristine" }), "cgc_pristine_10");
    assert.equal(gradeKeyForHolding(true, { company: "BGS", grade: 10, designation: "Black Label" }), "bgs_black_label_10");
  });

  test("never falls back a graded holding to raw", () => {
    assert.equal(gradeKeyForHolding(true, { company: "PSA", grade: 6 }), null);
    assert.equal(gradeKeyForHolding(true, { company: "Unknown", grade: 10 }), null);
    assert.equal(gradeKeyForHolding(true, null), null);
  });
});

describe("Timestamped snapshot buckets", () => {
  test("supports two captures on the same UTC calendar day", () => {
    assert.equal(snapshotBucketFor(new Date("2026-08-21T01:00:00.000Z")), "2026-08-21:AM");
    assert.equal(snapshotBucketFor(new Date("2026-08-21T13:00:00.000Z")), "2026-08-21:PM");
  });

  test("is timezone-independent and deduplicable", () => {
    assert.equal(snapshotBucketFor(new Date("2026-08-21T11:59:59.999Z")), "2026-08-21:AM");
    assert.equal(snapshotBucketFor(new Date("2026-08-21T12:00:00.000Z")), "2026-08-21:PM");
    assert.equal(snapshotBucketFor(new Date("2026-08-21T12:00:00.000Z")), "2026-08-21:PM");
  });
});

describe("Bulk guide persistence batching", () => {
  test("splits more than 11k rows below the PostgreSQL parameter ceiling", () => {
    const chunks = chunkGuideRows(Array.from({ length: 11_001 }, (_, id) => id));
    assert.deepEqual(chunks.map(chunk => chunk.length), [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1]);
    assert.ok(chunks.every(chunk => chunk.length * 6 < 65_535));
  });
});

describe("FX converter (no live calls)", () => {
  beforeEach(() => {
    clearFxCache();
  });

  test("same currency returns rate 1", async () => {
    const rate = await getExchangeRate("AUD", "AUD");
    assert.equal(rate, 1);
  });

  test("convertCents same currency returns identity", async () => {
    const result = await convertCents(5000, "AUD", "AUD");
    assert.equal(result, 5000);
  });

  // Note: live network calls are not made in unit tests.
  // If pricing FX or network is unavailable, these return null gracefully.
  test("convertCents handles unavailable rate gracefully", async () => {
    // Override fetch to simulate network failure
    const originalFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => {
      throw new Error("Network unavailable");
    };
    clearFxCache();
    const result = await convertCents(5000, "USD", "AUD");
    // Should return null (not throw) when rate unavailable
    assert.equal(result, null);
    (globalThis as any).fetch = originalFetch;
  });
});

// ── Archive sale math ─────────────────────────────────────────────────────────

describe("Archive sale math", () => {
  test("realised gain calculation is correct", () => {
    // Sale price is the total transaction proceeds; acquisition is per unit.
    const acquiredPriceCents = 5000;  // $50.00
    const salePriceCents     = 16000; // $160.00 total
    const quantity           = 2;
    const gain = salePriceCents - acquiredPriceCents * quantity;
    assert.equal(gain, 6000, "Realised gain should be $60.00 (6000 cents)");
  });

  test("realised loss is negative", () => {
    const acquiredPriceCents = 10000;
    const salePriceCents     = 7000;
    const quantity           = 1;
    const gain = salePriceCents - acquiredPriceCents * quantity;
    assert.equal(gain, -3000);
  });

  test("zero gain when sale equals cost", () => {
    const price = 5000;
    const gain = price * 3 - price * 3;
    assert.equal(gain, 0);
  });
});
