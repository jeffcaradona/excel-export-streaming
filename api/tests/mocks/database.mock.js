/**
 * Mock database error objects for testing
 * Provides realistic MSSQL and custom error scenarios
 */

import { ExportError } from '../../src/utils/errors.js';

class DatabaseMock {
  /**
   * Create a mock MSSQL connection error
   * @param {string} message - Error message
   * @returns {Error} Connection error
   */
  static connectionError(message = 'Connection failed') {
    const err = new Error(message);
    err.code = 'ESOCKET';
    err.connectionFailed = true;
    return err;
  }

  /**
   * Create a mock MSSQL timeout error
   * @param {string} message - Error message
   * @returns {Error} Timeout error
   */
  static timeoutError(message = 'Request timeout') {
    const err = new Error(message);
    err.code = 'ETIMEDOUT';
    err.timeout = true;
    return err;
  }

  /**
   * Create a mock MSSQL authorization error
   * @param {string} message - Error message
   * @returns {Error} Auth error
   */
  static authError(message = 'Login failed for user') {
    const err = new Error(message);
    err.code = 'ELOGIN';
    return err;
  }

  /**
   * Create a mock MSSQL query error (column not found, syntax, etc)
   * @param {string} message - Error message
   * @returns {Error} Query error
   */
  static queryError(message = 'Column does not exist') {
    const err = new Error(message);
    err.code = 'EREQUEST';
    err.lineNumber = 1;
    return err;
  }



  /**
   * Create an ExportError (from errors.js)
   * @param {string} message - Error message
   * @param {string} code - Error code
   * @returns {ExportError} Export error
   */
  static exportError(message = 'Export failed', code = 'EXPORT_ERROR') {
    return new ExportError(message, code);
  }

  /**
   * Create a socket/network error (simulates socket close during streaming)
   * @returns {Error} Socket error
   */
  static socketError() {
    const err = new Error('write ECONNRESET');
    err.code = 'ECONNRESET';
    err.syscall = 'write';
    return err;
  }

  /**
   * Create a pipe error (downstream consumer closed connection)
   * @returns {Error} Pipe error
   */
  static pipeError() {
    const err = new Error('write EPIPE');
    err.code = 'EPIPE';
    err.syscall = 'write';
    return err;
  }
}

export default DatabaseMock;
