# Code Quality Review — Streaming Excel Export

> **Date:** February 7, 2026  
> **Scope:** Full codebase review for bad programming practices  
> **Exclusion:** Buffered export endpoint intentionally loads all data into memory for demo/comparison — not a bug

---

## Review Categories

- **Deops** — V8 deoptimizations (hidden class changes, megamorphic call sites, polymorphic objects)
- **Releasing Zalgo** — Functions that inconsistently call callbacks sync vs async
- **Event Loop Blocking** — Synchronous operations in hot paths
- **Memory Leaks** — Unclosed streams, uncleaned listeners, growing caches
- **Error Handling** — Swallowed errors, floating promises, unhandled rejections
- **Stream Issues** — Missing error handlers, no backpressure, not destroying on error

---

## Summary Table

| # | Issue | Category | Severity | File |
|---|-------|----------|----------|------|
| 1 | Floating promise on `execute()` | Error Handling | **HIGH** | exportController.js |
| 2 | Response never closed on mid-stream SQL error | Stream / Leak | **HIGH** | exportController.js |
| 3 | Unhandled rejection in async `on('done')` | Error / Zalgo | **HIGH** | exportController.js |
| 4 | No backpressure in row handler | Stream / Leak | **HIGH** | exportController.js |
| 5 | Unhandled rejection in pool error handler | Error Handling | **MEDIUM** | mssql.js |
| 6 | Shutdown timer never cleared | Event Loop | **MEDIUM** | mssql.js |
| 7 | No error handler on `res` stream | Stream Issue | **MEDIUM** | exportController.js |
| 8 | `res.end()` instead of `res.destroy()` on proxy error | Stream Issue | **MEDIUM** | exportProxy.js |
| 9 | Event handlers attached after `listen()` | Error / Race | **LOW** | server.js (api) |
| 10 | Dead `setImmediate` before `process.exit` | Dead Code | **LOW** | server.js (api) |
| 11 | `process.memoryUsage()` in hot path | Event Loop | **LOW** | exportController.js |
| 12 | Polymorphic error objects (conditional spread) | Deopt | **LOW** | api.js / app.js |
| 13 | Inconsistent error class shapes | Deopt | **LOW** | errors.js (api) |
| 14 | `parseInt` without radix | Best Practice | **LOW** | stress-test*.js |
| 15 | `isPoolHealthy` dead code | Dead Code | **LOW** | mssql.js |
| 16 | `util._extend` deprecation in http-proxy | Third-party Dep | **LOW** | http-proxy@1.18.1 |

---

## HIGH Severity

### 1. Floating Promise — `streamRequest.execute()` not caught

**File:** [api/src/controllers/exportController.js](api/src/controllers/exportController.js) ~line 122  
**Category:** Error Handling / Floating Promise

```javascript
streamRequest.input("RowCount", mssql.Int, requestedRows);
streamRequest.execute('spGenerateData');
```

**Problem:** In mssql streaming mode, `.execute()` returns a Promise that is neither awaited nor `.catch()`ed. If the stored procedure doesn't exist or the connection drops before execution starts, the promise rejects and produces an **unhandled promise rejection** — Node.js terminates the process. The `on('error')` event fires separately and doesn't catch the rejected promise.

**Fix:**
```javascript
streamRequest.execute('spGenerateData').catch((err) => {
  debugAPI("Execute failed:", err);
  if (!res.headersSent) {
    const dbError = new DatabaseError('Database error occurred', err);
    res.status(dbError.status).json({
      error: { message: dbError.message, code: dbError.code }
    });
  } else {
    res.destroy(err);
  }
});
```

---

### 2. Response Stream Never Closed on SQL Error Mid-Stream

**File:** [api/src/controllers/exportController.js](api/src/controllers/exportController.js) ~line 141-155  
**Category:** Stream Issue / Memory Leak

```javascript
streamRequest.on('error', (err) => {
  debugAPI("SQL stream error:", err);
  if (!res.headersSent) {
    const dbError = new DatabaseError('Database error occurred', err);
    res.status(dbError.status).json({ /* ... */ });
  }
  // When headersSent === true: error logged, response LEFT OPEN
});
```

**Problem:** If streaming has already started (`headersSent` is true) and a SQL error occurs, the response stream is never closed. The client receives a partial/corrupt Excel file and hangs waiting for the transfer to complete. The Express connection remains open, consuming memory and a file descriptor.

**Fix:** Add `else` branch:
```javascript
} else {
  res.destroy(err); // Abort the in-flight transfer
}
```

---

### 3. Async Event Listener — Unhandled Rejection from `on('done')`

**File:** [api/src/controllers/exportController.js](api/src/controllers/exportController.js) ~line 159  
**Category:** Error Handling / Zalgo

```javascript
streamRequest.on('done', async () => {
  try {
    await worksheet.commit();
    await workbook.commit();
    res.end();
  } catch (err) {
    debugAPI("Error finalizing workbook:", err);
    if (!res.headersSent) {
      // ... send error response
    }
    // If headersSent is true: error silently swallowed, response left open
  }
});
```

**Problem:** Event emitters discard the returned Promise from `async` listeners. If the `catch` block itself throws (e.g., `res.status().json()` fails because the socket is destroyed), the rejection is **unhandled** and the process crashes. When `headersSent` is true, the error is silently swallowed and the response left dangling.

**Fix:**
```javascript
} catch (err) {
  debugAPI("Error finalizing workbook:", err);
  if (!res.headersSent) {
    res.status(500).json({
      error: { message: 'Failed to generate Excel file', code: 'EXPORT_ERROR' }
    });
  } else {
    res.destroy(err); // Force-close the partially-written response
  }
}
```

---

### 4. No Backpressure Handling in Row Event

**File:** [api/src/controllers/exportController.js](api/src/controllers/exportController.js) ~line 130  
**Category:** Stream Issue / Memory Leak

```javascript
streamRequest.on('row', (row) => {
  rowCount++;
  worksheet.addRow(mapRowToExcel(row)).commit();
});
```

**Problem:** `addRow().commit()` writes to the underlying `res` stream via ExcelJS. If the client reads slowly (slow network, mobile client), Node.js buffers data in the writable stream's internal buffer. The database keeps pushing rows at full speed since there's no backpressure signal. Under load, this can cause unbounded memory growth — effectively turning the "streaming" export into a buffered one.

**Fix:**
```javascript
streamRequest.on('row', (row) => {
  rowCount++;
  worksheet.addRow(mapRowToExcel(row)).commit();

  // Check for backpressure on the response stream
  if (res.writableLength > res.writableHighWaterMark) {
    streamRequest.pause();
    res.once('drain', () => streamRequest.resume());
  }
});
```

---

## MEDIUM Severity

### 5. Async Callback in Pool Error Handler — Unhandled Rejection

**File:** [api/src/services/mssql.js](api/src/services/mssql.js) ~line 62-68  
**Category:** Error Handling

```javascript
pool.on("error", async (err) => {
  if (err.code === "ESOCKET" || err.code === "ECONNRESET") {
    await closeAndResetPool(); // If this rejects → unhandled
  }
});
```

**Problem:** Event emitters ignore returned Promises. If `closeAndResetPool()` rejects, the rejection is **completely unhandled**. Node.js ≥15 terminates the process on unhandled rejections by default.

**Fix:**
```javascript
pool.on("error", (err) => {
  if (err.code === "ESOCKET" || err.code === "ECONNRESET") {
    closeAndResetPool().catch((resetErr) => {
      debugMSSQL("Failed to reset pool after error: %O", { message: resetErr.message });
    });
  }
});
```

---

### 6. Shutdown Timeout Timer Never Cleared

**File:** [api/src/services/mssql.js](api/src/services/mssql.js) ~line 254-268  
**Category:** Event Loop Blocking

```javascript
const closePromise = pool.close();
const timeoutPromise = new Promise((resolve) => {
  setTimeout(() => {
    debugMSSQL(`Warning: Shutdown taking longer than ${drainTimeout}ms`);
    resolve();
  }, drainTimeout);  // 30 seconds — never cleared
});
await Promise.race([closePromise, timeoutPromise]);
```

**Problem:** If `closePromise` wins the race (normal case), the `setTimeout` handle is never cleared. The 30-second timer keeps the event loop alive, delaying process exit by up to 30 seconds unnecessarily.

**Fix:**
```javascript
let drainTimer;
const timeoutPromise = new Promise((resolve) => {
  drainTimer = setTimeout(() => {
    debugMSSQL(`Warning: Shutdown taking longer than ${drainTimeout}ms`);
    resolve();
  }, drainTimeout);
});
await Promise.race([closePromise, timeoutPromise]);
clearTimeout(drainTimer);
```

---

### 7. No Error Handler on Response Stream

**File:** [api/src/controllers/exportController.js](api/src/controllers/exportController.js) ~line 97-100  
**Category:** Stream Issue

```javascript
const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
  stream: res,
  useStyles: false,
  useSharedStrings: false
});
```

**Problem:** The response stream (`res`) is used as ExcelJS's underlying writable stream. No `res.on('error', ...)` handler exists. If a write occurs after the client disconnects (between the `close` event and the next write), it throws `ERR_STREAM_WRITE_AFTER_END` or `ERR_STREAM_DESTROYED` — **crashing the process**.

**Fix:**
```javascript
res.on('error', (err) => {
  debugAPI("Response stream error:", err);
  if (streamRequest) {
    streamRequest.cancel();
  }
});
```

---

### 8. Proxy `res.end()` Instead of `res.destroy()` on Error

**File:** [app/src/middlewares/exportProxy.js](app/src/middlewares/exportProxy.js) ~line 50-55  
**Category:** Stream Issue

```javascript
error(err, req, res) {
  if (res.headersSent) {
    debugApplication('Headers already sent, destroying response');
    res.end();     // ← graceful FIN — client thinks truncated file is complete
    return;
  }
}
```

**Problem:** `res.end()` sends a normal FIN to the client, which may interpret the truncated file as a complete (but corrupt) download. `res.destroy()` sends RST, correctly signaling abnormal termination. The comment says "destroying" but the code does `.end()`.

**Fix:**
```javascript
if (res.headersSent) {
  debugApplication('Headers already sent, destroying response');
  res.destroy(err);
  return;
}
```

---

## LOW Severity

### 9. `onError` Handler Attached After `server.listen()` — Race Condition

**File:** [api/src/server.js](api/src/server.js) ~line 44-51  
**Category:** Error Handling / Race

```javascript
try {
  await initializeDatabase();
  server.listen(port);         // ← fires async
} catch (err) { ... }
server.on("error", onError);   // ← attached AFTER listen()
server.on("listening", onListening);
```

**Problem:** `server.listen()` is asynchronous. If the port bind fails extremely fast (before handlers are attached), the `error` event fires with no listener. Works in practice because `listen` always defers past the current tick — but fragile and ordering-dependent.

**Fix:** Attach handlers *before* `listen()`:
```javascript
server.on("error", onError);
server.on("listening", onListening);
server.listen(port);
```

---

### 10. Dead Code — `setImmediate` Before Synchronous `process.exit`

**File:** [api/src/server.js](api/src/server.js) ~line 21-22  
**Category:** Dead Code

```javascript
setImmediate(() => process.exit(1));  // ← never executes
process.exit(1);                       // ← runs immediately, kills process
```

**Problem:** `process.exit(1)` is synchronous — it terminates the process immediately. The `setImmediate` callback is the dead code, not the other way around. The comment ("Unreachable but satisfies type checker") has it backwards.

**Fix:** Pick one:
```javascript
// Option A: Exit immediately
process.exit(1);

// Option B: Allow async cleanup (remove the synchronous exit)
setImmediate(() => process.exit(1));
```

---

### 11. `process.memoryUsage()` in Hot Path — Event Loop Blocking

**File:** [api/src/controllers/exportController.js](api/src/controllers/exportController.js) ~line 135-138 via [shared/src/memory.js](shared/src/memory.js)  
**Category:** Event Loop Blocking

```javascript
if (rowCount % 5000 === 0) {
  memoryLogger(`Export - ${rowCount} rows`);
}
```

**Problem:** `memoryLogger` calls `process.memoryUsage()`, a **synchronous libuv call** (~0.1-0.5ms). At 100k rows, that's 20 blocking calls totaling ~2-10ms. Minor but unnecessary in a streaming hot path.

**Fix:** Increase interval to 25,000 rows, or use the cheaper `process.memoryUsage.rss()` (Node 15.6+).

---

### 12. Deopt — Polymorphic Error Response Objects

**File:** [api/src/api.js](api/src/api.js) ~line 50-57 and [app/src/app.js](app/src/app.js) ~line 73-80  
**Category:** Deopt

```javascript
const errorResponse = {
  error: {
    message: isDevelopment ? err.message : 'Internal server error',
    code: err.code || 'INTERNAL_ERROR',
    ...(isDevelopment && { stack: err.stack })  // ← two hidden classes
  }
};
```

**Problem:** Conditional spread produces objects with different shapes (with `stack` vs without). V8 marks the construction site as polymorphic. Since `isDevelopment` is constant per process, this is mildly wasteful — but only on error paths.

**Fix (monomorphic):**
```javascript
const errorResponse = {
  error: {
    message: isDevelopment ? err.message : 'Internal server error',
    code: err.code || 'INTERNAL_ERROR',
    stack: isDevelopment ? err.stack : undefined,
  }
};
```

---

### 13. Deopt — Inconsistent Error Class Shapes

**File:** [api/src/utils/errors.js](api/src/utils/errors.js) ~line 33-38  
**Category:** Deopt

```javascript
export class DatabaseError extends AppError {
  constructor(message, originalError = null) {
    super(message, 500, 'DATABASE_ERROR');
    this.name = 'DatabaseError';
    this.originalError = originalError; // ← only DatabaseError has this
  }
}
```

**Problem:** `DatabaseError` adds `originalError` that other `AppError` subclasses don't have. When the global error handler accesses `err.status` across different error types, V8 encounters megamorphic property lookups. Only on error paths — negligible impact.

**Fix:** Add `this.originalError = null` in `AppError` base class for consistent shape.

---

### 14. `parseInt` Without Radix in Stress Tests

**File:** stress-test.js and stress-test-buffered.js ~line 9  
**Category:** Best Practice

```javascript
parseInt(args[index + 1])  // missing radix
```

**Fix:** `parseInt(args[index + 1], 10)`

---

### 15. `isPoolHealthy` — Dead Code

**File:** [api/src/services/mssql.js](api/src/services/mssql.js) ~line 181-189  
**Category:** Dead Code

```javascript
export const isPoolHealthy = async () => {
  try {
    await initial_test();
    return true;
  } catch (err) {
    debugMSSQL("Pool health check failed: %O", { message: err.message });
    return false;
  }
};
```

**Problem:** Exported but never called anywhere in the codebase. Also uses `initial_test()` (a full query) when a lightweight `SELECT 1` would suffice for health checks.

---

### 16. `util._extend` Deprecation in http-proxy@1.18.1

**File:** Transitive dependency via [http-proxy-middleware@3.0.5](http-proxy-middleware@3.0.5)  
**Category:** Third-party Dependency

**Warning Output:**
```
[DEP0060] DeprecationWarning: The `util._extend` API is deprecated.
  at ProxyServer.<anonymous> (node_modules/http-proxy/lib/http-proxy/index.js:50:26)
```

**Root Cause:**  
`http-proxy@1.18.1` (last published 6 years ago, 21M weekly downloads) uses the deprecated `util._extend()` API on line 2 of `lib/http-proxy/index.js`:
```javascript
var extend = require('util')._extend;
// Line 50: Called on every proxy request
mergedOptions = extend({}, options);
```

**Problem:** `util._extend` is deprecated and will eventually be removed from Node.js (currently still functional on Node 22). The warning appears on every BFF proxy request. This is a third-party package issue beyond our control.

**Mitigation Options:**

| Option | Effort | Pros | Cons |
|--------|--------|------|------|
| **Suppress with `--no-deprecation`** | Trivial | Immediate fix | Hides all deprecation warnings |
| **Use `patch-package`** | Low | Fixes only this warning | Must re-apply after npm install |
| **Wait for http-proxy update** | None | Permanent solution | Upstream unmaintained; unlikely |
| **Replace with raw `node:http` proxy** | Medium | Eliminates dependency | Requires new implementation |

**Recommended:** **Patch-package** for short term (warning suppressed, no code changes needed). Consider investigating a custom `node:http` proxy for long-term architectural improvement (also discussed earlier as alternative to `http-proxy-middleware`).

---

## Recommended Fix Order

1. **Issues #1-4** (exportController.js) — Can crash the process, leak connections, or consume unbounded memory
2. **Issues #5-8** (mssql.js, exportProxy.js) — Unhandled rejections, delayed shutdown, stream corruption
3. **Issue #16** (http-proxy@1.18.1) — Apply patch-package to replace `util._extend` with `Object.assign`
4. **Issues #9-15** — Clean up dead code, minor deopt, best practices

---

*Last Updated: February 7, 2026*
