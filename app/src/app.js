/**
 * BFF Express application — middleware stack, routes, error handling.
 * Routes requests through a configurable middleware chain with
 * security, CORS, logging, and error handling.
 */

// ── Imports and Dependencies ────────────────────────────────────────────────
import createError from "http-errors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Eta } from "eta";
import cookieParser from "cookie-parser";

import { debugApplication } from '../../shared/src/debug.js';
import { getEnv } from './config/env.js';
import router from "./routes/router.js";
import { registerStatic } from "./middlewares/staticAssets.js";
import { renderError } from "./middlewares/app.js";

// ── Application Setup ───────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const env = getEnv();
const app = express();

// ── View Engine Configuration ───────────────────────────────────────────────
const viewsPath = path.join(__dirname,  "views");
const eta = new Eta({ views: viewsPath });
app.engine("eta", (filePath, options, callback) => {
  const templateName = path.basename(filePath, ".eta");
  try {
    const html = eta.render(templateName, options);
    callback(null, html);
  } catch (err) {
    callback(err);
  }
});

app.set("views", viewsPath);
app.set("view engine", "eta");

// ── Middleware Stack ────────────────────────────────────────────────────────
// Security headers — allow the inline importmap for ESM loading
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src": ["'self'", "'sha256-lABFLvyf4oDsjVqUMFH2RMLyppqgvWWAdK0nUWvN4oY='"],
      },
    },
  }),
);

// CORS — BFF is the frontend's API gateway
// Only the configured origin may call through the BFF.
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    methods: ['GET', 'OPTIONS'],           // exports are read-only
    allowedHeaders: ['Content-Type'],
  }),
);

// Body parsing (for potential future POST endpoints)
app.use(express.json());

// Request logging
app.use((req, _res, next) => {
  debugApplication(`${req.method} ${req.url}`);
  next();
});

app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Static assets
registerStatic(app, __dirname);

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/', router);

// ── Error Handling ──────────────────────────────────────────────────────────
// Catch 404 and forward to error handler
app.use((_req, res) => {
  res.status(404).json({
    error: { message: 'Not found', code: 'NOT_FOUND' },
  });
});

// Global error handler — must be registered last
// eslint-disable-next-line no-unused-vars
app.use(function (_req, _res, next) {
  next(createError(404));
});

app.use(renderError);

export default app;
