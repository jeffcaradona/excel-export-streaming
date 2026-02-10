/**
 * Export routes — declares paths and composes proxy middleware.
 *
 * Route mapping is declared here, where it belongs.
 * The proxy middleware is a dumb pipe that forwards to the given API path.
 *
 * Separation of concerns:
 *   routes/exports.js          → what path maps to what API endpoint (this file)
 *   middlewares/exportProxy.js → how the proxy works (config, errors)
 *   app.js                     → global middleware stack
 *   server.js                  → HTTP lifecycle + graceful shutdown
 */
import { Router } from 'express';
import { createExportProxy } from '../middlewares/exportProxy.js';

const router = Router();

/**
 * GET /exports/report(?rowCount=N)
 * Streams an Excel file from the API through the BFF to the browser.
 */
router.use('/report', createExportProxy('/export/report'));

/**
 * GET /exports/report-buffered(?rowCount=N)
 * Streams a buffered Excel export from the API through the BFF.
 * Used to demonstrate memory exhaustion with large datasets.
 */
router.use('/report-buffered', createExportProxy('/export/report-buffered'));

export default router;
