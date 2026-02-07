import { Router } from 'express';
import {
  streamReportExport,
  bufferReportExport,
} from "../controllers/exportController.js";

const router = Router();

/**
 * GET /export/report?rowCount=<number>
 * Streams an Excel export directly to the browser
 * Query params:
 *   - rowCount: Number of rows to export (default: 30000, max: 1000000)
 * No authentication required (Phase 1)
 */
router.get('/report', streamReportExport);

/**
 * GET /export/report-buffered?rowCount=<number>
 * Non-streaming Excel export (loads all data into memory first)
 * Useful for comparing memory usage vs streaming approach
 * Query params:
 *   - rowCount: Number of rows to export (default: 30000, max: 1000000)
 * No authentication required (Phase 1)
 */
router.get("/report-buffered", bufferReportExport);

export default router;
