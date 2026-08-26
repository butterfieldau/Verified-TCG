import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalCatalogueReadsEnabled } from "../catalogue/internal/catalogueReadConfig.js";

test("canonical catalogue reads default to the existing JustTCG behaviour", () => {
  assert.equal(canonicalCatalogueReadsEnabled({}), false);
  assert.equal(
    canonicalCatalogueReadsEnabled({
      CANONICAL_CATALOGUE_READS_ENABLED: "false",
    }),
    false,
  );
});

test("canonical catalogue reads require an explicit server-side opt-in", () => {
  assert.equal(
    canonicalCatalogueReadsEnabled({
      CANONICAL_CATALOGUE_READS_ENABLED: "true",
    }),
    true,
  );
  assert.equal(
    canonicalCatalogueReadsEnabled({ CANONICAL_CATALOGUE_READS_ENABLED: "1" }),
    true,
  );
});
