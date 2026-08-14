import { Router, type Request, type Response } from "express";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import express from "express";

const router = Router();

// ── Config helpers ────────────────────────────────────────────────────────────

function getMissingSecrets(): string[] {
  const missing: string[] = [];
  if (!process.env.EBAY_VERIFICATION_TOKEN) missing.push("EBAY_VERIFICATION_TOKEN");
  if (!process.env.EBAY_ENDPOINT_URL)       missing.push("EBAY_ENDPOINT_URL");
  return missing;
}

// ── GET /api/ebay/account-deletion ───────────────────────────────────────────

/**
 * eBay challenge/verification handshake.
 *
 * eBay sends a GET with ?challenge_code=<code> to prove ownership of the
 * endpoint. We respond with the SHA-256 hash of the concatenation:
 *   challengeCode + EBAY_VERIFICATION_TOKEN + EBAY_ENDPOINT_URL
 * as a lowercase hex string, wrapped in { challengeResponse }.
 *
 * Reference:
 * https://developer.ebay.com/marketplace-account-deletion
 */
router.get("/ebay/account-deletion", (req: Request, res: Response) => {
  const missing = getMissingSecrets();
  if (missing.length > 0) {
    return res.status(503).json({
      error: `Endpoint not configured. Missing: ${missing.join(", ")}`,
    });
  }

  const challengeCode =
    typeof req.query.challenge_code === "string" ? req.query.challenge_code : "";

  if (!challengeCode) {
    return res.status(400).json({ error: "challenge_code query parameter is required" });
  }

  const hash = createHash("sha256");
  hash.update(challengeCode);
  hash.update(process.env.EBAY_VERIFICATION_TOKEN!);
  hash.update(process.env.EBAY_ENDPOINT_URL!);

  return res.status(200).json({ challengeResponse: hash.digest("hex") });
});

// ── POST /api/ebay/account-deletion ──────────────────────────────────────────

/**
 * eBay Marketplace Account Deletion / Closure notification receiver.
 *
 * eBay POSTs a signed JSON payload whenever an eBay user exercises their
 * right to delete their account. We verify the X-EBAY-SIGNATURE header,
 * log the event for audit purposes, and respond 200 OK.
 *
 * express.raw() is applied at the route level only — other routes continue
 * to use the global express.json() middleware without any impact.
 *
 * Signature algorithm: HMAC-SHA256 of the raw request body bytes, keyed
 * with EBAY_VERIFICATION_TOKEN, base64-encoded.
 *
 * TODO: Once eBay–collector account linkage is added to the app, use these
 * events to delete or anonymise the associated collector data per eBay's
 * policy requirements.
 */
router.post(
  "/ebay/account-deletion",
  express.raw({ type: "application/json" }),
  (req: Request, res: Response) => {
    const missing = getMissingSecrets();
    if (missing.length > 0) {
      return res.status(503).json({
        error: `Endpoint not configured. Missing: ${missing.join(", ")}`,
      });
    }

    const rawBody          = req.body as Buffer;
    const verificationToken = process.env.EBAY_VERIFICATION_TOKEN!;
    const signatureHeader  = req.headers["x-ebay-signature"] as string | undefined;

    // Verify the signature when the header is present.
    // Missing signature is treated as invalid — legitimate eBay notifications
    // always include the header.
    if (!signatureHeader) {
      return res.status(403).json({ error: "Missing X-EBAY-SIGNATURE header" });
    }

    try {
      const hmac = createHmac("sha256", verificationToken);
      hmac.update(rawBody);
      const computed = hmac.digest("base64");

      // timingSafeEqual prevents timing-based attacks; both buffers must be
      // the same length, so we compare string lengths first.
      const computedBuf = Buffer.from(computed);
      const receivedBuf = Buffer.from(signatureHeader);

      const valid =
        computedBuf.length === receivedBuf.length &&
        timingSafeEqual(computedBuf, receivedBuf);

      if (!valid) {
        return res.status(403).json({ error: "Signature verification failed" });
      }
    } catch {
      return res.status(403).json({ error: "Signature verification failed" });
    }

    // Parse the event payload for logging. Failure here does not affect the
    // 200 acknowledgement — eBay re-delivers on non-200, so we never want to
    // reject a valid, verified notification due to a parse error.
    let payload: unknown = "<unparseable>";
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      // keep the raw sentinel
    }

    // Structured log for audit trail — visible in server logs / deployment logs.
    req.log?.info({ event: "ebay.account_deletion", payload }, "eBay account deletion notification received");

    return res.status(200).send();
  },
);

export default router;
