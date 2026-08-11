import { Router, type IRouter } from "express";
import healthRouter from "./health";
import wishlistRouter from "./wishlist";

const router: IRouter = Router();

router.use(healthRouter);
router.use(wishlistRouter);

export default router;
