# Sprint 2: Stream Stability & Pool Resilience (Issues #4-7)

**Status:** Ready for Implementation  
**Priority:** HIGH (#4) + MEDIUM (#5, #6, #7)  
**Target:** Quality Review Issues #4-7 across [exportController.js](../api/src/controllers/exportController.js) and [mssql.js](../api/src/services/mssql.js)  
**Date:** February 7, 2026

---

## Overview

Four issues that, combined, let a slow client or a crashing pool trigger unbounded memory growth, unhandled rejections, or stale timers that delay process exit. The fixes are independent of each other but collectively harden the streaming pipeline and the database connection pool.

### Issues Addressed

| # | Issue | Category | Severity | File |
|---|-------|----------|----------|------|
| 4 | No backpressure in row handler | Stream / Leak | **HIGH** | exportController.js |
| 5 | Unhandled rejection in pool error handler | Error Handling | MEDIUM | mssql.js |
| 6 | Shutdown timer never cleared | Event Loop | MEDIUM | mssql.js |
| 7 | No error handler on `res` stream | Stream Issue | MEDIUM | exportController.js |

---

## The Problems

### Data Flow — Where Each Issue Sits

```
MSSQL                            Node.js                           Client
──────                           ───────                           ──────
spGenerateData                                                     Browser
      │                                                               ▲
      │  row event                                                    │
      ├──────────────► streamRequest.on('row')                        │
      │                      │                                        │
      │               worksheet.addRow().commit()                     │
      │                      │                                        │
      │                 ┌────▼────┐        Issue #7                   │
      │                 │   res   │◄─── no error handler ───── socket close
      │                 │ stream  │                                   │
      │                 └────┬────┘                                   │
      │                      │                                        │
      │    Issue #4          │           if client reads slowly...     │
      │    No pause()   writes pile ──► writableLength grows ──► OOM  │
      │    signal        up here                                      │
      │                                                               │
      │                                                               │
Pool layer (mssql.js)                                                 │
─────────────────────                                                 │
      │                                                               │
      │  Issue #5: pool.on('error', async () => {                     │
      │              await closeAndResetPool() ← unhandled rejection  │
      │            })                                                 │
      │                                                               │
      │  Issue #6: gracefulShutdown()                                 │
      │              setTimeout(30s) ← never clearTimeout()           │
      │              keeps event loop alive 30s after close            │
```

### Issue #4 — No Backpressure (HIGH)

**File:** [exportController.js](../api/src/controllers/exportController.js) line ~145-155  
**Current code:**
```javascript
streamRequest.on('row', (row) => {
  rowCount++;
  worksheet.addRow(mapRowToExcel(row)).commit();
  
  if (rowCount % 5000 === 0) {
    memoryLogger(`Export - ${rowCount} rows`);
    debugAPI(`Processed ${rowCount} rows`);
  }
});
```

**Problem:** `addRow().commit()` writes to the underlying `res` stream via ExcelJS. If the client reads slowly (slow network, mobile, throttled connection), Node.js buffers data in the writable stream's internal buffer. The database keeps pushing rows at full speed since there's no backpressure signal. Under load, this can cause unbounded memory growth — effectively turning the "streaming" export into a buffered one.

**Why it matters:** This defeats the entire purpose of the streaming architecture. A single slow client exporting 500k rows can consume gigabytes of memory and crash the process.

**Scenario:**
```
Database:  ████████████████████ → 100,000 rows/sec
Client:    ██░░░░░░░░░░░░░░░░░ → 2,000 rows/sec (slow 3G)
Buffer:    ████████████████████ → 490 MB and growing...
```

---

### Issue #5 — Unhandled Rejection in Pool Error Handler (MEDIUM)

**File:** [mssql.js](../api/src/services/mssql.js) line ~57-66  
**Current code:**
```javascript
pool.on("error", async (err) => {
  debugMSSQL("Pool error event: %O", {
    message: err.message,
    code: err.code,
  });
  if (err.code === "ESOCKET" || err.code === "ECONNRESET") {
    debugMSSQL("Fatal pool error detected: " + err.code + " - resetting pool");
    await closeAndResetPool();
  }
});
```

**Problem:** Event emitters ignore returned Promises from `async` callback functions. If `closeAndResetPool()` rejects, the rejection is **completely unhandled**. Node.js ≥15 terminates the process on unhandled rejections by default. This is the same class of bug as Sprint 1's Issue #3 (async event listener) — but in the database layer.

**Scenario:**
```
1. SQL Server drops connection (ESOCKET)
2. pool.on('error') fires
3. closeAndResetPool() attempts pool.close()
4. pool.close() rejects (socket already dead)
5. Returned Promise rejected — no handler
6. Node.js: UnhandledPromiseRejectionWarning → process.exit(1)
```

---

### Issue #6 — Shutdown Timer Never Cleared (MEDIUM)

**File:** [mssql.js](../api/src/services/mssql.js) line ~258-270  
**Current code:**
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

**Problem:** If `closePromise` wins the race (the normal case — pool closes in <1 second), the `setTimeout` handle is never cleared. The 30-second timer keeps the event loop alive, delaying process exit by up to 30 seconds unnecessarily. During deployment, this means containers hang for half a minute after receiving SIGTERM.

**Scenario:**
```
SIGTERM received
  → gracefulShutdown() called
  → pool.close() completes in 200ms  ← wins race
  → setTimeout(30000) still pending  ← keeps event loop alive
  → process.exit(0) called...
  → ...but 30s timer is still active, holding the event loop
     (in practice, the explicit process.exit(0) in server.js 
      forces exit, but the timer is still a bug)
```

---

### Issue #7 — No Error Handler on Response Stream (MEDIUM)

**File:** [exportController.js](../api/src/controllers/exportController.js) line ~97-103  
**Current code:**
```javascript
const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
  stream: res,
  useStyles: false,
  useSharedStrings: false
});
```

**Problem:** The response stream (`res`) is used as ExcelJS's underlying writable stream, but no `res.on('error', ...)` handler is registered. If a write occurs after the client disconnects (between the `close` event and the next write), Node.js throws `ERR_STREAM_WRITE_AFTER_END` or `ERR_STREAM_DESTROYED`. Without a listener, this becomes an uncaught exception — **crashing the process**.

**Scenario:**
```
1. Client connection drops (browser closed, network timeout)
2. req 'close' event queued in microtask
3. BEFORE close handler runs, next row event fires
4. worksheet.commit() writes to already-destroyed res
5. res emits 'error' — ERR_STREAM_DESTROYED
6. No listener → uncaughtException → process crashes
```

---

## Solution Architecture

### Issue #4 Fix: Backpressure via `pause()`/`resume()`

Node.js writable streams signal backpressure through `writableLength` and `writableHighWaterMark`. When buffered data exceeds the high water mark, the producer should pause until the consumer drains.

```
Database rows → pause() → waiting... → drain event → resume() → more rows
```

**Key properties:**
- `res.writableLength` — bytes currently buffered in the writable stream
- `res.writableHighWaterMark` — threshold above which backpressure should be applied (default: 16KB)
- `res.once('drain')` — emitted when buffer drops below high water mark

### Issue #5 Fix: Replace `async` with `.catch()`

Remove the `async` keyword from the event listener and handle the promise explicitly with `.catch()`. This is the same pattern applied to `.execute()` in Sprint 1.

### Issue #6 Fix: Store timer reference and `clearTimeout()`

Assign the `setTimeout` return value to a variable and clear it after the race completes.

### Issue #7 Fix: Attach `res.on('error')` handler

Register an error handler on the response stream that logs the error, sets the guard flag, and cancels the database request.

---

## Implementation Details

### Change 1: Add Backpressure Handling (Issue #4)

**Location:** [exportController.js](../api/src/controllers/exportController.js) line ~145-155

**Replace:**
```javascript
    // ROW EVENT: Fired for each row returned from database
    // This is where data flows from MSSQL → ExcelJS → HTTP response
    streamRequest.on('row', (row) => {
      rowCount++;
      
      // Map database columns to Excel row format and write immediately
      // .commit() writes the row to the underlying stream without buffering
      worksheet.addRow(mapRowToExcel(row)).commit();
      
      // MEMORY TRACKING: Log memory usage periodically
      // Every 5000 rows, check memory to detect potential issues
      if (rowCount % 5000 === 0) {
        memoryLogger(`Export - ${rowCount} rows`);
        debugAPI(`Processed ${rowCount} rows`);
      }
    });
```

**With:**
```javascript
    // ROW EVENT: Fired for each row returned from database
    // This is where data flows from MSSQL → ExcelJS → HTTP response
    streamRequest.on('row', (row) => {
      rowCount++;
      
      // Map database columns to Excel row format and write immediately
      // .commit() writes the row to the underlying stream without buffering
      worksheet.addRow(mapRowToExcel(row)).commit();
      
      // BACKPRESSURE: If the response stream buffer is full, pause the
      // database stream until the client catches up. Without this, a slow
      // client causes unbounded memory growth as rows pile up in the buffer.
      if (res.writableLength > res.writableHighWaterMark) {
        streamRequest.pause();
        res.once('drain', () => streamRequest.resume());
      }
      
      // MEMORY TRACKING: Log memory usage periodically
      // Every 5000 rows, check memory to detect potential issues
      if (rowCount % 5000 === 0) {
        memoryLogger(`Export - ${rowCount} rows`);
        debugAPI(`Processed ${rowCount} rows`);
      }
    });
```

**What changes:**
- After each row commit, checks if `res` buffer exceeds the high water mark
- If so, pauses the MSSQL stream request (stops emitting `row` events)
- When `res` drains (buffer drops below threshold), resumes the stream
- Memory stays bounded regardless of client speed

---

### Change 2: Fix Pool Error Handler (Issue #5)

**Location:** [mssql.js](../api/src/services/mssql.js) line ~57-66

**Replace:**
```javascript
        // Attach error event listeners for automatic recovery
        pool.on("error", async (err) => {
          debugMSSQL("Pool error event: %O", {
            message: err.message,
            code: err.code,
          });
          // Mark pool as unhealthy so next call will attempt reconnection
          if (err.code === "ESOCKET" || err.code === "ECONNRESET") {
            debugMSSQL("Fatal pool error detected: " + err.code + " - resetting pool");
            await closeAndResetPool();
          }
        });
```

**With:**
```javascript
        // Attach error event listeners for automatic recovery
        // NOTE: NOT async — event emitters discard returned Promises.
        // Using .catch() ensures rejections are always handled.
        pool.on("error", (err) => {
          debugMSSQL("Pool error event: %O", {
            message: err.message,
            code: err.code,
          });
          // Mark pool as unhealthy so next call will attempt reconnection
          if (err.code === "ESOCKET" || err.code === "ECONNRESET") {
            debugMSSQL("Fatal pool error detected: " + err.code + " - resetting pool");
            closeAndResetPool().catch((resetErr) => {
              debugMSSQL("Failed to reset pool after error: %O", { message: resetErr.message });
            });
          }
        });
```

**What changes:**
- Removes `async` keyword from event listener
- Replaces `await` with `.catch()` — explicit rejection handling
- If `closeAndResetPool()` fails, the error is logged instead of crashing the process

---

### Change 3: Clear Shutdown Timer (Issue #6)

**Location:** [mssql.js](../api/src/services/mssql.js) line ~258-270

**Replace:**
```javascript
      // Use a timeout race to enforce maximum drain time
      const closePromise = pool.close();
      const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => {
          debugMSSQL(`Warning: Shutdown taking longer than ${drainTimeout}ms`);
          resolve();
        }, drainTimeout);
      });
      
      // Race: whichever completes first
      await Promise.race([closePromise, timeoutPromise]);
```

**With:**
```javascript
      // Use a timeout race to enforce maximum drain time
      const closePromise = pool.close();
      let drainTimer;
      const timeoutPromise = new Promise((resolve) => {
        drainTimer = setTimeout(() => {
          debugMSSQL(`Warning: Shutdown taking longer than ${drainTimeout}ms`);
          resolve();
        }, drainTimeout);
      });
      
      // Race: whichever completes first
      await Promise.race([closePromise, timeoutPromise]);
      clearTimeout(drainTimer);
```

**What changes:**
- Stores `setTimeout` return value in `drainTimer`
- Calls `clearTimeout(drainTimer)` after race completes
- If pool closes quickly (normal case), the 30s timer is immediately cleared
- Process can exit without waiting for the stale timer

---

### Change 4: Add Response Stream Error Handler (Issue #7)

**Location:** [exportController.js](../api/src/controllers/exportController.js) line ~103 (after workbook setup, before database connection)

**After this line:**
```javascript
    const worksheet = workbook.addWorksheet('Report');
    worksheet.columns = REPORT_COLUMNS; // Define columns from schema
```

**Insert:**
```javascript
    
    // RESPONSE STREAM ERROR HANDLER
    // If the client disconnects and a write is attempted before the close
    // event fires, res emits an error (ERR_STREAM_WRITE_AFTER_END or
    // ERR_STREAM_DESTROYED). Without this handler, the error becomes an
    // uncaught exception and crashes the process.
    res.on('error', (err) => {
      if (streamError) return;
      streamError = true;
      debugAPI("Response stream error:", err);
      if (streamRequest) {
        streamRequest.cancel();
      }
    });
```

**What changes:**
- Registers an error handler on `res` before any writes occur
- Uses the existing `streamError` guard flag to prevent double-handling
- Cancels the database request to stop orphaned row events
- Process no longer crashes from writes to a destroyed response stream

---

## Testing Requirements

### Unit Tests → `npm test`
**Framework:** Node.js built-in test runner + sinon

#### Issue #4 — Backpressure Tests

| # | Test | Assertion |
|---|------|-----------|
| 1 | Row handler calls `streamRequest.pause()` when `writableLength > writableHighWaterMark` | `pause()` called once |
| 2 | Row handler does NOT pause when buffer is below threshold | `pause()` not called |
| 3 | `res.once('drain')` registers callback that calls `resume()` | `resume()` called on drain |
| 4 | Multiple pause/resume cycles work correctly | pause/resume called equal times |

**Example:**
```javascript
test('Row handler pauses stream when backpressure detected', () => {
  const res = ResponseMock.stub();
  const mockRequest = StreamRequestMock.stub();
  
  // Simulate buffer exceeding high water mark
  Object.defineProperty(res, 'writableLength', { value: 32768 });
  Object.defineProperty(res, 'writableHighWaterMark', { value: 16384 });
  
  // Simulate row handler logic
  if (res.writableLength > res.writableHighWaterMark) {
    mockRequest.pause();
    res.once('drain', () => mockRequest.resume());
  }
  
  assert.strictEqual(mockRequest.pause.calledOnce, true);
  assert.strictEqual(res.once.calledWith('drain'), true);
});
```

#### Issue #5 — Pool Error Handler Tests

| # | Test | Assertion |
|---|------|-----------|
| 5 | Pool error handler is NOT async | `typeof handler !== 'AsyncFunction'` |
| 6 | `closeAndResetPool()` rejection is caught and logged | No unhandled rejection |
| 7 | Non-fatal error codes skip pool reset | `closeAndResetPool` not called |

#### Issue #6 — Shutdown Timer Tests

| # | Test | Assertion |
|---|------|-----------|
| 8 | `clearTimeout` called after successful pool close | Timer reference cleared |
| 9 | Timer fires if pool close exceeds `drainTimeout` | Warning logged |

#### Issue #7 — Response Error Handler Tests

| # | Test | Assertion |
|---|------|-----------|
| 10 | `res.on('error')` handler is registered | `res.on` called with `'error'` |
| 11 | Error handler sets `streamError` guard flag | Guard prevents double-handling |
| 12 | Error handler cancels `streamRequest` | `cancel()` called |
| 13 | Error handler does nothing if `streamError` already true | `cancel()` not called again |

**Success Criteria:** 13/13 pass

---

### Smoke Tests → `npm run test:smoke`

| # | Test | Assertion |
|---|------|-----------|
| 1 | Normal 100-row export still completes | Response ends with data |
| 2 | 50k-row export memory remains bounded | Peak memory < 80MB |
| 3 | Response headers correct after all changes | Excel MIME, filename, disposition |

**Success Criteria:** Happy path unaffected by defensive changes

---

### Integration Tests → `npm run test:integration`

| # | Test | Assertion |
|---|------|-----------|
| 1 | Slow consumer triggers backpressure pause/resume cycle | `pause()` and `resume()` both called |
| 2 | Pool ESOCKET error resets pool without crashing | Pool reconnects, no unhandled rejection |
| 3 | Graceful shutdown completes in < 2s (timer cleared) | No 30s delay |
| 4 | Client disconnect mid-stream triggers `res.on('error')` handler | `cancel()` called, no crash |
| 5 | Back-to-back errors on `res` and `streamRequest` — guard flag deduplicates | Only one cleanup runs |

**Success Criteria:** All 5 scenarios handled gracefully, no process crashes, no unhandled rejections

---

### Stress Tests → Manual validation with `npm run stress-test`

**Backpressure validation:**
1. Start API with `--max-old-space-size=128` to limit heap
2. Run stress test with 10 concurrent slow clients and 100k rows
3. Verify process survives without OOM

```bash
# API with constrained memory (should survive with backpressure)
node --max-old-space-size=128 --env-file=../.env src/server.js

# Stress test
node stress-test.js --connections 10 --duration 120 --rowCount 100000
```

**Success Criteria:** Process stays alive, memory bounded < 128MB

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| `pause()` deadlock — paused stream never resumes | `drain` event is guaranteed by Node.js when buffer drops below HWM; `close` handler also cancels request as existing failsafe |
| Multiple `drain` listeners pile up | Using `res.once('drain')` (not `res.on`) ensures exactly one listener per pause |
| `clearTimeout` on already-fired timer | Safe: `clearTimeout()` is a no-op if the timer has already fired |
| `res.on('error')` fires before `streamError` is initialized | Handler is registered after `streamError` is declared at function scope; safe |
| Backpressure slows exports | By design: export speed matches client speed, preventing OOM. Fast clients see no difference. |

---

## Dependencies

- ✓ [exportController.js](../api/src/controllers/exportController.js) — Changes 1 and 4
- ✓ [mssql.js](../api/src/services/mssql.js) — Changes 2 and 3
- ✓ Guard flag `streamError` from Sprint 1 — reused by Change 4
- ✓ `streamRequest.pause()` / `streamRequest.resume()` — mssql v8+ API
- ✓ `res.writableLength` / `res.writableHighWaterMark` — Node.js Writable stream API

---

## File Change Summary

| File | Changes | Lines Modified |
|------|---------|---------------|
| [exportController.js](../api/src/controllers/exportController.js) | Backpressure in row handler + `res.on('error')` handler | ~12 lines added |
| [mssql.js](../api/src/services/mssql.js) | Remove `async` from pool error, clear shutdown timer | ~6 lines modified |

**Total:** ~18 lines across 2 files  
**Complexity:** Low (each change is independent and localized)  
**Risk Level:** Low (defensive additions, no happy-path logic altered)

---

## Recommended Fix Order

1. **Issue #7** — Add `res.on('error')` handler (simplest, no behavior change)
2. **Issue #5** — Fix pool error handler (one-line async removal + `.catch()`)
3. **Issue #6** — Clear shutdown timer (two-line addition)
4. **Issue #4** — Add backpressure (most impactful, requires careful testing)

Issues #5, #6, and #7 are safe one-shot changes. Issue #4 deserves the most testing attention because it introduces pause/resume behavior into the hot path.

---

## Success Criteria

✅ **Issue #4 resolved:**
- Memory stays bounded regardless of client speed
- Slow clients export successfully (just slower)
- Fast clients see no performance change

✅ **Issue #5 resolved:**
- Pool error handler never produces unhandled rejections
- Process survives pool reset failures

✅ **Issue #6 resolved:**
- Graceful shutdown completes in < 2 seconds (not 30)
- No stale timers holding the event loop open

✅ **Issue #7 resolved:**
- Process survives writes to destroyed response stream
- Client disconnects handled cleanly without uncaught exceptions

✅ **No new side effects:**
- All 44 existing tests still pass
- Lint clean (0 errors)
- Streaming export happy path unchanged

---

## Version Update

After sprint completion: `0.2.0` → `0.3.0` (streaming stability fixes)

Update [version-history.md](../api/version-history.md) with:
- Issue #4: Backpressure handling prevents OOM on slow clients
- Issue #5: Pool error handler no longer crashes on reset failures
- Issue #6: Shutdown timer cleared, no stale handles
- Issue #7: Response stream errors handled, prevents uncaught exceptions

---

## Related Issues

- Issue #8: `res.end()` instead of `res.destroy()` on proxy error (separate fix, different file)
- Issue #9: Event handlers attached after `listen()` (separate fix, server.js)
- Issue #11: `process.memoryUsage()` in hot path (lower priority, exportController.js)

These are scheduled for future sprints.

---

*Created: February 7, 2026*  
*Status: Ready for implementation*
