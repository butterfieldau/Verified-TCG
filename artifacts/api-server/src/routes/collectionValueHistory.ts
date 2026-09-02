import { Router } from "express";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";
import {
  calculatePortfolioValueHistory,
  portfolioChartData,
} from "../pricing/portfolio.js";

const router = Router();

const RANGE_DAYS: Record<string, number> = {
  "1D": 1,
  "7D": 7,
  "1M": 30,
  "3M": 90,
  "6M": 180,
  "1Y": 365,
  "ALL": 36_500,
};

function isValidCurrency(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z]{3}$/.test(value);
}

router.get("/collection/value-history", requireActiveUser, async (req: AuthRequest, res): Promise<void> => {
  const requestedRange =
    typeof req.query["range"] === "string" ? req.query["range"].toUpperCase() : "ALL";
  const range = RANGE_DAYS[requestedRange] ? requestedRange : "ALL";
  const displayCurrency =
    typeof req.query["displayCurrency"] === "string" &&
    isValidCurrency(req.query["displayCurrency"])
      ? req.query["displayCurrency"].toUpperCase()
      : "AUD";
  // Build the complete daily series once, then select the requested display
  // cadence. This keeps chartData ranges independent of whichever range the
  // caller happened to request.
  const history = await calculatePortfolioValueHistory(
    req.userId!,
    RANGE_DAYS.ALL!,
    displayCurrency,
  );
  const chartData = portfolioChartData(history.points);
  const points = chartData[range as keyof typeof chartData] ?? [];
  res.json({
    range,
    currency: history.currency,
    points,
    history: points,
    chartData,
    historyAvailable: points.some(point => point.available),
    historyUnavailableReason: points.some(point => point.available)
      ? null
      : "No complete retained price observations are available during ownership",
  });
});

export default router;