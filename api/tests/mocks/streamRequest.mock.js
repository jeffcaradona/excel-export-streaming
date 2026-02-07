/**
 * Mock mssql Request object for testing
 * Creates an EventEmitter-based request with stubbed execute() method
 */

import sinon from 'sinon';
import { EventEmitter } from 'events';

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

    // Output array for stored procedure results
    request.output = [];

    return request;
  }

  /**
   * Simulate query execution success (emits 'done')
   * @param {Object} request - Request mock
   * @param {number} rowCount - Number of rows processed
   */
  static emulateDone(request, rowCount = 100) {
    setImmediate(() => {
      request.emit('done', null, rowCount);
    });
  }

  /**
   * Simulate query execution error (emits 'error')
   * @param {Object} request - Request mock
   * @param {Error} error - Error to emit
   */
  static emulateError(request, error) {
    setImmediate(() => {
      request.emit('error', error);
    });
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
