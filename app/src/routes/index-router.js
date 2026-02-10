import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.render("index", { title: "Excel Export Streaming Demo" });
});

export default router;