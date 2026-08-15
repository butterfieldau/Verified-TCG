import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import pinoHttp from "pino-http";
import { rateLimit } from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";
// Rate limiters for individual routes are in lib/rateLimiters.ts (avoids circular imports)

// ── JWT startup validation ────────────────────────────────────────────────────
// Refuse to start if SESSION_SECRET is missing or too short (< 32 chars).
// A weak secret means JWTs can be brute-forced.

const JWT_SECRET = process.env.SESSION_SECRET;
if (!JWT_SECRET) {
  logger.fatal("SESSION_SECRET environment variable is not set. Server cannot start.");
  process.exit(1);
}
if (JWT_SECRET.length < 32) {
  logger.fatal(
    `SESSION_SECRET is too short (${JWT_SECRET.length} chars). Minimum length is 32 characters. Server cannot start.`,
  );
  process.exit(1);
}

// ── CORS ─────────────────────────────────────────────────────────────────────
// In production: restrict to known origins.
// In development: allow all origins so local Expo / web dev works.

const ALLOWED_ORIGINS_ENV = process.env.ALLOWED_ORIGINS; // comma-separated list
const isDev = process.env.NODE_ENV !== "production";

const corsOptions: cors.CorsOptions = isDev
  ? { origin: true, credentials: true }
  : {
      origin: ALLOWED_ORIGINS_ENV
        ? ALLOWED_ORIGINS_ENV.split(",").map((o) => o.trim()).filter(Boolean)
        : [
            "https://verifiedtcg.com",
            "https://www.verifiedtcg.com",
          ],
      credentials: true,
    };

// ── Rate limiters ─────────────────────────────────────────────────────────────
// express-rate-limit uses in-memory store by default.  For a multi-instance
// deployment, swap to a shared store (Redis, Upstash, etc.).  For a single
// Replit server this is adequate.

/** General API rate limit — 100 req/min per IP */
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again shortly." },
  skip: (req) => req.path === "/health",
});

/** Strict limiter for auth signup / signin — 10 req/min per IP */
export const authSignLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Please wait a minute and try again." },
});

/** Strict limiter for password recovery / reset — 5 req/min per IP */
export const authRecoverLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many password reset attempts. Please wait a minute and try again." },
});

// ── App ───────────────────────────────────────────────────────────────────────

const app: Express = express();

// Trust the first proxy hop (Replit's reverse proxy) so that req.ip reflects
// the real client address from X-Forwarded-For, and express-rate-limit can
// key its buckets on the actual client IP rather than the proxy's address.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors(corsOptions));
app.use(cookieParser());

// Scan endpoint accepts base64-encoded card images; allow up to 12 MB.
// Avatar upload endpoint accepts base64 images up to 8 MB.
// All other endpoints keep the tighter default via the second parser.
app.use("/api/scan", express.json({ limit: "12mb" }));
app.use("/api/auth/avatar", express.json({ limit: "8mb" }));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// Apply the general rate limit to all /api routes
app.use("/api", generalLimiter);

app.use("/api", router);

// ── Global error handler ──────────────────────────────────────────────────────
// Catches any error thrown by route handlers and returns a sanitized response.
// Full error details are logged server-side only — never sent to the client.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err, url: req.url, method: req.method }, "Unhandled route error");
  if (res.headersSent) return;
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

export default app;
