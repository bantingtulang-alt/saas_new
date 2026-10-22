const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { auth } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission, requireRole } = require('../middleware/permissions');
const db = require('../db');

process.env.JWT_SECRET = 'abcdefghijklmnopqrstuvwxyz123456';

async function executeMiddlewareChain(chain, req, res) {
  let index = 0;
  const run = async () => {
    if (index >= chain.length) return;
    const fn = chain[index++];
    return await fn(req, res, run);
  };
  await run();
}

test('e2e: valid login token flows through auth and tenant middleware', async () => {
  const original = db.query;
  db.query = async (sql, params) => {
    if (sql.includes('FROM users WHERE id = ?')) {
      return [[{ status: 'active', email_verified_at: '2024-01-01', pca: null }]];
    }
    if (sql.includes('FROM business_users bu')) {
      return [[{ role: 'owner' }]];
    }
    return [[]];
  };

  try {
    const token = jwt.sign({ uid: 42 }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const req = { headers: { authorization: `Bearer ${token}`, 'x-business-id': '7' } };
    const res = { status(code) { this.code = code; return this; }, json() {} };
    await executeMiddlewareChain([auth, tenant], req, res);
    assert.equal(req.uid, 42);
    assert.equal(req.tenant.id, 7);
    assert.equal(req.tenant.role, 'owner');
  } finally {
    db.query = original;
  }
});

test('e2e: cross-tenant access is denied', async () => {
  const original = db.query;
  db.query = async () => [[]];
  try {
    let statusCode;
    const req = { uid: 15, headers: { 'x-business-id': '999' }, emailVerified: true };
    const res = {
      status(code) { statusCode = code; return { json() {} }; },
    };
    await tenant(req, res, () => {});
    assert.equal(statusCode, 403);
  } finally {
    db.query = original;
  }
});

test('e2e: staff cannot write items even if module active', async () => {
  const original = db.query;
  db.query = async () => [[{ 1: 1 }]];
  try {
    let statusCode;
    const req = { tenant: { id: 5, role: 'staff', permissions: ['items:read'] } };
    const res = {
      status(code) { statusCode = code; return { json() {} }; },
    };
    await requirePermission('items:write')(req, res, () => {});
    assert.equal(statusCode, 403);
  } finally {
    db.query = original;
  }
});

test('e2e: admin user can manage business members', async () => {
  const req = { tenant: { role: 'admin' } };
  let nextCalled = false;
  const res = { status() { return { json() {} }; } };
  await requireRole(['owner', 'admin'])(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});
