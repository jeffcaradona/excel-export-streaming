import process from 'node:process';
import mssql from 'mssql';
import { debugAPI } from "../../../shared/src/debug.js";
import { createMemoryLogger } from '../../../shared/src/memory.js';
import { getConnectionPool } from '../services/mssql.js';
import { DEFAULT_ROW_COUNT, validateRowCount } from '../config/export.js';
import { DatabaseError } from '../utils/errors.js';

import {DEFAULT_PAGE_NUMBER, DEFAULT_PAGE_SIZE} from '../config/report.js';


export const streamReport = async (req, res, next) => {
  // INITIALIZATION
  const startTime = Date.now();
  const memoryLogger = createMemoryLogger(process, debugAPI);
  let rowCount = 0;
  let streamRequest = null;
  let streamError = false;

  // Get and validate row count from query parameter
  const requestedRows = validateRowCount(
    req.query.rowCount || DEFAULT_ROW_COUNT,
  );

  try {
    debugAPI(
      `Starting MSSQL stream (${requestedRows} rows requested)`,
    );
    memoryLogger('Stream');

    // RESPONSE SETUP
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');

    // RESPONSE STREAM ERROR HANDLER
    res.on('error', (err) => {
      if (streamError) return;
      streamError = true;
      debugAPI("Response stream error:", err);
      if (streamRequest) {
        streamRequest.cancel();
      }
    });

    // DATABASE CONNECTION
    const pool = await getConnectionPool();
    streamRequest = pool.request();
    streamRequest.stream = true;

    debugAPI(
      `Executing spGenerateData in streaming mode with ${requestedRows} rows`,
    );

    // STORED PROCEDURE EXECUTION
    streamRequest.input("RowCount", mssql.Int, requestedRows);
    streamRequest.execute('spGenerateData').catch((err) => {
      if (streamError) return;
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

    // ROW EVENT: Stream each row as JSON to response
    streamRequest.on('row', (row) => {
      rowCount++;

      // Write row as newline-delimited JSON
      res.write(JSON.stringify(row) + '\n');

      // BACKPRESSURE: Pause database stream if response buffer fills up
      if (res.writableLength > res.writableHighWaterMark) {
        streamRequest.pause();
        res.once('drain', () => streamRequest.resume());
      }

      // MEMORY TRACKING: Log memory usage periodically
      if (rowCount % 5000 === 0) {
        memoryLogger(`Stream - ${rowCount} rows`);
        debugAPI(`Streamed ${rowCount} rows`);
      }
    });

    // ERROR EVENT: Fired if database streaming fails
    streamRequest.on('error', (err) => {
      if (streamError) return;
      streamError = true;
      debugAPI("SQL stream error:", err);

      if (res.headersSent) {
        res.destroy(err);
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

    // DONE EVENT: Fired when all rows are sent
    streamRequest.on('done', () => {
      try {
        debugAPI(`SQL stream complete. Total rows: ${rowCount}`);

        const duration = Date.now() - startTime;
        debugAPI(`Stream complete: ${rowCount} rows in ${duration}ms`);
        memoryLogger('Stream - Complete');
        memoryLogger.logPeakSummary('Stream - Peak');

        // Close the HTTP response
        res.end();
      } catch (err) {
        if (streamError) return;
        streamError = true;
        debugAPI("Error finalizing stream:", err);
        if (res.headersSent) {
          res.destroy(err);
        } else {
          const dbError = new DatabaseError('Stream error', err);
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
      }
    });

    // CLIENT DISCONNECT HANDLING
    req.on('close', () => {
      if (!res.writableEnded) {
        debugAPI(`Client disconnected after ${rowCount} rows`);
        memoryLogger.logPeakSummary('Stream - Peak (Disconnected)');

        if (streamRequest) {
          streamRequest.cancel();
        }
      }
    });

  } catch (err) {
    debugAPI("Error setting up stream:", err);
    next(err);
  }
};

/**
 * BUFFERED PAGED DATA PULL
 * 
 * Loads a single page of data into memory and returns as JSON.
 * Uses spPagedData stored procedure for efficient paging at the database level.
 * 
 * Query Parameters:
 *   - pageNumber: Page number (1-based, default: 1)
 *   - pageSize: Rows per page (default: 100)
 *   - totalRows: Total rows to consider (default: 300000)
 *     Example: GET /report/paged?pageNumber=2&pageSize=50&totalRows=100000
 * 
 * Response:
 *   - Returns JSON object with:
 *     - data: Array of row objects for the requested page
 *     - pageNumber: The page number requested
 *     - pageSize: The page size requested
 *     - totalRows: Total rows specified
 *     - rowCount: Actual rows returned on this page
 *     - duration: Time to fetch data in milliseconds
 * 
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @param {import('express').NextFunction} next - Express error handler function
 */
export const getPagedReport = async (req, res, next) => {
  const startTime = Date.now();
  const memoryLogger = createMemoryLogger(process, debugAPI);

  try {
    // PARAMETERS
    const pageNumber = parseInt(req.query.pageNumber) || DEFAULT_PAGE_NUMBER;
    const pageSize = parseInt(req.query.pageSize) || DEFAULT_PAGE_SIZE;
    const totalRows = parseInt(req.query.totalRows) || DEFAULT_ROW_COUNT;

    debugAPI(
      `Fetching paged data: page ${pageNumber}, size ${pageSize}, total ${totalRows}`,
    );
    memoryLogger('Paged Report');

    // DATABASE CONNECTION & EXECUTION
    // Non-streaming: execute() returns all results at once (no events)
    const pool = await getConnectionPool();
    const request = pool.request();

    request.input("PageNumber", mssql.Int, pageNumber);
    request.input("PageSize", mssql.Int, pageSize);
    request.input("RowCount", mssql.Int, totalRows);

    debugAPI(`Executing spPagedData`);
    const result = await request.execute("spPagedData");

    // DATA EXTRACTION FROM RESULT
    const rows = result.recordset || [];
    const rowCount = rows.length;

    debugAPI(`Retrieved ${rowCount} rows for page ${pageNumber}`);
    memoryLogger('Paged Report - Data Loaded');

    // FINAL METRICS
    const duration = Date.now() - startTime;
    debugAPI(`Paged data fetch complete: ${rowCount} rows in ${duration}ms`);
    memoryLogger.logPeakSummary('Paged Report - Peak');

    // SEND RESPONSE
    res.json({
      data: rows,
      pageNumber,
      pageSize,
      totalRows,
      rowCount,
      duration
    });
  } catch (err) {
    debugAPI("Error fetching paged report:", err);
    next(err);
  }
};

