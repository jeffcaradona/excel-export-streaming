/**
 * Mock mssql Request object for testing
 * Supports both EventEmitter-based and toReadableStream()-based patterns
 */

import sinon from 'sinon';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

class StreamRequestMock {
  /**
   * Create a stubbed mssql Request object
   * @returns {Object} Request mock extending EventEmitter
   */
  static stub() {
    const request = new EventEmitter();

    // Execute method (returns promise by default, can be overridden)
    request.execute = sinon.stub().resolves();

    // Cancel method to prevent orphaned queries
    request.cancel = sinon.stub();

    // Input method for setting parameters
    request.input = sinon.stub().returnsThis();

    // Output array for stored procedure results
    request.output = [];

    // toReadableStream() returns a Node.js Readable in object mode
    // Mirrors the real mssql request.toReadableStream() behavior
    request.toReadableStream = sinon.stub().callsFake(() => {
      const readable = new Readable({
        objectMode: true,
        read() {} // No-op; data is pushed externally via emulateRows/emulateDone
      });
      request._readableStream = readable;
      return readable;
    });

    return request;
  }

  /**
   * Push rows into the readable stream created by toReadableStream()
   * @param {Object} request - Request mock
   * @param {Array<Object>} rows - Array of row objects to push
   */
  static emulateRows(request, rows) {
    const stream = request._readableStream;
    if (!stream) throw new Error('Call toReadableStream() before emulateRows()');
    setImmediate(() => {
      for (const row of rows) {
        stream.push(row);
      }
    });
  }

  /**
   * Signal stream completion (pushes null to end the readable stream)
   * @param {Object} request - Request mock
   * @param {number} rowCount - Number of rows processed (for logging)
   */
  static emulateDone(request, rowCount = 100) {
    const stream = request._readableStream;
    if (stream) {
      setImmediate(() => {
        stream.push(null); // Signal end of stream
      });
    } else {
      // Fallback for EventEmitter-based tests
      setImmediate(() => {
        request.emit('done', null, rowCount);
      });
    }
  }

  /**
   * Simulate stream error (destroys the readable stream with error)
   * @param {Object} request - Request mock
   * @param {Error} error - Error to emit
   */
  static emulateError(request, error) {
    const stream = request._readableStream;
    if (stream) {
      setImmediate(() => {
        stream.destroy(error);
      });
    } else {
      // Fallback for EventEmitter-based tests
      setImmediate(() => {
        request.emit('error', error);
      });
    }
  }

  /**
   * Simulate promise rejection on execute()
   * @param {Object} request - Request mock
   * @param {Error} error - Error to reject with
   */
  static emulateExecuteRejection(request, error) {
    request.execute.rejects(error);
  }

  /**
   * Verify request was cancelled
   * @param {Object} request - Request mock
   * @returns {boolean} True if cancel() was called
   */
  static wasCancelled(request) {
    return request.cancel.called;
  }

  /**
   * Get count of listener registrations
   * @param {Object} request - Request mock
   * @param {string} eventName - Event name to check
   * @returns {number} Count of listeners for event
   */
  static listenerCount(request, eventName) {
    return request.listenerCount(eventName);
  }
}

export default StreamRequestMock;
