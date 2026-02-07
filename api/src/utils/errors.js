/**
 * Custom error classes for consistent error handling across the application
 */

/**
 * Base application error with HTTP status code
 */
export class AppError extends Error {
  constructor(message, status = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Validation error for invalid input parameters
 */
export class ValidationError extends AppError {
  constructor(message, code = 'VALIDATION_ERROR') {
    super(message, 400, code);
    this.name = 'ValidationError';
  }
}

/**
 * Database connection or query error
 */
export class DatabaseError extends AppError {
  constructor(message, originalError = null) {
    super(message, 500, 'DATABASE_ERROR');
    this.name = 'DatabaseError';
    this.originalError = originalError;
  }
}

/**
 * Environment configuration error
 */
export class ConfigurationError extends AppError {
  constructor(message) {
    super(message, 500, 'CONFIG_ERROR');
    this.name = 'ConfigurationError';
  }
}

/**
 * Excel export specific error
 */
export class ExportError extends AppError {
  constructor(message, code = 'EXPORT_ERROR') {
    super(message, 500, code);
    this.name = 'ExportError';
  }
}
