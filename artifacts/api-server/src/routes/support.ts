import { Router } from "express";
import { db, contactSubmissionsTable, supportCasesTable } from "@workspace/db";

const router = Router();

// ── Allowed categories (enum validation prevents user-controlled log fields) ──
const ALLOWED_CATEGORIES = new Set([
  "General Question",
  "Bug Report",
  "Collection / Scanner",
  "Pricing & Market",
  "Grading & Verification",
  "Account & Billing",
  "Trade & Wishlist",
  "Verified Pro",
  "Privacy & Data",
  "Other",
]);

// ── In-memory rate limiter ────────────────────────────────────────────────────
// Keyed on req.socket.remoteAddress — the physical TCP peer, not a spoofable
// X-Forwarded-For header.  When deployed behind a trusted reverse proxy the
// proxy should strip or rewrite X-Forwarded-For so that req.socket holds the
// proxy address; add `app.set('trust proxy', 1)` and switch to req.ip if the
// proxy is known and trusted.
// Max 5 submissions per address per 15-minute window.
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 min
const RATE_LIMIT_MAX = 5;

type RateBucket = { count: number; windowStart: number };
const rateBuckets = new Map<string, RateBucket>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW) {
    rateBuckets.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (bucket.count >= RATE_LIMIT_MAX) return true;
  bucket.count++;
  return false;
}

// Periodic cleanup to prevent unbounded map growth
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW;
  for (const [ip, b] of rateBuckets) {
    if (b.windowStart < cutoff) rateBuckets.delete(ip);
  }
}, RATE_LIMIT_WINDOW);

interface ContactRequest {
  name: string;
  email: string;
  category: string;
  subject: string;
  message: string;
}

/**
 * POST /api/support/contact
 *
 * Guarantees:
 * - Rate-limited to 5 req/socket-IP/15 min (not spoofable via forwarded headers).
 * - Category validated against a fixed enum before any logging or storage.
 * - Full submission (name, email, category, subject, message) persisted to
 *   the `contact_submissions` DB table before returning 200, making every
 *   successful submission permanently actionable by the support team.
 * - Resend delivery is a best-effort enhancement with a 5 s abort timeout;
 *   its failure does NOT affect the 200 response since the data is already durable.
 * - Application logs contain only enum-validated, bounded metadata — no PII.
 */
router.post("/support/contact", async (req, res) => {
  // Raw socket address — immune to X-Forwarded-For spoofing
  const ip = req.socket.remoteAddress ?? "unknown";

  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests. Please try again later." });
  }

  const { name, email, category, subject, message } = req.body as Partial<ContactRequest>;

  // Presence check
  if (!name?.trim() || !email?.trim() || !category?.trim() || !subject?.trim() || !message?.trim()) {
    return res.status(400).json({ error: "All fields are required." });
  }

  // Email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: "Invalid email address." });
  }

  // Enum validation — prevents user-controlled strings reaching logs or DB category column
  if (!ALLOWED_CATEGORIES.has(category.trim())) {
    return res.status(400).json({ error: "Invalid category." });
  }

  // Length caps
  if (name.trim().length > 200)    return res.status(400).json({ error: "Name too long." });
  if (subject.trim().length > 200) return res.status(400).json({ error: "Subject too long." });
  if (message.trim().length > 2000) return res.status(400).json({ error: "Message must be 2000 characters or fewer." });

  const cleanName     = name.trim();
  const cleanEmail    = email.trim();
  const cleanCategory = category.trim(); // safe: validated against enum
  const cleanSubject  = subject.trim();
  const cleanMessage  = message.trim();

  // Persist full submission to the database.
  // This is the durable store — the support team can always query contact_submissions
  // to find and reply to any submission, regardless of email delivery status.
  // Return 500 on failure so the UI never promises a reply it cannot guarantee.
  try {
    await db.transaction(async (tx) => {
      const [submission] = await tx.insert(contactSubmissionsTable).values({
        name:     cleanName,
        email:    cleanEmail,
        category: cleanCategory,
        subject:  cleanSubject,
        message:  cleanMessage,
      }).returning({ id: contactSubmissionsTable.id });
      await tx.insert(supportCasesTable).values({
        submissionId: submission!.id,
      });
    });
  } catch (err) {
    console.error("[SUPPORT] DB write failed:", (err as Error)?.message ?? "unknown");
    return res.status(500).json({ error: "Failed to save your message. Please try again." });
  }

  // Structured audit log — no PII, only enum-validated category and counts
  console.log("[SUPPORT] Submission saved", JSON.stringify({
    timestamp: new Date().toISOString(),
    category:   cleanCategory, // enum-validated
    subjectLen: cleanSubject.length,
    messageLen: cleanMessage.length,
  }));

  // Optional Resend notification — best-effort (submission already durable)
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (RESEND_API_KEY) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Verified TCG <support@verifiedtcg.com>",
          to: ["support@verifiedtcg.com"],
          reply_to: cleanEmail,
          subject: `[Support] ${cleanCategory}: ${cleanSubject}`,
          text: [
            `From: ${cleanName} <${cleanEmail}>`,
            `Category: ${cleanCategory}`,
            `Subject: ${cleanSubject}`,
            `Submitted: ${new Date().toISOString()}`,
            "",
            cleanMessage,
          ].join("\n"),
        }),
        signal: controller.signal,
      });
      if (!emailRes.ok) {
        console.warn("[SUPPORT] Resend notification failed, status:", emailRes.status);
      }
    } catch {
      console.warn("[SUPPORT] Resend notification did not complete (non-fatal; submission is stored).");
    } finally {
      clearTimeout(timeout);
    }
  }

  return res.status(200).json({
    success: true,
    message: "Your message has been recorded for the support team.",
  });
});

export default router;
