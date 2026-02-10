import { Router } from 'express';
import {
  streamReportExport,
  bufferReportExport,
} from "../controllers/exportController.js";
import { jwtAuthMiddleware } from '../../../shared/src/middlewares/jwtAuth.js';
import { getEnv } from '../config/env.js';

const router = Router();
const env = getEnv();

// Apply JWT authentication to all export routes
router.use(jwtAuthMiddleware(env.JWT_SECRET));

/**
 * GET /export/report?rowCount=<number>
 * Streams an Excel export directly to the browser
 * Query params:
 *   - rowCount: Number of rows to export (default: 30000, max: 1000000)
 * Requires valid JWT token from App service
 */
router.get('/report', streamReportExport);

/**
 * GET /export/report-buffered?rowCount=<number>
 * Non-streaming Excel export (loads all data into memory first)
 * Useful for comparing memory usage vs streaming approach
 * Query params:
 *   - rowCount: Number of rows to export (default: 30000, max: 1000000)
 * Requires valid JWT token from App service
 */
router.get("/report-buffered", bufferReportExport);

export default router;
