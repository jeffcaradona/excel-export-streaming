import http from "node:http";
import process from "node:process";
import { setImmediate, setTimeout, clearTimeout } from "node:timers";

import { debugServer } from "../../shared/src/debug.js";
import { normalizePort } from "../../shared/src/server.js";

import { initializeDatabase, gracefulShutdown as gracefulDatabaseShutdown } from "./services/mssql.js";

import app from "./api.js";

// Create HTTP server. API_PORT is defined in .env
/**
 * Get port from environment and store in Express.
 */

const port = normalizePort(process.env.API_PORT || "3000");
app.set("port", port);

/**
 * Create HTTP server.
 */
// snyk:skip=Cleartext Transmission
const server = http.createServer(app);

// Initialize database and start server
try {
  await initializeDatabase();
  debugServer("Database initialized successfully");

  // Only start listening after DB is ready
  server.listen(port);
} catch (err) {
  debugServer("Failed to initialize database:", err);
  debugServer("Exiting due to database initialization failure");
  // Use setImmediate to allow error to be logged before exit
  setImmediate(() => process.exit(1));
}
server.on("error", onError);
server.on("listening", onListening);


function onError(error) {
  if (error.syscall !== "listen") {
    throw error;
  }

  const bind = typeof port === "string" ? "Pipe " + port : "Port " + port;

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case "EACCES":
      debugServer(bind + " requires elevated privileges");
      setImmediate(() => process.exit(1));
      break;
    case "EADDRINUSE":
      debugServer(bind + " is already in use");
      setImmediate(() => process.exit(1));
      break;
    default:
      throw error;
  }
}

/**
 * Event listener for HTTP server "listening" event.
 */

function onListening() {
  const addr = server.address();
  const bind = typeof addr === "string" ? "pipe " + addr : "port " + addr.port;
  const url = `http://localhost:${addr.port}`;
  debugServer("Listening on " + bind);
  debugServer(`Server is running at ${url}`);
}

// Graceful shutdown
let isShuttingDown = false;
let forceExitTimer = null;

const gracefulShutdown = async (signal) => {
  if (isShuttingDown) {
    debugServer(
      `Shutdown already in progress, ignoring additional ${signal} signal`,
    );
    return;
  }
  isShuttingDown = true;

  debugServer(`Received ${signal}. Shutting down gracefully...`);

  // Force exit after 40 seconds if graceful shutdown hangs
  forceExitTimer = setTimeout(() => {
    debugServer(
      "Could not close connections in time, forcefully shutting down",
    );
    setImmediate(() => process.exit(1));
  }, 40000); // 30s drain + 10s buffer

  // Stop accepting new connections
  debugServer("Stopping HTTP server from accepting new connections...");
  server.close(async () => {
    debugServer(
      "HTTP server closed (all connections finished), waiting for active queries to complete...",
    );

    try {
      // Give active database queries time to complete (30 seconds drain)
      await gracefulDatabaseShutdown(30000);
      debugServer("Database connections closed successfully.");

      // Clear force-exit timer since we succeeded
      if (forceExitTimer) {
        clearTimeout(forceExitTimer);
      }

      process.exit(0);
    } catch (err) {
      debugServer("Error closing database connections:", err);
      process.exit(1);
    }
  });
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));