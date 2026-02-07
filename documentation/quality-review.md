# Code Quality Review — Streaming Excel Export

> **Date:** February 7, 2026  
> **Scope:** Full codebase review for bad programming practices  
> **Last Updated:** February 7, 2026 (Sprint 1 Complete)  
> **Exclusion:** Buffered export endpoint intentionally loads all data into memory for demo/comparison — not a bug

---

## Sprint 1 Summary

**Status:** ✅ Complete  
**Issues Fixed:** #1, #2, #3 (HIGH severity streaming error handling)  
**Version Update:** `0.0.1` → `0.1.0` (critical stability fixes)  
**Changes:** 4 interconnected fixes in [exportController.js](../../api/src/controllers/exportController.js) for error handling, response cleanup, and stream management  
**Test Coverage:** 10 unit tests + 3 smoke tests + 6 integration tests ✅ PASSING  
**Lint Status:** 0 errors ✅

**Remaining Issues:** 13 (5 MEDIUM, 8 LOW) — scheduled for future sprints

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

| # | Issue | Category | Severity | Status | File |
|---|-------|----------|----------|--------|------|
| 1 | Floating promise on `execute()` | Error Handling | **HIGH** | ✅ FIXED | exportController.js |
| 2 | Response never closed on mid-stream SQL error | Stream / Leak | **HIGH** | ✅ FIXED | exportController.js |
| 3 | Unhandled rejection in async `on('done')` | Error / Zalgo | **HIGH** | ✅ FIXED | exportController.js |
| 4 | No backpressure in row handler | Stream / Leak | **HIGH** | ⏳ PLANNED | exportController.js |
| 5 | Unhandled rejection in pool error handler | Error Handling | MEDIUM | ⏳ PLANNED | mssql.js |
| 6 | Shutdown timer never cleared | Event Loop | MEDIUM | ⏳ PLANNED | mssql.js |
| 7 | No error handler on `res` stream | Stream Issue | MEDIUM | ⏳ PLANNED | exportController.js |
| 8 | `res.end()` instead of `res.destroy()` on proxy error | Stream Issue | MEDIUM | ⏳ PLANNED | exportProxy.js |
| 9 | Event handlers attached after `listen()` | Error / Race | LOW | ⏳ PLANNED | server.js (api) |
| 10 | Dead `setImmediate` before `process.exit` | Dead Code | LOW | ⏳ PLANNED | server.js (api) |
| 11 | `process.memoryUsage()` in hot path | Event Loop | LOW | ⏳ PLANNED | exportController.js |
| 12 | Polymorphic error objects (conditional spread) | Deopt | LOW | ⏳ PLANNED | api.js / app.js |
| 13 | Inconsistent error class shapes | Deopt | LOW | ⏳ PLANNED | errors.js (api) |
| 14 | `parseInt` without radix | Best Practice | LOW | ⏳ PLANNED | stress-test*.js |
| 15 | `isPoolHealthy` dead code | Dead Code | LOW | ⏳ PLANNED | mssql.js |
| 16 | `util._extend` deprecation in http-proxy | Third-party Dep | LOW | ⏳ PLANNED | http-proxy@1.18.1 |

---

## ✅ FIXED ISSUES (Sprint 1)

### 1. Floating Promise — `streamRequest.execute()` not caught

**File:** [api/src/controllers/exportController.js](../../api/src/controllers/exportController.js#L128-L146)  
**Category:** Error Handling / Floating Promise  
**Status:** ✅ FIXED (Sprint 1)

**Problem:** In mssql streaming mode, `.execute()` returns a Promise that is neither awaited nor `.catch()`ed. If the stored procedure doesn't exist or the connection drops before execution starts, the promise rejects and produces an **unhandled promise rejection** — Node.js terminates the process.

**Solution Applied:**
```javascript
streamRequest.execute('spGenerateData').catch((err) => {
  if (streamError) return;  // Guard flag prevents double-handling
  streamError = true;
  
  debugAPI("Execute failed:", err);
  if (!res.headersSent) {
    const dbError = new DatabaseError('Database error occurred', err);
    try {
      res.status(dbError.status).json({
        error: { message: dbError.message, code: dbError.code }
      });
    } catch (jsonErr) {
      debugAPI("Failed to send error response:", jsonErr);
    }
  } else {
    res.destroy(err);
  }
  
  if (streamRequest) {
    streamRequest.cancel();
  }
});
```

**Impact:** Process no longer crashes from unhandled promise rejection before streaming starts.

---

### 2. Response Stream Never Closed on SQL Error Mid-Stream

**File:** [api/src/controllers/exportController.js](../../api/src/controllers/exportController.js#L166-L187)  
**Category:** Stream Issue / Memory Leak  
**Status:** ✅ FIXED (Sprint 1)

**Problem:** If streaming has already started (`headersSent` is true) and a SQL error occurs, the response stream is never closed, leaving the connection open and consuming memory.

**Solution Applied:**
```javascript
streamRequest.on('error', (err) => {
  if (streamError) return;  // Guard flag prevents double-handling
  streamError = true;
  
  debugAPI("SQL stream error:", err);
  if (!res.headersSent) {
    const dbError = new DatabaseError('Database error occurred', err);
    try {
      res.status(dbError.status).json({
        error: { message: dbError.message, code: dbError.code }
      });
    } catch (jsonErr) {
      debugAPI("Failed to send error response:", jsonErr);
    }
  } else {
    res.destroy(err);  // ← FIX: Close stream if already streaming
  }
  
  if (streamRequest) {
    streamRequest.cancel();
  }
});
```

**Impact:** Mid-stream SQL errors now properly close the response, preventing connection leaks and client hangs.

---

### 3. Async Event Listener — Unhandled Rejection from `on('done')`

**File:** [api/src/controllers/exportController.js](../../api/src/controllers/exportController.js#L213-L231)  
**Category:** Error Handling / Zalgo  
**Status:** ✅ FIXED (Sprint 1)

**Problem:** Event emitters discard the returned Promise from `async` listeners. When `headersSent` is true, errors are silently swallowed and the response left dangling, or rejections are unhandled.

**Solution Applied:**
```javascript
} catch (err) {
  if (streamError) return;  // Guard flag prevents double-handling
  streamError = true;
  
  debugAPI("Error finalizing workbook:", err);
  if (!res.headersSent) {
    const exportError = new ExportError('Failed to generate Excel file');
    try {
      res.status(exportError.status).json({
        error: { message: exportError.message, code: exportError.code }
      });
    } catch (jsonErr) {
      debugAPI("Failed to send error response:", jsonErr);
    }
  } else {
    res.destroy(err);  // ← FIX: Force-close partially-written stream
  }
}
```

**Impact:** Workbook finalization errors properly handled; process no longer crashes from unhandled rejections.

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

1. ✅ **Issues #1-3** (exportController.js) — COMPLETE (Sprint 1)
2. ⏳ **Issues #4-8** (exportController.js, mssql.js, exportProxy.js) — PLANNED (Sprint 2)
3. ⏳ **Issue #16** (http-proxy@1.18.1) — PLANNED (patch-package)
4. ⏳ **Issues #9-15** — PLANNED (cleanup, deopt, best practices)

---

*Last Updated: February 7, 2026 (Sprint 1 Complete)*
