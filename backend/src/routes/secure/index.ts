import { Router } from "express";
import productsRoute from "./products.route";
import categoriesRoute from "./categories.route";
import cartRoute from "./cart.route";
import ordersRoute from "./orders.route";
import addressesRoute from "./addresses.route";
import reviewsRoute from "./reviews.route";
import uploadsRoute from "./uploads.route";
import aiRoute from "./ai.route";
import wishlistRoute from "./wishlist.route";
import paymentsRoute from "./payments.route";
import meRoute from "./me.route";
import adminRoute from "./admin.route";

const router = Router();

router.use("/products", productsRoute);
router.use("/categories", categoriesRoute);
router.use("/cart", cartRoute);
router.use("/orders", ordersRoute);
router.use("/addresses", addressesRoute);
router.use("/reviews", reviewsRoute);
router.use("/uploads", uploadsRoute);
router.use("/ai", aiRoute);
router.use("/wishlist", wishlistRoute);
router.use("/payments", paymentsRoute);
router.use("/me", meRoute);
router.use("/admin", adminRoute);

export default router;
