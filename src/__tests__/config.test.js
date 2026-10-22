const test = require('node:test');
const assert = require('node:assert/strict');

const { validateConfig } = require('../config');
const { auth } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requireModule } = require('../middleware/requireModule');
const db = require('../db');

const baseEnv = {
  JWT_SECRET: 'abcdefghijklmnopqrstuvwxyz123456',
  DB_HOST: 'localhost',
  DB_USER: 'root',
  DB_PASSWORD: 'secret',
  DB_NAME: 'umkm_test',
  PORT: '3000',
};

test('validateConfig accepts a complete env', () => {
  const cfg = validateConfig(baseEnv);
  assert.equal(cfg.PORT, 3000);
  assert.equal(cfg.DB_NAME, 'umkm_test');
  assert.equal(cfg.JWT_SECRET.length, 32);
});

test('validateConfig rejects missing DB values', () => {
  assert.throws(() => validateConfig({ ...baseEnv, DB_NAME: '' }), /Missing required environment variables: DB_NAME/);
});

test('validateConfig rejects weak JWT_SECRET', () => {
  assert.throws(() => validateConfig({ ...baseEnv, JWT_SECRET: 'short' }), /JWT_SECRET must be set and at least 32 characters long/);
});

test('validateConfig rejects invalid PORT', () => {
  assert.throws(() => validateConfig({ ...baseEnv, PORT: 'bad' }), /PORT must be a positive number/);
});

test('auth rejects missing Authorization header', async () => {
  let statusCode;
  const req = { headers: {} };
  const res = {
    status(code) {
      statusCode = code;
      return { json() {} };
    },
  };

  await auth(req, res, () => {});
  assert.equal(statusCode, 401);
});

test('tenant rejects missing X-Business-Id header', async () => {
  let statusCode;
  const req = { uid: 1, headers: {}, emailVerified: true };
  const res = {
    status(code) {
      statusCode = code;
      return { json() {} };
    },
  };

  await tenant(req, res, () => {});
  assert.equal(statusCode, 400);
});

test('requireModule rejects disabled module', async () => {
  const original = db.query;
  db.query = async () => [[]];

  try {
    let statusCode;
    const req = { tenant: { id: 9 } };
    const res = {
      status(code) {
        statusCode = code;
        return { json() {} };
      },
    };

    await requireModule('items')(req, res, () => {});
    assert.equal(statusCode, 403);
  } finally {
    db.query = original;
  }
});
