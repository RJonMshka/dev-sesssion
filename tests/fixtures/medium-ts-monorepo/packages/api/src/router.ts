import { Router } from "express";
import { ordersController } from "./controllers/orders.js";
import { productsController } from "./controllers/products.js";
import { usersController } from "./controllers/users.js";

export const router = Router();

router.use("/users", usersController);
router.use("/orders", ordersController);
router.use("/products", productsController);
