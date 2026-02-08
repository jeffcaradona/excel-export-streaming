import mssql from "mssql";

import { setTimeout, clearTimeout } from "node:timers";
import { debugMSSQL } from "../../../shared/src/debug.js";
import { getEnv } from "../config/env.js";
import { DatabaseError } from "../utils/errors.js";

let isShuttingDown = false;
let pool = null;
let poolConnect = null;

// Create config lazily to ensure environment variables are loaded and validated
const getDbConfig = () => {
  const env = getEnv();
  return {
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    server: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    requestTimeout: 30000, // 30 second timeout for requests
    connectionTimeout: 15000, // 15 second timeout for initial connection
    options: {
      encrypt: false,
      trustServerCertificate: true,
    },
    pool: {
      max: 50,              // Increased from 10 to handle more concurrent requests
      min: 5,               // Keep 5 warm connections to reduce latency
      idleTimeoutMillis: 60000,  // Keep idle connections for 60 seconds
    },
  };
};

export const getConnectionPool = async () => {
  if (isShuttingDown) {
    throw new Error("Cannot get connection pool during shutdown");
  }

  if (!poolConnect) {
    // Only start connection once, even if called multiple times
    poolConnect = (async () => {
      try {
        debugMSSQL("Creating new connection pool");
        const dbConfig = getDbConfig();
        debugMSSQL(
          "Database config: server=%s, database=%s, user=%s",
          dbConfig.server,
          dbConfig.database,
          dbConfig.user
        );
        pool = new mssql.ConnectionPool(dbConfig);

        // Attach error event listeners for automatic recovery
        // NOTE: NOT async — event emitters discard returned Promises.
        // Using .catch() ensures rejections are always handled.
        pool.on("error", (err) => {
          debugMSSQL("Pool error event: %O", {
            message: err.message,
            code: err.code,
          });
          // Mark pool as unhealthy so next call will attempt reconnection
          if (err.code === "ESOCKET" || err.code === "ECONNRESET") {
            debugMSSQL("Fatal pool error detected: " + err.code + " - resetting pool");
            closeAndResetPool().catch((error_) => {
              debugMSSQL("Failed to reset pool after error: %O", { message: error_.message });
            });
          }
        });

        await pool.connect();
        debugMSSQL("Database connection pool created successfully");
        return pool;
      } catch (err) {
        debugMSSQL("Failed to create connection pool: %O", {
          message: err.message,
          code: err.code,
        });
        pool = null;
        poolConnect = null; // Reset to allow retry
        throw new DatabaseError(
          `Failed to connect to database: ${err.message}`,
          err
        );
      }
    })();
  }
  await poolConnect;
  
  // Validate pool is still connected
  if (!pool) {
    throw new DatabaseError("Connection pool is not available. Please try again.");
  }
  
  return pool;
};

/**
 * Safely close and reset the connection pool.
 * Ensures pool.close() completes before nullifying references.
 * This prevents connection leaks on fatal errors.
 */
export const closeAndResetPool = async () => {
  debugMSSQL('Closing and resetting connection pool');
  if (pool) {
    try {
      await pool.close();
      debugMSSQL('Pool closed successfully');
    } catch (err) {
      debugMSSQL(`Error closing pool during reset: ${err.message}`);
    }
  }
  pool = null;
  poolConnect = null;
};

/**
 * Close and reset the connection pool
 * Useful for graceful shutdown or restarting after errors
 */
export const closeConnectionPool = async () => {
  try {
    if (pool) {
      debugMSSQL("Closing connection pool");
      await pool.close();
      pool = null;
      debugMSSQL("Connection pool closed successfully");
    }
  } catch (err) {
    debugMSSQL("Error closing connection pool: %O", { message: err.message });
    // Don't rethrow - let pool cleanup continue
  } finally {
    poolConnect = null; // Always reset so next call will create new pool
  }
};

/**
 * Reset the connection pool (close and clear references)
 * Used to force recreation of the pool
 */
export const resetConnectionPool = async () => {
  await closeConnectionPool();
  debugMSSQL("Connection pool reset - ready for reconnection");
};

// Connection error codes that warrant pool reset
const CONNECTION_ERROR_CODES = new Set(["ESOCKET", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH"]);

/**
 * Execute a database query with automatic error handling and pool recovery
 * Handles connection errors and logs all database operations
 * @param {Function} queryFn - Async function that executes the query
 * @param {string} operationName - Name of the operation for logging
 * @returns {Promise} Result from queryFn
 */
export const executeQuery = async (queryFn, operationName = "Database operation") => {
  try {
    const result = await queryFn();
    debugMSSQL(`${operationName} completed successfully`);
    return result;
  } catch (err) {
    debugMSSQL(`${operationName} failed: %O`, {
      message: err.message,
      code: err.code,
      state: err.state,
    });
    
    // Reset pool on connection errors
    if (CONNECTION_ERROR_CODES.has(err.code)) {
      debugMSSQL("Connection error detected, resetting pool");
      await resetConnectionPool();
    }
    
    throw new DatabaseError(
      `${operationName} failed: ${err.message}`,
      err
    );
  }
};

/**
 * Check if the pool is connected and healthy
 */
export const isPoolHealthy = async () => {
  try {
    await initial_test();
    return true;
  } catch (err) {
    debugMSSQL("Pool health check failed: %O", { message: err.message });
    return false;
  }
};

export const initial_test = async (recQy = 1) => {
  // Validate input parameter upfront
  if (typeof recQy !== 'number' || recQy < 0) {
    throw new Error(`Invalid recQy parameter: must be a non-negative number, got ${recQy}`);
  }

  // Execute query with automatic error handling and logging
  return await executeQuery(async () => {
    const localPool = await getConnectionPool();
    const request = localPool.request().input("recQy", mssql.Int, recQy);
    
    const result = await request.query("SELECT [REC_QY] = @recQy;");
    return result.recordset;
  }, "initial_test");
};



export const testBadRecord = async () => {
 try {
    debugMSSQL("Database failure test starting");
    await initial_test(-1);
    debugMSSQL("Initial failure test failed ");
  } catch (err) {
    debugMSSQL("Initial database failure test passed: %O", {
      message: err.message,
      code: err.code,
    });
    throw err; // Rethrow so caller knows initialization failed
  } 

}


/**
 * Initialize the database connection and run initial test
 * Call this after dotenv is loaded but before the app serves requests
 */
export const initializeDatabase = async () => {
  try {
    debugMSSQL("Database initialization starting");
    await initial_test();
    debugMSSQL("Initial database test passed");
  } catch (err) {
    debugMSSQL("Initial database test failed: %O", {
      message: err.message,
      code: err.code,
    });
    throw err; // Rethrow so caller knows initialization failed
  }
};

/**
 * Gracefully close the connection pool, allowing active queries to complete
 * @param {number} drainTimeout - Maximum time (ms) to wait for pool to close
 */
export const gracefulShutdown = async (drainTimeout = 30000) => {
  if (isShuttingDown) {
    debugMSSQL("Graceful shutdown already in progress, skipping duplicate call");
    return;
  }
  isShuttingDown = true;
  try {
    if (pool) {
      debugMSSQL("Starting graceful shutdown of database pool...");
      
      // Use a timeout race to enforce maximum drain time
      const closePromise = pool.close();
      let drainTimer;
      const timeoutPromise = new Promise((resolve) => {
        drainTimer = setTimeout(() => {
          debugMSSQL(`Warning: Shutdown taking longer than ${drainTimeout}ms`);
          resolve();
        }, drainTimeout);
      });
      
      // Race: whichever completes first
      await Promise.race([closePromise, timeoutPromise]);
      clearTimeout(drainTimer);
      
      pool = null;
      debugMSSQL("Graceful shutdown completed");
    }
  } catch (err) {
    debugMSSQL("Error during graceful shutdown: %O", { message: err.message });
  } finally {
    poolConnect = null;
  }
};