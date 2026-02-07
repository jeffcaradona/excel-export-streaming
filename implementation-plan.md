# Implementation Plan — Streaming Excel Export

## Goal
Implement end-to-end streaming Excel export pipeline:  
**MSSQL → API (ExcelJS) → BFF (proxy) → Browser**

Export uses existing `spGenerateData` stored procedure, streams rows through ExcelJS workbook writer in API service, pipes through BFF to browser download.

---

## Current State Assessment

### ✅ Ready to Use
- **Production-ready MSSQL service** ([api/src/services/mssql.js](api/src/services/mssql.js))
  - Connection pooling with health checks and auto-recovery
  - Supports streaming queries via `request.stream = true`
  - Graceful shutdown support
  - Debug logging integration
  
- **Export-ready stored procedure** ([mssql/DB/spGenerateData.sql](mssql/DB/spGenerateData.sql))
  - Returns rowset (not JSON) - ideal for streaming
  - 10 columns of varied types (Int, BigInt, Decimal, Float, Bit, Guid, Date, Varchar, Text, Json)
  - Configurable row count via `@RowCount` parameter
  
- **Required libraries installed**
  - API service: `exceljs` v4.4.0, `express` v5.2.1, `mssql` v12.2.0
  - App service: `express` v5.2.1
  - Shared utilities: `debug` package, memory monitoring
  
- **Environment configuration**
  - `APP_PORT=3000`, `API_PORT=3001`
  - Database connection settings
  - Debug namespace configured

### ⚠️ Needs Implementation
- Both [api/src/server.js](api/src/server.js) and [app/src/server.js](app/src/server.js) are empty
- No proxy library in app service (`http-proxy-middleware` needed)
- No existing endpoints or routing patterns
- No error handling middleware

---

## Requirements (Clarified)

| Requirement | Decision |
|-------------|----------|
| **Authentication** | None - open access for initial implementation |
| **Query Parameters** | No - export all data from stored proc with defaults |
| **Excel Formatting** | Plain data only (fastest) - no styling or formatting |
| **Filename Pattern** | Timestamped: `report-YYYY-MM-DD-HHmmss.xlsx` |
| **Row Count** | Use stored procedure default (configurable for testing) |
| **Error Handling** | Log stream failures, handle client disconnects gracefully |

---

## Implementation Steps

### Step 1: Add Streaming Proxy Dependency
**File:** [app/package.json](app/package.json)

**Action:**
```bash
cd app
npm install http-proxy-middleware
```

**Purpose:** Enable stream piping from API to browser without buffering in the BFF layer.

---

### Step 2: Implement API Server
**File:** [api/src/server.js](api/src/server.js)

**Requirements:**
- Bootstrap Express v5 server on port 3001 (from `.env`)
- Import `debugServer` from [shared/src/debug.js](shared/src/debug.js)
- Mount router from [api/src/api.js](api/src/api.js)
- Integrate graceful shutdown with `closeConnectionPool()` from [api/src/services/mssql.js](api/src/services/mssql.js)
- Add error handling middleware
- Start server with startup logging

**Key Patterns:**
- Use `process.env.API_PORT` for port configuration
- Handle `SIGTERM` and `SIGINT` for graceful shutdown
- Log server startup and shutdown events

---

### Step 3: Create Streaming Export Endpoint
**File:** [api/src/api.js](api/src/api.js)

**Route:** `GET /export/report`

**Implementation Flow:**

1. **Set Response Headers**
   ```javascript
   Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
   Content-Disposition: attachment; filename=report-{timestamp}.xlsx
   ```
   - Timestamp format: `YYYY-MM-DD-HHmmss`

2. **Initialize MSSQL Streaming Query**
   - Call `getConnectionPool()` from [api/src/services/mssql.js](api/src/services/mssql.js)
   - Create request: `const request = pool.request()`
   - Enable streaming: `request.stream = true`
   - Execute: `request.execute('spGenerateData')`

3. **Create ExcelJS Streaming Writer**
   ```javascript
   import ExcelJS from 'exceljs';
   const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
   const worksheet = workbook.addWorksheet('Data');
   ```

4. **Define Column Schema**
   - 10 columns matching stored procedure output:
     - IntColumn, BigIntColumn, DecimalColumn, FloatColumn, BitColumn
     - GuidColumn, DateColumn, VarcharColumn, TextColumn, JsonColumn
   - Use column names as headers

5. **Stream Row Events**
   ```javascript
   request.on('row', async (row) => {
     worksheet.addRow([...row values...]);
     await worksheet.commit();
   });
   ```

6. **Handle Error Events**
   ```javascript
   request.on('error', (err) => {
     debugMSSQL('Stream error:', err);
     if (!res.headersSent) {
       res.status(500).end();
     }
   });
   ```

7. **Finalize on Done**
   ```javascript
   request.on('done', async () => {
     await workbook.commit();
     res.end();
   });
   ```

8. **Monitor Memory Usage**
   - Use `createMemoryLogger()` from [shared/src/memory.js](shared/src/memory.js)
   - Log memory at start and periodic intervals during stream

9. **Handle Client Disconnect**
   ```javascript
   res.on('close', () => {
     debugApplication('Client disconnected mid-stream');
     // Cleanup if needed
   });
   ```

**Error Scenarios to Handle:**
- Database connection failure
- SQL execution timeout (configure 30s timeout)
- Client disconnect mid-stream
- ExcelJS write failures
- Memory pressure

---

### Step 4: Implement BFF Server
**File:** [app/src/server.js](app/src/server.js)

**Requirements:**
- Bootstrap Express v5 server on port 3000 (from `.env`)
- Import `debugServer` from [shared/src/debug.js](shared/src/debug.js)
- Mount router from [app/src/app.js](app/src/app.js)
- Graceful shutdown handling
- Add error handling middleware
- Start server with startup logging

**Key Patterns:**
- Use `process.env.APP_PORT` for port configuration
- Handle `SIGTERM` and `SIGINT` for graceful shutdown
- Log server startup and shutdown events

---

### Step 5: Create Proxy Route
**File:** [app/src/app.js](app/src/app.js)

**Route:** `GET /exports/report`

**Implementation:**
```javascript
import { createProxyMiddleware } from 'http-proxy-middleware';

const exportProxy = createProxyMiddleware({
  target: `http://localhost:${process.env.API_PORT}`,
  changeOrigin: true,
  pathRewrite: {
    '^/exports/report': '/export/report'
  },
  selfHandleResponse: false, // Auto-pipe streams
  onError: (err, req, res) => {
    debugApplication('Proxy error:', err);
    if (!res.headersSent) {
      res.status(502).send('Bad Gateway');
    }
  }
});

router.get('/exports/report', exportProxy);
```

**Key Points:**
- `selfHandleResponse: false` enables automatic stream piping
- No buffering between API and browser
- Preserve headers from API response
- Handle proxy-specific errors (connection refused, timeout)

---

### Step 6: Add Error Handling and Logging

**API Service:**
- Add Express error middleware in [api/src/server.js](api/src/server.js)
- Log all errors with stack traces using `debugApplication`
- Configure request timeout (30s default)
- Handle stream-specific errors:
  - Client disconnect: Log and cleanup gracefully
  - SQL timeout: Return 504 Gateway Timeout
  - Memory pressure: Log warnings

**BFF Service:**
- Add Express error middleware in [app/src/server.js](app/src/server.js)
- Log proxy failures with `debugApplication`
- Handle API service unavailable (connection refused)

**Debug Namespaces:**
- `debugServer` - Server lifecycle events
- `debugApplication` - Application logic and routes
- `debugMSSQL` - Database operations and streams

---

### Step 7: Configure NPM Scripts

**Root [package.json](package.json):**
```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev -w api\" \"npm run dev -w app\"",
    "start:api": "npm start -w api",
    "start:app": "npm start -w app"
  }
}
```

**API [api/package.json](api/package.json):**
```json
{
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js"
  }
}
```

**App [app/package.json](app/package.json):**
```json
{
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js"
  }
}
```

**Install `concurrently` (if needed):**
```bash
npm install -D concurrently
```

---

## Verification Checklist

### Initial Setup
- [ ] Install `http-proxy-middleware` in app service
- [ ] Install `concurrently` in root (if not present)
- [ ] Verify `.env` file has correct ports and DB credentials

### Database Preparation
- [ ] Execute [mssql/exec.sql](mssql/exec.sql) to run `spGenerateData`
- [ ] Start with low row count (~1,000 rows) for quick testing
- [ ] Verify stored procedure executes successfully

### Development Testing
- [ ] Start both services: `npm run dev` from workspace root
- [ ] Verify API server starts on port 3001
- [ ] Verify App server starts on port 3000
- [ ] Check debug logs for startup messages

### Export Functionality
- [ ] Navigate to: `http://localhost:3000/exports/report`
- [ ] Verify Excel file begins downloading immediately
- [ ] Verify filename format: `report-2026-02-07-143022.xlsx` (with timestamp)
- [ ] Open downloaded file and verify:
  - [ ] 10 columns present with correct headers
  - [ ] Data matches stored procedure output
  - [ ] All rows exported successfully

### Performance Testing
- [ ] **1k rows:** Export completes < 1 second
- [ ] **10k rows:** Monitor memory usage (should stay under 50MB growth)
- [ ] **30k rows:** Export completes smoothly, no memory spikes
- [ ] **100k+ rows:** (Optional) Stress test if time permits

### Memory Monitoring
- [ ] Check console for memory logger output during export
- [ ] Verify RSS memory growth is minimal during stream
- [ ] Verify memory returns to baseline after export completes

### Error Scenarios
- [ ] **Client disconnect:** Cancel download mid-stream
  - Verify no errors crash the server
  - Check logs show graceful handling
- [ ] **Database timeout:** Configure low timeout, try large export
  - Verify proper error response (504 or 500)
- [ ] **API service down:** Stop API, try export from BFF
  - Verify 502 Bad Gateway response
  - Check proxy error logging

### Production Readiness
- [ ] Review all debug log output for sensitive data
- [ ] Test graceful shutdown: `Ctrl+C` both services
- [ ] Verify connection pool closes cleanly
- [ ] Document deployment steps

---

## Technical Decisions

### Architecture
- **MSSQL → API → BFF → Browser** streaming pipeline
- No in-memory buffering at any layer
- Native Node.js stream backpressure handling

### Libraries
- **ExcelJS `stream.xlsx.WorkbookWriter`** for memory-efficient Excel generation
- **http-proxy-middleware** for stream-aware proxying (simplest option)
- **mssql package streaming mode** (`request.stream = true`)

### Configuration
- **API Port:** 3001
- **App Port:** 3000
- **Request Timeout:** 30 seconds
- **Connection Pool:** 5-25 connections (existing configuration)

### Error Handling Strategy
- **Client disconnect:** Log and cleanup, no error response needed
- **SQL errors:** 500 Internal Server Error
- **SQL timeout:** 504 Gateway Timeout
- **Proxy errors:** 502 Bad Gateway
- **All errors logged with full stack traces**

### Security (Phase 1)
- **No authentication** - open access for initial implementation
- **No input validation** - no parameters accepted yet
- **Phase 2 considerations:**
  - Add JWT validation middleware
  - Add request parameter validation
  - Add rate limiting for export endpoint
  - Add audit logging

---

## Performance Targets

| Metric | Target |
|--------|--------|
| **1k rows** | < 1 second |
| **10k rows** | < 5 seconds |
| **30k rows** | < 15 seconds |
| **Memory overhead** | < 50MB during streaming |
| **Concurrent exports** | 10+ simultaneous downloads |

---

## File Summary

### Files to Create/Modify
1. [api/src/server.js](api/src/server.js) - Create Express server (currently empty)
2. [api/src/api.js](api/src/api.js) - Create export endpoint with ExcelJS streaming (currently empty)
3. [app/src/server.js](app/src/server.js) - Create Express server (currently empty)
4. [app/src/app.js](app/src/app.js) - Create proxy route (currently empty)
5. [app/package.json](app/package.json) - Add `http-proxy-middleware` dependency
6. [package.json](package.json) - Add dev script with `concurrently`
7. [api/package.json](api/package.json) - Add start/dev scripts
8. [app/package.json](app/package.json) - Add start/dev scripts

### Files to Use (No Changes)
- [api/src/services/mssql.js](api/src/services/mssql.js) - Import and use as-is
- [shared/src/debug.js](shared/src/debug.js) - Import debug loggers
- [shared/src/memory.js](shared/src/memory.js) - Import memory logger
- [mssql/DB/spGenerateData.sql](mssql/DB/spGenerateData.sql) - Execute for data generation

---

## Next Steps

1. **Implement Step 1-7** sequentially
2. **Test incrementally** after each major component
3. **Load test with increasing row counts** (1k → 10k → 30k)
4. **Document any issues or optimizations** discovered during testing
5. **Prepare for Phase 2** enhancements:
   - Authentication
   - Query parameters (filters, limits)
   - Basic Excel formatting (column widths)
   - Error reporting improvements

---

## Estimated Effort

**Based on current state:**
- **Setup and dependencies:** 0.5 hours
- **API server + export endpoint:** 2-3 hours
- **BFF server + proxy route:** 1-2 hours
- **Error handling and logging:** 1-2 hours
- **Testing and verification:** 2-3 hours
- **Documentation and cleanup:** 1 hour

**Total: 8-12 hours (1-1.5 developer-days)**

**ROM validation:** Original estimate was 5-7 days, but:
- Stored procedure is already ready (saved 1-2 days)
- MSSQL service is production-ready (saved scaffolding time)
- No auth complexity (saved 1-2 days)
- Simplified requirements (plain Excel, no parameters)

**Actual effort aligns with "Scenario A" from original ROM.**

---

## Success Criteria

✅ **Implementation Complete When:**
1. User can navigate to BFF endpoint and download Excel file
2. Excel file contains all rows from stored procedure
3. Export works reliably with 30k+ rows
4. Memory usage stays low during streaming
5. Client disconnect doesn't crash servers
6. All error scenarios handled gracefully
7. Debug logging provides clear troubleshooting info

---

*Last Updated: February 7, 2026*
