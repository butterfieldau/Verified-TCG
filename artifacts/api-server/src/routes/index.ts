import { Router, type IRouter } from "express";
import healthRouter from "./health";
import wishlistRouter from "./wishlist";
import imageProxyRouter from "./imageProxy";

const router: IRouter = Router();

router.use(healthRouter);
router.use(wishlistRouter);
router.use(imageProxyRouter);

export default router;
