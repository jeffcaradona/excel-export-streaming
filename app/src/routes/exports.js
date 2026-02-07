/**
 * Export proxy route — pipes streaming Excel downloads from API to browser.
 *
 * Separation of concerns:
 *   routes/exports.js  → route definition + proxy wiring
 *   app.js             → middleware stack + error handling
 *   server.js          → HTTP lifecycle + graceful shutdown
 *
 * The proxy preserves the binary stream end-to-end with no buffering.
 * Errors are status-code-only to avoid corrupting an in-flight stream.
 */
import { Router } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { debugApplication } from '../../../shared/src/debug.js';
import { getEnv } from '../config/env.js';

const router = Router();

const env = getEnv();
const apiTarget = `http://${env.API_HOST}:${env.API_PORT}`;

/**
 * Proxy middleware for export endpoints.
 *
 * Key settings:
 *   selfHandleResponse: false  → auto-pipe the response stream (no buffering)
 *   changeOrigin: true         → set Host header to the target
 *   pathRewrite                → /exports/report  →  /export/report
 */
const exportProxy = createProxyMiddleware({
  target: apiTarget,
  changeOrigin: true,

  pathRewrite: {
    // Express strips the mount path (/exports/report) before the proxy sees it,
    // so req.url arrives as '/'.  Rewrite to the API's actual endpoint.
    '^/': '/export/report',
  },

  // Let http-proxy-middleware pipe the response stream directly — no buffering
  selfHandleResponse: false,

  on: {
    /**
     * Proxy error handler — status-code-only responses.
     * Preserves stream integrity and avoids sending a JSON body
     * that would corrupt a partially-written Excel download.
     */
    error(err, req, res) {
      debugApplication(`Proxy error [${req.method} ${req.originalUrl}]: ${err.code || err.message}`);

      if (res.headersSent) {
        // Stream already started — nothing safe to send; destroy it.
        debugApplication('Headers already sent, destroying response');
        res.end();
        return;
      }

      const statusCode = err.code === 'ECONNREFUSED' ? 502 : 504;
      res.writeHead(statusCode).end();
    },

    /**
     * Optional: log successful proxy forwarding for debugging
     */
    proxyReq(proxyReq, req) {
      debugApplication(`Proxy → ${apiTarget}${proxyReq.path} [${req.method}]`);
    },
  },
});

/**
 * GET /exports/report(?rowCount=N)
 * Streams an Excel file from the API through the BFF to the browser.
 */
router.use('/report', exportProxy);

export default router;
