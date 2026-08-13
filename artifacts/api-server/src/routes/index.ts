import { Router, type IRouter } from "express";
import healthRouter from "./health";
import wishlistRouter from "./wishlist";
import imageProxyRouter from "./imageProxy";
import catalogRouter from "./catalog";
import certificationRouter from "./certification";
import gradedPricesRouter from "./gradedPrices";

const router: IRouter = Router();

router.use(healthRouter);
router.use(wishlistRouter);
router.use(imageProxyRouter);
router.use(catalogRouter);
router.use(certificationRouter);
router.use(gradedPricesRouter);

export default router;
