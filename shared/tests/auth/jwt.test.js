/**
 * Unit tests for JWT authentication utilities
 * Run: node --test shared/tests/auth/jwt.test.js
 */

import test from 'node:test';
import assert from 'node:assert';
import { generateToken, verifyToken } from '../../src/auth/jwt.js';

const TEST_SECRET = 'test-secret-key-minimum-32-characters-long';

test('JWT Utilities', async (t) => {
  await t.test('generateToken - creates valid JWT with default expiration', () => {
    const token = generateToken(TEST_SECRET);
    
    assert.strictEqual(typeof token, 'string');
    assert.ok(token.length > 0);
    assert.ok(token.split('.').length === 3); // JWT format: header.payload.signature
  });

  await t.test('generateToken - creates token with custom expiration', () => {
    const token = generateToken(TEST_SECRET, '1h');
    
    const decoded = verifyToken(token, TEST_SECRET);
    assert.ok(decoded.exp > decoded.iat);
  });

  await t.test('generateToken - includes required claims', () => {
    const token = generateToken(TEST_SECRET);
    const decoded = verifyToken(token, TEST_SECRET);
    
    assert.strictEqual(decoded.iss, 'excel-export-app');
    assert.strictEqual(decoded.aud, 'excel-export-api');
    assert.ok(decoded.iat);
    assert.ok(decoded.exp);
  });

  await t.test('verifyToken - successfully verifies valid token', () => {
    const token = generateToken(TEST_SECRET);
    const decoded = verifyToken(token, TEST_SECRET);
    
    assert.strictEqual(decoded.iss, 'excel-export-app');
    assert.strictEqual(decoded.aud, 'excel-export-api');
  });

  await t.test('verifyToken - throws error for invalid signature', () => {
    const token = generateToken(TEST_SECRET);
    const wrongSecret = 'wrong-secret-key-different-from-original';
    
    assert.throws(
      () => verifyToken(token, wrongSecret),
      { name: 'JsonWebTokenError', message: /invalid signature/ }
    );
  });

  await t.test('verifyToken - throws error for expired token', () => {
    const token = generateToken(TEST_SECRET, '-1s'); // Already expired
    
    assert.throws(
      () => verifyToken(token, TEST_SECRET),
      { name: 'TokenExpiredError' }
    );
  });

  await t.test('verifyToken - throws error for wrong issuer', async () => {
    // Manually create token with wrong issuer
    const jwt = await import('jsonwebtoken');
    const token = jwt.default.sign(
      { iss: 'wrong-issuer', aud: 'excel-export-api' },
      TEST_SECRET
    );
    
    assert.throws(
      () => verifyToken(token, TEST_SECRET),
      { name: 'JsonWebTokenError', message: /jwt issuer invalid/ }
    );
  });

  await t.test('verifyToken - throws error for wrong audience', async () => {
    // Manually create token with wrong audience
    const jwt = await import('jsonwebtoken');
    const token = jwt.default.sign(
      { iss: 'excel-export-app', aud: 'wrong-audience' },
      TEST_SECRET
    );
    
    assert.throws(
      () => verifyToken(token, TEST_SECRET),
      { name: 'JsonWebTokenError', message: /jwt audience invalid/ }
    );
  });

  await t.test('verifyToken - throws error for malformed token', () => {
    assert.throws(
      () => verifyToken('not.a.valid.jwt.token', TEST_SECRET),
      { name: 'JsonWebTokenError' }
    );
  });

  await t.test('verifyToken - throws error for empty token', () => {
    assert.throws(
      () => verifyToken('', TEST_SECRET),
      { name: 'JsonWebTokenError' }
    );
  });

  await t.test('Token lifecycle - generate and verify roundtrip', async () => {
    const token1 = generateToken(TEST_SECRET);
    
    // Wait 1ms to ensure different iat
    await new Promise(resolve => setTimeout(resolve, 1));
    
    const token2 = generateToken(TEST_SECRET);
    
    // Tokens should be different (different iat timestamp)
    // Note: If generated in same second, may be identical
    // Both should verify successfully regardless
    const decoded1 = verifyToken(token1, TEST_SECRET);
    const decoded2 = verifyToken(token2, TEST_SECRET);
    
    assert.strictEqual(decoded1.iss, decoded2.iss);
    assert.strictEqual(decoded1.aud, decoded2.aud);
    assert.ok(decoded1.iat <= decoded2.iat, 'token2 should have same or later iat');
  });
});
