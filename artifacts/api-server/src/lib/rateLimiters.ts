/**
 * Shared rate limiter instances.
 *
 * These are defined in a dedicated module (not in app.ts) to avoid circular
 * imports between app.ts → routes/index → routes/auth → app.ts.
 */

import { rateLimit } from "express-rate-limit";

/** Auth signup / signin — 10 requests per minute per IP */
export const authSignLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Please wait a minute and try again." },
});

/** Password recovery / reset — 5 requests per minute per IP */
export const authRecoverLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many password reset attempts. Please wait a minute and try again." },
});
