/**
 * Shared rate limiter instances.
 *
 * These are defined in a dedicated module (not in app.ts) to avoid circular
 * imports between app.ts → routes/index → routes/auth → app.ts.
 *
 * In the test environment (NODE_ENV=test) the rate limiters are replaced with
 * plain passthrough middleware so:
 *   1. Integration tests are not blocked by per-IP limits, and
 *   2. The express-rate-limit MemoryStore never creates a setInterval,
 *      which would otherwise keep the Node process alive after tests complete.
 */

import type { Request, Response, NextFunction } from "express";
import { rateLimit } from "express-rate-limit";

const isTestEnv = process.env.NODE_ENV === "test";

// In test mode skip calling rateLimit() entirely — avoid creating any
// MemoryStore / setInterval that would prevent process.exit after tests.
const passthrough = (_req: Request, _res: Response, next: NextFunction) => next();

/** Auth signup / signin — 10 requests per minute per IP */
export const authSignLimiter = isTestEnv
  ? passthrough
  : rateLimit({
      windowMs: 60 * 1000,
      limit: 10,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Too many sign-in attempts. Please wait a minute and try again." },
    });

/** Password recovery / reset — 5 requests per minute per IP */
export const authRecoverLimiter = isTestEnv
  ? passthrough
  : rateLimit({
      windowMs: 60 * 1000,
      limit: 5,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Too many password reset attempts. Please wait a minute and try again." },
    });
