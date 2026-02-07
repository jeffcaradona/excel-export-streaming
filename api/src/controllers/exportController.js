import process from 'node:process';
import ExcelJS from 'exceljs';
import { debugApplication } from '../../../shared/src/debug.js';
import { createMemoryLogger } from '../../../shared/src/memory.js';
import { getConnectionPool } from '../services/mssql.js';
import { generateTimestampedFilename } from '../utils/filename.js';
import { REPORT_COLUMNS, mapRowToExcel } from '../utils/columnMapper.js';

/**
 * Handles the streaming Excel export
 * Streams data from MSSQL through ExcelJS directly to the HTTP response.
 * No data is buffered in memory - rows are processed one at a time.
 * 
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @param {import('express').NextFunction} next - Express next function
 */
export const streamReportExport = async (req, res, next) => {
  const startTime = Date.now();
  const memoryLogger = createMemoryLogger(process, debugApplication);
  let rowCount = 0;
  let streamRequest = null;
  
  try {
    debugApplication('Starting Excel export');
    memoryLogger('Export'); // Log initial memory
    
    // Set response headers for file download
    const filename = generateTimestampedFilename();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // Create ExcelJS streaming workbook writer
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: res,
      useStyles: false,
      useSharedStrings: false
    });
    
    const worksheet = workbook.addWorksheet('Report');
    worksheet.columns = REPORT_COLUMNS;
    
    // Get database connection and create streaming request
    const pool = await getConnectionPool();
    streamRequest = pool.request();
    streamRequest.stream = true; // Enable streaming mode
    
    debugApplication('Executing stored procedure in streaming mode');
    
    // Execute stored procedure
    streamRequest.execute('spGenerateData');
    
    // Handle row events - write each row to Excel as it arrives
    streamRequest.on('row', (row) => {
      rowCount++;
      
      // Add row to worksheet and commit immediately
      worksheet.addRow(mapRowToExcel(row)).commit();
      
      // Log memory periodically (every 5000 rows)
      if (rowCount % 5000 === 0) {
        memoryLogger(`Export - ${rowCount} rows`);
        debugApplication(`Processed ${rowCount} rows`);
      }
    });
    
    // Handle errors from the database stream
    streamRequest.on('error', (err) => {
      debugApplication('SQL stream error:', err);
      
      // If headers haven't been sent yet, we can send an error response
      if (!res.headersSent) {
        res.status(500).json({ error: 'Database error occurred' });
      }
      // Otherwise, stream is already in progress - just log and let it fail
    });
    
    // Handle completion
    streamRequest.on('done', async () => {
      try {
        debugApplication(`SQL stream complete. Total rows: ${rowCount}`);
        
        // Finalize the workbook
        await worksheet.commit();
        await workbook.commit();
        
        const duration = Date.now() - startTime;
        debugApplication(`Export complete: ${rowCount} rows in ${duration}ms`);
        memoryLogger('Export - Complete'); // Final memory log
        
        res.end();
      } catch (err) {
        debugApplication('Error finalizing workbook:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to generate Excel file' });
        }
      }
    });
    
    // Handle client disconnect
    req.on('close', () => {
      if (!res.writableEnded) {
        debugApplication(`Client disconnected after ${rowCount} rows`);
        
        // Cancel the database request if still active
        if (streamRequest) {
          streamRequest.cancel();
        }
      }
    });
    
  } catch (err) {
    debugApplication('Error setting up export stream:', err);
    next(err); // Pass to Express error handler
  }
};
