import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { summarizeSchedulerOutcome } from "../pricing/scheduler.js";

describe("pricing scheduler outcome accounting", () => {
  test("provider failures keep the bucket retryable", () => {
    const result = summarizeSchedulerOutcome(
      [
        { status: "fulfilled", value: undefined },
        { status: "rejected", reason: new Error("provider returned no data") },
      ],
      { captured: 1, skipped: 0, failed: 0 },
    );

    assert.deepEqual(result, {
      status: "failed",
      refreshSucceeded: 1,
      refreshFailed: 1,
      errorMessage: "1 refreshes failed",
    });
  });

  test("portfolio capture failures are persisted as a failed run", () => {
    const result = summarizeSchedulerOutcome(
      [{ status: "fulfilled", value: undefined }],
      { captured: 0, skipped: 1, failed: 2 },
    );

    assert.deepEqual(result, {
      status: "failed",
      refreshSucceeded: 1,
      refreshFailed: 0,
      errorMessage: "2 portfolio snapshots failed",
    });
  });

  test("only genuine success or evidence-based skips complete the bucket", () => {
    const result = summarizeSchedulerOutcome(
      [{ status: "fulfilled", value: undefined }],
      { captured: 1, skipped: 2, failed: 0 },
    );

    assert.deepEqual(result, {
      status: "completed",
      refreshSucceeded: 1,
      refreshFailed: 0,
      errorMessage: null,
    });
  });
});