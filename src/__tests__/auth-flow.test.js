const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/permissions');

const secret = 'abcdefghijklmnopqrstuvwxyz123456';
process.env.JWT_SECRET = secret;

test('auth accepts valid bearer token', async () => {
  const token = jwt.sign({ uid: 42 }, secret, { expiresIn: '1h' });
  const db = require('../db');
  const original = db.query;
  db.query = async () => [[{ status: 'active', email_verified_at: null, pca: null }]];

  try {
    let nextCalled = false;
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = { status() { return this; }, json() {} };
    await auth(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.uid, 42);
  } finally {
    db.query = original;
  }
});

test('auth rejects invalid bearer token', async () => {
  let statusCode;
  const req = { headers: { authorization: 'Bearer invalid-token' } };
  const res = { status(code) { statusCode = code; return { json() {} }; } };
  await auth(req, res, () => {});
  assert.equal(statusCode, 401);
});

test('auth rejects stale password change token', async () => {
  const token = jwt.sign({ uid: 42, iat: 100 }, secret, { expiresIn: '1h' });
  const db = require('../db');
  const original = db.query;
  db.query = async () => [[{ status: 'active', email_verified_at: null, pca: 200 }]];

  try {
    let statusCode;
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = { status(code) { statusCode = code; return { json() {} }; } };
    await auth(req, res, () => {});
    assert.equal(statusCode, 401);
  } finally {
    db.query = original;
  }
});

test('requireRole blocks non-allowed roles', async () => {
  let code;
  const req = { tenant: { role: 'staff' } };
  const res = { status(c) { code = c; return { json() {} }; } };
  await requireRole(['owner', 'admin'])(req, res, () => {});
  assert.equal(code, 403);
});
