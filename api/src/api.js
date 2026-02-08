import express from 'express';
import helmet from 'helmet';
import process from 'node:process';
import { debugAPI } from '../../shared/src/debug.js';
import exportRouter from './routes/export.js';

const app = express();

// Security middleware - sets various HTTP headers to protect against attacks
app.use(helmet());

// Parse JSON bodies (if needed for future endpoints)
app.use(express.json());

// Request logging middleware
app.use((req, _res, next) => {
  debugAPI(`${req.method} ${req.url}`);
  next();
});

// Mount routers
app.use('/export', exportRouter);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ 
    error: {
      message: 'Not found',
      code: 'NOT_FOUND'
    }
  });
});

// Global error handler - must be last
// Handles all errors thrown by route handlers and middleware
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  debugAPI("Error:", err);
  
  // Determine HTTP status code
  const statusCode = err.status || 500;
  
  // Don't expose error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  // Build error response (monomorphic shape)
  const errorResponse = {
    error: {
      message: isDevelopment ? err.message : 'Internal server error',
      code: err.code || 'INTERNAL_ERROR',
      stack: isDevelopment ? err.stack : undefined
    }
  };
  
  res.status(statusCode).json(errorResponse);
});

export default app;