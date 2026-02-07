#!/usr/bin/env node
import autocannon from 'autocannon';
import process from 'node:process';
import console from 'node:console';

// Parse command-line arguments
const args = process.argv.slice(2);
const getArgValue = (argName, defaultValue) => {
  const index = args.indexOf(argName);
  return index !== -1 && args[index + 1] ? parseInt(args[index + 1]) : defaultValue;
};

const connections = getArgValue('--connections', 20);
const duration = getArgValue('--duration', 60);
const rowCount = getArgValue('--rowCount', 20_000);

console.log(`🧪 Starting Buffered Export Stress Test`);
console.log(`   URL: http://localhost:3001/export/report-buffered?rowCount=${rowCount}`);
console.log(`   Connections: ${connections}`);
console.log(`   Duration: ${duration}s`);
console.log(`   Row Count: ${rowCount.toLocaleString()}`);
console.log('');

const result = await autocannon({
  url: `http://localhost:3001/export/report-buffered?rowCount=${rowCount}`,
  connections,                    // Number of concurrent connections
  pipelining: 1,                  // Requests per connection
  duration,                       // Test duration in seconds
  timeout: 120,                   // Socket timeout (longer for large exports)
  setupClient: (client) => {
    client.on('error', (err) => {
      console.error('Client error:', err.message);
    });
  }
});

console.log('\n📊 Test Results:');
autocannon.printResult(result);

// Extract and display key metrics
const summary = {
  'Requests/sec': result.requests.average,
  'Throughput (MB/s)': (result.throughput.average / 1024 / 1024).toFixed(2),
  'Latency (p50)': `${result.latency.p50}ms`,
  'Latency (p99)': `${result.latency.p99}ms`,
  'Errors': result.errors,
  'Timeouts': result.timeouts
};

console.log('\n🎯 Key Metrics:');
Object.entries(summary).forEach(([key, value]) => {
  console.log(`   ${key}: ${value}`);
});
