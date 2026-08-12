import { Router, type IRouter } from "express";
import healthRouter from "./health";
import wishlistRouter from "./wishlist";
import imageProxyRouter from "./imageProxy";
import collectionRouter from "./collection";

const router: IRouter = Router();

router.use(healthRouter);
router.use(wishlistRouter);
router.use(imageProxyRouter);
router.use(collectionRouter);

export default router;
