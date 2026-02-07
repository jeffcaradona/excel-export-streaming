/**
 * Mock Express Response object for testing
 * Stubs all critical methods for export controller testing
 */

import sinon from 'sinon';

class ResponseMock {
  /**
   * Create a stubbed Response object
   * @returns {Object} Response mock with stubbed methods
   */
  static stub() {
    const res = Object.create(Object.getPrototypeOf({}));

    // Core methods
    res.status = sinon.stub().returnsThis();
    res.json = sinon.stub().returnsThis();
    res.header = sinon.stub().returnsThis();
    res.setHeader = sinon.stub().returnsThis();

    // State tracking
    res.headersSent = false;
    res.statusCode = 200;

    // Stream/cleanup methods
    res.destroy = sinon.stub();
    res.end = sinon.stub();
    res.write = sinon.stub().returns(true);

    // Drain event for backpressure
    res.once = sinon.stub().returnsThis();
    res.on = sinon.stub().returnsThis();
    res.removeListener = sinon.stub().returnsThis();

    // Simulate header-sending
    res.markHeadersSent = function() {
      this.headersSent = true;
      return this;
    };

    return res;
  }

  /**
   * Verify response ended properly
   * @param {Object} res - Response mock
   * @returns {boolean} True if response ended
   */
  static isEnded(res) {
    return res.end.called || res.destroy.called;
  }

  /**
   * Verify response had error
   * @param {Object} res - Response mock
   * @returns {boolean} True if status was error code
   */
  static isErrorResponse(res) {
    if (res.status.called) {
      const statusCode = res.status.firstCall.args[0];
      return statusCode >= 400;
    }
    return false;
  }
}

export default ResponseMock;
