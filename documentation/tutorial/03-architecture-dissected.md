# Building Your Own Streaming Export: Step-by-Step Implementation

## Introduction

In [02-streams-and-node-design.md](02-streams-and-node-design.md), we learned stream concepts. Now let's **implement a streaming export** from scratch. Whether you're building your first export or migrating from buffering, this chapter walks through each component you need to build.

**By the end, you'll have:**
- A streaming database query
- ExcelJS writing directly to HTTP
- Proper error handling and backpressure
- A working export that handles millions of rows

## The Architecture: What We're Building

Here's the complete data flow from database to browser:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          STREAMING EXCEL EXPORT                             │
└─────────────────────────────────────────────────────────────────────────────┘

USER BROWSER                                                    
    │ GET /exports/report?rowCount=100000
    │ (with session/cookies)
    ↓
┌─────────────────────────────────────┐
│  BFF SERVICE (Port 3000)            │  [app/src/server.js]
│  ├─ Express Router                  │  [app/src/routes/exports.js]
│  ├─ JWT Auth Middleware             │  [shared/src/auth/jwt.js]
│  └─ HTTP Proxy Middleware           │  [app/src/middlewares/exportProxy.js]
└─────────────────────────────────────┘
    │ Validates user session
    │ Generates JWT token
    │ Proxies to API with Authorization header
    ↓
┌─────────────────────────────────────┐
│  API SERVICE (Port 3001)            │  [api/src/server.js]
│  ├─ JWT Verification Middleware     │  [shared/src/middlewares/jwtAuth.js]
│  ├─ Express Router                  │  [api/src/routes/export.js]
│  └─ Export Controller               │  [api/src/controllers/exportController.js]
└─────────────────────────────────────┘
    │
    │ 1. Validate row count
    │ 2. Set response headers (Content-Type, filename)
    ↓
┌─────────────────────────────────────┐
│  ExcelJS WorkbookWriter             │
│  new WorkbookWriter({ stream: res })│  ← Writes directly to HTTP response
│  ├─ Workbook metadata               │
│  └─ Worksheet definition            │  [api/src/utils/columnMapper.js]
└─────────────────────────────────────┘
    │
    │ 3. Execute stored procedure with stream: true
    ↓
┌─────────────────────────────────────┐
│  MSSQL Connection Pool              │  [api/src/services/mssql.js]
│  request.stream = true              │  ← Enables row-by-row events
│  request.execute('spGenerateData')  │
└─────────────────────────────────────┘
    │
    ↓
┌─────────────────────────────────────┐
│  SQL SERVER                         │  [mssql/DB/spGenerateData.sql]
│  spGenerateData(@RowCount)          │
│  RETURNS 10 columns per row         │
└─────────────────────────────────────┘
    │
    │ EMIT 'row' event for each row
    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                    EVENT LOOP (Per Row Processing)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  FOR EACH ROW FROM DATABASE:                                                │
│                                                                             │
│  request.on('row', row => {                                                 │
│    1. mapRowToExcel(row)          ← Transform DB columns to Excel format    │
│    2. worksheet.addRow().commit() ← Write row to stream immediately         │
│    3. Every 5000 rows: log memory ← Monitor memory usage                    │
│  })                                                                         │
│                                                                             │
│  Memory stays constant: Only 1 row in memory at a time                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
    │
    │ ALL ROWS PROCESSED
    ↓
┌─────────────────────────────────────┐
│  'done' EVENT                       │
│  await worksheet.commit()           │  ← Flush worksheet
│  await workbook.commit()            │  ← Finalize Excel file structure
│  res.end()                          │  ← Close HTTP response
└─────────────────────────────────────┘
    │
    ↓
BROWSER RECEIVES COMPLETE .xlsx FILE
report-2026-02-07-143022.xlsx
```

## Implementation: Building the Export From Scratch

Now let's build this step-by-step. We'll use Express.js with MSSQL (but this works with PostgreSQL, MySQL, etc.)

### Step 1: Set Up Your Route and Controller

First, create an Express route handler. This will be your main export endpoint:

```javascript
// routes/export.js
import { Router } from 'express';
import { jwtAuth } from '../middlewares/jwtAuth.js';
import { exportController } from '../controllers/exportController.js';

const router = Router();

// GET /export/report?rowCount=100000
router.get('/report', jwtAuth, exportController.streamReportExport);

export default router;
```

**What we're doing:**
- `jwtAuth` middleware validates user before streaming starts
- Route accepts `rowCount` query parameter  
- Controller handles the actual streaming logic

### Step 2: Validate Input and Set Response Headers
```javascript
export const streamReportExport = async (req, res, next) => {
  // Step 2a: Validate and log
  const startTime = Date.now();
  let rowCount = 0;
  let streamRequest = null;
  let streamError = false;  // Prevent double error handling
  
  // Validate row count parameter (1 to 1,048,576)
  const requestedRows = validateRowCount(req.query.rowCount || DEFAULT_ROW_COUNT);
  if (!requestedRows) {
    return res.status(400).json({ error: 'Invalid row count' });
  }
  
  console.log(`Starting export: ${requestedRows} rows requested`);
```

**What's happening:**
- Validate input before doing any work
- Set `streamError` flag to track if we've already reported an error
- Store references we'll need later (`streamRequest`)

### Step 3: Configure HTTP Response Headers

```javascript
  // Step 3: Configure browser download
  const filename = `report-${new Date().toISOString()}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
```

**Why this matters:**
- `Content-Type` tells browser it's an Excel file
- `Content-Disposition: attachment` triggers download dialog
- **Headers must be set before any data is written**

### Step 4: Create Streaming Excel Workbook

```javascript
  // Step 4: THIS IS THE KEY - Create workbook that writes to HTTP response (not memory)
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: res,              // ← Write directly to HTTP response
    useStyles: false,         // Skip styles (reduces overhead)
    useSharedStrings: false   // Disable shared strings  
  });
  
  const worksheet = workbook.addWorksheet('Report');
  worksheet.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Amount', key: 'amount', width: 15 },
    // Add your columns here
  ];
```

**Compare buffering vs. streaming:**

**If you were buffering (don't do this for large exports):**
```javascript
const workbook = new ExcelJS.Workbook();  // In-memory workbook
const buffer = await workbook.xlsx.writeBuffer();  // Entire file in memory!
res.send(buffer);  // Send complete buffer
```
Memory: Entire file buffered in RAM

**With streaming (what we're doing):**
```javascript
const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
// Bytes go directly to client as they're written
```
Memory: Only one row + small write buffer at a time

### Step 5: Enable Streaming from Your Database

```javascript
  // Step 5: Connect to database and enable streaming
  try {
    const pool = await getConnectionPool();  // Your connection pool
    streamRequest = pool.request();
    
    // CRITICAL: Enable streaming mode
    streamRequest.stream = true;  //  ← This enables 'row' events
    
    // Set parameters
    streamRequest.input('RowCount', mssql.Int, requestedRows);
    
    // Execute query (returns immediately, rows come via events)
    streamRequest.execute('spGenerateData');
  } catch (err) {
    // Handle connection errors
    res.status(500).json({ error: 'Database connection failed' });
    return;
  }
```

**What `stream: true` does:**

**Without it (traditional buffering):**
```javascript
const result = await request.query('SELECT * FROM large_table');
// Waits here until ALL rows returned
const rows = result.recordset;  // All rows in array
```

**With `stream: true` (streaming):**
```javascript
request.stream = true;
request.query('SELECT * FROM large_table');
// Returns immediately
request.on('row', row => { /* process one row */ });
// Rows arrive via events as they're fetched from database
```

### Step 6: Process Rows as They Arrive

```javascript
  // Step 6: Handle each row as it arrives from database
  streamRequest.on('row', (row) => {
    rowCount++;
    
    // Transform data from database format to Excel format
    const excelRow = {
      id: row.Id,
      name: row.Name,
      amount: row.Amount,
      // Map your columns here
    };
    
    // Write row to Excel stream immediately
    worksheet.addRow(excelRow).commit();
    
    // Optional: Log progress every 5,000 rows
    if (rowCount % 5000 === 0) {
      console.log(`Processed ${rowCount} rows...`);
    }
  });
  
  // Step 7: Manage backpressure - pause database if HTTP buffer gets full
  // This prevents memory from growing if client is slow
  const checkBackpressure = () => {
    // writableLength = bytes waiting to be sent to client
    // writableHighWaterMark = typical/recommended buffer size
    if (res.writableLength > res.writableHighWaterMark) {
      streamRequest.pause();  // Pause database query
      console.log('Backpressure: paused database query (HTTP buffer full)');
    }
  };
  
  // Check backpressure after each row
  streamRequest.on('row', checkBackpressure);
  
  // Resume when client catches up
  res.on('drain', () => {
    if (streamRequest && streamRequest.paused) {
      streamRequest.resume();
      console.log('Backpressure released: resumed database query');
    }
  });
```

**How row processing works:**

1. **Row arrives:** Database sends one row, MSSQL driver emits `'row'` event
2. **Transform:** Map from database column names to Excel format
3. **Write:** `worksheet.addRow().commit()` writes row to Excel stream
4. **Discard:** Row is garbage collected, memory freed
5. **Repeat:** Loop for next row

**Memory profile:**
- First row: +15-20 MB (workbook metadata overhead)
- Second row: +~5 KB (one row)
- Third row: +~5 KB (one row)
- ...
- 1,000,000th row: Still ~5 KB per row
- Total: ~50-80 MB constant (metadata + current row buffer)

**Backpressure: Why it matters**

Without backpressure, what happens when client is slow (3G network)?

```
Database: Sends 100 rows/second
HTTP: Can only send 10 rows/second to slow client
Result: 90 rows/second accumulate in memory!
```

With backpressure:
```
Database waits → Only 1-2 rows in memory → Adapt to client speed
```

**Step 7-9: Handle Completion and Errors

### Phase 6: Client Disconnect Handling

```javascript
  // Step 7: Finalize when all rows are processed
  streamRequest.on('done', async () => {
    try {
      console.log(`All rows received from database (${rowCount} rows), finalizing Excel...`);
      
      // CRITICAL: Excel file needs closing tags written
      await worksheet.commit();  // Flush any remaining worksheet data
      await workbook.commit();   // Write Excel footer/metadata
      
      // Log metrics
      const duration = Date.now() - startTime;
      console.log(`Export complete: ${rowCount} rows in ${duration}ms`);
      
      // Close HTTP response - browser receives complete file
      res.end();
    } catch (err) {
      if (streamError) return;  // Don't handle twice
      streamError = true;
      console.error('Error finalizing workbook:', err);
      if (res.headersSent) {
        // Headers already sent, can't send error response - close connection
        res.destroy(err);
      } else {
        // Haven't sent headers yet, send error
        res.status(500).json({ error: 'Failed to generate Excel file' });
      }
    }
  });
```

**Why `commit()` is important:**
- ExcelJS buffers data internally
- `worksheet.commit()` flushes buffered worksheet rows to the stream
- `workbook.commit()` writes the Excel file's closing XML tags
- Without these, the file is incomplete
- Must be `await`ed to ensure all data is written before closing

### Step 8: Handle Database Errors

```javascript
  // Step 8: Handle SQL errors (connection lost, timeout, etc.)
  streamRequest.on('error', (err) => {
    if (streamError) return;  // Already handling an error
    streamError = true;
    console.error('SQL stream error:', err);
    
    if (res.headersSent) {
      // Headers already sent - close the connection
      res.destroy(err);
    } else {
      // Haven't sent headers - send error response
      res.status(500).json({ error: 'Database error occurred' });
    }
    
    // Cancel any pending database query
    if (streamRequest) {
      streamRequest.cancel();
    }
  });
```

**When this fires:**
- Database connection lost mid-stream
- Query timeout (default: 30 seconds)
- SQL syntax or execution error
- Network interruption

The `streamError` flag prevents "trying to set headers twice" errors if multiple things fail simultaneously.

### Step 9: Handle Client Disconnect

```javascript
  // Step 9: User closes browser or connection drops
  req.on('close', () => {
    if (rowCount > 0 && !res.writableEnded) {
      console.log(`Client disconnected after ${rowCount} rows`);
      
      // Cancel database query to free resources
      // Otherwise, database keeps sending data that nobody's listening to
      if (streamRequest) {
        streamRequest.cancel();
      }
    }
  });
```

**Why this matters:**
- User closes browser tab mid-export
- Network interruption
- Browser timeout / refresh

Without this handler, database continues generating data that goes nowhere. Canceling the query frees database connections and prevents wasted server work.

## Supporting Components You'll Need

### 1. Column Mapper Utility

Define your column schema and transformation logic:

```javascript
// columnMapper.js
export const REPORT_COLUMNS = [
  { header: 'ID', key: 'id', width: 10 },
  { header: 'Name', key: 'name', width: 30 },
  { header: 'Amount', key: 'amount', width: 15, numFmt: '$#,##0.00' },
];

export function mapRowToExcel(dbRow) {
  return {
    id: dbRow.Id,
    name: dbRow.Name,
    amount: dbRow.Amount,
    // Convert types as needed (BigInt to string, Date formatting, etc.)
  };
}
```

### 2. Connection Pool Management

Set up a reusable connection pool with auto-recovery:

```javascript
// services/database.js
import mssql from 'mssql';

const dbConfig = {
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  authentication: {
    type: 'azure-active-directory-default', // or your auth type
  },
  pool: {
    min: 5,              // Keep warm connections ready
    max: 50,            // Max concurrent connections
    idleTimeoutMillis: 30000,
  },
  options: {
    requestTimeout: 30000,  // 30 second timeout per query
    enableKeepAlive: true,
  },
};

let pool = null;
let poolConnect = null;

export async function getConnectionPool() {
  if (!poolConnect) {
    poolConnect = (async () => {
      pool = new mssql.ConnectionPool(dbConfig);
      
      // Handle pool errors gracefully
      pool.on('error', async (err) => {
        console.error('Pool error:', err);
        if (err.code === 'ESOCKET' || err.code === 'ECONNRESET') {
          // Fatal error - reset pool
          pool = null;
          poolConnect = null;
        }
      });
      
      await pool.connect();
      return pool;
    })();
  }
  return poolConnect;
}

export async function closePool() {
  if (pool) {
    await pool.close();
    pool = null;
    poolConnect = null;
  }
}
```

### 3. Input Validation

Protect against bad input:

```javascript
export function validateRowCount(rowCount) {
  const count = parseInt(rowCount, 10);
  
  if (isNaN(count) || count < 1) {
    throw new Error('Row count must be at least 1');
  }
  
  if (count > 1048576) {  // Excel max rows
    throw new Error('Row count cannot exceed 1,048,576');
  }
  
  return count;
}
```

## Database Considerations

### MSSQL (SQL Server)

```javascript
request.stream = true;
request.execute('spStoredProcedure');
```
✅ Native streaming support
✅ Emits 'row' events

### PostgreSQL

```javascript
const query = client.query('SELECT * FROM large_table');
query.on('row', (row) => { /* ... */ });
```
✅ Native streaming  
✅ Use `pg-query-stream` for better backpressure

### MySQL

```javascript
const query = connection.query('SELECT * FROM large_table')
  .stream({ highWaterMark: 5 });
query.on('data', (row) => { /* ... */ });
```
✅ Streaming available  
✅ Use `.stream()` method

## Testing Your Implementation

Before deploying, test with increasing dataset sizes:

```bash
# Test with 1,000 rows
curl "http://localhost:3001/export/report?rowCount=1000" -o test-1k.xlsx

# Test with 10,000 rows  
curl "http://localhost:3001/export/report?rowCount=10000" -o test-10k.xlsx

# Test with 100,000 rows
curl "http://localhost:3001/export/report?rowCount=100000" -o test-100k.xlsx
ls -lh test-*.xlsx  # Check file sizes match
```

**Monitor memory during export:**
```bash
# In another terminal
while true; do ps aux | grep node | grep -v grep; sleep 1; done
```

Memory should stay relatively constant throughout export.

## When You Might Need a Proxy/BFF Layer

## Alternative Patterns: Why Not `pipeline()`?

### The Question

The [official node-mssql documentation](https://github.com/tediousjs/node-mssql?tab=readme-ov-file#streaming) shows two high-level patterns:

```javascript
// Pattern A: pipeline() with readable stream
const readableStream = request.toReadableStream({ highWaterMark: 100 });
pipeline(readableStream, transformStream, writableStream, callback);

// Pattern B: direct pipe
request.pipe(writableStream);
```

Both provide **automatic backpressure** and **built-in error propagation**. So why are we using the **event-driven pattern** with manual `pause()`/`resume()` instead?

### The Reality: ExcelJS Doesn't Fit `pipeline()`

**Problem:** ExcelJS's `WorkbookWriter` doesn't accept rows as input. It writes to an underlying stream **as a side effect**:

```javascript
// ExcelJS's API
const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
const worksheet = workbook.addWorksheet('Report');
worksheet.addRow(rowData).commit();  // ← writes to 'res' as side effect, not return value
```

This doesn't match the Transform stream model, where data flows through:
```javascript
readable.pipe(transform).pipe(writable);  // Data flows through transform
```

### What `pipeline()` Would Require

To use `pipeline()`, we'd need a custom Transform stream wrapper:

```javascript
class ExcelTransformStream extends Transform {
  constructor(worksheet) {
    super({ objectMode: true });
    this.worksheet = worksheet;
  }
  
  _transform(row, encoding, callback) {
    // Problem 1: worksheet.commit() returns a Promise, but Transform
    // streams expect synchronous callback() invocation
    this.worksheet.addRow(mapRowToExcel(row)).commit()
      .then(() => callback())
      .catch(callback);
  }
  
  _flush(callback) {
    // Problem 2: Workbook finalization still needs manual handling
    this.workbook.commit()
      .then(() => callback())
      .catch(callback);
  }
}

const excelStream = new ExcelTransformStream(worksheet);
pipeline(request.toReadableStream(), excelStream, res, (err) => {
  // handle errors
});
request.query('EXEC spGenerateData @RowCount');
```

**Trade-offs:**
- ✅ Automatic backpressure (nice!)
- ✅ Built-in error propagation
- ❌ 30+ lines of Transform stream boilerplate
- ❌ Complex async handling in `_transform()` (Promise → callback bridge)
- ❌ Workbook finalization logic split across class methods
- ❌ Less clear error handling (pipeline errors + workbook errors)
- ❌ **More complexity, not less**

### Our Choice: Event-Driven + Manual Backpressure

**Implementation:**
```javascript
request.on('row', (row) => {
  worksheet.addRow(mapRowToExcel(row)).commit();
  
  // Manual backpressure: pause when HTTP buffer is full
  if (res.writableLength > res.writableHighWaterMark) {
    request.pause();
    res.once('drain', () => request.resume());
  }
});

request.on('done', async () => {
  await worksheet.commit();
  await workbook.commit();
  res.end();
});
```

**Why this is better for our use case:**
- ✅ Works directly with ExcelJS's existing API (no wrapper)
- ✅ Clear, linear control flow
- ✅ 4 extra lines for backpressure vs. 30+ for Transform stream
- ✅ Explicit error handling at each step
- ✅ Uses same backpressure mechanism `pipeline()` uses internally

### Byte-Level vs. Row-Count Backpressure

The official docs also show row-count batching:

```javascript
// Official docs example
let rowsToProcess = [];
request.on('row', row => {
  rowsToProcess.push(row);
  if (rowsToProcess.length >= 15) {  // ← arbitrary threshold
    request.pause();
    processRows();
  }
});
```

**Our byte-level approach is better for HTTP streaming:**

| Aspect | Row-Count Batching | Byte-Level (Ours) |
|--------|-------------------|-------------------|
| **Trigger** | Fixed row count (why 15?) | Actual HTTP buffer fullness |
| **Metric** | Rows in memory | Bytes in `res` stream |
| **Network awareness** | No - pauses at fixed intervals | Yes - responds to client speed |
| **Memory** | Buffers N rows before processing | No buffering - checks each write |
| **Fast client** | Still pauses every 15 rows | Never pauses - exports at full speed |
| **Slow client (3G)** | Might still overflow buffer | Pauses frequently - memory bounded |

**Key insight:** Our approach adapts to actual network conditions using Node.js's built-in stream backpressure signals (`writableLength`/`writableHighWaterMark`/`drain`).

### When to Use Each Pattern

**Use `pipeline()` / `toReadableStream()` when:**
- ✅ Piping raw data (no transformation) or simple transforms
- ✅ Destination accepts data via standard Writable stream
- ✅ Transformation fits Transform stream model (data in → data out)
- ✅ Example: `SELECT * FROM users` → pipe to JSON HTTP response

**Use event-driven pattern when:**
- ✅ Library uses side-effect writes (like ExcelJS)
- ✅ Need row-by-row processing with async operations
- ✅ Precise control over cleanup order (database → transform → HTTP)
- ✅ Multiple event sources need coordination (DB + HTTP close + errors)
- ✅ Example: `SELECT * FROM orders` → transform via ExcelJS → stream to HTTP

**Rule of thumb:** If you're thinking "I need to create a custom Transform stream to use `pipeline()`" — the event-driven pattern is probably simpler.

---

## Summary

The streaming architecture achieves constant memory by:

1. **Never buffering data** - Each row flows through immediately
2. **Streaming at every layer** - Database → Excel → HTTP → Browser
3. **Event-driven processing** - React to data arrival, don't wait for completion
4. **Direct stream piping** - ExcelJS writes to HTTP response, no intermediate buffer
5. **Manual backpressure** - Pauses database when HTTP buffer fills, resumes when drained

**Result:** 1 million rows use the same memory as 10,000 rows (~80 MB), regardless of client network speed.

---

**Next:** [04-why-streaming-wins.md](04-why-streaming-wins.md) - Comparing streaming vs. buffering with real benchmarks
