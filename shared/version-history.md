# Excel Export Streaming Shared Module - Version History

## [0.3.0] - 2026-02-08

### No changes in this version
The shared module version stays in sync with the workspace (v0.3.0), but there were no breaking changes or new features in this release.

---

## [0.2.0] - 2026-02-07

### Added
- **JWT Authentication Module** - Server-side token generation and verification
  - `generateToken(secret, [expiresIn])` - Creates signed JWT tokens for inter-service auth
  - `verifyToken(token, secret)` - Validates and decodes JWT tokens
  - Token format: `iss: 'excel-export-app'`, `aud: 'excel-export-api'`, with configurable expiration
- **JWT Authentication Middleware** - Express middleware for protecting endpoints
  - `jwtAuthMiddleware(secret)` - Validates Authorization headers in format `Bearer <token>`
  - Attaches decoded payload to `req.auth` for downstream handlers
  - Returns 401 errors with consistent error format for missing/invalid/expired tokens
- **Enhanced Memory Logger** - Improvements to peak memory tracking
  - Added `logPeakSummary(label)` method for summary reporting
  - Added `getPeakSummary()` method for programmatic access to peak values
  - Both methods support optional labels for context
  - Now tracks array buffers separately when available
- **Unit Tests**
  - `tests/auth/jwt.test.js` - Comprehensive JWT generation, verification, and error handling tests
  - `tests/middlewares/jwtAuth.test.js` - Middleware authentication validation and error scenarios

### Changed
- Memory logger now differentiates between current memory and peak memory reporting
- Improved memory formatter to handle both bytes and MB representations

### Why JWT in Shared?
The JWT authentication logic is shared because:
- BFF generates tokens server-side using the same secret
- API validates tokens using the same verification logic
- Consistent token format and claims across services
- Single source of truth prevents signing/verification mismatches

---

## [0.1.0] - 2026-02-07

### Added
- **Debug Logging Module** - Namespaced debug loggers for consistent logging
  - `debugServer` - For HTTP server events and lifecycle
  - `debugApplication` - For application-level operations
  - `debugAPI` - For API-specific operations
  - `debugMSSQL` - For database operations
  - Uses `debug` package for granular logging control via `DEBUG` environment variable
- **Memory Logger** - Tracks memory usage throughout operations
  - `createMemoryLogger(process, logger)` - Factory function to create memory tracking logger
  - Logs current RSS, heap used, heap total, external memory, and array buffers
  - Tracks peak values for each metric across application lifetime
  - Formats bytes to MB with 2 decimal places
  - `updatePeaks()` method to capture memory snapshots
- **Server Utilities** - HTTP server helper functions
  - `normalizePort(val)` - Converts port input to number, string (named pipe), or false
- **Package Exports** - Defined in `package.json` for clean imports
  - `./debug` → `src/debug.js`
  - `./memory` → `src/memory.js`
  - `./server` → `src/server.js`
  - `./auth` → `src/auth/jwt.js`
  - `./middlewares/jwtAuth` → `src/middlewares/jwtAuth.js`

### Configuration
- Uses local `package.json` to get module name (excel-export-streaming) for debug namespace
- All logging is namespaced under `excel-export-streaming:<module>`

---

## Module Dependencies

| Package | Version | Added | Purpose |
|---------|---------|-------|---------|
| debug | ~4.4.3 | v0.1.0 | Namespaced debug logging |
| jsonwebtoken | ^9.0.3 | v0.2.0 | JWT token generation/verification |

---

## Design Principles

### 1. **Shared Responsibility**
The shared module is used by both API and BFF to ensure:
- Consistent debugging across services
- Same JWT token format and verification
- Identical memory tracking capabilities
- Single source of truth for error handling

### 2. **Factory Pattern**
- `createMemoryLogger()` - Allows per-operation memory tracking
- `jwtAuthMiddleware()` - Middleware factory for Express integration
- `createDebugger()` - Creates namespaced loggers

### 3. **No Side Effects**
- All modules are pure functions or factories
- No global state or configuration
- Passed as dependencies to higher-level code

### 4. **Consistent Error Handling**
- JWT errors return 401 status with consistent format
- Error codes: `UNAUTHORIZED`, with optional stack for development
- Matches error format used in API and BFF

---

## Usage Examples

### Debug Logging Across Services

**API:**
```javascript
import { debugAPI } from '../../../shared/src/debug.js';

debugAPI('Starting streaming export');
// Output: excel-export-streaming:api Starting streaming export +0ms
```

**BFF:**
```javascript
import { debugApplication } from '../../shared/src/debug.js';

debugApplication('Proxying request to API');
// Output: excel-export-streaming:application Proxying request to API +45ms
```

**Enable debug output:**
```bash
$env:DEBUG='excel-export-streaming:*'
npm start
```

### Memory Tracking

```javascript
import { createMemoryLogger } from '../../../shared/src/memory.js';

const memoryLogger = createMemoryLogger(process, debugAPI);

memoryLogger('Export - Start');
// → [Export - Start] Memory Usage: RSS: 50.23 MB | Heap Used: 25.15 MB / 100.00 MB | ...

// ... perform operation ...

memoryLogger.logPeakSummary('Export - Complete');
// → [Export - Complete] Peak Memory Usage: RSS: 52.23 MB | ...
```

### JWT Authentication

**Generate token (BFF):**
```javascript
import { generateToken } from '../../../shared/src/auth/jwt.js';

const token = generateToken(env.JWT_SECRET, env.JWT_EXPIRES_IN);
proxyReq.setHeader('Authorization', `Bearer ${token}`);
```

**Verify token (API):**
```javascript
import { jwtAuthMiddleware } from '../../../shared/src/middlewares/jwtAuth.js';

router.use(jwtAuthMiddleware(env.JWT_SECRET));
// Now all routes require valid JWT token
```

---

## Future Considerations

1. **Token Caching** - Cache verified tokens to reduce crypto overhead
2. **Token Scopes** - Add scope claims for fine-grained authorization
3. **Rate Limiting** - Limit token generation rate to prevent abuse
4. **Metrics Export** - Export memory metrics in Prometheus format
5. **Structured Logging** - Add JSON logging option for production log aggregation
6. **NPM Publishing** - Package as public module once API is stable

---

## Testing Strategy

### Unit Tests
- JWT: Token generation, verification, expiration, error handling
- Middleware: Valid tokens, invalid tokens, missing headers, expired tokens, malformed headers

### Integration Testing
- BFF generates token and proxies to API successfully
- API rejects requests without valid JWT
- Token expiration is enforced across services

### Load Testing
- Memory tracking accuracy under sustained operations
- Token generation performance with high request volume

---

## Known Issues / Limitations

- Memory logger uses `process.memoryUsage()` which is approximate
- No built-in token refresh/rotation mechanism
- JWT tokens use only basic claims (consider adding more for production)
- Debug logging has no log level filtering (all or nothing per namespace)

---

## Migration Guide

### To v0.2.0 from v0.1.0
**Breaking**: Both API and BFF now require JWT_SECRET environment variable

1. Update `.env` to include:
   ```env
   JWT_SECRET=your-secret-key-at-least-32-characters
   JWT_EXPIRES_IN=15m
   ```

2. No code changes required if using shared module imports
3. If not using the middleware, add it to API routes to enable authentication

### To v0.3.0 from v0.2.0
No breaking changes. All functionality remains the same.
