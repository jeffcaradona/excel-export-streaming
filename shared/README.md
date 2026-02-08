# Excel Export Streaming - Shared Module

Shared utilities module providing cross-service functionality for the Excel Export Streaming system. Used by both the API and BFF services.

## Overview

The shared module exports reusable utilities that prevent duplication between services:

- **Debug Logging** - Consistent debugging across API and BFF with namespaced loggers
- **Memory Tracking** - Peak memory monitoring and reporting throughout operations
- **JWT Authentication** - Token generation and verification for inter-service communication
- **Server Utilities** - Common HTTP server helpers
- **Express Middleware** - Authentication middleware for protecting endpoints

## Installation

The shared module is designed for use within the workspace and is referenced as a local path in `package.json`:

```json
{
  "dependencies": {
    "excel-export-streaming-shared": "file:../shared"
  }
}
```

## Exports

```javascript
// Debug logging
import { debugServer, debugApplication, debugAPI, debugMSSQL } from 'excel-export-streaming-shared/debug';

// Memory tracking
import { createMemoryLogger } from 'excel-export-streaming-shared/memory';

// JWT authentication
import { generateToken, verifyToken } from 'excel-export-streaming-shared/auth';

// Middleware
import { jwtAuthMiddleware } from 'excel-export-streaming-shared/middlewares/jwtAuth';

// Server utilities
import { normalizePort } from 'excel-export-streaming-shared/server';
```

## Modules

### Debug Logging

Provides namespaced debug loggers using the `debug` package. Each logger is scoped by module for filtering in logs.

**Available Loggers:**

```javascript
import { 
  debugServer, 
  debugApplication, 
  debugAPI, 
  debugMSSQL 
} from 'excel-export-streaming-shared/debug';

// Namespaces:
// - excel-export-streaming:server
// - excel-export-streaming:application
// - excel-export-streaming:api
// - excel-export-streaming:mssql
```

**Usage:**

```javascript
import { debugAPI } from '../../../shared/src/debug.js';

debugAPI('Starting export operation');
// Output: excel-export-streaming:api Starting export operation +0ms
```

**Enable Debug Output:**

```bash
$env:DEBUG='excel-export-streaming:*'
npm start

# Or specific modules:
$env:DEBUG='excel-export-streaming:api,excel-export-streaming:mssql'
npm start
```

---

### Memory Tracking

Monitors and reports memory usage throughout the application lifecycle. Tracks current and peak values for RSS, heap, external memory, and array buffers.

**API:**

```javascript
import { createMemoryLogger } from 'excel-export-streaming-shared/memory';

const memoryLogger = createMemoryLogger(process, debugAPI);

// Log current memory usage
memoryLogger('Export - Start');
// → [Export - Start] Memory Usage: RSS: 50.23 MB | Heap Used: 25.15 MB / 100.00 MB | ...

// Get peak summary object (for programmatic access)
const peaks = memoryLogger.getPeakSummary();
// {
//   rss: { bytes: 52428800, mb: '50.00' },
//   heapUsed: { bytes: 26214400, mb: '25.00' },
//   ...
// }

// Log peak memory seen so far
memoryLogger.logPeakSummary('Export - Complete');
// → [Export - Complete] Peak Memory Usage: RSS: 52.23 MB | ...
```

**Use Cases:**

- Track memory growth during streaming operations
- Compare buffered vs. streaming export approaches
- Detect memory leaks in long-running processes
- Monitor API and BFF resource usage

**Output Format:**

```
[Label] Memory Usage: RSS: X.XX MB | Heap Used: Y.YY MB / Z.ZZ MB | External: A.AA MB | Array Buffers: B.BB MB
```

---

### JWT Authentication

Handles secure token generation and verification for inter-service communication between the BFF and API.

#### Token Generation

```javascript
import { generateToken } from 'excel-export-streaming-shared/auth';

const token = generateToken(process.env.JWT_SECRET);
// → "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

// With custom expiration
const shortToken = generateToken(process.env.JWT_SECRET, '5m');
```

**Token Claims:**

```javascript
{
  iss: 'excel-export-app',      // issuer
  aud: 'excel-export-api',      // audience
  iat: 1707319200,              // issued at
  exp: 1707319900               // expires in
}
```

#### Token Verification

```javascript
import { verifyToken } from 'excel-export-streaming-shared/auth';

try {
  const decoded = verifyToken(token, process.env.JWT_SECRET);
  console.log(decoded.iss); // 'excel-export-app'
} catch (error) {
  if (error.name === 'TokenExpiredError') {
    console.error('Token expired');
  } else if (error.name === 'JsonWebTokenError') {
    console.error('Invalid token signature');
  }
}
```

---

### JWT Middleware

Express middleware for validating JWT tokens in request headers. Protects API endpoints from unauthorized access.

**Usage:**

```javascript
import { jwtAuthMiddleware } from 'excel-export-streaming-shared/middlewares/jwtAuth';

// Protect routes
router.use(jwtAuthMiddleware(process.env.JWT_SECRET));

// After middleware, req.auth contains decoded token
router.get('/protected', (req, res) => {
  console.log(req.auth.iss); // 'excel-export-app'
  res.send('Authenticated!');
});
```

**Header Format:**

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Error Responses:**

```json
{
  "error": {
    "message": "Missing or invalid authorization header",
    "code": "UNAUTHORIZED"
  }
}
```

or

```json
{
  "error": {
    "message": "Token expired",
    "code": "UNAUTHORIZED"
  }
}
```

---

### Server Utilities

Helper functions for HTTP server operations.

**Port Normalization:**

```javascript
import { normalizePort } from 'excel-export-streaming-shared/server';

normalizePort('3000');           // → 3000
normalizePort('8080');           // → 8080
normalizePort('/tmp/app.sock');  // → '/tmp/app.sock' (named pipe)
normalizePort('invalid');        // → false
```

Used in server startup to handle common port configurations.

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| debug | ~4.4.3 | Namespaced debug logging |
| jsonwebtoken | ^9.0.3 | JWT token generation/verification |

## Architecture

### Why Shared?

The shared module applies the DRY (Don't Repeat Yourself) principle:

- **Debug Namespace** - All services use consistent module names
- **Memory Logger** - Same implementation across API and BFF
- **JWT** - Single source of truth for authentication logic
- **Middleware** - Consistent error responses

### Import Patterns

**Using Package Exports:**

```javascript
import { debugAPI } from 'excel-export-streaming-shared/debug';
import { createMemoryLogger } from 'excel-export-streaming-shared/memory';
```

Defined in `package.json`:

```json
{
  "exports": {
    "./debug": "./src/debug.js",
    "./memory": "./src/memory.js",
    "./auth": "./src/auth/jwt.js",
    "./middlewares/jwtAuth": "./src/middlewares/jwtAuth.js",
    "./server": "./src/server.js"
  }
}
```

This keeps imports clean and allows the module to be published to npm in the future without path changes.

---

## Testing

Unit tests are provided for JWT functionality:

```bash
npm test --workspace=shared
```

**Test Coverage:**

- `tests/auth/jwt.test.js` - Token generation, verification, expiration
- `tests/middlewares/jwtAuth.test.js` - Middleware authentication, error handling

---

## Development

### Project Structure

```
shared/
├── src/
│   ├── debug.js                  # Debug logging setup
│   ├── memory.js                 # Memory tracking logger
│   ├── server.js                 # Server utilities
│   ├── auth/
│   │   └── jwt.js               # JWT token generation/verification
│   └── middlewares/
│       └── jwtAuth.js           # Express JWT middleware
├── tests/
│   ├── auth/
│   │   └── jwt.test.js
│   └── middlewares/
│       └── jwtAuth.test.js
├── package.json                  # Workspace package
└── README.md                      # This file
```

### Adding New Utilities

Follow these patterns:

1. **Create module** in `src/` with clear docstrings
2. **Export explicitly** from module
3. **Add export entry** to `package.json` `exports` field
4. **Write unit tests** in `tests/`
5. **Document usage** in this README

---

## Known Limitations

- No rate limiting for token generation (consider adding for production)
- Memory logger is approximate (uses `process.memoryUsage()`)
- JWT tokens are not decorated with additional claims (consider adding user/scope info for future expansion)

---

## License

See LICENSE file in root directory
