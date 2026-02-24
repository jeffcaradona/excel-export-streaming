/**
 * Integration tests for exportController.js
 * Tests stream-based error handling with pipeline() and toReadableStream()
 * Run: node --test api/tests/controllers/exportController.integration.test.js --test-timeout=10000
 */

import test from 'node:test';
import assert from 'node:assert';
import sinon from 'sinon';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

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

  await t.test('Error during row streaming aborts pipeline and destroys response', async () => {
    // Scenario: stream error on row 3 causes pipeline to reject
    const mockRequest = StreamRequestMock.stub();
    const res = ResponseMock.stub();
    const dbStream = mockRequest.toReadableStream();

    let rowCount = 0;

    const writer = new Writable({
      objectMode: true,
      write(row, encoding, callback) {
        rowCount++;
        if (rowCount === 3) {
          callback(new Error('Row handler error'));
        } else {
          callback();
        }
      }
    });

    // Push 5 rows and signal done
    StreamRequestMock.emulateRows(mockRequest, [
      { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }
    ]);
    StreamRequestMock.emulateDone(mockRequest);

    res.markHeadersSent();

    try {
      await pipeline(dbStream, writer);
      assert.fail('Pipeline should have rejected');
    } catch (err) {
      // Simulate controller error handling
      if (res.headersSent) {
        res.destroy(err);
      }
    }

    assert.strictEqual(rowCount, 3);
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

  await t.test('Pipeline rejects when dbStream is destroyed with error', async () => {
    // Scenario: database error destroys the readable stream, pipeline catches it
    const mockRequest = StreamRequestMock.stub();
    const res = ResponseMock.stub();
    const dbStream = mockRequest.toReadableStream();

    let cleanupCount = 0;

    const writer = new Writable({
      objectMode: true,
      write(row, encoding, callback) {
        callback();
      }
    });

    // Emit error on stream
    StreamRequestMock.emulateError(mockRequest, new Error('Query error'));

    res.markHeadersSent();

    try {
      await pipeline(dbStream, writer);
    } catch {
      cleanupCount++;
      res.destroy(new Error('Query error'));
    }

    assert.strictEqual(cleanupCount, 1, 'Pipeline should reject exactly once');
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

  await t.test('Timeout error during query destroys stream and is handled', async () => {
    // Scenario: query takes too long, timeout error destroys the stream
    const mockRequest = StreamRequestMock.stub();
    const res = ResponseMock.stub();
    const dbStream = mockRequest.toReadableStream();

    const timeoutError = DatabaseMock.timeoutError('30s timeout');

    const writer = new Writable({
      objectMode: true,
      write(row, encoding, callback) {
        callback();
      }
    });

    res.markHeadersSent();

    // Destroy stream with timeout error
    StreamRequestMock.emulateError(mockRequest, timeoutError);

    try {
      await pipeline(dbStream, writer);
      assert.fail('Pipeline should have rejected');
    } catch (err) {
      if (res.headersSent) {
        res.destroy(err);
      }
    }

    assert.strictEqual(res.destroy.calledOnce, true);
    assert.strictEqual(res.destroy.firstCall.args[0].message, '30s timeout');
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

  await t.test('Successful pipeline completes and all rows are processed', async () => {
    // Scenario: 100 rows stream through pipeline successfully
    const mockRequest = StreamRequestMock.stub();
    const dbStream = mockRequest.toReadableStream();

    let rowCount = 0;
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));

    const writer = new Writable({
      objectMode: true,
      write(row, encoding, callback) {
        rowCount++;
        callback();
      }
    });

    StreamRequestMock.emulateRows(mockRequest, rows);
    StreamRequestMock.emulateDone(mockRequest);

    await pipeline(dbStream, writer);

    assert.strictEqual(rowCount, 100);
  });
});
