# Excel Export Streaming

**Memory-efficient Excel exports for Node.js applications**

Stream large Excel files (1M+ rows) directly from your database to the browser with **constant memory usage** (~80 MB), regardless of dataset size.

## Why This Project?

Traditional Excel export approaches load entire datasets into memory, causing:
- **OutOfMemoryError** crashes on large exports (100k+ rows)
- **Linear memory growth** ($O(n)$) with dataset size
- **Concurrency limits** (3-5 users max before OOM)
- **High cloud costs** (need 32-64 GB RAM for production)

**This project solves it** with streaming architecture:
- **Constant memory** (~80 MB for any export size)
- **Unlimited dataset size** (tested with 1M+ rows)
- **High concurrency** (50+ simultaneous users)
- **98% cost savings** ($15/month vs $736/month)

## Quick Start

```bash
# Install dependencies
npm install

# Start API service (port 3001)
cd api && npm run dev

# Start BFF service (port 3000)
cd app && npm run dev

# Test export
curl "http://localhost:3000/exports/report?rowCount=10000" -o test.xlsx
```

## 📚 Tutorial

**New to streaming?** Start here:

👉 **[Complete Tutorial Series](documentation/tutorial/README.md)** 👈

**4-part comprehensive guide (2-2.5 hours):**

1. **[The Memory Problem](documentation/tutorial/01-the-memory-problem.md)** - Why traditional approaches fail at scale
2. **[Streams and Node.js Design](documentation/tutorial/02-streams-and-node-design.md)** - Understanding streaming fundamentals  
3. **[Architecture Dissected](documentation/tutorial/03-architecture-dissected.md)** - Step-by-step implementation walkthrough
4. **[Why Streaming Wins](documentation/tutorial/04-why-streaming-wins.md)** - Real benchmarks and performance comparison

**Target Audience:** Node.js developers with 1-2 years experience building REST APIs

## Key Features

- ✅ **Memory-Efficient Streaming** - Constant memory footprint regardless of export size
- ✅ **Database to Browser** - Direct streaming from MSSQL → ExcelJS → HTTP response
- ✅ **Production-Ready** - Error handling, client disconnect detection, connection pooling
- ✅ **Performance Monitoring** - Real-time memory tracking and metrics logging
- ✅ **BFF Architecture** - Proxy layer for CORS, authentication, rate limiting
- ✅ **Type-Safe Configuration** - Zod schema validation for environment variables
- ✅ **Stress Tested** - Validated with 50 concurrent users and 1M+ row exports

## Performance

### Memory Comparison

| Row Count | Streaming | Buffered | Difference |
|-----------|-----------|----------|------------|
| 10,000    | 52 MB     | 83 MB    | 1.6x       |
| 100,000   | 68 MB     | 487 MB   | **7x**     |
| 1,000,000 | 79 MB     | ~5 GB    | **63x**    |

### Concurrent Users (20k row exports)

| Scenario | Streaming | Buffered | Winner |
|----------|-----------|----------|--------|
| 5 users  | 3.84 req/sec | 0.92 req/sec | **Streaming (4.17x)** |
| 50 users | Stable | OOM Crash | **Streaming** |

**Light Load Test** (5 connections, 60 seconds, 20k rows):
- Streaming: **9.45 MB/s throughput, 1293ms median latency**
- Buffered: **2.02 MB/s throughput, 5242ms median latency**
- Verdict: Streaming is **4-5x faster** ⚡

See [Complete Performance Analysis](documentation/tutorial/04-why-streaming-wins.md) for detailed benchmarks.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          STREAMING EXCEL EXPORT                             │
└─────────────────────────────────────────────────────────────────────────────┘

USER BROWSER
    │ GET /exports/report?rowCount=100000
    ↓
┌─────────────────────────────────────┐
│  BFF SERVICE (Port 3000)            │  Express + HTTP Proxy Middleware
│  └─ Streams response (no buffering) │  [app/]
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  API SERVICE (Port 3001)            │  Express + MSSQL + ExcelJS
│  ├─ Export Controller               │  [api/src/controllers/]
│  ├─ Connection Pool                 │  [api/src/services/]
│  └─ Memory Monitoring               │  [shared/src/]
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│  MSSQL SERVER                       │  Stored procedure: spGenerateData
│  └─ Emits rows one at a time        │  [mssql/DB/]
└─────────────────────────────────────┘
```

**Key Principle:** Data flows through the system without accumulation

## Project Structure

```
excel-export-streaming/
├── api/                      # Backend data service (Port 3001)
│   ├── src/
│   │   ├── controllers/      # Export handlers (streaming + buffered)
│   │   ├── services/         # Database connection pool
│   │   ├── routes/           # API endpoints
│   │   ├── utils/            # Column mapping, errors, filenames
│   │   └── config/           # Environment validation
│   └── tests/                # Unit + integration tests
├── app/                      # Frontend BFF service (Port 3000)
│   ├── src/
│   │   ├── middlewares/      # Export proxy (streaming)
│   │   └── routes/           # BFF endpoints
│   └── tests/
├── shared/                   # Common utilities
│   └── src/
│       ├── memory.js         # Memory monitoring
│       ├── debug.js          # Debug logging
│       └── server.js         # Server utilities
├── mssql/                    # Database setup
│   └── DB/
│       └── spGenerateData.sql  # Stored procedure
├── documentation/
│   ├── tutorial/             # 📚 Complete tutorial series
│   ├── STRESS-TEST.md        # Performance testing guide
│   └── *.md                  # Planning docs
└── stress-test.js            # Autocannon stress test
```

## API Endpoints

### GET `/exports/report?rowCount=<number>`

Streaming Excel export (recommended)

- **Memory:** Constant ~80 MB regardless of row count
- **Max rows:** Unlimited (tested 1M+)
- **Time to first byte:** 50-100ms

### GET `/exports/report-buffered?rowCount=<number>`

Buffered Excel export (for comparison)

- **Memory:** Linear with row count (~500 MB for 100k rows)
- **Max rows:** ~100,000 before OOM risk
- **Time to first byte:** 2-10 seconds

### GET `/health`

Health check endpoint

## Configuration

Create `.env` file:

```env
# Database (Required)
DB_USER=sa
DB_PASSWORD=YourPassword
DB_HOST=localhost
DB_NAME=YourDatabase
DB_PORT=1433

# Services (Optional)
API_PORT=3001
APP_PORT=3000
NODE_ENV=development
```

See [api/README.md](api/README.md) for complete configuration details.

## Running Tests

```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# Stress tests
npm run stress-test
npm run stress-test:light    # 5 connections, 15s
npm run stress-test:heavy    # 50 connections, 60s
```

See [STRESS-TEST.md](documentation/STRESS-TEST.md) for detailed testing guide.

## Documentation

### Getting Started
- **[Tutorial Series](documentation/tutorial/README.md)** - Complete learning path (start here!)
- [API Documentation](api/README.md) - API endpoints and configuration
- [App Documentation](app/README.md) - BFF service details

### Technical Deep Dives
- [Architecture Dissected](documentation/tutorial/03-architecture-dissected.md) - Implementation walkthrough
- [Implementation Plan](documentation/implementation-plan.md) - Design decisions
- [Excel Export Sequence Diagram](documentation/excel-export-sequence-diagram.md) - Visual flow

### Performance & Testing
- [Why Streaming Wins](documentation/tutorial/04-why-streaming-wins.md) - Benchmarks and comparisons
- [Stress Test Guide](documentation/STRESS-TEST.md) - Performance testing
- [Quality Review](documentation/quality-review.md) - Code quality audit

## Real-World Use Cases

This architecture is ideal for:

- 📊 **Business Intelligence Reports** - Large dataset exports for analysis
- 📈 **Data Exports** - Full database table dumps for backup/migration
- 🏦 **Financial Reports** - Transaction history, account statements
- 📦 **Inventory Exports** - Complete product catalogs
- 👥 **User Data Exports** - GDPR compliance, data portability
- 📅 **Historical Data** - Time-series data, audit logs

**Production-tested** with 1M+ row exports and 50+ concurrent users.

## Technology Stack

- **Runtime:** Node.js 22+
- **Framework:** Express.js
- **Database:** MSSQL Server (pattern applies to PostgreSQL, MySQL, MongoDB)
- **Excel Generation:** ExcelJS (streaming mode)
- **Proxy:** http-proxy-middleware
- **Testing:** Node.js test runner, Autocannon
- **Validation:** Zod
- **Security:** Helmet.js

## Contributing

Contributions welcome! Areas of interest:

- Additional database adapters (PostgreSQL, MySQL, MongoDB)
- Additional export formats (CSV, JSON streaming)
- Performance optimizations
- Documentation improvements

## License

MIT

## Acknowledgments

Built to demonstrate memory-efficient streaming patterns in Node.js for real-world production scenarios.

**Key Insight:** Data should flow, not accumulate.

---

**Ready to learn?** 👉 **[Start the Tutorial](documentation/tutorial/README.md)** 👈


