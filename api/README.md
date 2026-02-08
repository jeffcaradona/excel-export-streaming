# Excel Export Streaming API

High-performance REST API for streaming large Excel exports directly from MSSQL Server to the browser. Uses memory-efficient streaming to handle exports with minimal resource consumption.

## Features

- **Memory-Efficient Streaming** - Stream rows directly from database → Excel → HTTP response with constant memory footprint
- **JWT Authentication** - Secure endpoints with JWT token validation
- **Secure by Default** - Helmet.js security headers, input validation, filename sanitization, environment validation
- **Type-Safe Configuration** - Zod schema validation for all environment variables
- **Structured Error Handling** - Consistent JSON error responses with error codes and (optionally) stack traces
- **Connection Pooling** - Automatic MSSQL connection pool management with recovery
- **Performance Monitoring** - Memory usage tracking and logging throughout export process
- **Client Disconnect Handling** - Gracefully cancels database queries when browser disconnects

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file in the root of the project with required variables:

```env
# Database Configuration (Required)
DB_USER=sa
DB_PASSWORD=YourStrongPassword
DB_HOST=localhost
DB_NAME=YourDatabaseName
DB_PORT=1433  # Optional, defaults to 1433

# API Configuration (Optional)
API_PORT=3001  # Defaults to 3001
NODE_ENV=development  # development|production|test
CORS_ORIGIN=http://localhost:3000  # Defaults to http://localhost:3000

# Authentication (Required)
JWT_SECRET=your-secret-key-at-least-32-characters  # Must be at least 32 characters
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

### GET `/health`

Health check endpoint to verify the API is running and responsive. **Does not require authentication.**

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2026-02-07T18:31:55.895Z"
}
```

### GET `/export/report?rowCount=<number>`

Streams an Excel file directly from the database. Uses memory-efficient streaming - no data is buffered in memory.

**Authentication:** Requires valid JWT token in `Authorization` header.

```
Authorization: Bearer <jwt-token>
```

**Query Parameters:**
- `rowCount` (optional, default: 30000, max: 1,048,576) - Number of rows to export

**Example Requests:**

```
GET /export/report?rowCount=1000
GET /export/report?rowCount=30000  # Default
GET /export/report?rowCount=1000000  # Large export
```

**Response:**
- Downloads an `.xlsx` file directly
- Filename format: `report-YYYY-MM-DD-HHmmss.xlsx`
- Content-Type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

**Notes:**
- Memory usage remains constant regardless of row count (true streaming)
- Suitable for exports with 30k+ rows
- If client disconnects mid-export, database query is automatically cancelled

### GET `/export/report-buffered?rowCount=<number>`

Non-streaming Excel export that loads all data into memory first. Useful for testing or small datasets.

**⚠️ Warning:** This endpoint loads entire result set into memory. Not recommended for large exports (see memory profile below).

**Authentication:** Requires valid JWT token in `Authorization` header.

```
Authorization: Bearer <jwt-token>
```

**Query Parameters:**
- `rowCount` (optional, default: 30000, max: 1,048,576) - Number of rows to export

**Memory Profile:** See [Performance Analysis](../documentation/tutorial/04-why-streaming-wins.md#memory-efficiency-the-critical-difference) for detailed benchmarks.

## Error Handling

All errors are returned as JSON with consistent structure:

```json
{
  "error": {
    "message": "User-friendly error message",
    "code": "ERROR_CODE",
    "stack": "... (development only)"
  }
}
```

**Error Codes:**

| Code | Status | Meaning |
|------|--------|---------|
| `NOT_FOUND` | 404 | Endpoint does not exist |
| `UNAUTHORIZED` | 401 | Missing or invalid JWT token |
| `VALIDATION_ERROR` | 400 | Invalid query parameter |
| `DATABASE_ERROR` | 500 | Database connection or query failed |
| `CONFIG_ERROR` | 500 | Missing/invalid environment configuration |
| `EXPORT_ERROR` | 500 | Excel file generation failed |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## Security

The API implements several security best practices:

- **JWT Authentication** - All export endpoints require valid JWT token
- **Helmet.js** - Sets security HTTP headers (CSP, HSTS, X-Frame-Options, etc.)
- **Input Validation** - Query parameters validated with type coercion and bounds checking
- **Filename Sanitization** - Exported filenames sanitized to prevent path traversal attacks
- **Environment Validation** - All configuration validated at startup with Zod schema
- **Error Hiding** - Error stack traces only exposed in development mode
- **Connection Pool Management** - Automatic recovery from database connection failures

## Performance Characteristics

### Streaming Export (`/export/report`)

**Memory Footprint:** Constant, ~50-80MB regardless of row count

**Real-World Stress Test Results** (light load: 5 concurrent users, 20k rows each):
- Requests/sec: **3.84** ⚡
- Throughput: **9.45 MB/s** ⚡
- Latency (p50): **1293ms**
- Latency (p99): **2269ms**
- Errors: **0**

**Performance Benchmarks:**
```
Time to first byte: 50-100ms
Throughput: ~500-1000 rows/second
10k rows: 10-20 seconds
100k rows: 100-200 seconds
1M rows: 10-20 minutes
```

**Scalability:** Handles 50+ concurrent users without degradation

### Buffered Export (`/export/report-buffered`)

**Memory Footprint:** Grows linearly with row count

**Real-World Stress Test Results** (light load: 5 concurrent users, 20k rows each):
- Requests/sec: **0.92** (4.17x slower)
- Throughput: **2.02 MB/s** (4.68x slower)
- Latency (p50): **5242ms**
- Latency (p99): **5502ms**
- Errors: **0**

**Memory Profile:**
- 10k rows: 20-50MB
- 50k rows: 100-250MB
- 100k rows: 200-500MB+
- 500k rows: 1-2.5GB (likely OOM)

**Limits:** Crashes at ~50+ concurrent users due to memory exhaustion

See [Complete Performance Analysis](../documentation/tutorial/04-why-streaming-wins.md) for detailed comparison.

## Development

### Project Structure

```
api/
├── src/
│   ├── api.js                    # Express app setup + middleware
│   ├── server.js                 # HTTP server + startup logic
│   ├── config/
│   │   └── env.js               # Environment validation (Zod)
│   │   └── export.js            # Export configuration + validation
│   ├── controllers/
│   │   └── exportController.js  # Streaming & buffered export handlers
│   ├── services/
│   │   └── mssql.js            # Database connection pool management
│   ├── routes/
│   │   └── export.js           # Route definitions
│   ├── utils/
│   │   ├── errors.js           # Custom error classes
│   │   ├── columnMapper.js    # Database column → Excel mapping
│   │   └── filename.js        # Timestamped filename generation
│   └── middlewares/            # (Placeholder for future middleware)
└── tests/
    ├── controllers/             # Unit, integration, and smoke tests
    │   ├── exportController.test.js
    │   ├── exportController.integration.test.js
    │   └── exportController.smoke.test.js
    └── mocks/                   # Test mocks for database and responses
```

### Debugging

Enable debug logging:

```bash
$env:DEBUG='excel-export-streaming:*'
npm start
```

This shows detailed logs for:
- `excel-export-streaming:application` - Express app events
- `excel-export-streaming:server` - Server startup and shutdown
- `excel-export-streaming:mssql` - Database operations

### Dependencies

- **express** (^5.2.1) - Web framework
- **exceljs** (^4.4.0) - Excel file generation
- **mssql** (^12.2.0) - MSSQL Server driver
- **helmet** (^8.1.0) - Security HTTP headers
- **zod** (^4.3.6) - Runtime type validation
- **dotenv** (^17.2.4) - Environment variable loading

## Troubleshooting

### Port Already in Use

```powershell
Get-NetTCPConnection -LocalPort 3001 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

### Database Connection Failed

Verify environment variables in `.env`:
```bash
echo $env:DB_USER
echo $env:DB_HOST
echo $env:DB_NAME
```

### Memory Issues During Large Exports

Use the streaming endpoint (`/export/report`) instead of buffered. Streaming uses constant memory regardless of row count.

## Testing

Export 100 rows (requires valid JWT token):
```powershell
$token = "your-jwt-token"
$headers = @{ Authorization = "Bearer $token" }
Invoke-WebRequest http://localhost:3001/export/report?rowCount=100 -Headers $headers -OutFile export.xlsx
```

Check health (no authentication required):
```powershell
Invoke-WebRequest http://localhost:3001/health | Select-Object StatusCode
```

## License

See LICENSE file in root directory