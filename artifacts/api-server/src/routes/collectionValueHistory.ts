import { Router } from "express";
import { requireActiveUser, type AuthRequest } from "../lib/authMiddleware.js";
import {
  calculatePortfolioMovementBreakdown,
  calculatePortfolioValueHistory,
  hasPortfolioHistoryValue,
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
  const rangeHasValue = hasPortfolioHistoryValue(points);
  res.json({
    range,
    currency: history.currency,
    points,
    history: points,
    chartData,
    historyAvailable: rangeHasValue,
    historyUnavailableReason: rangeHasValue
      ? null
      : "No retained market prices are available for cards in this profile",
  });
});

router.get(
  "/collection/value-history/movement",
  requireActiveUser,
  async (req: AuthRequest, res): Promise<void> => {
    const date = typeof req.query["date"] === "string" ? req.query["date"] : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      res.status(400).json({ message: "date must be a valid ISO calendar date" });
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    if (date > today) {
      res.status(400).json({ message: "date cannot be in the future" });
      return;
    }
    const displayCurrency =
      typeof req.query["displayCurrency"] === "string" &&
      isValidCurrency(req.query["displayCurrency"])
        ? req.query["displayCurrency"].toUpperCase()
        : "AUD";
    res.json(
      await calculatePortfolioMovementBreakdown(req.userId!, date, displayCurrency),
    );
  },
);

export default router;