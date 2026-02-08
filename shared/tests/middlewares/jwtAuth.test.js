/**
 * Unit tests for JWT authentication middleware
 * Run: node --test shared/tests/middlewares/jwtAuth.test.js
 */

import test from 'node:test';
import assert from 'node:assert';
import sinon from 'sinon';
import { jwtAuthMiddleware } from '../../src/middlewares/jwtAuth.js';
import { generateToken } from '../../src/auth/jwt.js';

const TEST_SECRET = 'test-secret-key-minimum-32-characters-long';

test('JWT Auth Middleware', async (t) => {
  let sandbox;

  t.beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  t.afterEach(() => {
    sandbox.restore();
  });

  await t.test('Valid token - attaches decoded payload to req.auth', () => {
    const middleware = jwtAuthMiddleware(TEST_SECRET);
    const token = generateToken(TEST_SECRET);
    
    const req = {
      headers: {
        authorization: `Bearer ${token}`
      }
    };
    const res = {
      status: sandbox.stub().returnsThis(),
      json: sandbox.stub()
    };
    const next = sandbox.stub();
    
    middleware(req, res, next);
    
    assert.ok(req.auth, 'req.auth should be set');
    assert.strictEqual(req.auth.iss, 'excel-export-app');
    assert.strictEqual(req.auth.aud, 'excel-export-api');
    assert.ok(next.calledOnce, 'next() should be called');
    assert.ok(res.status.notCalled, 'res.status() should not be called');
  });

  await t.test('Missing Authorization header - returns 401', () => {
    const middleware = jwtAuthMiddleware(TEST_SECRET);
    
    const req = { headers: {} };
    const res = {
      status: sandbox.stub().returnsThis(),
      json: sandbox.stub()
    };
    const next = sandbox.stub();
    
    middleware(req, res, next);
    
    assert.ok(res.status.calledWith(401));
    assert.ok(res.json.calledOnce);
    const errorResponse = res.json.firstCall.args[0];
    assert.strictEqual(errorResponse.error.code, 'UNAUTHORIZED');
    assert.strictEqual(errorResponse.error.message, 'Missing or invalid authorization header');
    assert.ok(next.notCalled, 'next() should not be called');
  });

  await t.test('Invalid Authorization format (no Bearer) - returns 401', () => {
    const middleware = jwtAuthMiddleware(TEST_SECRET);
    const token = generateToken(TEST_SECRET);
    
    const req = {
      headers: {
        authorization: token // Missing "Bearer " prefix
      }
    };
    const res = {
      status: sandbox.stub().returnsThis(),
      json: sandbox.stub()
    };
    const next = sandbox.stub();
    
    middleware(req, res, next);
    
    assert.ok(res.status.calledWith(401));
    assert.ok(res.json.calledOnce);
    const errorResponse = res.json.firstCall.args[0];
    assert.strictEqual(errorResponse.error.message, 'Missing or invalid authorization header');
  });

  await t.test('Invalid token signature - returns 401', () => {
    const middleware = jwtAuthMiddleware(TEST_SECRET);
    const token = generateToken('different-secret-key-32-chars-min');
    
    const req = {
      headers: {
        authorization: `Bearer ${token}`
      }
    };
    const res = {
      status: sandbox.stub().returnsThis(),
      json: sandbox.stub()
    };
    const next = sandbox.stub();
    
    middleware(req, res, next);
    
    assert.ok(res.status.calledWith(401));
    assert.ok(res.json.calledOnce);
    const errorResponse = res.json.firstCall.args[0];
    assert.strictEqual(errorResponse.error.code, 'UNAUTHORIZED');
    assert.strictEqual(errorResponse.error.message, 'Invalid token');
    assert.ok(next.notCalled);
  });

  await t.test('Expired token - returns 401 with specific message', () => {
    const middleware = jwtAuthMiddleware(TEST_SECRET);
    const expiredToken = generateToken(TEST_SECRET, '-1s'); // Already expired
    
    const req = {
      headers: {
        authorization: `Bearer ${expiredToken}`
      }
    };
    const res = {
      status: sandbox.stub().returnsThis(),
      json: sandbox.stub()
    };
    const next = sandbox.stub();
    
    middleware(req, res, next);
    
    assert.ok(res.status.calledWith(401));
    assert.ok(res.json.calledOnce);
    const errorResponse = res.json.firstCall.args[0];
    assert.strictEqual(errorResponse.error.code, 'UNAUTHORIZED');
    assert.strictEqual(errorResponse.error.message, 'Token expired');
    assert.ok(next.notCalled);
  });

  await t.test('Malformed token - returns 401', () => {
    const middleware = jwtAuthMiddleware(TEST_SECRET);
    
    const req = {
      headers: {
        authorization: 'Bearer not.a.valid.token'
      }
    };
    const res = {
      status: sandbox.stub().returnsThis(),
      json: sandbox.stub()
    };
    const next = sandbox.stub();
    
    middleware(req, res, next);
    
    assert.ok(res.status.calledWith(401));
    assert.ok(res.json.calledOnce);
    const errorResponse = res.json.firstCall.args[0];
    assert.strictEqual(errorResponse.error.message, 'Invalid token');
  });

  await t.test('Empty Bearer token - returns 401', () => {
    const middleware = jwtAuthMiddleware(TEST_SECRET);
    
    const req = {
      headers: {
        authorization: 'Bearer '
      }
    };
    const res = {
      status: sandbox.stub().returnsThis(),
      json: sandbox.stub()
    };
    const next = sandbox.stub();
    
    middleware(req, res, next);
    
    assert.ok(res.status.calledWith(401));
    assert.ok(res.json.calledOnce);
  });

  await t.test('Case-sensitive Bearer prefix - returns 401 for lowercase', () => {
    const middleware = jwtAuthMiddleware(TEST_SECRET);
    const token = generateToken(TEST_SECRET);
    
    const req = {
      headers: {
        authorization: `bearer ${token}` // Lowercase 'bearer'
      }
    };
    const res = {
      status: sandbox.stub().returnsThis(),
      json: sandbox.stub()
    };
    const next = sandbox.stub();
    
    middleware(req, res, next);
    
    assert.ok(res.status.calledWith(401));
    const errorResponse = res.json.firstCall.args[0];
    assert.strictEqual(errorResponse.error.message, 'Missing or invalid authorization header');
  });

  await t.test('Multiple valid requests - each should succeed independently', () => {
    const middleware = jwtAuthMiddleware(TEST_SECRET);
    
    // First request
    const token1 = generateToken(TEST_SECRET);
    const req1 = { headers: { authorization: `Bearer ${token1}` } };
    const res1 = {
      status: sandbox.stub().returnsThis(),
      json: sandbox.stub()
    };
    const next1 = sandbox.stub();
    
    middleware(req1, res1, next1);
    assert.ok(next1.calledOnce);
    
    // Second request with different token
    const token2 = generateToken(TEST_SECRET);
    const req2 = { headers: { authorization: `Bearer ${token2}` } };
    const res2 = {
      status: sandbox.stub().returnsThis(),
      json: sandbox.stub()
    };
    const next2 = sandbox.stub();
    
    middleware(req2, res2, next2);
    assert.ok(next2.calledOnce);
    
    // Both should have auth attached
    assert.ok(req1.auth);
    assert.ok(req2.auth);
  });
});
