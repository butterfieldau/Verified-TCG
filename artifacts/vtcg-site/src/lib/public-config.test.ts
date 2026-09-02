import assert from "node:assert/strict";
import test from "node:test";
import { getPublicConfig, isValidAppVersion } from "./public-config.ts";
import { isPublicWishlistPath, PUBLIC_ROUTES, publicWishlistPath } from "./public-routes.ts";

test("normalises preview and production API bases", () => {
  const preview = getPublicConfig({}, "https://preview.example");
  assert.equal(preview.apiBaseUrl, "https://preview.example/api");

  const configured = getPublicConfig(
    { VITE_API_BASE_URL: "https://api.example/v1", VITE_APP_VERSION: "2.3.4" },
    "https://site.example",
  );
  assert.equal(configured.apiBaseUrl, "https://api.example/v1/api");
  assert.equal(configured.clientVersion, "2.3.4");
});

test("rejects unsafe or unapproved app destinations", () => {
  const config = getPublicConfig(
    {
      VITE_APP_URL: "javascript:alert(1)",
      VITE_IOS_STORE_URL: "https://apps.example/app",
    },
    "https://site.example",
  );
  assert.equal(config.appUrl, null);
  assert.equal(config.iosStoreUrl, "https://apps.example/app");
  assert.equal(config.androidStoreUrl, null);
  assert.equal(isValidAppVersion("1.2.3"), true);
  assert.equal(isValidAppVersion("latest"), false);
});

test("publishes the registered routes without escaping the router base", () => {
  assert.equal(PUBLIC_ROUTES.privacy, "/privacy");
  assert.equal(PUBLIC_ROUTES.subscriptionTerms, "/subscription-terms");
  assert.equal(publicWishlistPath("collector name"), "/c/collector%20name/wishlist");
  assert.equal(isPublicWishlistPath("/c/alex/wishlist"), true);
  assert.equal(isPublicWishlistPath("/collectors/alex"), false);
});