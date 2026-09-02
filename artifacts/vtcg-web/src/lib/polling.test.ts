import test from "node:test";
import assert from "node:assert/strict";
import { canReadPricingJobs, isLatestPanelRequest, panelFreshness } from "./polling";

test("out-of-order panel responses are rejected", () => {
  assert.equal(isLatestPanelRequest(4, 5), false);
  assert.equal(isLatestPanelRequest(5, 5), true);
});

test("system-only permissions do not trigger protected pricing-job reads", () => {
  assert.equal(canReadPricingJobs(["system:read"]), false);
  assert.equal(canReadPricingJobs(["system:read", "pricing:read"]), true);
});

test("failed polling cannot present retained data as current", () => {
  assert.equal(
    panelFreshness({
      hasData: true,
      error: "probe failed",
      lastSuccessAt: "2026-09-02T00:00:00.000Z",
    }),
    "stale",
  );
  assert.equal(
    panelFreshness({
      hasData: true,
      error: null,
      lastSuccessAt: "2026-09-02T00:00:00.000Z",
    }),
    "current",
  );
});