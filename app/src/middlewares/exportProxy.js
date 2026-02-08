/**
 * Export proxy middleware factory — creates a streaming proxy to the API service.
 *
 * This is a dumb pipe: it proxies to whatever path it's told.
 * Route mapping logic belongs in the routes file.
 *
 * Stream behavior:
 *   selfHandleResponse: false  → auto-pipe the response stream (no buffering)
 *   changeOrigin: true         → set Host header to the target
 *
 * Error strategy:
 *   Status-code-only responses to avoid corrupting an in-flight Excel stream.
 *   502 for connection refused (API down), 504 for timeouts.
 */
import process from "node:process";
import { createProxyMiddleware } from 'http-proxy-middleware';
import { debugApplication } from '../../../shared/src/debug.js';
import { getEnv } from '../config/env.js';
import { createMemoryLogger } from "../../../shared/src/memory.js";
import { generateToken } from '../../../shared/src/auth/jwt.js';

const env = getEnv();
const apiTarget = `http://${env.API_HOST}:${env.API_PORT}`;
const memoryLogger = createMemoryLogger(process, debugApplication);

/**
 * Extracts query string from a URL.
 * @param {string} url - The URL to extract query from
 * @returns {string} Query string including '?' or empty string
 */
const extractQuery = (url) => {
  const queryIndex = url.indexOf('?');
  return queryIndex !== -1 ? url.slice(queryIndex) : '';
};

/**
 * Creates an export proxy middleware for a specific API path.
 * @param {string} apiPath - The target API path (e.g., '/export/report')
 * @returns {function} Express middleware
 */
export const createExportProxy = (apiPath) => {
  return createProxyMiddleware({
    target: apiTarget,
    changeOrigin: true,
    selfHandleResponse: false,

    pathRewrite: (_path, req) => `${apiPath}${extractQuery(req.url)}`,

    on: {
      /**
       * Proxy error handler — status-code-only responses.
       * Preserves stream integrity and avoids sending a JSON body
       * that would corrupt a partially-written Excel download.
       */
      error(err, req, res) {
        debugApplication(`Proxy error [${req.method} ${req.originalUrl}]: ${err.code || err.message}`);
        memoryLogger('proxy-error');

        if (res.headersSent) {
          debugApplication('Headers already sent, destroying response');
          res.destroy(err);
          return;
        }

        const statusCode = err.code === 'ECONNREFUSED' ? 502 : 504;
        res.writeHead(statusCode).end();
      },

      /**
       * Inject JWT token and log successful proxy forwarding
       */
      proxyReq(proxyReq, req) {
        const token = generateToken(env.JWT_SECRET, env.JWT_EXPIRES_IN);
        proxyReq.setHeader('Authorization', `Bearer ${token}`);

        debugApplication(`Proxy → ${apiTarget}${proxyReq.path} [${req.method}]`);
        memoryLogger('proxy-start');
      },

      /**
       * Log when response starts streaming back
       */
      proxyRes(proxyRes, req) {
        debugApplication(`Proxy ← ${proxyRes.statusCode} [${req.method} ${req.originalUrl}]`);
        memoryLogger('proxy-response');

        proxyRes.on('end', () => {
          memoryLogger.logPeakSummary('proxy-complete');
        });
      },
    },
  });
};
