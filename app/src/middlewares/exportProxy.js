/**
 * Export proxy middleware — configures streaming proxy to the API service.
 *
 * Encapsulates all proxy configuration, path rewriting, and error handling.
 * The route file stays thin: it only declares what path maps to this middleware.
 *
 * Stream behavior:
 *   selfHandleResponse: false  → auto-pipe the response stream (no buffering)
 *   changeOrigin: true         → set Host header to the target
 *   pathRewrite                → rewrite to API's /export/report endpoint
 *
 * Error strategy:
 *   Status-code-only responses to avoid corrupting an in-flight Excel stream.
 *   502 for connection refused (API down), 504 for timeouts.
 */
import { createProxyMiddleware } from 'http-proxy-middleware';
import { debugApplication } from '../../../shared/src/debug.js';
import { getEnv } from '../config/env.js';

const env = getEnv();
const apiTarget = `http://${env.API_HOST}:${env.API_PORT}`;

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
     * Log successful proxy forwarding for debugging
     */
    proxyReq(proxyReq, req) {
      debugApplication(`Proxy → ${apiTarget}${proxyReq.path} [${req.method}]`);
    },
  },
});

export default exportProxy;
