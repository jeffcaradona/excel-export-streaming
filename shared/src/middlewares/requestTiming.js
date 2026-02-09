// shared/src/express.js
import { performance } from "node:perf_hooks";
import { console } from "node:console";
import process from "node:process";
import express from "express";
import { timing } from ".timingStore.js";

/**
 * Express middleware that measures "Node received request" -> "Node finished sending response".
 */
export function createRequestTimingMiddleware({
  logger = console,
  logBody = false, // keep false by default
  //eslint-disable-next-line no-unused-vars
  getMeta = (_req, _res) => ({}),
} = {}) {
  return function requestTimingMiddleware(req, res, next) {
    if (!timing.isEnabled()) return next();

    const start = performance.now();

    res.on("finish", () => {
      const durationMs = performance.now() - start;

      const payload = {
        type: "http_timing",
        method: req.method,
        path: req.originalUrl ?? req.url,
        status: res.statusCode,
        duration_ms: Math.round(durationMs * 1000) / 1000,
        ...getMeta(req, res),
      };

      if (logBody) {
        payload.content_length = res.getHeader("content-length");
      }

      // Supports pino/winston/console-ish interfaces
      if (typeof logger.info === "function") logger.info(payload);
      else logger.log(payload);
    });

    next();
  };
}

/**
 * Optional admin router to enable/disable/toggle timing at runtime.
 * Mount somewhere internal-only, and protect it.
 */
export function createTimingToggleRouter({
  requireToken = true,
  tokenEnv = "ADMIN_TOKEN",
  headerName = "x-admin-token",
  allowFromLocalhostOnly = false,
} = {}) {
  const router = express.Router();

  router.post("/timing/:state", (req, res) => {
    if (allowFromLocalhostOnly) {
      // express "trust proxy" can affect this; keep in mind behind proxies
      const ip = req.ip;
      if (!(ip === "127.0.0.1" || ip === "::1" || ip?.endsWith("127.0.0.1"))) {
        return res.sendStatus(403);
      }
    }

    if (requireToken) {
      const expected = process.env[tokenEnv];
      const got = req.get(headerName);

      if (!expected || got !== expected) return res.sendStatus(403);
    }

    const { state } = req.params;
    if (state === "on") timing.enable();
    else if (state === "off") timing.disable();
    else if (state === "toggle") timing.toggle();
    else return res.status(400).json({ error: "use on|off|toggle" });

    res.json({ timingEnabled: timing.isEnabled() });
  });

  router.get("/timing", (req, res) => {
    res.json({ timingEnabled: timing.isEnabled() });
  });

  return router;
}
