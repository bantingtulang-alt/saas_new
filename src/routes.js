const router = require('express').Router();
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const db = require('./db');
const events = require('./events');
const { sign, auth, tenant, requireModule } = require('./auth');
const account = require('./account');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Modul bawaan per jenis bisnis (hanya preset awal, bisa diubah pemilik kapan saja)
const PRESETS = {
  toko: ['customer', 'items', 'inventory', 'sales', 'finance'],
  barbershop: ['customer', 'items', 'sales', 'booking', 'employee', 'finance'],
  laundry: ['customer', 'items', 'sales', 'finance'],
  kopi: ['customer', 'items', 'inventory', 'sales', 'finance'],
  lainnya: ['customer', 'items', 'sales', 'finance'],
};

const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 });

router.use(account.router);

router.get('/health', wrap(async (req, res) => {
  await db.query('SELECT 1');
  res.json({ ok: true, time: new Date().toISOString() });
}));

// ---------- AUTH ----------
const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().max(191),
  password: z.string().min(8).max(100),
  business_name: z.string().min(2).max(150),
  business_type: z.enum(Object.keys(PRESETS)).default('lainnya'),
});

async function businessesOf(uid) {
  const [rows] = await db.query(
    `SELECT b.id, b.name, b.business_type, ro.name AS role
       FROM business_users bu JOIN businesses b ON b.id = bu.business_id
       JOIN roles ro ON ro.id = bu.role_id
      WHERE bu.user_id = ? AND bu.status = 'active'`, [uid]);
  return rows;
}

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

// Batas gagal login per email (memori; reset saat server restart) di atas batas per IP.
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
  if (!u || u.status !== 'active' || !(await bcrypt.compare(d.password, u.password_hash)))
    { addFail(key); return res.status(401).json({ error: 'Email atau password salah' }); }
  fails.delete(key);
  await db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [u.id]);
  res.json({ token: sign(u), user: { id: u.id, name: u.name, email: u.email, email_verified: !!u.email_verified_at }, businesses: await businessesOf(u.id) });
}));

router.get('/me', auth, wrap(async (req, res) => {
  const [r] = await db.query('SELECT id,name,email,email_verified_at IS NOT NULL AS email_verified FROM users WHERE id = ?', [req.uid]);
  res.json({ user: { ...r[0], email_verified: !!r[0].email_verified }, businesses: await businessesOf(req.uid) });
}));

// ---------- MODUL (menu yang bisa diatur tiap UMKM) ----------
router.get('/modules', auth, tenant, wrap(async (req, res) => {
  const [rows] = await db.query(
    `SELECT m.code, m.name, m.description, COALESCE(bm.enabled,0) AS enabled
       FROM modules m LEFT JOIN business_modules bm ON bm.module_id = m.id AND bm.business_id = ?
      WHERE m.is_active = 1 ORDER BY m.id`, [req.tenant.id]);
  res.json(rows.map((r) => ({ ...r, enabled: !!r.enabled })));
}));

router.put('/modules/:code', auth, tenant, wrap(async (req, res) => {
  if (!['owner', 'admin'].includes(req.tenant.role)) return res.status(403).json({ error: 'Hanya owner/admin' });
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
  const [m] = await db.query('SELECT id FROM modules WHERE code = ? AND is_active = 1', [req.params.code]);
  if (!m.length) return res.status(404).json({ error: 'Modul tidak ditemukan' });
  await db.query(
    `INSERT INTO business_modules (business_id,module_id,enabled) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`, [req.tenant.id, m[0].id, enabled ? 1 : 0]);
  res.json({ code: req.params.code, enabled });
}));

// ---------- CUSTOMER (modul contoh, semua query wajib pakai business_id) ----------
const cust = [auth, tenant, requireModule('customer')];
const custSchema = z.object({
  name: z.string().min(1).max(150),
  phone: z.string().max(30).nullish(),
  email: z.string().email().max(191).nullish(),
  address: z.string().max(1000).nullish(),
  notes: z.string().max(1000).nullish(),
});

router.get('/customers', cust, wrap(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const q = `%${req.query.q || ''}%`;
  const [rows] = await db.query(
    `SELECT id,name,phone,email,address,notes,total_spending,created_at FROM customers
      WHERE business_id = ? AND deleted_at IS NULL AND (name LIKE ? OR phone LIKE ?)
      ORDER BY id DESC LIMIT ? OFFSET ?`, [req.tenant.id, q, q, limit, (page - 1) * limit]);
  res.json(rows);
}));

router.post('/customers', cust, wrap(async (req, res) => {
  const d = custSchema.parse(req.body);
  const [[plan]] = await db.query(
    `SELECT p.max_customers FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.business_id = ? AND s.status IN ('trial','active') AND s.current_period_end > NOW()
      ORDER BY s.id DESC LIMIT 1`, [req.tenant.id]);
  if (!plan) return res.status(402).json({ error: 'Langganan tidak aktif' });
  if (plan.max_customers !== null) {
    const [[c]] = await db.query('SELECT COUNT(*) n FROM customers WHERE business_id = ? AND deleted_at IS NULL', [req.tenant.id]);
    if (c.n >= plan.max_customers) return res.status(402).json({ error: 'Batas pelanggan paket Anda tercapai' });
  }
  const [r] = await db.query(
    'INSERT INTO customers (business_id,name,phone,email,address,notes) VALUES (?,?,?,?,?,?)',
    [req.tenant.id, d.name, d.phone ?? null, d.email ?? null, d.address ?? null, d.notes ?? null]);
  events.emit('customer.created', { business_id: req.tenant.id, customer_id: r.insertId, name: d.name, phone: d.phone || '' });
  res.status(201).json({ id: r.insertId, ...d });
}));

router.put('/customers/:id', cust, wrap(async (req, res) => {
  const d = custSchema.parse(req.body);
  const [r] = await db.query(
    `UPDATE customers SET name=?,phone=?,email=?,address=?,notes=?
      WHERE id = ? AND business_id = ? AND deleted_at IS NULL`,
    [d.name, d.phone ?? null, d.email ?? null, d.address ?? null, d.notes ?? null, req.params.id, req.tenant.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
  res.json({ id: Number(req.params.id), ...d });
}));

router.delete('/customers/:id', cust, wrap(async (req, res) => {
  const [r] = await db.query('UPDATE customers SET deleted_at = NOW() WHERE id = ? AND business_id = ? AND deleted_at IS NULL', [req.params.id, req.tenant.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Pelanggan tidak ditemukan' });
  res.json({ deleted: true });
}));

router.use(require('./items'));
router.use(require('./sales'));
router.use(require('./finance'));
router.use(require('./reports'));
router.use(require('./whatsappApi'));
router.use(require('./workflows'));

module.exports = router;
