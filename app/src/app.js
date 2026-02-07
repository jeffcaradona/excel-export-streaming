/**
 * BFF Express application — middleware stack, routes, error handling.
 *
 * Mirrors the API's api.js structure:
 *   1. Security (helmet)
 *   2. CORS (BFF controls policy)
 *   3. Body parsing
 *   4. Request logging
 *   5. Routes
 *   6. Health check
 *   7. 404 handler
 *   8. Global error handler (last)
 */
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { debugApplication } from '../../shared/src/debug.js';
import { getEnv } from './config/env.js';
import exportsRouter from './routes/exports.js';

const env = getEnv();
const app = express();

// ── 1. Security headers ─────────────────────────────────────────────────────
app.use(helmet());

// ── 2. CORS — BFF is the frontend's API gateway ────────────────────────────
// Only the configured origin may call through the BFF.
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    methods: ['GET', 'OPTIONS'],           // exports are read-only
    allowedHeaders: ['Content-Type'],
  }),
);

// ── 3. Body parsing (for potential future POST endpoints) ───────────────────
app.use(express.json());

// ── 4. Request logging ──────────────────────────────────────────────────────
app.use((req, _res, next) => {
  debugApplication(`${req.method} ${req.url}`);
  next();
});

// ── 5. Routes ───────────────────────────────────────────────────────────────
app.use('/exports', exportsRouter);

// ── 6. Health check — lightweight, no upstream dependency ───────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── 7. 404 handler ──────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    error: { message: 'Not found', code: 'NOT_FOUND' },
  });
});

// ── 8. Global error handler — must be registered last ───────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  debugApplication('Error:', err);

  const statusCode = err.status || 500;
  const isDevelopment = env.NODE_ENV === 'development';

  const errorResponse = {
    error: {
      message: isDevelopment ? err.message : 'Internal server error',
      code: err.code || 'INTERNAL_ERROR',
      ...(isDevelopment && { stack: err.stack }),
    },
  };

  res.status(statusCode).json(errorResponse);
});

export default app;
