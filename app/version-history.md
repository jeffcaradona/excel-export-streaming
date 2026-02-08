# Excel Export Streaming BFF - Version History

## [0.3.0] - 2026-02-08

### Changed
- **Abstracted Export Proxy Factory** - Refactored `createExportProxy()` middleware factory to accept dynamic target URLs as parameters, allowing flexible route-to-API endpoint mapping
- Improved proxy middleware architecture by separating route configuration from proxy mechanics
- Enhanced code reusability for future export endpoints

### Features
- JWT token injection with configurable expiration
- Memory logging throughout proxy chain
- Stream passthrough without buffering
- CORS enforcement
- Graceful error handling preserving stream integrity
- Environmental validation with Zod schema

---

## [0.2.0] - 2026-02-07

### Added
- **JWT Authentication** - Server-side token generation and injection for API requests
  - Implemented JWT secret management
  - Added configurable token expiration (default: 15m)
  - Secure credential storage (cannot be exposed to frontend)
- **Memory Logger Integration** - Memory usage tracking at proxy checkpoints
  - `proxy-start` - When forwarding request to API
  - `proxy-response` - When API response begins
  - `proxy-complete` - When response fully streamed (with peak summary)
- **Frontend Refactoring** - Architectural improvements
  - Separated concerns: routes, middleware, config, error handling
  - Aligned BFF structure with API's design patterns
  - Improved request logging and debugging
- **Documentation** - JWT Authentication documentation (jwt-authentication.md)
- **Testing** - JWT and authentication middleware unit tests in shared module

### Changed
- Environment validation now requires JWT_SECRET and JWT_EXPIRES_IN
- Export proxy now authenticates requests with generated JWT tokens
- Enhanced error handling strategy for stream preservation

---

## [0.1.0] - 2026-02-07

### Added
- **Initial BFF Setup** - Express-based Backend for Frontend service
  - HTTP server with graceful shutdown (10-second timeout)
  - Helmet.js security headers
  - CORS middleware with configurable origin policy
  - Environment validation with Zod schema
- **Streaming Proxy** - HTTP proxy middleware (`http-proxy-middleware`)
  - Proxies Excel exports without buffering
  - Automatic stream passthrough to browser
  - Path rewriting to map `/exports/*` to `/export/*` on API
- **Export Routes**
  - `GET /exports/report?rowCount=<number>` - Streaming Excel export
  - `GET /exports/report-buffered?rowCount=<number>` - Buffered Excel export
- **Error Handling**
  - Consistent error response format (mirroring API)
  - Status-code-only responses for proxy errors (preserves stream integrity)
  - 502 Bad Gateway for connection refused
  - 504 Gateway Timeout for request timeouts
- **Request Logging** - Debug logging for all requests and proxy operations
- **Project Structure**
  - `/src/app.js` - Express middleware stack
  - `/src/server.js` - HTTP server lifecycle and shutdown
  - `/src/config/env.js` - Environment validation
  - `/src/routes/exports.js` - Export endpoints
  - `/src/middlewares/exportProxy.js` - Streaming proxy factory
  - `/src/utils/errors.js` - Custom error classes

### Configuration
- `APP_PORT` - BFF server port (default: 3000)
- `API_HOST` - Backend API host (default: localhost)
- `API_PORT` - Backend API port (default: 3001)
- `NODE_ENV` - Environment mode (development|production|test, default: development)
- `CORS_ORIGIN` - Allowed frontend origin (default: http://localhost:3000)

---

## Architecture Notes

### Why a BFF?
- **Security** - Frontend cannot safely store JWT secrets; BFF generates tokens server-side
- **Request Flow** - Browser → BFF → API → Excel Stream → BFF → Browser
- **Isolation** - Decouples frontend concerns from backend API
- **Flexibility** - Single API gateway for potential multiple frontend clients

### Design Principles
1. **Stateless** - No persistent state; scales horizontally
2. **Stream-Aware** - Preserves streaming integrity; no buffering of Excel files
3. **Error-Safe** - Status-code-only responses during streams to prevent corruption
4. **Memory-Tracked** - Logs memory at key points for debugging and optimization
5. **Security-First** - JWT secrets protected, CORS enforced, headers hardened

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| express | ^5.2.1 | Web framework |
| http-proxy-middleware | ^3.0.5 | Streaming proxy |
| cors | ^2.8.6 | CORS middleware |
| helmet | ^8.1.0 | Security headers |
| zod | ^4.3.6 | Runtime validation |

---

## Migration Notes

### 0.2.0 → 0.3.0
No breaking changes. Update should be seamless.

### 0.1.0 → 0.2.0
**Breaking**: Requires JWT_SECRET environment variable
- Set `JWT_SECRET` to a string of at least 32 characters
- (Optional) Set `JWT_EXPIRES_IN` to customize token expiration (default: 15m)
- BFF will now generate and inject JWT tokens automatically

---

## Known Issues / Limitations

- BFF currently supports only read-only operations (GET, OPTIONS)
- No built-in caching (consider for future optimization)
- No request rate limiting (consider for production)
- CORS origin must be set per environment (no wildcard support by default)
