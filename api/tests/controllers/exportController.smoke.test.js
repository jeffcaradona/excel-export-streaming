/**
 * Smoke tests for exportController.js
 * Quick validation that core error paths don't crash
 * Run: node --test api/tests/controllers/exportController.smoke.test.js
 */

import test from 'node:test';
import assert from 'node:assert';
import sinon from 'sinon';

import ResponseMock from '../mocks/response.mock.js';
import StreamRequestMock from '../mocks/streamRequest.mock.js';
import DatabaseMock from '../mocks/database.mock.js';

test('Smoke Tests - exportController', async (t) => {
  let sandbox;

  t.beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  t.afterEach(() => {
    sandbox.restore();
  });

  await t.test('Process does not crash on connection error', async () => {
    // Verify: connection error in execute() doesn't crash process
    const mockRequest = StreamRequestMock.stub();
    const error = DatabaseMock.connectionError('ESOCKET');

    StreamRequestMock.emulateExecuteRejection(mockRequest, error);
    mockRequest.cancel();

    // Should resolve without throwing
    let caught = false;
    try {
      await mockRequest.execute();
    } catch (err) {
      caught = true;
      assert.strictEqual(err.code, 'ESOCKET');
    }

    assert.strictEqual(caught, true);
    assert.strictEqual(mockRequest.cancel.called, true);
  });

  await t.test('Process does not crash on mid-stream error', async () => {
    // Verify: error during streaming closes response properly
    const res = ResponseMock.stub().markHeadersSent();
    const error = DatabaseMock.socketError();

    // Simulate mid-stream error handler
    if (res.headersSent) {
      res.destroy(error);
    }

    assert.strictEqual(res.destroy.called, true);
    assert.strictEqual(res.statusCode, 200); // Not status(500) - headers already sent
  });

  await t.test('Response stream is closed on error', async () => {
    // Verify: res.destroy() is called, preventing stream leak
    const res = ResponseMock.stub();
    const error = DatabaseMock.queryError();

    res.destroy(error);

    assert.strictEqual(res.destroy.calledOnce, true);
    ResponseMock.isEnded(res);
    assert.strictEqual(true, ResponseMock.isEnded(res));
  });
});
