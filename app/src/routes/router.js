
import { Router } from "express";
import exportsRouter from "./exports-router.js";
import indexRouter from "./index-router.js";


const router = Router();

router.use("/", indexRouter);
router.use("/exports", exportsRouter);

router.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});



export default router;