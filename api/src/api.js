import express from 'express';
import process from 'node:process';
import { debugApplication } from '../../shared/src/debug.js';
import exportRouter from './routes/export.js';

const app = express();

// Parse JSON bodies (if needed for future endpoints)
app.use(express.json());

// Log all requests
app.use((req, _res, next) => {
  debugApplication(`${req.method} ${req.url}`);
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
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, _req, res, next) => {
  debugApplication('Error:', err);
  
  // Don't expose error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(err.status || 500).json({
    error: isDevelopment ? err.message : 'Internal server error',
    ...(isDevelopment && { stack: err.stack })
  });
});

export default app;