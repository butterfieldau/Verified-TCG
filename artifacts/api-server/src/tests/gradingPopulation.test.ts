import assert from "node:assert/strict";
import test from "node:test";
import { normaliseGemRateGrade, normalizeCollectorNumber, normalizeGameSlug } from "../grading/normalisation.js";
import { scorePopulationMatch } from "../grading/matching.js";
import { GemRateProvider } from "../grading/gemrate.js";
import { isPopulationCacheFresh, POPULATION_CACHE_TTL_MS } from "../grading/cache.js";

test("population matching normalises game and collector-number identity", () => {
  assert.equal(normalizeGameSlug("Pokémon"), "pokemon");
  assert.equal(normalizeCollectorNumber(" 234 / 091 "), "234/091");
  const match = scorePopulationMatch({ canonicalCardId: "card", game: "Pokemon", setName: "Paldean Fates", name: "Charizard ex", collectorNumber: "234/091" }, {
    providerCardId: "gem", description: "Charizard", game: "Pokémon", setName: "Paldean Fates", name: "Charizard ex", collectorNumber: "234 / 091", raw: {},
  });
  assert.equal(match.status, "confirmed");
  assert.equal(match.matchMethod, "game_set_number_name");
});

test("weak name-only population match remains review-only", () => {
  const match = scorePopulationMatch({ canonicalCardId: "card", game: "Pokemon", setName: "Set A", name: "Pikachu", collectorNumber: "001" }, {
    providerCardId: "gem", description: "Pikachu", name: "Pikachu", raw: {},
  });
  assert.equal(match.status, "needs_review");
});

test("grader-specific population tens remain distinct", () => {
  assert.equal(normaliseGemRateGrade("psa", "psa_10").label, "PSA 10");
  assert.equal(normaliseGemRateGrade("bgs", "beckett_10_black").label, "BGS Black Label 10");
  assert.equal(normaliseGemRateGrade("bgs", "beckett_10_pristine").label, "BGS Pristine 10");
  assert.equal(normaliseGemRateGrade("cgc", "cgc_10_perfect").label, "CGC Perfect 10");
  assert.equal(normaliseGemRateGrade("cgc", "cgc_10_pristine").label, "CGC Pristine 10");
  assert.equal(normaliseGemRateGrade("cgc", "cgc_10").label, "CGC 10");
});

test("GemRate population parser retains zero while missing values stay unavailable", async () => {
  const request: typeof fetch = async () => new Response(JSON.stringify({ data: {
    population: { population_data: { data_last_updated: "2026-09-03", by_grader: {
      psa: { total: 4, gem_rate: 0.25, grades: { psa_10: 1, psa_9: 0 } },
      beckett: { total: 2, gem_rate: 0.5, grades: { beckett_10_black: 0, beckett_10_pristine: 1 } },
      cgc: { total: 1, gem_rate: 1, grades: { cgc_10_perfect: 1 } },
    } } },
  } }), { status: 200, headers: { "content-type": "application/json" } });
  const provider = new GemRateProvider({ GEMRATE_API_KEY: "test-key" }, request);
  const result = await provider.getPopulation("gem-id");
  assert.equal(result.graders.psa?.grades["9"]?.population, 0);
  assert.equal(result.graders.bgs?.grades.black_label_10?.population, 0);
  assert.equal(result.graders.cgc?.grades.perfect_10?.population, 1);
});

test("population cache is fresh for 24 hours and expires without deleting the snapshot", () => {
  const now = Date.parse("2026-09-03T12:00:00.000Z");
  assert.equal(isPopulationCacheFresh(new Date(now - POPULATION_CACHE_TTL_MS + 1), now), true);
  assert.equal(isPopulationCacheFresh(new Date(now - POPULATION_CACHE_TTL_MS), now), false);
  assert.equal(isPopulationCacheFresh(null, now), false);
});
