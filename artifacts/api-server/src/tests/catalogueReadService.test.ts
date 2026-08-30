import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import {
  deduplicatePublicCards,
  getCatalogueReadMetrics,
  isUnsupportedCanonicalRecord,
  recordCatalogueReadMetric,
  resetCatalogueReadMetrics,
  shapeCanonicalCard,
} from "../catalogue/internal/catalogueReadService.js";

const completeRow = {
  external_id: "pokemon-stage3c-pikachu",
  card_id: "9d2a4db7-0dc3-4c6d-8395-c7eebf57a108",
  name: "Pikachu",
  game: "Pokémon",
  set_name: "Base Set",
  set_code: "BASE1",
  collector_number: "001/102",
  rarity: "Common",
  image_url: "https://images.example.test/pikachu.png",
  language: "en",
  region: "us",
  release_date: "1999-01-09",
  variants: [],
};

afterEach(() => resetCatalogueReadMetrics());

describe("Stage 3C canonical public DTO boundaries", () => {
  test("keeps the JustTCG identifier while never exposing the canonical UUID", () => {
    const card = shapeCanonicalCard({
      ...completeRow,
      variants: [{ id: "9d2a4db7-0dc3-4c6d-8395-c7eebf57a108", key: "normal" }],
    });
    assert.ok(card);
    assert.equal(card.id, completeRow.external_id);
    assert.equal("canonical_id" in card, false);
    assert.equal("card_id" in card, false);
    assert.equal("id" in (card.variants[0] ?? {}), false);
  });

  test("keeps a canonical card available when the provider has no image", () => {
    const card = shapeCanonicalCard({ ...completeRow, image_url: null });
    assert.ok(card);
    assert.equal(card.image_url, null);
  });

  test("requires the public fields needed for a compatible card response", () => {
    assert.equal(shapeCanonicalCard({ ...completeRow, name: "" }), null);
    assert.equal(shapeCanonicalCard({ ...completeRow, set_name: "" }), null);
    assert.equal(shapeCanonicalCard({ ...completeRow, external_id: "" }), null);
  });

  test("allows a complete supported Pokémon record", () => {
    assert.equal(isUnsupportedCanonicalRecord(completeRow), false);
    assert.equal(
      isUnsupportedCanonicalRecord({ ...completeRow, language: "English" }),
      false,
    );
  });

  test("routes Japanese Pokémon records to the compatible fallback", () => {
    for (const language of ["ja", "Japanese", "jpn", "jp"]) {
      assert.equal(
        isUnsupportedCanonicalRecord({ ...completeRow, language }),
        true,
        language,
      );
    }
  });

  test("does not exclude Japanese records for other TCGs", () => {
    assert.equal(
      isUnsupportedCanonicalRecord({
        ...completeRow,
        game: "Magic: The Gathering",
        language: "ja",
      }),
      false,
    );
  });
});

describe("Stage 3C canonical/fallback joining and telemetry", () => {
  test("deduplicates fallback cards using the public JustTCG ID", () => {
    const canonical = shapeCanonicalCard(completeRow);
    assert.ok(canonical);
    const joined = deduplicatePublicCards([canonical], [
      { id: completeRow.external_id, name: "Provider duplicate" },
      { id: "pokemon-stage3c-unmapped", name: "Provider-only card" },
    ]);
    assert.deepEqual(
      joined.map((card) => card.id),
      [completeRow.external_id, "pokemon-stage3c-unmapped"],
    );
    assert.equal(joined[0]?.name, "Pikachu");
  });

  test("reports hit, fallback, error, unsupported and latency metrics", () => {
    recordCatalogueReadMetric("card_lookup", "canonical_hit", 8);
    recordCatalogueReadMetric("search", "fallback", 20);
    recordCatalogueReadMetric("search", "canonical_error", 5);
    recordCatalogueReadMetric("card_lookup", "unsupported_fallback", 12);
    recordCatalogueReadMetric("search", "incomplete", 4);

    assert.deepEqual(getCatalogueReadMetrics(), {
      total: 5,
      canonicalHits: 1,
      justTcgFallbacks: 4,
      mixedReads: 0,
      canonicalErrors: 1,
      unsupportedFallbacks: 1,
      incompleteFallbacks: 1,
      canonicalHitPercentage: 20,
      fallbackPercentage: 80,
      averageLatencyMs: 9.8,
      p95LatencyMs: 20,
    });
  });

  test("starts with an empty metric snapshot", () => {
    assert.deepEqual(getCatalogueReadMetrics(), {
      total: 0,
      canonicalHits: 0,
      justTcgFallbacks: 0,
      mixedReads: 0,
      canonicalErrors: 0,
      unsupportedFallbacks: 0,
      incompleteFallbacks: 0,
      canonicalHitPercentage: 0,
      fallbackPercentage: 0,
      averageLatencyMs: null,
      p95LatencyMs: null,
    });
  });
});