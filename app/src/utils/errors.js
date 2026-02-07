/**
 * Custom error classes for consistent error handling across the BFF service.
 *
 * Mirrors API error hierarchy but omits database/export-specific errors
 * that don't apply to the proxy layer.
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
 * Environment configuration error — thrown during startup validation
 */
export class ConfigurationError extends AppError {
  constructor(message) {
    super(message, 500, 'CONFIG_ERROR');
    this.name = 'ConfigurationError';
  }
}

/**
 * Upstream proxy error — API unreachable or timed out
 */
export class ProxyError extends AppError {
  constructor(message, status = 502, code = 'PROXY_ERROR') {
    super(message, status, code);
    this.name = 'ProxyError';
  }
}
