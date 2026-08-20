import { Router, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { db, ebayAccountDeletionEventsTable } from "@workspace/db";
import {
  getEbayChallengeConfig,
  getEbayNotificationConfig,
  verifyEbayNotificationSignature,
} from "../lib/ebayNotificationVerifier.js";

const router = Router();

const ACCOUNT_DELETION_TOPIC = "MARKETPLACE_ACCOUNT_DELETION";

function configurationError(res: Response, missing: string[]) {
  return res.status(503).json({
    error: "Endpoint configuration is incomplete.",
    missingConfiguration: missing,
  });
}

function notificationIdFromPayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const metadata = record["metadata"];
  const notification = record["notification"];
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata) ||
    typeof notification !== "object" ||
    notification === null ||
    Array.isArray(notification)
  ) {
    return null;
  }

  const topic = (metadata as Record<string, unknown>)["topic"];
  const notificationId = (notification as Record<string, unknown>)["notificationId"];
  if (
    topic !== ACCOUNT_DELETION_TOPIC ||
    typeof notificationId !== "string" ||
    notificationId.length === 0 ||
    notificationId.length > 512
  ) {
    return null;
  }

  return notificationId;
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
  const challengeCode =
    typeof req.query.challenge_code === "string" ? req.query.challenge_code : "";

  if (!challengeCode) {
    return res.status(400).json({ error: "challenge_code query parameter is required" });
  }

  const settings = getEbayChallengeConfig();
  if (!settings.config) return configurationError(res, settings.missing);

  const hash = createHash("sha256");
  hash.update(challengeCode);
  hash.update(settings.config.verificationToken);
  hash.update(settings.config.endpointUrl);

  return res.status(200).json({ challengeResponse: hash.digest("hex") });
});

// ── POST /api/ebay/account-deletion ──────────────────────────────────────────

/**
 * eBay Marketplace Account Deletion / Closure notification receiver.
 *
 * eBay POSTs a signed JSON payload whenever an eBay user exercises their
 * right to delete their account. We verify the X-EBAY-SIGNATURE header using
 * eBay's public-key process before parsing or processing the notification.
 *
 * The app installs express.raw() for this exact route before its global JSON
 * parser so signature verification always uses the original request bytes.
 *
 * The processing ledger retains only eBay's delivery notification ID and the
 * no-linkage outcome. We intentionally inspect no userId, username, or EIAS
 * token because there is no verified eBay-to-collector identity mapping.
 */
router.post(
  "/ebay/account-deletion",
  async (req: Request, res: Response) => {
    const settings = getEbayNotificationConfig();
    if (!settings.config) return configurationError(res, settings.missing);

    const rawBody = req.body;
    const signatureHeader = req.get("x-ebay-signature");
    if (
      !signatureHeader ||
      !Buffer.isBuffer(rawBody) ||
      !(await verifyEbayNotificationSignature(rawBody, signatureHeader, settings.config))
    ) {
      return res.status(412).json({ error: "Notification signature could not be verified." });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as unknown;
    } catch {
      return res.status(400).json({ error: "Notification payload is invalid." });
    }

    const notificationId = notificationIdFromPayload(payload);
    if (!notificationId) {
      return res.status(400).json({ error: "Notification topic or identifier is invalid." });
    }

    try {
      await db
        .insert(ebayAccountDeletionEventsTable)
        .values({
          notificationId,
          outcome: "no_linked_ebay_data",
        })
        .onConflictDoNothing();
    } catch {
      // Do not acknowledge an event we could not record: eBay will retry it.
      // Deliberately omit payload and identifier data from logs and responses.
      return res.status(503).json({ error: "Notification processing is temporarily unavailable." });
    }

    return res.status(204).send();
  },
);

export default router;
