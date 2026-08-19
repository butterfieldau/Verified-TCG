import { Router } from "express";
import { recordTelemetry } from "../lib/telemetry.js";

const router = Router();
const PSA_BASE_URL = "https://api.psacard.com/publicapi";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; body: unknown }>();

router.get("/certifications/psa/:certNumber", async (req, res) => {
  const certNumber = String(req.params.certNumber).trim();
  if (!/^\d{4,12}$/.test(certNumber)) {
    return res.status(400).json({ error: "Invalid PSA certification number" });
  }
  const token = process.env.PSA_API_TOKEN;
  if (!token) return res.status(503).json({ error: "PSA_API_TOKEN is not configured" });

  const hit = cache.get(certNumber);
  if (hit && hit.expiresAt > Date.now()) return res.json({ ...((hit.body as object) ?? {}), source: "PSA", cached: true });

  // Sanitized integration observability for actual outbound PSA calls only
  // (cache hits above are skipped). Records ok/failed, duration, numeric HTTP
  // status, and a fixed operation enum — never the cert number, credentials,
  // headers, or provider body.
  const startedAt = Date.now();
  try {
    const response = await fetch(`${PSA_BASE_URL}/cert/GetByCertNumber/${certNumber}`, {
      headers: { authorization: `bearer ${token}`, accept: "application/json" },
    });
    const body = await response.json().catch(() => ({ error: "Invalid PSA response" }));
    void recordTelemetry({
      category: "integration",
      action: "integration.psa.request",
      status: response.ok ? "ok" : "failed",
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
      metadata: { operation: "cert_lookup" },
    });
    if (!response.ok) return res.status(response.status).json(body);
    cache.set(certNumber, { expiresAt: Date.now() + CACHE_TTL_MS, body });
    return res.json({ ...((body as object) ?? {}), source: "PSA", cached: false });
  } catch (error) {
    void recordTelemetry({
      category: "integration",
      action: "integration.psa.request",
      status: "failed",
      durationMs: Date.now() - startedAt,
      metadata: { operation: "cert_lookup" },
    });
    return res.status(503).json({ error: error instanceof Error ? error.message : "PSA unavailable" });
  }
});

export default router;
