import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalCatalogueReadsEnabled } from "../catalogue/internal/catalogueReadConfig.js";

test("canonical catalogue reads default to the persisted catalogue", () => {
  assert.equal(canonicalCatalogueReadsEnabled({}), true);
  assert.equal(
    canonicalCatalogueReadsEnabled({
      CANONICAL_CATALOGUE_READS_ENABLED: "false",
    }),
    false,
  );
});

test("canonical catalogue reads accept explicit enablement", () => {
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
