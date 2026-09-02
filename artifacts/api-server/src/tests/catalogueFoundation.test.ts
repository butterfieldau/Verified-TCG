import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCollectorNumber,
  normalizeForMatching,
  normalizeGameSlug,
  normalizeSetCode,
} from "../catalogue/internal/catalogueNormalisation.js";
import { canonicalIdentitySignature } from "../catalogue/internal/catalogueIdentity.js";
import {
  emptyImportCounters,
  sanitizeImportError,
} from "../catalogue/internal/catalogueIngestion.js";
import { normalizeJustTcgCard } from "../catalogue/internal/justTcgCanonicalAdapter.js";

describe("Stage 3A catalogue normalisation", () => {
  test("normalises supported game aliases without making provider IDs canonical", () => {
    assert.equal(normalizeGameSlug("Pokémon"), "pokemon");
    assert.equal(normalizeGameSlug("pokemon-tcg"), "pokemon");
    assert.equal(
      normalizeGameSlug("Magic: The Gathering"),
      "magic-the-gathering",
    );
    assert.equal(normalizeGameSlug("Yu-Gi-Oh!"), "yu-gi-oh");
    assert.equal(normalizeGameSlug("Unknown Provider ID"), null);
  });

  test("normalises aliases for lookup while retaining canonical display separately", () => {
    assert.equal(normalizeForMatching("Monkey.D.Luffy"), "monkey d luffy");
    assert.equal(normalizeForMatching("Pokémon  Évolué"), "pokemon evolue");
  });

  test("preserves meaningful collector number formatting", () => {
    assert.equal(normalizeCollectorNumber("001"), "001");
    assert.equal(normalizeCollectorNumber("1"), "1");
    assert.equal(normalizeCollectorNumber("001 / 198"), "001/198");
    assert.equal(normalizeCollectorNumber("P - 110"), "P-110");
    assert.equal(normalizeCollectorNumber("sm168"), "SM168");
    assert.equal(normalizeCollectorNumber("tg05 / tg30"), "TG05/TG30");
    assert.equal(normalizeSetCode(" op - 05 "), "OP-05");
  });

  test("builds an identity only when a resolved set and collector number exist", () => {
    const identity = canonicalIdentitySignature({
      game: "Pokemon",
      setId: "set-uuid",
      collectorNumber: "001/198",
      language: "en",
      variantKey: "foil",
    });
    assert.equal(identity, "pokemon|set-uuid|001/198|en|foil");
    assert.equal(
      canonicalIdentitySignature({
        game: "Pokemon",
        setCode: "SV1",
        collectorNumber: null,
      }),
      null,
    );
  });

  test("keeps same-name and same-number cards in different sets distinct", () => {
    const baseSet = canonicalIdentitySignature({
      game: "Pokemon",
      setId: "base-set-uuid",
      collectorNumber: "001",
    });
    const promoSet = canonicalIdentitySignature({
      game: "Pokemon",
      setId: "promo-set-uuid",
      collectorNumber: "001",
    });
    assert.notEqual(baseSet, promoSet);
  });

  test("keeps variants distinct without treating them as separate base cards", () => {
    const foil = canonicalIdentitySignature({
      game: "Magic",
      setId: "set-uuid",
      collectorNumber: "123",
      variantKey: "foil",
    });
    const nonFoil = canonicalIdentitySignature({
      game: "Magic",
      setId: "set-uuid",
      collectorNumber: "123",
      variantKey: "non-foil",
    });
    const stamped = canonicalIdentitySignature({
      game: "One Piece",
      setId: "set-uuid",
      collectorNumber: "P-110",
      variantKey: "winner-stamp",
    });
    const firstEdition = canonicalIdentitySignature({
      game: "Yu-Gi-Oh!",
      setId: "set-uuid",
      collectorNumber: "001",
      variantKey: "first-edition",
      language: "en",
    });
    const unlimited = canonicalIdentitySignature({
      game: "Yu-Gi-Oh!",
      setId: "set-uuid",
      collectorNumber: "001",
      variantKey: "unlimited",
      language: "en",
    });
    const japanese = canonicalIdentitySignature({
      game: "Yu-Gi-Oh!",
      setId: "set-uuid",
      collectorNumber: "001",
      variantKey: "unlimited",
      language: "ja",
    });
    assert.notEqual(foil, nonFoil);
    assert.match(stamped ?? "", /winner stamp$/);
    assert.notEqual(firstEdition, unlimited);
    assert.notEqual(unlimited, japanese);
  });

  test("adapts a JustTCG record as a future ingestion candidate only", () => {
    const candidate = normalizeJustTcgCard({
      id: "justtcg-123",
      game: "Pokémon",
      name: " Pikachu ",
      set_name: "Base Set",
      set_code: "base1",
      number: "001 / 102",
      rarity: "Common",
    });
    assert.equal(candidate.providerKey, "justtcg");
    assert.equal(candidate.externalId, "justtcg-123");
    assert.equal(candidate.gameSlug, "pokemon");
    assert.equal(candidate.collectorNumber, "001/102");
  });

  test("derives verified TCGPlayer artwork from the provider product ID", () => {
    const candidate = normalizeJustTcgCard({
      id: "justtcg-123",
      game: "Pokémon",
      name: "Pikachu",
      set_name: "Base Set",
      number: "001/102",
      tcgplayerId: 123456,
    });
    assert.equal(
      candidate.imageUrl,
      "https://product-images.tcgplayer.com/fit-in/1000x1000/123456.jpg",
    );
  });

  test("does not construct artwork URLs from malformed provider IDs", () => {
    const candidate = normalizeJustTcgCard({
      id: "justtcg-123",
      game: "Pokémon",
      name: "Pikachu",
      set_name: "Base Set",
      number: "001/102",
      tcgplayerId: "123/../../secret",
    });
    assert.equal(candidate.imageUrl, null);
  });

  test("keeps import counters isolated and sanitises provider secrets", () => {
    assert.deepEqual(emptyImportCounters(), {
      recordsRead: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      recordsFailed: 0,
    });
    const sanitised = sanitizeImportError(
      "GET /cards?token=secret Authorization: Bearer abc123",
    );
    assert.ok(!sanitised.includes("secret"));
    assert.ok(!sanitised.includes("abc123"));
    assert.ok(sanitised.includes("[REDACTED]"));
  });
});
