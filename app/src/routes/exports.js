/**
 * Export routes — thin declarations mapping paths to middleware.
 *
 * Separation of concerns:
 *   routes/exports.js          → what path, which handler (this file)
 *   middlewares/exportProxy.js  → how the proxy works (config, errors)
 *   app.js                     → global middleware stack
 *   server.js                  → HTTP lifecycle + graceful shutdown
 */
import { Router } from 'express';
import exportProxy from '../middlewares/exportProxy.js';

const router = Router();

/**
 * GET /exports/report(?rowCount=N)
 * Streams an Excel file from the API through the BFF to the browser.
 */
router.use('/report', exportProxy);

export default router;
