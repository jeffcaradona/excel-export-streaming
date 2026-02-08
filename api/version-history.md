# API Version History

## 0.3.0 — Stream Stability & Pool Resilience (February 8, 2026)

**Status:** ✅ Released  
**Focus:** Backpressure handling, pool error recovery, shutdown cleanup, stream error handling  
**Breaking Changes:** None  
**Migration Required:** None

### Summary

Four stability issues fixed across streaming pipeline and database connection pool. This release prevents unbounded memory growth on slow clients, eliminates unhandled rejections from pool errors, clears stale shutdown timers, and handles response stream errors gracefully.

### Fixed Issues

#### Issue #4: No Backpressure in Row Handler — HIGH
- **Impact:** Slow clients trigger unbounded memory growth; defeats streaming architecture
- **Root Cause:** Database pushes rows at full speed regardless of client read speed; writes pile up in response buffer
- **Solution:** Added pause/resume mechanism based on `res.writableLength` and `writableHighWaterMark`
- **File:** [src/controllers/exportController.js](src/controllers/exportController.js#L145-L165)

#### Issue #5: Unhandled Rejection in Pool Error Handler — MEDIUM
- **Impact:** Process crash when pool reset fails after connection errors
- **Root Cause:** Event emitters discard returned Promises; `async` pool error handler allows unhandled rejections
- **Solution:** Removed `async` keyword, added explicit `.catch()` to `closeAndResetPool()`
- **File:** [src/services/mssql.js](src/services/mssql.js#L57-L68)

#### Issue #6: Shutdown Timer Never Cleared — MEDIUM
- **Impact:** Event loop held open for 30 seconds after pool closes; delays container shutdown
- **Root Cause:** `setTimeout` handle not stored; timer continues even after pool close wins race
- **Solution:** Store timer reference and call `clearTimeout()` after race completes
- **File:** [src/services/mssql.js](src/services/mssql.js#L258-L272)

#### Issue #7: No Error Handler on Response Stream — MEDIUM
- **Impact:** Process crash from writes to destroyed response stream
- **Root Cause:** Client disconnect triggers write before close event fires; uncaught exception
- **Solution:** Added `res.on('error')` handler that sets guard flag and cancels database request
- **File:** [src/controllers/exportController.js](src/controllers/exportController.js#L106-L119)

### Technical Details

#### Backpressure Pattern
Added byte-level backpressure using Node.js stream signals:

```javascript
streamRequest.on('row', (row) => {
  worksheet.addRow(mapRowToExcel(row)).commit();
  
  // Pause when HTTP buffer full; resume on drain
  if (res.writableLength > res.writableHighWaterMark) {
    streamRequest.pause();
    res.once('drain', () => streamRequest.resume());
  }
});
```

**Result:** Memory stays bounded regardless of client speed. Fast clients export at full database speed; slow clients trigger frequent pauses.

#### Pool Error Handler Fix
Replaced async event listener with explicit promise handling:

```javascript
// Before: async listener → unhandled rejection possible
pool.on("error", async (err) => {
  await closeAndResetPool();
});

// After: explicit .catch() → always handled
pool.on("error", (err) => {
  closeAndResetPool().catch((resetErr) => {
    debugMSSQL("Failed to reset pool after error: %O", { message: resetErr.message });
  });
});
```

#### Shutdown Timer Cleanup
Stored timer reference for proper cleanup:

```javascript
let drainTimer;
const timeoutPromise = new Promise((resolve) => {
  drainTimer = setTimeout(() => { /* ... */ }, drainTimeout);
});
await Promise.race([closePromise, timeoutPromise]);
clearTimeout(drainTimer);  // Clear regardless of which wins
```

#### Response Stream Error Handler
Added early error handler to catch writes to destroyed streams:

```javascript
res.on('error', (err) => {
  if (streamError) return;
  streamError = true;
  debugAPI("Response stream error:", err);
  if (streamRequest) {
    streamRequest.cancel();
  }
});
```

### Testing

- ✅ 44 Unit Tests (all existing + new tests for backpressure, pool errors, timer cleanup)
- ✅ Test Coverage: ≥85%
- ✅ Lint: 0 errors
- ✅ Memory bounded under slow client conditions
- ✅ No unhandled rejections from pool errors
- ✅ Graceful shutdown completes in <2 seconds

### Architectural Notes

**Why Event-Driven Pattern Instead of `pipeline()`?**

The official node-mssql docs show `pipeline()` for streaming, but our implementation uses the event-driven pattern because:

1. ExcelJS writes to streams as side effects, not via Transform stream interface
2. Byte-level backpressure adapts to actual client speed (no arbitrary batch sizes)
3. Simpler than creating custom Transform stream wrappers for async operations
4. Clear control flow for multi-step cleanup (database → transformation → HTTP)

See [Sprint 2 documentation](../../documentation/sprint-2.md#architectural-decision-record-event-driven-vs-stream-based) for full rationale.

### Verification Checklist

- [x] Backpressure handling prevents OOM on slow clients
- [x] Pool error handler never crashes on reset failures
- [x] Shutdown timer cleared, no stale handles
- [x] Response stream errors handled without crashes
- [x] All 44 tests passing
- [x] No new unhandled rejections
- [x] Streaming export happy path unchanged
- [x] Lint validation passing
- [x] Version updated to 0.3.0

### Compatibility

- **Node.js:** ≥22 (unchanged)
- **mssql:** v12.2.0+ (unchanged)
- **ExcelJS:** v4.4.0+ (unchanged)
- **Breaking Changes:** None

---

## 0.1.0 — Critical Stability Fixes (February 7, 2026)

**Status:** \u2705 Released  
**Focus:** Critical streaming error handling, response cleanup, crash prevention  
**Breaking Changes:** None  
**Migration Required:** None

### Summary

Three interconnected HIGH-severity issues fixed in the streaming Excel export error handling flow. All stem from missing response cleanup when errors occur at different stages of the streaming pipeline. This release prevents process crashes, connection leaks, and unhandled rejections.

### Fixed Issues

#### Issue #1: Floating Promise on `streamRequest.execute()` \u2014 CRITICAL
- **Impact:** Process crash on stored procedure errors or connection drops before streaming
- **Root Cause:** Promise rejection from `.execute()` not caught; unhandled rejection terminates Node.js
- **Solution:** Added `.catch()` handler with guard flag to safely handle errors before streaming starts
- **File:** [src/controllers/exportController.js](src/controllers/exportController.js#L128-L146)

#### Issue #2: Response Never Closed on Mid-Stream SQL Error \u2014 CRITICAL  
- **Impact:** Connection leak; client hangs indefinitely; corrupted/partial Excel file
- **Root Cause:** When headers already sent, SQL error handler doesn't close response stream
- **Solution:** Added `res.destroy(err)` in error handler for mid-stream failures
- **File:** [src/controllers/exportController.js](src/controllers/exportController.js#L166-L187)

#### Issue #3: Unhandled Rejection in Async `on('done')` \u2014 CRITICAL
- **Impact:** Process crash or silent error swallowing; dangling response streams
- **Root Cause:** Event emitters discard returned Promises from async listeners; errors silently swallowed when headers already sent
- **Solution:** Added error handler branches with `res.destroy()` for partially-written streams
- **File:** [src/controllers/exportController.js](src/controllers/exportController.js#L213-L231)

### Technical Details

#### Guard Flag Pattern
Added `let streamError = false` at controller scope to deduplicate error handling across multiple error paths. Prevents simultaneous cleanup attempts when multiple errors fire in quick succession.

```javascript
let streamError = false;  // Guard against multiple simultaneous error handlers

streamRequest.execute('spGenerateData').catch((err) => {
  if (streamError) return;
  streamError = true;
  // ... handle error
});

streamRequest.on('error', (err) => {
  if (streamError) return;
  streamError = true;
  // ... handle error
});

streamRequest.on('done', async () => {
  try { /* ... */ }
  catch (err) {
    if (streamError) return;
    streamError = true;
    // ... handle error
  }
});
```

#### Safe Error Response Pattern
All error paths now follow consistent pattern:
1. Check `streamError` guard flag to prevent double-handling
2. If headers not yet sent: send JSON error response with try-catch
3. If headers already sent: destroy response stream to abort transfer
4. Always cancel database request to prevent orphaned row events

### Testing

- \u2705 10 Unit Tests (guard flag, promise catching, error sending, stream destruction)
- \u2705 3 Smoke Tests (happy path, headers validation, memory stability)
- \u2705 6 Integration Tests (stored procedure errors, connection drops, workbook failures, client disconnect, multi-error scenarios)
- \u2705 Test Coverage: \u226585%
- \u2705 Lint: 0 errors

### Verification Checklist

- [x] All 4 changes applied to exportController.js
- [x] Guard flag prevents double-handling
- [x] Promise rejection from `.execute()` caught and handled
- [x] Response stream closed on mid-stream SQL error
- [x] Workbook finalization errors don't crash process
- [x] All 10 unit tests passing
- [x] All 3 smoke tests passing
- [x] All 6 integration tests passing
- [x] No unhandled promise rejections
- [x] No socket leaks / CLOSE_WAIT connections
- [x] Memory profile stable during error scenarios
- [x] Error messages reach client correctly
- [x] Lint validation passing

### Compatibility

- **Node.js:** \u226522 (unchanged)
- **mssql:** v12.2.0+ (unchanged)
- **ExcelJS:** v4.4.0+ (unchanged)
- **Breaking Changes:** None
- **Deprecations:** None

### Performance Impact

- **Happy Path:** No change (error handling only)
- **Memory:** Stable in error scenarios (vs. unbounded buffering before fix)
- **CPU:** Negligible (guard flag comparison is microseconds)
- **Stream Timing:** No impact on successful exports

### Known Issues / Limitations

🔴 **Issue #4 - No Backpressure** (planned for Sprint 2)
- Row event handler doesn't pause database stream when response buffer fills
- Can cause unbounded memory growth under slow clients
- Workaround: None; avoid very slow connections during large exports

🟡 **Issue #7 - No Error Handler on `res` Stream** (planned for Sprint 2)
- Response stream has no `.on('error')` handler
- Can crash if write occurs after client disconnects
- Workaround: None; graceful error handling added for database side

### Migration Guide

**No migration required.** This is a drop-in replacement.

- No API changes
- No configuration changes
- No database schema changes
- Query parameters unchanged
- Response format unchanged for successful exports
- Error response format improved (now consistent across all error types)

### Deployment Notes

1. Deploy to staging first
2. Run integration test suite: `npm run test:integration`
3. Monitor logs for any error patterns
4. Deploy to production
5. Verify in production logs that error handlers are working (debug logs)

### Related Documentation

- [Sprint 1 Details](sprint-1.md) — Detailed technical implementation
- [Quality Review](../documentation/quality-review.md) — Full code quality assessment

---

## 0.0.1 — Initial Release (January 2026)

**Status:** Superseded  
**Focus:** Initial streaming Excel export implementation  
**Known Issues:** 16 code quality issues identified (see [quality-review.md](../documentation/quality-review.md))

### Features

- Streaming Excel export from MSSQL
- Uses ExcelJS for workbook generation
- Response headers for download disposition
- Debug logging support via `excel-export-streaming:*` namespace
- Error responses with status codes and error codes

### Known Issues in 0.0.1

**CRITICAL** (Issues #1-3):
- Unhandled promise rejections on connection failures
- Response stream leaks on mid-stream SQL errors
- Workbook finalization failures crash process

**HIGH** (Issue #4):
- No backpressure in row event handler

**MEDIUM** (Issues #5-8):
- Async callback errors in pool handlers
- Uncleaned shutdown timers
- Missing error handlers on response stream
- Improper stream destruction in proxy

See [quality-review.md](../documentation/quality-review.md) for all 16 identified issues.

---

## Semver Strategy

- **0.x.z** — Active development; breaking changes on minor version bump
- **x.y.0** — Feature or bug fix release
- **x.y.z** — Patch fixes to current minor version only
- **1.0.0** — Production-ready API stabilization

Current progression:
- `0.0.1` → `0.1.0` (critical bug fixes)
- Planned: `0.2.0` (remaining HIGH/MEDIUM severity issues)
- Target: `1.0.0` (full code quality review completion)

---

*Last Updated: February 7, 2026*  
*Maintainer: Jeff Caradona*
