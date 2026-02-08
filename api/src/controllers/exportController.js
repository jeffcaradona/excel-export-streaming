import process from 'node:process';
import ExcelJS from 'exceljs';
import mssql from 'mssql';
import { debugAPI } from "../../../shared/src/debug.js";
import { createMemoryLogger } from '../../../shared/src/memory.js';
import { getConnectionPool } from '../services/mssql.js';
import { generateTimestampedFilename } from '../utils/filename.js';
import { REPORT_COLUMNS, mapRowToExcel } from '../utils/columnMapper.js';
import { DEFAULT_ROW_COUNT, validateRowCount } from '../config/export.js';
import { ExportError, DatabaseError } from '../utils/errors.js';

/**
 * STREAMING EXPORT CONTROLLER
 * 
 * This module provides two different approaches to Excel export:
 * 1. streamReportExport() - Memory-efficient streaming (RECOMMENDED)
 * 2. bufferReportExport() - Buffered export loads all data into memory (for comparison)
 * 
 * KEY DIFFERENCES:
 * - Streaming: Rows are piped directly from MSSQL → ExcelJS → HTTP response
 *   - Low memory footprint (constant throughout)
 *   - Suitable for large exports (30k+ rows)
 *   - No intermediate buffering
 * 
 * - Buffered: All data loaded into memory → written to Excel workbook → sent as buffer
 *   - High memory footprint (grows with row count)
 *   - Suitable for small/medium exports
 *   - Useful for testing memory limits
 */

/**
 * STREAMING EXCEL EXPORT
 * 
 * Memory-efficient export that streams rows from database directly to the browser.
 * No data is buffered in memory - each row is processed and written immediately.
 * 
 * Query Parameters:
 *   - rowCount: Number of rows to export (default: 30000, max: 1000000)
 *     Example: GET /export/report?rowCount=50000
 * 
 * Memory Profile:
 *   - Constant memory usage regardless of row count
 *   - Peak memory typically < 50MB for large exports
 *   - Suitable for 30k+ rows without risk of OOM
 * 
 * Flow:
 *   1. Validate row count from query parameter
 *   2. Set HTTP response headers (Excel file download)
 *   3. Create ExcelJS streaming workbook (writes directly to response stream)
 *   4. Connect to MSSQL and execute stored procedure in streaming mode
 *   5. For each row from database:
 *      - Map database columns to Excel format
 *      - Write to worksheet and commit immediately
 *      - Track row count and memory usage
 *   6. When all rows received, finalize workbook and close response
 *   7. Log peak memory usage and performance metrics
 * 
 * Error Handling:
 *   - Database stream errors: Log and attempt to send error response if headers not sent
 *   - Client disconnect: Cancel database request and cleanup
 *   - Workbook finalization errors: Attempt error response, otherwise stream fails gracefully
 * 
 * @param {import('express').Request} req - Express request object (query.rowCount optional)
 * @param {import('express').Response} res - Express response object (file download)
 * @param {import('express').NextFunction} next - Express error handler function
 */
export const streamReportExport = async (req, res, next) => {
  // INITIALIZATION
  // Track performance metrics and memory usage throughout the export
  const startTime = Date.now();
  const memoryLogger = createMemoryLogger(process, debugAPI);
  let rowCount = 0;
  let streamRequest = null;
  let streamError = false; // Guard against multiple simultaneous error handlers
  
  // Get and validate row count from query parameter
  // validateRowCount() ensures value is between MIN_ROW_COUNT and MAX_ROW_COUNT
  const requestedRows = validateRowCount(req.query.rowCount || DEFAULT_ROW_COUNT);
  
  try {
    // LOG: Initial state
    debugAPI(
      `Starting streaming Excel export (${requestedRows} rows requested)`,
    );
    memoryLogger('Export'); // Log initial memory baseline
    
    // RESPONSE SETUP
    // Configure HTTP response to trigger browser download
    // Content-Disposition header tells browser to save as file, not display
    const filename = generateTimestampedFilename();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // EXCEL WORKBOOK SETUP (STREAMING)
    // ExcelJS WorkbookWriter streams directly to res (HTTP response)
    // This is the key to memory efficiency - data never fully buffered in memory
    // useStyles/useSharedStrings set to false for minimal memory overhead
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: res,                    // Write directly to HTTP response stream
      useStyles: false,               // Skip Excel styles to reduce memory
      useSharedStrings: false         // Disable shared strings for streaming
    });
    
    const worksheet = workbook.addWorksheet('Report');
    worksheet.columns = REPORT_COLUMNS; // Define columns from schema
    
    // RESPONSE STREAM ERROR HANDLER
    // If the client disconnects and a write is attempted before the close
    // event fires, res emits an error (ERR_STREAM_WRITE_AFTER_END or
    // ERR_STREAM_DESTROYED). Without this handler, the error becomes an
    // uncaught exception and crashes the process.
    res.on('error', (err) => {
      if (streamError) return;
      streamError = true;
      debugAPI("Response stream error:", err);
      if (streamRequest) {
        streamRequest.cancel();
      }
    });
    
    // DATABASE CONNECTION
    // Get connection from pool and enable streaming mode
    const pool = await getConnectionPool();
    streamRequest = pool.request();
    streamRequest.stream = true; // Enable streaming - events emitted per row instead of loadAll
    
    // LOG: Database execution
    debugAPI(
      `Executing stored procedure in streaming mode with ${requestedRows} rows`,
    );
    
    // STORED PROCEDURE EXECUTION
    // Execute with row count parameter
    // In streaming mode, this emits 'row' events as data flows from MSSQL
    streamRequest.input("RowCount", mssql.Int, requestedRows);
    streamRequest.execute('spGenerateData').catch((err) => {
      if (streamError) return; // Prevent double-handling
      streamError = true;
      debugAPI("Execute failed:", err);
      if (res.headersSent) {
        res.destroy(err);
      } else {
        const dbError = new DatabaseError('Database error occurred', err);
        try {
          res.status(dbError.status).json({
            error: { message: dbError.message, code: dbError.code }
          });
        } catch (error_) {
          debugAPI("Failed to send error response:", error_);
        }
      }
      if (streamRequest) {
        streamRequest.cancel();
      }
    });
    
    // EVENT HANDLERS (Database → Excel → HTTP)
    // These async listeners handle the streaming data flow
    
    // ROW EVENT: Fired for each row returned from database
    // This is where data flows from MSSQL → ExcelJS → HTTP response
    streamRequest.on('row', (row) => {
      rowCount++;
      
      // Map database columns to Excel row format and write immediately
      // .commit() writes the row to the underlying stream without buffering
      worksheet.addRow(mapRowToExcel(row)).commit();
      
      // BACKPRESSURE: If the response stream buffer is full, pause the
      // database stream until the client catches up. Without this, a slow
      // client causes unbounded memory growth as rows pile up in the buffer.
      if (res.writableLength > res.writableHighWaterMark) {
        streamRequest.pause();
        res.once('drain', () => streamRequest.resume());
      }
      
      // MEMORY TRACKING: Log memory usage periodically
      // Every 5000 rows, check memory to detect potential issues
      if (rowCount % 5000 === 0) {
        memoryLogger(`Export - ${rowCount} rows`);
        debugAPI(`Processed ${rowCount} rows`);
      }
    });
    
    // ERROR EVENT: Fired if database streaming fails
    // Could indicate: connection lost, timeout, SQL error, etc.
    streamRequest.on('error', (err) => {
      if (streamError) return; // Prevent double-handling
      streamError = true;
      debugAPI("SQL stream error:", err);
      
      if (res.headersSent) {
        res.destroy(err); // Abort the in-flight transfer
      } else {
        const dbError = new DatabaseError('Database error occurred', err);
        try {
          res.status(dbError.status).json({
            error: {
              message: dbError.message,
              code: dbError.code
            }
          });
        } catch (error_) {
          debugAPI("Failed to send error response:", error_);
        }
      }
      if (streamRequest) {
        streamRequest.cancel();
      }
    });
    
    // DONE EVENT: Fired when all rows are sent and database stream closes
    // This is where we finalize the Excel file
    streamRequest.on('done', async () => {
      try {
        debugAPI(`SQL stream complete. Total rows: ${rowCount}`);
        
        // WORKBOOK FINALIZATION
        // These calls close the Excel stream and ensure all data is flushed
        // They must complete before we can end the HTTP response
        await worksheet.commit();
        await workbook.commit();
        
        // LOGGING & METRICS
        const duration = Date.now() - startTime;
        debugAPI(`Export complete: ${rowCount} rows in ${duration}ms`);
        memoryLogger('Export - Complete'); // Final current memory snapshot
        memoryLogger.logPeakSummary('Export - Peak'); // Peak memory during entire operation
        
        // Close the HTTP response (browser receives complete file)
        res.end();
      } catch (err) {
        if (streamError) return; // Prevent double-handling
        streamError = true;
        debugAPI("Error finalizing workbook:", err);
        if (res.headersSent) {
          res.destroy(err); // Force-close the partially-written response
        } else {
          const exportError = new ExportError('Failed to generate Excel file');
          try {
            res.status(exportError.status).json({
              error: {
                message: exportError.message,
                code: exportError.code
              }
            });
          } catch (error_) {
            debugAPI("Failed to send error response:", error_);
          }
        }
      }
    });
    
    // CLIENT DISCONNECT HANDLING
    // If browser closes connection mid-stream, clean up database request
    // This prevents orphaned database queries consuming resources
    req.on('close', () => {
      if (!res.writableEnded) {
        debugAPI(`Client disconnected after ${rowCount} rows`);
        memoryLogger.logPeakSummary('Export - Peak (Disconnected)');
        
        // Cancel the database request if it's still active
        if (streamRequest) {
          streamRequest.cancel();
        }
      }
    });
    
  } catch (err) {
    // INITIALIZATION ERRORS
    // Errors setting up the export (before streaming starts)
    debugAPI("Error setting up export stream:", err);
    next(err); // Pass to Express global error handler
  }
};

/**
 * BUFFERED EXCEL EXPORT (NON-STREAMING)
 * 
 * Full-memory export that loads all data before creating Excel file.
 * WARNING: High memory usage - only suitable for small/medium datasets.
 * 
 * Query Parameters:
 *   - rowCount: Number of rows to export (default: 30000, max: 1000000)
 *     Example: GET /export/report-buffered?rowCount=50000
 * 
 * Memory Profile:
 *   - Peak memory grows with row count
 *   - Approximately 2-5KB per row in memory
 *   - 100k rows ≈ 200-500MB
 *   - 500k rows ≈ 1-2.5GB (likely OOM)
 *   - NOT suitable for large exports
 * 
 * Flow:
 *   1. Validate row count from query parameter
 *   2. Connect to MSSQL and execute stored procedure
 *   3. WAIT for ALL rows to be returned and buffered in memory
 *   4. Log memory after data loaded
 *   5. Create ExcelJS non-streaming workbook
 *   6. Write all rows to worksheet at once
 *   7. Generate entire Excel file into memory buffer
 *   8. Send buffer to browser as file download
 *   9. Log peak memory usage
 * 
 * Use Cases:
 *   - Testing memory impact of buffering approach
 *   - Comparing with streaming performance
 *   - Small exports (< 10k rows) where latency doesn't matter
 *   - Debugging column/format issues
 * 
 * @param {import('express').Request} req - Express request object (query.rowCount optional)
 * @param {import('express').Response} res - Express response object (file download)
 * @param {import('express').NextFunction} next - Express error handler function
 */
export const bufferReportExport = async (req, res, next) => {
  // INITIALIZATION
  const startTime = Date.now();
  const memoryLogger = createMemoryLogger(process, debugAPI);

  // Get and validate row count from query parameter
  const requestedRows = validateRowCount(req.query.rowCount || DEFAULT_ROW_COUNT);

  try {
    // LOG: Initial state
    debugAPI(
      `Starting non-streaming Excel export (${requestedRows} rows requested)`,
    );
    memoryLogger("Export - Start"); // Log initial memory

    // DATABASE CONNECTION & EXECUTION
    // Non-streaming: execute() returns all results at once (no events)
    // ENTIRE RESULT SET is loaded into memory before function returns
    const pool = await getConnectionPool();
    const request = pool.request();

    debugAPI(
      `Executing stored procedure (loading ${requestedRows} rows into memory)`,
    );

    request.input("RowCount", mssql.Int, requestedRows);
    const result = await request.execute("spGenerateData");

    // DATA EXTRACTION FROM RESULT
    // result.recordset contains ALL rows returned by stored procedure
    // This array exists entirely in Node.js process memory
    const rows = result.recordset;
    const rowCount = rows.length;

    // MEMORY CHECKPOINT
    debugAPI(`Loaded ${rowCount} rows into memory`);
    memoryLogger("Export - Data Loaded"); // Snapshot after data buffered

    // RESPONSE SETUP
    // Configure HTTP response headers for file download
    const filename = generateTimestampedFilename("report-buffered");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    // EXCEL WORKBOOK SETUP (NON-STREAMING)
    // ExcelJS Workbook (not WorkbookWriter) - loads entire workbook in memory
    // All rows added to memory, then entire file generated to buffer
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Report");
    worksheet.columns = REPORT_COLUMNS;

    debugAPI("Writing rows to Excel workbook");

    // WRITE ALL ROWS TO WORKBOOK IN MEMORY
    // This loop adds each database row to the Excel worksheet
    // All rows and worksheet data exist in Node.js memory at this point
    for (let i = 0; i < rows.length; i++) {
      worksheet.addRow(mapRowToExcel(rows[i]));

      // MEMORY TRACKING: Log memory periodically during write
      if ((i + 1) % 5000 === 0) {
        memoryLogger(`Export - ${i + 1} rows written`);
        debugAPI(`Written ${i + 1} rows to workbook`);
      }
    }

    // MEMORY CHECKPOINT
    memoryLogger("Export - Rows Written"); // Snapshot after all rows added

    debugAPI("Generating Excel file buffer");

    // GENERATE EXCEL FILE BUFFER
    // This creates the complete .xlsx file in memory as a Buffer
    // Includes all rows + column definitions + metadata
    // The largest memory spike occurs here
    const buffer = await workbook.xlsx.writeBuffer();

    // MEMORY CHECKPOINT
    memoryLogger("Export - Buffer Generated"); // Snapshot after file buffer created

    // FINAL METRICS
    const duration = Date.now() - startTime;
    debugAPI(`Export complete: ${rowCount} rows in ${duration}ms`);
    memoryLogger.logPeakSummary("Export - Peak"); // Peak memory across entire operation

    // SEND FILE TO BROWSER
    // Send the buffer as express response
    // Browser receives complete file and saves it
    res.send(buffer);
  } catch (err) {
    // ERROR HANDLING
    debugAPI("Error during non-streaming export:", err);
    next(err); // Pass to Express global error handler
  }
};


