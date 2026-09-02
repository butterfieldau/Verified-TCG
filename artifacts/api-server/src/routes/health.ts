import { Router, type IRouter, type Request, type Response } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const router: IRouter = Router();

export function deepHealthFailure(checkedAt = new Date().toISOString()) {
  return {
    status: "degraded" as const,
    checkedAt,
    components: {
      database: {
        status: "failed" as const,
        latencyMs: null,
        error: "Database probe failed",
      },
      process: {
        status: "ok" as const,
        uptimeSeconds: Math.floor(process.uptime()),
        label: "current process",
      },
    },
  };
}

router.get("/healthz", async (req: Request, res: Response) => {
  const deep = req.query["deep"] === "1";

  if (!deep) {
    const data = HealthCheckResponse.parse({ status: "ok" });
    return res.json(data);
  }

  // Deep probe: test DB connectivity and report latency. This endpoint is
  // intentionally exempt from platform enforcement so it remains useful for
  // recovery and deployment checks.
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    const latencyMs = Math.max(1, Date.now() - start);
    return res.json({
      status: "ok",
      checkedAt: new Date().toISOString(),
      components: {
        database: {
          status: "ok",
          latencyMs,
        },
        process: {
          status: "ok",
          uptimeSeconds: Math.floor(process.uptime()),
          label: "current process",
        },
      },
    });
  } catch (err) {
    return res.status(503).json(deepHealthFailure());
  }
});

export default router;
