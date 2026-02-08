/**
 * BFF HTTP server — startup, error handling, graceful shutdown.
 *
 * Mirrors the API server.js structure but is simpler:
 *   - No database initialization (BFF is a stateless proxy)
 *   - Shorter force-exit timeout (no DB drain to wait for)
 *   - Same environment validation → HTTP listen → shutdown flow
 */
import http from 'node:http';
import process from 'node:process';
import { setImmediate, setTimeout, clearTimeout } from 'node:timers';

import { debugServer } from '../../shared/src/debug.js';
import { normalizePort } from '../../shared/src/server.js';
import { getEnv } from './config/env.js';

import app from './app.js';

// ── Validate environment early ──────────────────────────────────────────────
let env;
try {
  env = getEnv();
  debugServer(`Environment validated: NODE_ENV=${env.NODE_ENV}, APP_PORT=${env.APP_PORT}`);
  debugServer(`Proxy target: http://${env.API_HOST}:${env.API_PORT}`);
} catch (err) {
  debugServer(`Failed to validate environment: ${err.message}`);
  setImmediate(() => process.exit(1));
}

// ── Create HTTP server ──────────────────────────────────────────────────────
const port = normalizePort(env.APP_PORT || '3000');
app.set('port', port);

const server = http.createServer(app);
server.on("error", onError);
server.on("listening", onListening);


server.listen(port);


// ── Error handler for listen failures ───────────────────────────────────────
function onError(error) {
  if (error.syscall !== 'listen') {
    throw error;
  }

  const bind = typeof port === 'string' ? `Pipe ${port}` : `Port ${port}`;

  switch (error.code) {
    case 'EACCES':
      debugServer(`${bind} requires elevated privileges`);
      setImmediate(() => process.exit(1));
      break;
    case 'EADDRINUSE':
      debugServer(`${bind} is already in use`);
      setImmediate(() => process.exit(1));
      break;
    default:
      throw error;
  }
}

// ── Listening handler ───────────────────────────────────────────────────────
function onListening() {
  const addr = server.address();
  const bind = typeof addr === 'string' ? `pipe ${addr}` : `port ${addr.port}`;
  const url = `http://localhost:${addr.port}`;
  debugServer(`Listening on ${bind}`);
  debugServer(`BFF is running at ${url}`);
}

// ── Graceful shutdown ───────────────────────────────────────────────────────
// Simpler than the API — no database connections to drain.
let isShuttingDown = false;
let forceExitTimer = null;

const gracefulShutdown = (signal) => {
  if (isShuttingDown) {
    debugServer(`Shutdown already in progress, ignoring additional ${signal} signal`);
    return;
  }
  isShuttingDown = true;

  debugServer(`Received ${signal}. Shutting down gracefully...`);

  // Force exit after 10 seconds — BFF is stateless, no long drain needed
  forceExitTimer = setTimeout(() => {
    debugServer('Could not close connections in time, forcefully shutting down');
    setImmediate(() => process.exit(1));
  }, 10_000);

  debugServer('Stopping HTTP server from accepting new connections...');
  server.close(() => {
    debugServer('HTTP server closed (all connections finished)');

    if (forceExitTimer) {
      clearTimeout(forceExitTimer);
    }

    process.exit(0);
  });
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
