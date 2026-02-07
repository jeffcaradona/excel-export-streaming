# Stress Test Guide for Excel Export Streaming

This directory contains stress testing tools for the Excel export streaming API using `autocannon`.

## Prerequisites

1. **Start the API server** in one terminal:
   ```bash
   npm run dev:api
   ```
   The server should be running on `http://localhost:3001`

2. **Ensure the database is populated** with test data:
   - Run the stored procedures in `/mssql/spGenerateData.sql` if not already done

## Running Stress Tests

### Basic Test (10 concurrent users, 30 seconds)
```bash
npm run stress-test
```

### Light Load (5 concurrent users, 15 seconds)
```bash
npm run stress-test:light
```

### Heavy Load (50 concurrent users, 60 seconds)
```bash
npm run stress-test:heavy
```

### Custom Configuration
```bash
node stress-test.js --connections 25 --duration 45 --rowCount 524288
```

**Parameters:**
- `--connections`: Number of concurrent connections (default: 10)
- `--duration`: Test duration in seconds (default: 30)
- `--rowCount`: Number of rows to export (default: 1048576)

## Understanding Results

The stress test provides key metrics:

- **Requests/sec**: Average throughput
- **Throughput (MB/s)**: Average data throughput in megabytes per second
- **Latency (p50)**: 50th percentile response time
- **Latency (p99)**: 99th percentile response time
- **Errors**: Number of failed requests
- **Timeouts**: Number of timed-out requests

## Test Scenarios

### 1. Baseline Performance (Single User)
```bash
node stress-test.js --connections 1 --duration 30 --rowCount 1048576
```
Establishes baseline performance metrics with no concurrency.

### 2. Normal Load
```bash
node stress-test.js --connections 10 --duration 60 --rowCount 1048576
```
Simulates 10 simultaneous users pulling large exports.

### 3. Peak Load
```bash
node stress-test.js --connections 50 --duration 60 --rowCount 1048576
```
Simulates peak usage with 50 concurrent users.

### 4. Sustained Load
```bash
npm run stress-test:heavy
```
Tests system stability over an extended period (60 seconds, 50 connections).

### 5. Small Dataset
```bash
node stress-test.js --connections 20 --duration 30 --rowCount 102400
```
Tests performance with smaller exports (100K rows).

## Tips for Best Results

1. **Monitor system resources** during the test:
   - CPU usage
   - Memory consumption
   - Network I/O
   - Database connection pool

2. **Run tests in isolation** - don't run multiple tests simultaneously

3. **Increase timeout gradually** if you see timeouts:
   - Start with 120s (current default)
   - Increase to 180s if needed

4. **Test different row counts** to understand performance curves:
   - 102,400 rows (100K)
   - 1,048,576 rows (1M) 
   - 10,485,760 rows (10M)

5. **Repeat tests** for consistency - run each scenario 2-3 times

## Interpreting Load Test Results

### Expected Performance Indicators

| Scenario | Connections | Duration | Expected Behavior |
|----------|------------|----------|-------------------|
| Baseline | 1 | 30s | Establish baseline latency |
| Normal | 10 | 60s | Verify sustained throughput |
| Peak | 50 | 60s | Check for bottlenecks |
| Spike | 100+ | 30s | Test maximum capacity |

### Red Flags to Watch

- **High Error Rate**: More than 0.1% errors indicates stability issues
- **Increasing Latency**: p99 latency > p50 by more than 5x suggests queueing
- **Timeouts**: Any timeouts indicate insufficient resources or slow queries
- **Memory Creep**: Memory usage should stabilize, not continuously grow

## Troubleshooting

### Port Already in Use
```bash
# Kill existing process on port 3001
Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | 
  Select-Object OwningProcess | 
  Get-Unique | 
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

### Connection Refused
Ensure the API server is running:
```bash
npm run dev:api
```

### High Latency / Timeouts
- Check database performance
- Verify connection pool settings
- Check available system memory
- Review application logs for errors

## Example Test Output

```
🧪 Starting Stress Test
   URL: http://localhost:3001/export/report?rowCount=1048576
   Connections: 10
   Duration: 30s
   Row Count: 1,048,576

📊 Test Results:
[autocannon results...]

🎯 Key Metrics:
   Requests/sec: 0.45
   Throughput (MB/s): 45.23
   Latency (p50): 2150ms
   Latency (p99): 8540ms
   Errors: 0
   Timeouts: 0
```

## Advanced: Custom Test Scenarios

Create a new test file for specialized scenarios:

```javascript
import autocannon from 'autocannon';

// Custom test with specific request body or headers
const result = await autocannon({
  url: 'http://localhost:3001/export/report?rowCount=1048576',
  connections: 10,
  duration: 30,
  headers: {
    'User-Agent': 'Stress-Test-Client/1.0'
  }
});

autocannon.printResult(result);
```
