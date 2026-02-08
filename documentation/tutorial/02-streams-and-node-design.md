# Streams and Node.js Design: The Memory-Efficient Solution

## Introduction

In [01-the-memory-problem.md](01-the-memory-problem.md), we saw how traditional approaches cause memory to grow linearly with dataset size: $O(n)$. This tutorial explains how we can use Node.js streams to solve this problem by maintaining **constant memory usage** regardless of data volume: $O(1)$.

## What Are Streams?

A stream is a **sequence of data made available over time**. Instead of loading all data into memory at once, streams process data in small chunks as it becomes available.

### The Water Pipe Analogy

Think of data like water:

**Traditional Buffering (The Bucket Approach):**
```
Database → Fill giant bucket → Process bucket → Empty bucket → Send to client
```
- Bucket size = data size
- Need bigger buckets for more data
- Can only start processing once bucket is full

**Streaming (The Pipe Approach):**
```
Database → Pipe → Process → Pipe → Client
```
- Pipe size stays constant
- Water (data) flows continuously
- Processing happens simultaneously with data arrival

### The Key Insight

**Traditional:** "Give me all 100,000 rows, then I'll process them"

**Streaming:** "Give me rows one at a time. I'll process each immediately and pass it along"

Memory stays constant because you never hold more than **one chunk** at a time.

## Node.js Stream Types

Node.js provides four fundamental stream types:

### 1. Readable Streams
Sources that **produce** data you can read from.

**Examples:**
- Database query results (`mssql` with `stream: true`)
- File reads (`fs.createReadStream()`)
- HTTP request bodies (`req` in Express)
- Network sockets

```javascript
// MSSQL streaming query
const request = pool.request();
request.stream = true;  // Enable streaming mode
request.query('SELECT * FROM large_table');

// 'row' event fires for each row as it arrives
request.on('row', row => {
  console.log(row);  // Process one row at a time
});

request.on('end', () => {
  console.log('All rows received');
});
```

### 2. Writable Streams
Destinations you can **write** data to.

**Examples:**
- HTTP response bodies (`res` in Express)
- File writes (`fs.createWriteStream()`)
- ExcelJS WorkbookWriter (writes Excel file)

```javascript
// HTTP response is a writable stream
res.setHeader('Content-Type', 'application/json');
res.write('{"rows":[');  // Write chunk 1
res.write('{"id":1}');   // Write chunk 2
res.write(',{"id":2}');  // Write chunk 3
res.write(']}');         // Write chunk 4
res.end();               // Close stream
```

### 3. Duplex Streams
Both readable **and** writable (bidirectional).

**Examples:**
- Network sockets (TCP/WebSocket)
- Encryption/decryption streams

### 4. Transform Streams
A special duplex stream that **modifies** data as it passes through.

**Examples:**
- Compression (gzip)
- Encryption
- Data mapping/transformation

```javascript
// Transform stream example
const { Transform } = require('stream');

const uppercaseTransform = new Transform({
  transform(chunk, encoding, callback) {
    this.push(chunk.toString().toUpperCase());
    callback();
  }
});

inputStream
  .pipe(uppercaseTransform)
  .pipe(outputStream);
```

## Streams in Our Excel Export

Our streaming export uses **three** streams connected together in our architecture:

```
┌──────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   MSSQL      │      │  ExcelJS        │      │  HTTP Response  │
│   Readable   │  →   │  Writable       │  →   │  Writable       │
│   Stream     │      │  Stream         │      │  Stream         │
└──────────────┘      └─────────────────┘      └─────────────────┘
   request.on('row')   worksheet.addRow()      res (Express)
   
   Emits one row      Writes one row to       Sends bytes to
   at a time          Excel format            browser
```

### How They Connect

**1. MSSQL Readable Stream**

```javascript
const request = pool.request();
request.stream = true;  // Critical: enables streaming mode

// Without streaming: Returns ALL rows at once in result.recordset
// With streaming: Emits 'row' events one at a time

request.execute('spGenerateData');

request.on('row', row => {
  // This fires for EACH row as it arrives from SQL Server
  // Row is immediately available for processing
});

request.on('done', () => {
  // Fires when ALL rows have been emitted
});
```

**2. ExcelJS Writable Stream**

```javascript
const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
  stream: res,  // Critical: write directly to HTTP response
  useStyles: false,
  useSharedStrings: false
});

const worksheet = workbook.addWorksheet('Report');

// Write a row to the Excel stream
worksheet.addRow(rowData).commit();  // .commit() flushes to underlying stream
```

**3. HTTP Response Stream**

```javascript
// Express response object (res) is a writable stream
res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
res.setHeader('Content-Disposition', 'attachment; filename="report.xlsx"');

// ExcelJS writes Excel bytes to res
// res automatically sends bytes to browser as they arrive
// Browser receives and saves file progressively
```

## Memory Profile: Streaming vs. Buffering

### Buffered Approach (Traditional)

```javascript
// Load ALL rows into memory
const result = await pool.request().query('SELECT * FROM table');
const rows = result.recordset;  // Entire array in memory

// rows = [row1, row2, row3, ..., rowN]  ← All N rows in memory
```

**Memory Graph:**
```
Memory
  ^
  |                              ┌─── Peak (all data + workbook + buffer)
  |                          ┌───┘
  |                      ┌───┘
  |                  ┌───┘
  |              ┌───┘
  |          ┌───┘
  |      ┌───┘
  |  ┌───┘
  └──────────────────────────────────> Time
     Query  Load   Build   Buffer   Send
            Data   Excel   File
```

**Memory grows linearly with row count.**

### Streaming Approach

```javascript
request.on('row', row => {
  // Only ONE row in memory at a time
  worksheet.addRow(row).commit();
  // Row written to stream and released from memory
});
```

**Memory Graph:**
```
Memory
  ^
  |  ┌──────────────────────────────────┐ Constant memory
  |  │                                  │
  |  │                                  │
  |  │                                  │
  |  │                                  │
  |  └──────────────────────────────────┘
  └──────────────────────────────────────> Time
     Start streaming... (1M rows) ...Done
```

**Memory stays constant regardless of row count.**

## The Event-Driven Flow

Streaming relies on Node.js's event-driven architecture. Here's how data flows through our system:

### Event Sequence

```javascript
// 1. SQL Server starts executing query
request.execute('spGenerateData');

// 2. SQL Server sends row 1 → Node.js receives → 'row' event fires
request.on('row', row => {
  // 3. Transform row to Excel format
  const excelRow = mapRowToExcel(row);
  
  // 4. Write to worksheet → writes to HTTP response stream
  worksheet.addRow(excelRow).commit();
  
  // 5. HTTP response sends bytes to browser
  // (happens automatically via res stream)
});

// 6. SQL Server sends row 2 → Repeat steps 2-5
// 7. SQL Server sends row 3 → Repeat steps 2-5
// ...
// N. SQL Server sends row N → Repeat steps 2-5

// N+1. SQL Server finishes → 'done' event fires
request.on('done', async () => {
  // Finalize Excel file
  await worksheet.commit();
  await workbook.commit();
  
  // Close HTTP response
  res.end();
});
```

### Key Properties

**Non-Blocking:**
- While row 1 is being written to Excel, SQL Server can send row 2
- While Excel writes row 5, the browser can receive bytes from row 3
- All stages run **simultaneously**

**Constant Memory:**
- Row 1 processed → written → garbage collected
- Row 2 processed → written → garbage collected
- At any moment, only **~1-10 rows** exist in memory (buffered between stages)

**Backpressure (Natural):**
- If browser receives slowly, HTTP stream fills up
- If HTTP stream fills up, ExcelJS pauses
- If ExcelJS pauses, MSSQL pauses sending rows
- System automatically slows to match slowest component

## Why ExcelJS WorkbookWriter?

ExcelJS provides two ways to create Excel files:

### Workbook (Buffered)
```javascript
const workbook = new ExcelJS.Workbook();  // Entire file in memory
const worksheet = workbook.addWorksheet('Sheet');

rows.forEach(row => {
  worksheet.addRow(row);  // Adds to in-memory structure
});

const buffer = await workbook.xlsx.writeBuffer();  // Generates complete file
res.send(buffer);
```

**Memory:** Entire workbook + all rows + generated buffer = 3-5x data size

### WorkbookWriter (Streaming)
```javascript
const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
  stream: res  // Write directly to destination
});
const worksheet = workbook.addWorksheet('Sheet');

request.on('row', row => {
  worksheet.addRow(row).commit();  // Writes IMMEDIATELY to stream
});

await worksheet.commit();  // Flush remaining data
await workbook.commit();   // Finalize Excel structure
res.end();
```

**Memory:** Only current row + small write buffer (constant)

## HTTP Response Streaming

### Why It Works

The Express `res` object is a Node.js HTTP `ServerResponse`, which is a **writable stream**. When ExcelJS writes to `res`, bytes are:

1. **Chunked:** Sent in small HTTP chunks (not all at once)
2. **Transfer-Encoding:** Browser receives `Transfer-Encoding: chunked` header
3. **Progressive:** Browser receives and saves file progressively
4. **No buffering:** Server doesn't wait for complete file before sending

### What The Browser Sees

```http
HTTP/1.1 200 OK
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="report-2026-02-07-143022.xlsx"
Transfer-Encoding: chunked

504   ← Chunk size in hex (1284 bytes)
[1284 bytes of Excel data]
7FF   ← Next chunk size (2047 bytes)
[2047 bytes of Excel data]
...
0     ← Final chunk (0 bytes = end)
```

Browser sees chunks arriving and writes them to disk immediately. File appears in Downloads while still being generated.

### Authentication & Streaming

A common concern: "Doesn't JWT authentication add overhead to streaming?"

**Answer:** No. Here's why:

1. **Authentication happens first** - JWT is validated before streaming begins
2. **It's a simple check** - Verify token signature and expiration (milliseconds)
3. **Then streaming begins** - If auth passes, data flows immediately
4. **Memory unaffected** - Authentication doesn't add any memory overhead

**The sequence:**
```
1. Request arrives with JWT in Authorization header (50KB)
2. Check JWT signature and expiration (< 1ms)
3. If valid: Streaming begins (constant memory from here on)
4. If invalid: 401 response sent immediately (no resources consumed)
```

**Result:** Authentication is an extremely cheap gate-keeper that protects our streaming infrastructure.

## Real-World Memory Measurements

From our actual stress tests and documentation:

### Streaming Export ([api/src/controllers/exportController.js](../../api/src/controllers/exportController.js))

| Row Count | Peak Memory | Time    |
|-----------|-------------|---------|
| 10,000    | 52 MB       | 12s     |
| 100,000   | 68 MB       | 115s    |
| 1,000,000 | 79 MB       | 18min   |

**Memory increase from 10k → 1M rows: Only 27 MB (constant!)**

### Buffered Export (Comparison)

| Row Count | Peak Memory | Time    | Status |
|-----------|-------------|---------|--------|
| 10,000    | 48 MB       | 8s      | ✅ OK  |
| 100,000   | 487 MB      | 65s     | ⚠️ High |
| 500,000   | 2.4 GB      | 340s    | ❌ OOM Risk |
| 1,000,000 | ~5 GB       | N/A     | ❌ Crash |

**Memory increase from 10k → 100k: 10x growth (linear)**

## Key Principles

### 1. Never `await` for all data

**Bad:**
```javascript
const rows = await db.query('SELECT * FROM table');  // Loads all rows
```

**Good:**
```javascript
request.stream = true;
request.query('SELECT * FROM table');  // Emits 'row' events
request.on('row', row => { /* process */ });
```

### 2. Write immediately, don't accumulate

**Bad:**
```javascript
const results = [];
request.on('row', row => {
  results.push(row);  // Accumulates in memory
});
request.on('done', () => {
  results.forEach(row => worksheet.addRow(row));  // Too late, all in memory
});
```

**Good:**
```javascript
request.on('row', row => {
  worksheet.addRow(row).commit();  // Write immediately
});
```

### 3. Use streaming-capable libraries

Not all libraries support streaming:

| Library | Streaming Support |
|---------|-------------------|
| `mssql` | ✅ Yes (with `stream: true`) |
| `pg` (PostgreSQL) | ✅ Yes (with `QueryStream`) |
| `mysql2` | ✅ Yes (with `connection.query().stream()`) |
| `exceljs` | ✅ Yes (`WorkbookWriter`) |
| `csv-writer` | ✅ Yes |
| `json` (built-in) | ❌ No (must buffer) |

## Summary

**Traditional Approach:**
- Memory = $O(n)$ where $n$ is data size
- Must load entire dataset before processing
- Server memory limits determine maximum export size

**Streaming Approach:**
- Memory = $O(1)$ (constant)
- Process data as it arrives
- No theoretical limit on export size

**The Secret:** Data flows through the system like water through pipes. It never accumulates.

---

**Next:** [03-architecture-dissected.md](03-architecture-dissected.md) - Step-by-step walkthrough of our streaming implementation
