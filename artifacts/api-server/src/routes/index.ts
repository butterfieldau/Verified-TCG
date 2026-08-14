import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import wishlistRouter from "./wishlist";
import imageProxyRouter from "./imageProxy";
import catalogRouter from "./catalog";
import certificationRouter from "./certification";
import gradedPricesRouter from "./gradedPrices";
import ebayAccountDeletionRouter from "./ebayAccountDeletion";
import collectionRouter from "./collection";
import supportRouter from "./support";
import subscriptionRouter from "./subscription";
import scanRouter from "./scan";
import priceHistoryRouter from "./priceHistory";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(wishlistRouter);
router.use(imageProxyRouter);
router.use(catalogRouter);
router.use(certificationRouter);
router.use(gradedPricesRouter);
router.use(ebayAccountDeletionRouter);
router.use(collectionRouter);
router.use(supportRouter);
router.use(subscriptionRouter);
router.use(scanRouter);
router.use(priceHistoryRouter);

export default router;
