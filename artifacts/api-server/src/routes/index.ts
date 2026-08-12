import { Router, type IRouter } from "express";
import healthRouter from "./health";
import wishlistRouter from "./wishlist";
import imageProxyRouter from "./imageProxy";
import catalogRouter from "./catalog";
import certificationRouter from "./certification";

const router: IRouter = Router();

router.use(healthRouter);
router.use(wishlistRouter);
router.use(imageProxyRouter);
router.use(catalogRouter);
router.use(certificationRouter);

export default router;
