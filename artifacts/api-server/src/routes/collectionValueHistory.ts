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
  const history = await calculatePortfolioValueHistory(
    req.userId!,
    RANGE_DAYS[range]!,
    displayCurrency,
  );
  res.json({
    range,
    currency: history.currency,
    points: history.points,
    history: history.points,
    chartData: portfolioChartData(history.points),
    historyAvailable: history.historyAvailable,
    historyUnavailableReason: history.historyUnavailableReason,
  });
});

export default router;