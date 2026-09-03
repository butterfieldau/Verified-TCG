import { Router } from "express";
import { getCardGradingPopulation } from "../grading/service.js";

const router = Router();

/** Public, provider-neutral population response. GemRate remains server-only. */
router.get("/cards/:cardId/grading", async (req, res): Promise<void> => {
  const cardId = String(req.params.cardId ?? "").trim();
  if (!cardId || cardId.length > 200) { res.status(400).json({ error: "A valid card id is required." }); return; }
  const result = await getCardGradingPopulation(cardId);
  res.json(result);
});

export default router;
