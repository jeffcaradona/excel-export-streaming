# API Version History

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
