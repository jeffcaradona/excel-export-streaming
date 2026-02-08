# Code Quality Review — Streaming Excel Export

> **Date:** February 7, 2026  
> **Scope:** Full codebase review for bad programming practices  
> **Last Updated:** February 7, 2026 (Sprint 2 Review)  
> **Exclusion:** Buffered export endpoint intentionally loads all data into memory for demo/comparison — not a bug

---

## Sprint 2 Summary

**Status:** ✅ Review Complete  
**New Features Added:** JWT inter-service authentication, BFF proxy layer, Zod environment validation, Helmet security headers, CORS, comprehensive test infrastructure  
**Version Update:** `0.1.0` → `0.2.0` (authentication + BFF)  
**New Issues Found:** #17, #18, #19  
**Test Coverage:** 44 tests ✅ PASSING (unit + smoke + integration + JWT auth)  
**Lint Status:** 0 errors ✅

**Remaining Issues:** 16 (1 HIGH, 5 MEDIUM, 10 LOW) — scheduled for future sprints

---

## Sprint 1 Summary

**Status:** ✅ Complete  
**Issues Fixed:** #1, #2, #3 (HIGH severity streaming error handling)  
**Version Update:** `0.0.1` → `0.1.0` (critical stability fixes)  
**Changes:** 4 interconnected fixes in [exportController.js](../../api/src/controllers/exportController.js) for error handling, response cleanup, and stream management  
**Test Coverage:** 10 unit tests + 3 smoke tests + 6 integration tests ✅ PASSING  
**Lint Status:** 0 errors ✅

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
| 9 | Event handlers attached after `listen()` | Error / Race | MEDIUM | ⏳ PLANNED | server.js (api + app) |
| 10 | Dead `setImmediate` before `process.exit` | Dead Code | LOW | ⏳ PLANNED | server.js (api) |
| 11 | `process.memoryUsage()` in hot path | Event Loop | LOW | ⏳ PLANNED | exportController.js |
| 12 | Polymorphic error objects (conditional spread) | Deopt | LOW | ⏳ PLANNED | api.js / app.js |
| 13 | Inconsistent error class shapes | Deopt | LOW | ⏳ PLANNED | errors.js (api) |
| 14 | `Number.parseInt` without radix | Best Practice | LOW | ⏳ PLANNED | stress-test*.js |
| 15 | `isPoolHealthy` dead code | Dead Code | LOW | ⏳ PLANNED | mssql.js |
| 16 | `util._extend` deprecation in http-proxy | Third-party Dep | LOW | ⏳ PLANNED | http-proxy@1.18.1 |
| 17 | Stress tests bypass JWT authentication | Test Gap | MEDIUM | ⏳ PLANNED | stress-test*.js |
| 18 | `DatabaseMock.wrapAsDbError()` wrong constructor args | Test Quality | LOW | ⏳ PLANNED | database.mock.js |
| 19 | Debug message typo `"failre"` | Best Practice | LOW | ⏳ PLANNED | mssql.js |

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

**File:** [api/src/server.js](api/src/server.js) ~line 44-51 and [app/src/server.js](app/src/server.js) ~line 36-38  
**Category:** Error Handling / Race  
**Severity:** MEDIUM (upgraded — now applies to both servers)

**API server.js:**
```javascript
try {
  await initializeDatabase();
  server.listen(port);         // ← fires async
} catch (err) { ... }
server.on("error", onError);   // ← attached AFTER listen()
server.on("listening", onListening);
```

**BFF server.js:**
```javascript
server.listen(port);
server.on('error', onError);       // ← attached AFTER listen()
server.on('listening', onListening);
```

**Problem:** `server.listen()` is asynchronous. If the port bind fails extremely fast (before handlers are attached), the `error` event fires with no listener. Works in practice because `listen` always defers past the current tick — but fragile and ordering-dependent. Now affects **both** the API and BFF servers.

**Fix:** Attach handlers *before* `listen()` in both files:
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

### 14. `Number.parseInt` Without Radix in Stress Tests

**File:** stress-test.js and stress-test-buffered.js ~line 10  
**Category:** Best Practice

```javascript
Number.parseInt(args[index + 1])  // missing radix
```

**Fix:** `Number.parseInt(args[index + 1], 10)`

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

## NEW ISSUES (Sprint 2 Review)

### 17. Stress Tests Bypass JWT Authentication — Test Gap

**File:** [stress-test.js](../../stress-test.js) ~line 28 and [stress-test-buffered.js](../../stress-test-buffered.js) ~line 29  
**Category:** Test Gap  
**Severity:** MEDIUM

```javascript
const result = await autocannon({
  url: `http://localhost:3001/export/report?rowCount=${rowCount}`,
  connections,
  // ...
});
```

**Problem:** JWT authentication was added to all API export routes in Sprint 2 (`router.use(jwtAuthMiddleware(...))`). The stress tests hit port 3001 (API directly) without including a JWT `Authorization` header. Every request now receives a `401 Unauthorized` response, meaning the stress tests **no longer test actual export functionality** — they only stress-test the JWT rejection path.

**Fix:**
```javascript
import { generateToken } from './shared/src/auth/jwt.js';

const token = generateToken(process.env.JWT_SECRET);

const result = await autocannon({
  url: `http://localhost:3001/export/report?rowCount=${rowCount}`,
  connections,
  headers: {
    Authorization: `Bearer ${token}`
  },
  // ...
});
```

**Alternative:** Route stress tests through the BFF (port 3000) which handles JWT injection automatically. This is more realistic but adds proxy overhead to measurements.

---

### 18. `DatabaseMock.wrapAsDbError()` — Incorrect Constructor Arguments

**File:** [api/tests/mocks/database.mock.js](../../api/tests/mocks/database.mock.js) ~line 73-78  
**Category:** Test Quality  
**Severity:** LOW

```javascript
static wrapAsDbError(originalError) {
  return new DatabaseError(
    originalError.message || 'Database error',
    originalError.code || 'DB_ERROR'   // ← string, not Error object
  );
}
```

**Problem:** `DatabaseError` constructor signature is `constructor(message, originalError = null)` — the second parameter expects an Error object. The mock passes `originalError.code || 'DB_ERROR'` (a string), so `this.originalError` becomes the string `'DB_ERROR'` instead of the actual error. This could mask bugs in tests that rely on `originalError` being an Error instance. Additionally, `wrapAsDbError()` is not called by any current tests — it is dead test code.

**Fix:**
```javascript
static wrapAsDbError(originalError) {
  return new DatabaseError(
    originalError.message || 'Database error',
    originalError  // Pass the Error object, not a string
  );
}
```
Or remove the method if unused.

---

### 19. Debug Message Typo in `testBadRecord`

**File:** [api/src/services/mssql.js](../../api/src/services/mssql.js) ~line 222  
**Category:** Best Practice  
**Severity:** LOW

```javascript
debugMSSQL("Initial database failre test passed: %O", {
```

**Problem:** Typo: `"failre"` should be `"failure"`. Minor cosmetic issue in debug output.

**Fix:**
```javascript
debugMSSQL("Initial database failure test passed: %O", {
```

---

## Sprint 2 — New Code Review Notes

### ✅ Clean Code (No Issues Found)

The following new modules were reviewed and found to have no issues:

| Module | Notes |
|--------|-------|
| [shared/src/auth/jwt.js](../../shared/src/auth/jwt.js) | Clean JWT generation/verification. HMAC-SHA256, proper claims (iss, aud, iat, exp). Synchronous `verifyToken` — no Zalgo risk. |
| [shared/src/middlewares/jwtAuth.js](../../shared/src/middlewares/jwtAuth.js) | Clean middleware factory. Handles all JWT error types (expired, invalid, malformed). Responds directly — intentionally bypasses global error handler for security. |
| [shared/tests/auth/jwt.test.js](../../shared/tests/auth/jwt.test.js) | 11 tests covering generation, verification, expiry, wrong issuer/audience, malformed tokens, roundtrip. Thorough. |
| [shared/tests/middlewares/jwtAuth.test.js](../../shared/tests/middlewares/jwtAuth.test.js) | 10 tests covering valid tokens, missing/invalid headers, expired tokens, case sensitivity, multiple requests. Thorough. |
| [api/src/config/env.js](../../api/src/config/env.js) | Zod schema validation with lazy-cached getter. JWT_SECRET minimum 32 chars enforced. |
| [app/src/config/env.js](../../app/src/config/env.js) | Mirrors API pattern. Includes JWT_EXPIRES_IN default. Clean. |
| [api/src/config/export.js](../../api/src/config/export.js) | `Number.parseInt(value, 10)` — correct radix. Clean clamping logic. |
| [api/src/utils/filename.js](../../api/src/utils/filename.js) | Input sanitization prevents path traversal/injection. Length limits applied. |
| [api/src/utils/columnMapper.js](../../api/src/utils/columnMapper.js) | Simple static mapping. No issues. |
| [app/src/utils/errors.js](../../app/src/utils/errors.js) | Consistent error shapes (AppError, ConfigurationError, ProxyError). All via `super()`. |
| [shared/src/server.js](../../shared/src/server.js) | `normalizePort` uses `Number.parseInt(val, 10)` — correct radix. |
| [shared/src/debug.js](../../shared/src/debug.js) | Module-scoped debug instances. JSON import with import attributes (Node 22+). Clean. |
| [shared/src/memory.js](../../shared/src/memory.js) | Peak-tracking memory logger. Functional closure pattern. No leaks (tracks max values only). |
| [app/src/middlewares/exportProxy.js](../../app/src/middlewares/exportProxy.js) | JWT injection on `proxyReq` event. Module-scoped memoryLogger tracks process-lifetime peaks (intentional). |
| [app/src/app.js](../../app/src/app.js) | Helmet, CORS, proper middleware ordering. Has existing issue #12 (polymorphic error). |
| [api/src/routes/export.js](../../api/src/routes/export.js) | JWT middleware applied to all export routes via `router.use()`. Clean. |
| [app/src/routes/exports.js](../../app/src/routes/exports.js) | Thin route → middleware delegation. Clean. |
| [api/tests/mocks/response.mock.js](../../api/tests/mocks/response.mock.js) | Comprehensive Express response stub. Clean. |
| [api/tests/mocks/streamRequest.mock.js](../../api/tests/mocks/streamRequest.mock.js) | EventEmitter-based request mock with static helpers. Clean. |

---

## Recommended Fix Order

1. ✅ **Issues #1-3** (exportController.js) — COMPLETE (Sprint 1)
2. ⏳ **Issues #4, #7** (exportController.js) — Backpressure + response error handler (streaming stability)
3. ⏳ **Issues #5, #6** (mssql.js) — Pool error handling + shutdown timer
4. ⏳ **Issues #8, #9** (exportProxy.js, server.js) — Stream destroy + listen() race condition
5. ⏳ **Issue #17** (stress-test*.js) — Add JWT headers to stress tests (functional gap)
6. ⏳ **Issue #16** (http-proxy@1.18.1) — patch-package
7. ⏳ **Issues #10-15, #18, #19** — Cleanup, deopt, dead code, typos

---

*Last Updated: February 7, 2026 (Sprint 2 Review)*
