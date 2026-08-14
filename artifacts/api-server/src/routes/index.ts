import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import wishlistRouter from "./wishlist";
import imageProxyRouter from "./imageProxy";
import catalogRouter from "./catalog";
import certificationRouter from "./certification";
import gradedPricesRouter from "./gradedPrices";
import ebayAccountDeletionRouter from "./ebayAccountDeletion";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(wishlistRouter);
router.use(imageProxyRouter);
router.use(catalogRouter);
router.use(certificationRouter);
router.use(gradedPricesRouter);
router.use(ebayAccountDeletionRouter);

export default router;
