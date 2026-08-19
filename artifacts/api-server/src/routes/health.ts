import { Router, type IRouter, type Request, type Response } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", async (req: Request, res: Response) => {
  const deep = req.query["deep"] === "1";

  if (!deep) {
    const data = HealthCheckResponse.parse({ status: "ok" });
    return res.json(data);
  }

  // Deep probe: test DB connectivity and report latency
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    const latencyMs = Date.now() - start;
    return res.json({
      status: "ok",
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
    const latencyMs = Date.now() - start;
    return res.status(503).json({
      status: "degraded",
      components: {
        database: {
          status: "failed",
          latencyMs,
          error: "Database probe failed",
        },
        process: {
          status: "ok",
          uptimeSeconds: Math.floor(process.uptime()),
          label: "current process",
        },
      },
    });
  }
});

export default router;
