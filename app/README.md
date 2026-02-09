# Excel Export Streaming BFF (Backend for Frontend)

Frontend-facing API gateway that proxies Excel export requests to the backend API service. Handles JWT token generation, CORS policy enforcement, and graceful error handling while streaming large file downloads.

## Overview

The BFF (Backend for Frontend) is a lightweight proxy service that sits between the client application and the Excel Export Streaming API. It provides:

- **API Gateway Pattern** - Single entry point for frontend clients
- **JWT Token Injection** - Generates and injects JWT tokens for API authentication
- **Stream Proxying** - Pipes large Excel file downloads without buffering
- **CORS Management** - Enforces origin policy for frontend requests
- **Error Isolation** - Prevents API errors from corrupting in-flight file streams

## Architecture

### Why a BFF?

The BFF solves a critical problem: **the frontend cannot safely store JWT secrets**. Instead of embedding API credentials in client code:

1. Frontend calls BFF (request → BFF)
2. BFF generates JWT token server-side (server-side secret)
3. BFF proxies request to API with JWT token (server → server)
4. API responds with Excel stream
5. BFF pipes response back to frontend (BFF → frontend)

This keeps the JWT secret secure on the server and prevents credential exposure.

### Request Flow

```
Browser
  ↓
GET /exports/report?rowCount=10000
  ↓
BFF (CORS validation, memory logging)
  ↓
Generate JWT token server-side
  ↓
Proxy to API → GET /export/report?rowCount=10000
  ↓
API (Authentication, streaming, Excel generation)
  ↓
Excel file stream
  ↓
BFF pipes to browser
  ↓
Browser downloads file
```

## Features

- **Stateless Proxy** - No persistent state, scales horizontally
- **Stream Passthrough** - Excel files streamed without buffering
- **Automatic JWT Generation** - Configurable token expiration
- **CORS Validation** - Restricts frontend origins
- **Memory Tracking** - Logs memory usage throughout proxy chain
- **Graceful Shutdown** - 10-second force-exit timeout for quick restarts
- **Debug Logging** - Detailed logs for troubleshooting

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file in the root of the project with required variables:

```env
# BFF Server Port (Optional)
APP_PORT=3000  # Defaults to 3000

# API Backend Configuration (Required)
API_HOST=localhost  # Defaults to localhost
API_PORT=3001       # Defaults to 3001

# Security & CORS (Optional)
NODE_ENV=development  # development|production|test
CORS_ORIGIN=http://localhost:3000  # Defaults to http://localhost:3000

# JWT Authentication (Required)
JWT_SECRET=your-secret-key-at-least-32-characters  # Must be at least 32 characters
JWT_EXPIRES_IN=15m  # Token expiration (defaults to 15m)
```

All environment variables are validated on startup using Zod schema. Missing required variables will cause the server to exit with a clear error message.

## Running the Server

**Development Mode** (with auto-reload):

```bash
npm run dev
```

**Production Mode**:

```bash
npm start
```

## API Endpoints

The BFF provides two export endpoints that proxy directly to the API service.

### GET `/exports/report?rowCount=<number>`

Streams an Excel file through the BFF to the browser.

**Query Parameters:**
- `rowCount` (optional, default: 30000, max: 1,048,576) - Number of rows to export

**Example Requests:**

```
GET /exports/report?rowCount=1000
GET /exports/report?rowCount=30000
GET /exports/report?rowCount=1000000
```

**Response:**
- Downloads an `.xlsx` file directly
- Filename format: `report-YYYY-MM-DD-HHmmss.xlsx`
- Content-Type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

**How it works:**
1. BFF receives request from frontend
2. Validates CORS origin
3. Generates JWT token server-side
4. Proxies request to API with JWT token
5. Pipes Excel stream back to browser (no buffering)

### GET `/exports/report-buffered?rowCount=<number>`

Non-streaming Excel export through the BFF.

**⚠️ Warning:** This endpoint loads entire result set into memory. Not recommended for large exports.

**Query Parameters:**
- `rowCount` (optional, default: 30000, max: 1,048,576) - Number of rows to export

**Memory Profile:** See [Performance Comparison](../documentation/tutorial/04-why-streaming-wins.md#memory-efficiency-the-critical-difference) for more information.

## Error Handling

The BFF handles two categories of errors:

### Proxy Errors

If the API is unreachable, the BFF returns a status code without a body to avoid corrupting the response stream (which may be partially sent).

**Status Codes:**
- `502 Bad Gateway` - API connection refused (API service down)
- `504 Gateway Timeout` - API request timeout

**Why status-code-only?** If streaming has started, sending a JSON body would corrupt the Excel file. The BFF preserves stream integrity by only sending a status code.

### API Errors

If the API returns an error (validation, database, etc.), the error is forwarded as-is:

```json
{
  "error": {
    "message": "User-friendly error message",
    "code": "ERROR_CODE",
    "stack": "... (development only)"
  }
}
```

**API Error Codes:**

| Code | Status | Meaning |
|------|--------|---------|
| `NOT_FOUND` | 404 | Endpoint does not exist |
| `UNAUTHORIZED` | 401 | Invalid/missing JWT token |
| `VALIDATION_ERROR` | 400 | Invalid query parameter |
| `DATABASE_ERROR` | 500 | Database error |
| `CONFIG_ERROR` | 500 | Missing/invalid environment configuration |
| `EXPORT_ERROR` | 500 | Excel generation failed |
| `INTERNAL_ERROR` | 500 | Unexpected error |

## Security

The BFF implements several security best practices:

- **JWT Token Injection** - Server-side token generation protects secret from frontend
- **Helmet.js** - Sets security HTTP headers
- **CORS Enforcement** - Only allowed origins can call the BFF
- **Limited HTTP Methods** - Only GET and OPTIONS allowed
- **Status-Code-Only Errors** - Prevents response corruption
- **Environment Validation** - All configuration validated at startup with Zod

## Development

### Project Structure

```
app/
├── src/
│   ├── app.js                    # Express app + middleware stack
│   ├── server.js                 # HTTP server + startup/shutdown
│   ├── config/
│   │   └── env.js               # Environment validation (Zod)
│   ├── routes/
│   │   └── exports.js           # Route definitions
│   ├── middlewares/
│   │   └── exportProxy.js       # Streaming proxy factory
│   ├── utils/
│   │   └── errors.js            # Custom error classes
│   ├── controllers/             # (Placeholder for future endpoints)
│   └── models/                  # (Placeholder)
└── tests/                       # (Placeholder for test suite)
```

### Key Design Patterns

**Separation of Concerns:**
- `routes/exports.js` - Route mapping (what path → what API endpoint)
- `middlewares/exportProxy.js` - Proxy mechanics (how the proxy works)
- `app.js` - Global middleware stack (security, CORS, logging)
- `server.js` - HTTP lifecycle and graceful shutdown

**Stream Passthrough:**
The BFF uses `http-proxy-middleware` with `selfHandleResponse: false` to automatically pipe responses without buffering. This allows efficient streaming of large Excel files.

**Error Handling Strategy:**
When a proxy error occurs, the BFF checks if headers have been sent. If they have, it immediately ends the response to avoid corrupting the stream. If not, it sends a status-code-only response.

### Debugging

Enable debug logging:

```bash
$env:DEBUG='excel-export-streaming:*'
npm start
```

This shows detailed logs for:
- `excel-export-streaming:application` - BFF request/response handling
- `excel-export-streaming:server` - Server startup and shutdown

### Dependencies

- **express** (^5.2.1) - Web framework
- **http-proxy-middleware** (^3.0.5) - Streaming proxy middleware
- **cors** (^2.8.6) - CORS middleware
- **helmet** (^8.1.0) - Security HTTP headers
- **zod** (^4.3.6) - Runtime type validation

## Troubleshooting

### Port Already in Use

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

### API Connection Failed

Verify the API is running and environment variables are correct:

```bash
echo $env:API_HOST
echo $env:API_PORT
```

Test the API directly:
```powershell
Invoke-WebRequest http://localhost:3001/health
```

### JWT Secret Issues

Make sure `JWT_SECRET` is at least 32 characters and matches the API's secret:

```bash
echo $env:JWT_SECRET | Measure-Object -Character
```

### CORS Rejection

If the frontend can't reach the BFF, verify CORS is configured correctly:

```bash
echo $env:CORS_ORIGIN
# Should match your frontend's origin (e.g., http://localhost:3000)
```

### Memory Tracking

The BFF logs memory usage at key points:
- `proxy-start` - When proxying request to API
- `proxy-response` - When API response starts
- `proxy-complete` - When response fully piped (with peak memory summary)

Check logs with:
```bash
$env:DEBUG='excel-export-streaming:memory'
npm start
```

## Testing

Test streaming export through the BFF:

```powershell
Invoke-WebRequest http://localhost:3000/exports/report?rowCount=100 -OutFile export.xlsx
```

Test buffered export:

```powershell
Invoke-WebRequest http://localhost:3000/exports/report-buffered?rowCount=100 -OutFile export-buffered.xlsx
```

## License

See LICENSE file in root directory