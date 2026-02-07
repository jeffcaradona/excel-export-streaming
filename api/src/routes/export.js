import { Router } from 'express';
import { streamReportExport } from '../controllers/exportController.js';

const router = Router();

/**
 * GET /export/report
 * Streams an Excel export directly to the browser
 * No authentication required (Phase 1)
 */
router.get('/report', streamReportExport);

export default router;
