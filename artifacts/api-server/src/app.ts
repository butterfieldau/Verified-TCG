import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import pinoHttp from "pino-http";
import { rateLimit } from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";
import { enforcePlatformConfig } from "./lib/enforcementMiddleware";
import { recordApiEvent, sanitizePath } from "./lib/telemetry";
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
            "https://verifiedtcg.co",
            "https://www.verifiedtcg.co",
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
  skip: (req) => req.path === "/health" || process.env.NODE_ENV === "test",
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

// ── Telemetry skip list ───────────────────────────────────────────────────────
// Paths excluded from global API telemetry to avoid noise / self-references.
const TELEMETRY_SKIP_PREFIXES = [
  "/api/healthz",
  "/api/runtime-config",
  "/api/admin/auth",
  "/api/admin/intelligence/analytics",
  "/api/admin/intelligence/health",
  "/api/admin/intelligence/integrations",
  "/api/admin/intelligence/jobs",
  "/api/admin/intelligence/audit",
];

function shouldSkipTelemetry(fullUrl: string): boolean {
  return TELEMETRY_SKIP_PREFIXES.some((p) => fullUrl.startsWith(p));
}

/**
 * Global API telemetry middleware.
 * Fires on response finish — never blocks the request.
 * Records sanitized api.request / api.error events with: status code,
 * duration, normalized path, HTTP method, and authenticated user ID if present.
 * Does NOT record request bodies, raw query strings, IPs, or emails.
 */
function apiTelemetryMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startMs = Date.now();
  res.on("finish", () => {
    try {
      const rawUrl = req.originalUrl ?? req.url ?? "/";
      const fullUrl = rawUrl.includes("?") ? rawUrl.slice(0, rawUrl.indexOf("?")) : rawUrl;
      if (shouldSkipTelemetry(fullUrl)) return;
      if (process.env.NODE_ENV === "test") return;

      const durationMs = Date.now() - startMs;
      const statusCode = res.statusCode;
      // User ID is attached by auth middleware after this point runs; read it from req
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userId: string | null = (req as any).userId ?? null;
      // Use the server-generated request ID. Never persist a caller-controlled
      // header as a correlation identifier.
      const requestId = (req as Request & { id?: string | number }).id;
      const correlationId = requestId == null ? null : String(requestId);

      void recordApiEvent({
        method: req.method,
        path: sanitizePath(fullUrl),
        statusCode,
        durationMs,
        userId,
        correlationId,
      });
    } catch {
      // Never let telemetry errors surface
    }
  });
  next();
}

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
// eBay signs the exact account-deletion request bytes, so its route must receive
// a Buffer before the global JSON parser consumes the body.
// All other endpoints keep the tighter default via the second parser.
app.use("/api/scan", express.json({ limit: "12mb" }));
app.use("/api/auth/avatar", express.json({ limit: "8mb" }));
// Collection CSV imports are bounded again by the route (1 MiB / 1,000 rows).
// The slightly larger JSON limit accounts for string escaping overhead.
app.use("/api/collection/import", express.json({ limit: "2mb" }));
app.use(
  "/api/ebay/account-deletion",
  express.raw({ type: "application/json", limit: "100kb" }),
);
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// Apply the general rate limit to all /api routes
app.use("/api", generalLimiter);

// Global API telemetry — fires on response finish, before enforcement so all
// responses (including 503/400 from enforcement) are captured.
app.use("/api", apiTelemetryMiddleware);

// Platform configuration enforcement (maintenance mode, feature flags, version checks)
app.use("/api", enforcePlatformConfig);

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
