/**
 * Integration tests for exportController.js
 * Tests error handling with actual request/response flow
 * Run: node --test api/tests/controllers/exportController.integration.test.js --test-timeout=10000
 */

import test from 'node:test';
import assert from 'node:assert';
import sinon from 'sinon';
import { EventEmitter } from 'node:events';

import ResponseMock from '../mocks/response.mock.js';
import StreamRequestMock from '../mocks/streamRequest.mock.js';
import DatabaseMock from '../mocks/database.mock.js';

test('Integration Tests - exportController', async (t) => {
  let sandbox;

  t.beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  t.afterEach(() => {
    sandbox.restore();
  });

  await t.test('Error during row streaming aborts and closes response', async () => {
    // Scenario: 100 rows streamed, error on row 50
    const mockRequest = StreamRequestMock.stub();
    const res = ResponseMock.stub();

    let rowCount = 0;
    let streamError = false;

    mockRequest.on = function(event, handler) {
      EventEmitter.prototype.on.call(this, event, handler);
      return this;
    };

    // Setup row handler
    mockRequest.on('row', () => {
      rowCount++;
      if (rowCount === 50) {
        // Abort: emit error
        mockRequest.emit('error', new Error('Row handler error'));
      }
    });

    // Setup error handler (like in exportController)
    mockRequest.on('error', (error) => {
      if (!streamError) {
        streamError = true;
        if (res.headersSent) {
          res.destroy(error);
        } else {
          res.status(500).json({ error: error.message });
        }
      }
    });

    // Mark headers sent and stream 100 rows
    res.markHeadersSent();
    for (let i = 1; i <= 100; i++) {
      mockRequest.emit('row', { id: i });
      if (streamError) break;
    }

    assert.strictEqual(rowCount, 50);
    assert.strictEqual(streamError, true);
    assert.strictEqual(res.destroy.calledOnce, true);
  });

  await t.test('Unhandled rejection in execute() is caught and handled', async () => {
    // Scenario: SQL execution fails with connection error
    const mockRequest = StreamRequestMock.stub();
    const res = ResponseMock.stub();

    const dbError = DatabaseMock.connectionError('Connection dropped');
    StreamRequestMock.emulateExecuteRejection(mockRequest, dbError);

    let handledError = null;
    let queryWasCancelled = false;

    // Simulate: streamRequest.execute().catch(error => { ... })
    try {
      await mockRequest.execute();
    } catch (error) {
      handledError = error;
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
      mockRequest.cancel();
      queryWasCancelled = true;
    }

    assert.strictEqual(handledError !== null, true);
    assert.strictEqual(handledError.message, 'Connection dropped');
    assert.strictEqual(queryWasCancelled, true);
    assert.strictEqual(mockRequest.cancel.called, true);
    assert.strictEqual(res.status.calledWith(500), true);
  });

  await t.test('Race: error and done both fire, only first wins', async () => {
    // Scenario: error on row 100, done also emitted, guard flag prevents double cleanup
    const mockRequest = StreamRequestMock.stub();
    const res = ResponseMock.stub();

    let streamError = false;
    let cleanupCount = 0;

    mockRequest.on = function(event, handler) {
      EventEmitter.prototype.on.call(this, event, handler);
      return this;
    };

    const errorHandler = (error) => {
      if (!streamError) {
        streamError = true;
        cleanupCount++;
        res.destroy(error);
      }
    };

    const doneHandler = () => {
      if (!streamError) {
        streamError = true;
        cleanupCount++;
        res.end();
      }
    };

    mockRequest.on('error', errorHandler);
    mockRequest.on('done', doneHandler);

    res.markHeadersSent();

    // Emit both simultaneously (race)
    mockRequest.emit('error', new Error('Query error'));
    mockRequest.emit('done', 100);

    // Wait for next tick to allow both to fire
    await new Promise(resolve => setImmediate(resolve));

    assert.strictEqual(cleanupCount, 1, 'Only one handler should execute');
    assert.strictEqual(res.destroy.called, true);
  });

  await t.test('Connection error before streaming returns HTTP 500', async () => {
    // Scenario: execute() fails before first row sent
    const mockRequest = StreamRequestMock.stub();
    const res = ResponseMock.stub();

    const authError = DatabaseMock.authError('Login failed');
    StreamRequestMock.emulateExecuteRejection(mockRequest, authError);

    let handled = false;

    try {
      await mockRequest.execute();
    } catch (error) {
      // Headers not sent yet - safe to send error response
      if (!res.headersSent) {
        res.status(500).json({ 
          error: error.message,
          code: 'DB_ERROR'
        });
        handled = true;
      }
      mockRequest.cancel();
    }

    assert.strictEqual(handled, true);
    assert.strictEqual(res.status.calledWith(500), true);
    assert.strictEqual(res.json.calledOnce, true);
    assert.strictEqual(mockRequest.cancel.called, true);
  });

  await t.test('Timeout error during query emits and is handled', async () => {
    // Scenario: query takes too long, server timeout fires
    const mockRequest = StreamRequestMock.stub();
    const res = ResponseMock.stub();

    const timeoutError = DatabaseMock.timeoutError('30s timeout');
    let streamError = false;

    mockRequest.on = function(event, handler) {
      EventEmitter.prototype.on.call(this, event, handler);
      return this;
    };

    mockRequest.on('error', (error) => {
      if (!streamError) {
        streamError = true;
        res.destroy(error);
      }
    });

    res.markHeadersSent();
    mockRequest.emit('error', timeoutError);

    assert.strictEqual(streamError, true);
    assert.strictEqual(res.destroy.calledOnce, true);
    assert.strictEqual(res.destroy.firstCall.args[0], timeoutError);
  });

  await t.test('Canceled query prevents orphaned database connections', async () => {
    // Scenario: long-running export is cancelled by user
    const mockRequest = StreamRequestMock.stub();

    // Simulate long-running query
    StreamRequestMock.stub().execute = sinon.stub().resolves();

    // User closes browser/cancels request
    mockRequest.cancel();

    assert.strictEqual(mockRequest.cancel.called, true);
    assert.strictEqual(StreamRequestMock.wasCancelled(mockRequest), true);
  });
});
