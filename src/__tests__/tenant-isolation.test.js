const test = require('node:test');
const assert = require('node:assert/strict');
const { tenant } = require('../middleware/tenant');
const { requireModule } = require('../middleware/requireModule');
const db = require('../db');

test('tenant rejects when user is not a member of the given business', async () => {
  const original = db.query;
  db.query = async () => [[]];
  try {
    let statusCode;
    const req = { uid: 12, headers: { 'x-business-id': '99' }, emailVerified: true };
    const res = {
      status(code) { statusCode = code; return { json() {} }; },
    };
    await tenant(req, res, () => {});
    assert.equal(statusCode, 403);
  } finally {
    db.query = original;
  }
});

test('requireModule blocks if business module is disabled', async () => {
  const original = db.query;
  db.query = async () => [[]];
  try {
    let statusCode;
    const req = { tenant: { id: 7 } };
    const res = {
      status(code) { statusCode = code; return { json() {} }; },
    };
    await requireModule('sales')(req, res, () => {});
    assert.equal(statusCode, 403);
  } finally {
    db.query = original;
  }
});
