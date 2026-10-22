const router = require('express').Router();
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const db = require('../db');
const events = require('../events');
const { sign, auth } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requireModule } = require('../middleware/requireModule');
const account = require('../account');
const { wrap } = require('../util');

const PRESETS = {
  toko: ['customer', 'items', 'inventory', 'sales', 'finance'],
  barbershop: ['customer', 'items', 'sales', 'booking', 'employee', 'finance'],
  laundry: ['customer', 'items', 'sales', 'finance'],
  kopi: ['customer', 'items', 'inventory', 'sales', 'finance'],
  lainnya: ['customer', 'items', 'sales', 'finance'],
};

const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 });

async function businessesOf(uid) {
  const [rows] = await db.query(
    `SELECT b.id, b.name, b.business_type, ro.name AS role
       FROM business_users bu JOIN businesses b ON b.id = bu.business_id
       JOIN roles ro ON ro.id = bu.role_id
      WHERE bu.user_id = ? AND bu.status = 'active'`, [uid]);
  return rows;
}

router.use(account.router);

router.get('/health', wrap(async (req, res) => {
  await db.query('SELECT 1');
  res.json({ ok: true, time: new Date().toISOString() });
}));

const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().max(191),
  password: z.string().min(8).max(100),
  business_name: z.string().min(2).max(150),
  business_type: z.enum(Object.keys(PRESETS)).default('lainnya'),
});

router.post('/auth/register', authLimit, wrap(async (req, res) => {
  const d = registerSchema.parse(req.body);
  const hash = await bcrypt.hash(d.password, 12);
  const slug = d.business_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    + '-' + crypto.randomBytes(3).toString('hex');
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [u] = await conn.query('INSERT INTO users (name,email,password_hash) VALUES (?,?,?)', [d.name, d.email.toLowerCase(), hash]);
    const [b] = await conn.query('INSERT INTO businesses (name,slug,business_type) VALUES (?,?,?)', [d.business_name, slug, d.business_type]);
    const [ro] = await conn.query("INSERT INTO roles (business_id,name,description) VALUES (?,'owner','Pemilik bisnis')", [b.insertId]);
    await conn.query('INSERT INTO business_users (business_id,user_id,role_id) VALUES (?,?,?)', [b.insertId, u.insertId, ro.insertId]);
    const [mods] = await conn.query('SELECT id, code FROM modules WHERE is_active = 1');
    const on = PRESETS[d.business_type];
    for (const m of mods)
      await conn.query('INSERT INTO business_modules (business_id,module_id,enabled) VALUES (?,?,?)', [b.insertId, m.id, on.includes(m.code) ? 1 : 0]);
    await conn.query(
      `INSERT INTO subscriptions (business_id,plan_id,status,current_period_start,current_period_end,trial_ends_at)
       SELECT ?, id, 'trial', NOW(), DATE_ADD(NOW(), INTERVAL 14 DAY), DATE_ADD(NOW(), INTERVAL 14 DAY)
         FROM plans WHERE code = 'starter'`, [b.insertId]);
    await conn.commit();
    account.sendVerification({ id: u.insertId, name: d.name, email: d.email.toLowerCase() }).catch((e) => console.error('[mail]', e.message));
    res.status(201).json({ token: sign({ id: u.insertId }), user: { id: u.insertId, name: d.name, email: d.email, email_verified: false }, businesses: await businessesOf(u.insertId) });
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}));

const fails = new Map();
const FAIL_MAX = 8, FAIL_WINDOW = 15 * 60 * 1000;
const failed = (k) => { const f = fails.get(k); return f && Date.now() - f.t < FAIL_WINDOW ? f.n : 0; };
const addFail = (k) => { const f = fails.get(k); fails.set(k, f && Date.now() - f.t < FAIL_WINDOW ? { n: f.n + 1, t: f.t } : { n: 1, t: Date.now() }); };
setInterval(() => { for (const [k, f] of fails) if (Date.now() - f.t >= FAIL_WINDOW) fails.delete(k); }, 5 * 60 * 1000).unref();

router.post('/auth/login', authLimit, wrap(async (req, res) => {
  const d = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const key = d.email.toLowerCase();
  if (failed(key) >= FAIL_MAX) return res.status(429).json({ error: 'Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit atau reset password.' });
  const [r] = await db.query('SELECT * FROM users WHERE email = ?', [d.email.toLowerCase()]);
  const u = r[0];
  if (!u || u.status !== 'active' || !(await bcrypt.compare(d.password, u.password_hash))) {
    addFail(key); return res.status(401).json({ error: 'Email atau password salah' });
  }
  fails.delete(key);
  await db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [u.id]);
  res.json({ token: sign(u), user: { id: u.id, name: u.name, email: u.email, email_verified: !!u.email_verified_at }, businesses: await businessesOf(u.id) });
}));

router.get('/me', auth, wrap(async (req, res) => {
  const [r] = await db.query('SELECT id,name,email,email_verified_at IS NOT NULL AS email_verified FROM users WHERE id = ?', [req.uid]);
  res.json({ user: { ...r[0], email_verified: !!r[0].email_verified }, businesses: await businessesOf(req.uid) });
}));

module.exports = router;
