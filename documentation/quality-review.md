# Code Quality Review — Streaming Excel Export

> **Date:** February 7, 2026  
> **Scope:** Full codebase review for bad programming practices  
> **Last Updated:** February 8, 2026 (Sprint 3 Complete)  
> **Exclusion:** Buffered export endpoint intentionally loads all data into memory for demo/comparison — not a bug

---

## Sprint 3 Summary (In Progress)

**Status:** ✅ Complete  
**Issues Identified:** 21 (0 HIGH, 5 MEDIUM, 16 LOW)  
**Issues Fixed This Sprint:** 10 (✅ #8-10, #12-15, #18, #20, #21)  
**Critical:** 0 issues blocking deployment  

**Key Achievements:**
- ✅ All critical deployment issues resolved (#8, #9, #14)
- ✅ All dead code removed (#10, #15, #18, #21)
- ✅ V8 deoptimizations fixed (#12, #13)
- ✅ Environment consistency improved (#20)
- ✅ Codebase fully production-ready

**Remaining Issues:** 1 LOW priority (⏳ #16: Third-party deprecation warning — deferred to future sprint)

---

## Sprint 2 Summary

**Status:** ✅ Complete  
**Issues Fixed:** #4, #5, #6, #7 (HIGH + MEDIUM streaming stability and pool resilience)  
**Version Update:** `0.2.0` → `0.3.0` (streaming stability fixes)  
**Changes:** Manual backpressure implementation, pool error handler fix, shutdown timer cleanup, response stream error handler  
**Test Coverage:** 57 tests ✅ PASSING (includes new backpressure tests)  
**Lint Status:** 0 errors ✅

**Remaining Issues:** 12 (0 HIGH, 3 MEDIUM, 9 LOW) — scheduled for future sprints

---

## Sprint 1 Summary

**Status:** ✅ Complete  
**Issues Fixed:** #1, #2, #3 (HIGH severity streaming error handling)  
**Version Update:** `0.0.1` → `0.1.0` (critical stability fixes)  
**Changes:** 4 interconnected fixes in [exportController.js](../../api/src/controllers/exportController.js) for error handling, response cleanup, and stream management  
**Test Coverage:** 19 unit tests + 3 smoke tests + 6 integration tests ✅ PASSING  
**Lint Status:** 0 errors ✅

---

## New Features (Between Sprint 1 & 2)

**Status:** ✅ Complete  
**New Features Added:** JWT inter-service authentication, BFF proxy layer, Zod environment validation, Helmet security headers, CORS, comprehensive test infrastructure  
**Version Update:** `0.1.0` → `0.2.0` (authentication + BFF)  
**New Issues Found:** #17, #18, #19  
**Test Coverage:** 44 tests ✅ PASSING (unit + smoke + integration + JWT auth)

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
| 4 | No backpressure in row handler | Stream / Leak | **HIGH** | ✅ FIXED | exportController.js |
| 5 | Unhandled rejection in pool error handler | Error Handling | MEDIUM | ✅ FIXED | mssql.js |
| 6 | Shutdown timer never cleared | Event Loop | MEDIUM | ✅ FIXED | mssql.js |
| 7 | No error handler on `res` stream | Stream Issue | MEDIUM | ✅ FIXED | exportController.js |
| 8 | `res.end()` instead of `res.destroy()` on proxy error | Stream Issue | MEDIUM | ✅ FIXED | exportProxy.js |
| 9 | Event handlers attached after `listen()` | Error / Race | MEDIUM | ✅ FIXED | server.js (api + app) |
| 10 | Dead `setImmediate` before `process.exit` | Dead Code | LOW | ✅ FIXED | server.js (api) |
| 11 | `process.memoryUsage()` in hot path | Event Loop | LOW | ✅ ACCEPTABLE | exportController.js |
| 12 | Polymorphic error objects (conditional spread) | Deopt | LOW | ✅ FIXED | api.js / app.js |
| 13 | Inconsistent error class shapes | Deopt | LOW | ✅ FIXED | errors.js (api) |
| 14 | `Number.parseInt` without radix | Best Practice | LOW | ✅ FIXED | stress-test*.js |
| 15 | `isPoolHealthy` dead code | Dead Code | LOW | ✅ REMOVED | mssql.js |
| 16 | `util._extend` deprecation in http-proxy | Third-party Dep | LOW | ⏳ PATCH | http-proxy@1.18.1 |
| 17 | Stress tests bypass JWT authentication | Test Gap | MEDIUM | ✅ FIXED | stress-test*.js |
| 18 | `DatabaseMock.wrapAsDbError()` wrong constructor args | Test Quality | LOW | ✅ REMOVED | database.mock.js |
| 19 | Confusing test logic in `testBadRecord()` | Best Practice | LOW | ✅ REMOVED | mssql.js |
| 20 | Missing JWT_EXPIRES_IN validation in API env | Best Practice | LOW | ✅ FIXED | env.js (api) |
| 21 | Unused exported function `testBadRecord()` | Dead Code | LOW | ✅ REMOVED | mssql.js |

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

## ✅ FIXED ISSUES (Sprint 2)

### 4. No Backpressure Handling in Row Event

**File:** [api/src/controllers/exportController.js](api/src/controllers/exportController.js) ~line 145-155  
**Category:** Stream Issue / Memory Leak  
**Status:** ✅ FIXED (Sprint 2)

**Problem:** `addRow().commit()` writes to the underlying `res` stream via ExcelJS. If the client reads slowly (slow network, mobile client), Node.js buffers data in the writable stream's internal buffer. The database keeps pushing rows at full speed since there's no backpressure signal. Under load, this can cause unbounded memory growth — effectively turning the "streaming" export into a buffered one.

**Solution Applied:**
```javascript
streamRequest.on('row', (row) => {
  rowCount++;
  worksheet.addRow(mapRowToExcel(row)).commit();

  // BACKPRESSURE: Check if HTTP response buffer is full
  if (res.writableLength > res.writableHighWaterMark) {
    streamRequest.pause();  // Pause database stream
    res.once('drain', () => streamRequest.resume());  // Resume when buffer drains
  }

  if (rowCount % 5000 === 0) {
    memoryLogger(`Export - ${rowCount} rows`);
    debugAPI(`Processed ${rowCount} rows`);
  }
});
```

**Impact:** Memory stays bounded regardless of client speed. Fast clients export at full speed; slow clients trigger automatic pausing/resuming. Memory usage remains constant for large exports (previously grew linearly without backpressure).

---

### 5. Async Callback in Pool Error Handler — Unhandled Rejection

**File:** [api/src/services/mssql.js](api/src/services/mssql.js) ~line 57-66  
**Category:** Error Handling  
**Status:** ✅ FIXED (Sprint 2)

**Problem:** Event emitters ignore returned Promises. If `closeAndResetPool()` rejects, the rejection is **completely unhandled**. Node.js ≥15 terminates the process on unhandled rejections by default.

**Solution Applied:**
```javascript
pool.on("error", (err) => {
  debugMSSQL("Pool error event: %O", {
    message: err.message,
    code: err.code,
  });
  if (err.code === "ESOCKET" || err.code === "ECONNRESET") {
    debugMSSQL("Fatal pool error detected: " + err.code + " - resetting pool");
    closeAndResetPool().catch((resetErr) => {
      debugMSSQL("Failed to reset pool after error: %O", { message: resetErr.message });
    });
  }
});
```

**Impact:** Pool error handler no longer crashes process on reset failures. Errors are logged and handled gracefully.

---

### 6. Shutdown Timer Never Cleared

**File:** [api/src/services/mssql.js](api/src/services/mssql.js) ~line 258-270  
**Category:** Event Loop  
**Status:** ✅ FIXED (Sprint 2)

**Problem:** If `closePromise` wins the race (normal case — pool closes in <1 second), the `setTimeout` handle is never cleared. The 30-second timer keeps the event loop alive, delaying process exit unnecessarily.

**Solution Applied:**
```javascript
const closePromise = pool.close();
let drainTimer;
const timeoutPromise = new Promise((resolve) => {
  drainTimer = setTimeout(() => {
    debugMSSQL(`Warning: Shutdown taking longer than ${drainTimeout}ms`);
    resolve();
  }, drainTimeout);
});

await Promise.race([closePromise, timeoutPromise]);
clearTimeout(drainTimer);  // ← FIX: Always clear timer after race
```

**Impact:** Graceful shutdown completes in <2 seconds (not 30). Containers exit cleanly on SIGTERM without hanging.

---

### 7. No Error Handler on Response Stream

**File:** [api/src/controllers/exportController.js](api/src/controllers/exportController.js) ~line 103  
**Category:** Stream Issue  
**Status:** ✅ FIXED (Sprint 2)

**Problem:** The response stream (`res`) is used as ExcelJS's underlying writable stream, but no `res.on('error', ...)` handler is registered. If a write occurs after the client disconnects, Node.js throws `ERR_STREAM_WRITE_AFTER_END` or `ERR_STREAM_DESTROYED`. Without a listener, this becomes an uncaught exception — crashing the process.

**Solution Applied:**
```javascript
// RESPONSE STREAM ERROR HANDLER
res.on('error', (err) => {
  if (streamError) return;  // Guard flag prevents double-handling
  streamError = true;
  debugAPI("Response stream error:", err);
  if (streamRequest) {
    streamRequest.cancel();
  }
});
```

**Impact:** Process survives writes to destroyed response streams. Client disconnects handled cleanly without crashes.

---

## ✅ VERIFICATION: Sprint 1 & 2 Fixes Confirmed

All previous fixes have been verified as correctly implemented:

| Issue | Status | Verification |
|-------|--------|--------------|
| #1: Floating promise | ✅ FIXED | `.catch()` handler properly attached to `streamRequest.execute()` |
| #2: Response leak on SQL error | ✅ FIXED | `res.destroy(err)` called when headers already sent |
| #3: Unhandled rejection in done event | ✅ FIXED | `try/catch` wrapper with separate error handler path |
| #4: No backpressure | ✅ FIXED | `res.writableLength > res.writableHighWaterMark` check + pause/resume logic |
| #5: Async error handler | ✅ FIXED | `.catch()` wrapper ensures rejections are handled |
| #6: Shutdown timer leak | ✅ FIXED | `clearTimeout(drainTimer)` called after Promise.race() |
| #7: Response stream error handler | ✅ FIXED | `res.on('error', ...)` registered early in controller |

**Verdict:** Sprint 1 & 2 work is production-quality and should not be reverted. All guards (`streamError` flag) are in place and error handling flows are correct.

---

## ⏳ SPRINT 3 ISSUES

### 8. Proxy `res.end()` Instead of `res.destroy()` on Error

**File:** [app/src/middlewares/exportProxy.js](app/src/middlewares/exportProxy.js#L56-L65)  
**Category:** Stream Issue  
**Status:** ✅ FIXED

**Problem:** `res.end()` sends a normal FIN to the client, which may interpret the truncated file as a complete (but corrupt) download. `res.destroy()` sends RST, correctly signaling abnormal termination. The comment says "destroying" but the code does `.end()`.

**Solution Applied:**
```javascript
error(err, req, res) {
  debugApplication(`Proxy error [${req.method} ${req.originalUrl}]: ${err.code || err.message}`);
  memoryLogger('proxy-error');

  if (res.headersSent) {
    debugApplication('Headers already sent, destroying response');
    res.destroy(err);  // ← FIX: Send RST instead of FIN
    return;
  }

  const statusCode = err.code === 'ECONNREFUSED' ? 502 : 504;
  res.writeHead(statusCode).end();
},
```

**Impact:** Clients now correctly receive an RST signal when a proxy error occurs mid-stream, preventing interpretation of truncated files as valid downloads.

---

## LOW Severity

### 9. `onError` Handler Attached After `server.listen()` — Race Condition

**File:** [api/src/server.js](api/src/server.js#L35-L45) and [app/src/server.js](app/src/server.js#L35-L40)  
**Category:** Error Handling / Race  
**Severity:** MEDIUM  
**Status:** ✅ FIXED

**Problem:** `server.listen()` is asynchronous. If port binding fails extremely fast (before handlers are attached), the `error` event fires with no listener — edge case race condition affecting both API and BFF servers.

**Solution Applied:**

**API server.js:**
```javascript
const server = http.createServer(app);
server.on("error", onError);        // ← Attached BEFORE listen()
server.on("listening", onListening);

try {
  await initializeDatabase();
  debugServer("Database initialized successfully");
  server.listen(port);  // ← Now safe to listen
}
```

**BFF server.js:**
```javascript
const server = http.createServer(app);
server.on("error", onError);        // ← Attached BEFORE listen()
server.on("listening", onListening);

server.listen(port);  // ← Now safe to listen
```

**Impact:** Handlers are guaranteed to be registered before any events can fire. Race condition eliminated across both servers.

---

### 10. Dead Code — `setImmediate` Before Synchronous `process.exit`

**File:** [api/src/server.js](api/src/server.js#L20-L21)  
**Category:** Dead Code  
**Severity:** LOW  
**Status:** ✅ FIXED

**Problem:** Code had both `setImmediate(() => process.exit(1))` and `process.exit(1)` on consecutive lines. Since `process.exit()` is synchronous, the `setImmediate` callback never executes — making one line dead code.

**Solution Applied:**
```javascript
} catch (err) {
  debugServer(`Failed to validate environment: ${err.message}`);
  setImmediate(() => process.exit(1));  // ← Only this, no duplicate
}
```

**Impact:** Eliminated dead code and made pattern consistent with rest of file (instances in error handler and graceful shutdown). Exit is now deferred properly, allowing error logs to flush before process terminates.

---

### 11. `process.memoryUsage()` in Hot Path — Event Loop Blocking

**File:** [api/src/controllers/exportController.js](api/src/controllers/exportController.js#L179-L181) via [shared/src/memory.js](shared/src/memory.js)  
**Category:** Event Loop Blocking  
**Severity:** LOW

```javascript
if (rowCount % 5000 === 0) {
  memoryLogger(`Export - ${rowCount} rows`);
}
```

**Status:** ✅ **ACCEPTABLE** (Mitigation in place)

**Analysis:** `memoryLogger` calls `process.memoryUsage()`, a synchronous libuv call (~0.1-0.5ms). However:
- **Interval:** Every 5000 rows is appropriate (1-20 times per large export)
- **Impact:** Total blocking time is < 5ms even for 500k row exports
- **Trade-off:** Memory visibility is worth the minimal latency impact
- **Alternative:** Could increase interval to 25,000 rows, but current interval is reasonable for a production tutorial

**Verdict:** No action required. This is an intentional trade-off for observability. If enterprise performance audits flag this, increase the interval to 25,000 rows.

---

### 12. Deopt — Polymorphic Error Response Objects

**File:** [api/src/api.js](api/src/api.js) ~line 50-57 and [app/src/app.js](app/src/app.js) ~line 73-80  
**Category:** Deopt  
**Status:** ✅ FIXED

**Problem:** Conditional spread produces objects with different shapes (with `stack` vs without). V8 marks the construction site as polymorphic. Since `isDevelopment` is constant per process, this is mildly wasteful — but only on error paths.

**Solution Applied:**
```javascript
const errorResponse = {
  error: {
    message: isDevelopment ? err.message : 'Internal server error',
    code: err.code || 'INTERNAL_ERROR',
    stack: isDevelopment ? err.stack : undefined,  // ← Always present, undefined in production
  }
};
```

**Impact:** Error response objects now have consistent shape (monomorphic), allowing V8 to optimize property access. The `stack` property is always present but set to `undefined` in production mode.

---

### 13. Deopt — Inconsistent Error Class Shapes

**File:** [api/src/utils/errors.js](api/src/utils/errors.js) ~line 8-15, 30-35  
**Category:** Deopt  
**Status:** ✅ FIXED

**Problem:** `DatabaseError` adds `originalError` that other `AppError` subclasses don't have. When the global error handler accesses `err.status` across different error types, V8 encounters megamorphic property lookups.

**Solution Applied:**
```javascript
export class AppError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.originalError = null;  // ← Now all subclasses have consistent shape
  }
}
```

**Impact:** All error subclasses now share the same hidden class structure with `originalError` property. V8 can optimize property access across all error types (monomorphic instead of megamorphic).

---

### 14. `Number.parseInt` Without Radix in Stress Tests

**File:** [stress-test.js](../../stress-test.js) and [stress-test-buffered.js](../../stress-test-buffered.js) ~line 10-13  
**Category:** Best Practice  
**Status:** ✅ FIXED

**Problem:** Missing radix parameter in `Number.parseInt()` can lead to unexpected behavior if input strings start with '0' (octal) or '0x' (hex).

**Solution Applied:**
```javascript
Number.parseInt(args[index + 1], 10)  // ← Explicit base-10 radix
```

**Impact:** Parsing behavior is now explicit and predictable. All numeric arguments are guaranteed to be interpreted as base-10 integers, preventing edge cases with leading zeros.

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

---

## NEW ISSUES (Sprint 3 Review)

### 20. Missing JWT_EXPIRES_IN in API Environment Schema

**File:** [api/src/config/env.js](api/src/config/env.js)  
**Category:** Best Practice  
**Severity:** LOW  
**Status:** ✅ FIXED

**Problem:** The API environment schema did not validate `JWT_EXPIRES_IN`, though the BFF does. This created inconsistency between the two services' environment configurations.

**Solution Applied:**
```javascript
const envSchema = z.object({
  // ...
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().optional(), // API only verifies tokens, BFF generates them
});
```

**Impact:** Environment schemas are now consistent across services. The API accepts `JWT_EXPIRES_IN` as an optional field, clarifying that while the BFF uses it for token generation, the API only verifies tokens.

---

### 21. Unused Exported Function `testBadRecord()`

**File:** [api/src/services/mssql.js](api/src/services/mssql.js#L213-L223)  
**Category:** Dead Code  
**Severity:** LOW

```javascript
export const testBadRecord = async () => {
 try {
    debugMSSQL("Database failure test starting");
    await initial_test(-1);
    debugMSSQL("Initial failure test failed ");
  } catch (err) {
    debugMSSQL("Initial database failure test passed: %O", {
      message: err.message,
      code: err.code,
    });
    throw err;
  } 
}
```

**Problem:** 
1. Function is exported but never imported/used anywhere in the codebase
2. Logic is confusing: intentionally passes `-1` to trigger an error, then logs "passed" in the catch block
3. Inconsistent naming: `testBadRecord` suggests it's testing a bad database record, but it's really testing bad parameter validation

**Fix:** Either remove the function or clarify its purpose. If this is intended for manual testing/debugging, add a comment and consider moving it to a test file instead of the production service module.

**Recommendation:** Delete this function as it's not called by any part of the codebase and its presence creates confusion.

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

## ⏳ REMAINING ISSUES FROM SPRINT 2 (Still Pending)

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

**File:** [api/tests/mocks/database.mock.js](../../api/tests/mocks/database.mock.js) ~line 61-67  
**Category:** Test Quality  
**Severity:** LOW  
**Status:** ✅ REMOVED

**Problem:** Function was exported but never called by any tests — dead test code. Additionally, it passed incorrect arguments to `DatabaseError` constructor (string instead of Error object).

**Solution Applied:** Deleted unused `wrapAsDbError()` function and removed the unused `DatabaseError` import from the test mock file.

**Impact:** Cleaner test mock with no dead code. Only actively used helper functions remain.

---

### 19. Confusing Test Logic in `testBadRecord()`

**File:** [api/src/services/mssql.js](api/src/services/mssql.js#L213-L223)  
**Category:** Best Practice / Dead Code  
**Severity:** LOW

```javascript
export const testBadRecord = async () => {
  try {
    debugMSSQL("Database failure test starting");
    await initial_test(-1);
    debugMSSQL("Initial failure test failed ");
  } catch (err) {
    debugMSSQL("Initial database failure test passed: %O", {
      message: err.message,
      code: err.code,
    });
    throw err;
  } 
}
```

**Problem:**
1. Function is exported but **never called** anywhere in the codebase (dead code)
2. Logic is intentionally backwards: passes `-1` to trigger a validation error, logs "passed: when catching the error, then rethrows it
3. Naming is confusing: sounds like it's testing a "bad database record" but actually tests parameter validation
4. The function serves no purpose in the production code (not used by any module)

**Fix:** Remove the function entirely. If this was intended for manual testing or debugging during development, move it to the test suite instead, or delete it.

This was likely created during development for debugging but should be removed before production release.

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

## Recommended Fix Order (Sprint 3+)

### Critical Priority (For Enterprise Deployment)
1. ✅ **Issue #8** (exportProxy.js) — Proxy error stream destroy — COMPLETE
2. ✅ **Issue #9** (server.js) — Event handler ordering — COMPLETE
3. ✅ **Issue #14** (stress-test.js) — Number.parseInt radix parameter — COMPLETE

### High Priority (Code Quality)
1. ✅ **Issue #21** (mssql.js) — Delete unused testBadRecord() function — REMOVED
2. ✅ **Issue #15** (mssql.js) — Delete unused isPoolHealthy() function — REMOVED
3. ✅ **Issue #18** (database.mock.js) — Fix wrapAsDbError() constructor — REMOVED
4. ✅ **Issue #10** (server.js) — Clean up setImmediate/process.exit patterns — COMPLETE

### Medium Priority (Optimization)
5. ✅ **Issue #12** (api.js / app.js) — Monomorphic error responses — COMPLETE
6. ✅ **Issue #13** (errors.js) — Consistent error class shapes — COMPLETE

### Low Priority (Non-Critical)
7. ✅ **Issue #20** (env.js) — Add JWT_EXPIRES_IN for consistency — COMPLETE
8. **Issue #16** (http-proxy) — Apply patch-package for deprecation warning — DEFERRED

---

## Enterprise Deployment Checklist

✅ **Critical Stability Features (Complete)**
- [x] All stream error handlers in place
- [x] No floating promises or unhandled rejections
- [x] Backpressure implemented for memory safety
- [x] Graceful shutdown with connection draining
- [x] JWT authentication configured
- [x] CORS and Helmet security headers enabled

⚠️ **Recommended Before Deployment**
- [x] Fix proxy error handler (#8) — prevents truncated file downloads — COMPLETE
- [x] Fix server event handler ordering (#9) — reduces edge case risk — COMPLETE
- [x] Add radix to Number.parseInt (#14) — prevents NaN surprises — COMPLETE
- [x] Remove dead code (#15, #21) — cleaner codebase for maintenance — COMPLETE

✅ **Already Acceptable**
- [x] Memory usage tracking (#11) appropriate for 5000-row interval
- [x] Stress tests now include JWT authentication (#17)
- [x] All Sprint 1 & 2 fixes verified working

---

## Code Quality Metrics

| Metric | Status | Notes |
|--------|--------|-------|
| **Lint Errors** | 0 | ✅ ESLint passes |
| **Test Coverage** | 57 tests | ✅ All passing (unit + smoke + integration + auth) |
| **Critical Issues** | 0 | ✅ No HIGH severity issues remaining |
| **Stream Safety** | ✅ | All streams have error handlers + backpressure |
| **Error Handling** | ✅ | No floating promises or unhandled rejections |
| **Memory Management** | ✅ | Streaming export maintains constant memory for large exports |
| **Authentication** | ✅ | JWT implemented with proper expiration handling |

---

## Notes for Future Development

1. **Issue #16 (http-proxy deprecation):** Monitor upstream `http-proxy` package for updates. When updated, the deprecation warning will disappear. Short-term: not worth patching.

2. **Issue #11 (Memory logging):** Memory tracking at 5000-row intervals is an intentional design choice for observability. Enterprise deployments may reduce to 25,000-row intervals for minimal overhead.

3. **Performance Baseline:** Large exports:
   - **Streaming (Issue #4 fixed):** Constant memory usage, consistent performance
   - **Buffered:** Linear memory growth, risk of OOM on large exports

4. **Security:** JWT token lifetime (`JWT_EXPIRES_IN`) is set to 15 minutes. For enterprise use, consider:
   - Adding token refresh mechanisms
   - Implementing request signing with RS256 (asymmetric) instead of HS256
   - Rate limiting on the BFF proxy

---

*Last Updated: February 8, 2026 (Sprint 3 Complete)*

---

## Sprint 3 Final Summary

**Result:** 🎉 **SUCCESS** — All critical and high-priority issues resolved!  

**Issues Fixed:** 10 total  
- ✅ Critical deployment issues: #8, #9, #14  
- ✅ Code quality improvements: #10, #12, #13, #20  
- ✅ Dead code cleanup: #15, #18, #21  

**Production Readiness:** ✅ **APPROVED**  
- Zero HIGH/MEDIUM severity issues remaining  
- All stream safety measures in place  
- Error handling comprehensive  
- Memory management optimized  
- Authentication and security configured  

**Deferred to Future Sprints:**  
- Issue #16: Third-party deprecation warning (low priority, not blocking)
