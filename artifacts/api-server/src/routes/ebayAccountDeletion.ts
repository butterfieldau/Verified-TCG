import { Router, type Request, type Response } from "express";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

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
 * The app installs express.raw() for this exact route before its global JSON
 * parser so signature verification always uses the original request bytes.
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
  (req: Request, res: Response) => {
    const missing = getMissingSecrets();
    if (missing.length > 0) {
      return res.status(503).json({
        error: `Endpoint not configured. Missing: ${missing.join(", ")}`,
      });
    }

    const rawBody = req.body;
    const verificationToken = process.env.EBAY_VERIFICATION_TOKEN!;
    const signatureHeader = req.get("x-ebay-signature");

    // Verify the signature when the header is present.
    // Missing signature is treated as invalid — legitimate eBay notifications
    // always include the header.
    if (!signatureHeader) {
      return res.status(403).json({ error: "Missing X-EBAY-SIGNATURE header" });
    }
    if (!Buffer.isBuffer(rawBody)) {
      return res.status(403).json({ error: "Signature verification failed" });
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

    // Parsing failure does not affect acknowledgement: signature verification
    // has already authenticated the exact bytes and eBay retries non-200s.
    let payloadParsed = false;
    try {
      JSON.parse(rawBody.toString("utf8"));
      payloadParsed = true;
    } catch {
      // Keep payloadParsed false. Never log provider payloads or user details.
    }

    req.log?.info(
      {
        event: "ebay.account_deletion",
        payloadBytes: rawBody.byteLength,
        payloadParsed,
      },
      "eBay account deletion notification received",
    );

    return res.status(200).send();
  },
);

export default router;
