const router = require('express').Router();
const { z } = require('zod');
const db = require('../db');
const { auth, tenant } = require('../auth');
const { wrap, httpErr } = require('../util');

const adminGuard = [auth, tenant, (req, res, next) => {
  if (!['owner', 'admin'].includes(req.tenant.role)) return res.status(403).json({ error: 'Hanya owner/admin yang dapat mengelola role dan member' });
  next();
}];

router.get('/business/users', adminGuard, wrap(async (req, res) => {
  const [rows] = await db.query(
    `SELECT bu.user_id AS id, u.name, u.email, r.name AS role, bu.status
       FROM business_users bu
       JOIN users u ON u.id = bu.user_id
       JOIN roles r ON r.id = bu.role_id
      WHERE bu.business_id = ?
      ORDER BY bu.user_id ASC`,
    [req.tenant.id]
  );
  res.json(rows);
}));

router.post('/business/users/invite', adminGuard, wrap(async (req, res) => {
  const d = z.object({
    email: z.string().email().max(191),
    role: z.enum(['owner', 'admin', 'staff', 'accountant']),
  }).parse(req.body);

  const [[user]] = await db.query('SELECT id FROM users WHERE email = ? LIMIT 1', [d.email.toLowerCase()]);
  if (!user) return res.status(404).json({ error: 'User dengan email tersebut belum terdaftar' });

  const [[roleRow]] = await db.query('SELECT id FROM roles WHERE business_id = ? AND name = ?', [req.tenant.id, d.role]);
  if (!roleRow) return res.status(404).json({ error: `Role ${d.role} tidak ditemukan untuk bisnis ini` });

  const [existing] = await db.query(
    'SELECT id FROM business_users WHERE business_id = ? AND user_id = ?',
    [req.tenant.id, user.id]
  );

  if (existing.length) {
    await db.query(
      'UPDATE business_users SET role_id = ?, status = ? WHERE business_id = ? AND user_id = ?',
      [roleRow.id, 'active', req.tenant.id, user.id]
    );
    return res.status(200).json({ ok: true, invited: true, user_id: user.id, role: d.role });
  }

  await db.query(
    'INSERT INTO business_users (business_id, user_id, role_id, status) VALUES (?, ?, ?, ?)',
    [req.tenant.id, user.id, roleRow.id, 'active']
  );

  res.status(201).json({ ok: true, invited: true, user_id: user.id, role: d.role });
}));

router.patch('/business/users/:userId/role', adminGuard, wrap(async (req, res) => {
  const d = z.object({ role: z.enum(['owner', 'admin', 'staff', 'accountant']) }).parse(req.body);
  const [[roleRow]] = await db.query('SELECT id FROM roles WHERE business_id = ? AND name = ?', [req.tenant.id, d.role]);
  if (!roleRow) return res.status(404).json({ error: `Role ${d.role} tidak ditemukan untuk bisnis ini` });

  const [r] = await db.query(
    'UPDATE business_users SET role_id = ?, status = ? WHERE business_id = ? AND user_id = ?',
    [roleRow.id, 'active', req.tenant.id, req.params.userId]
  );
  if (!r.affectedRows) throw httpErr(404, 'User tidak ditemukan di bisnis ini');

  res.json({ ok: true, user_id: Number(req.params.userId), role: d.role });
}));

router.delete('/business/users/:userId', adminGuard, wrap(async (req, res) => {
  const [r] = await db.query(
    'UPDATE business_users SET status = ? WHERE business_id = ? AND user_id = ? AND user_id <> ?',
    ['inactive', req.tenant.id, req.params.userId, req.uid]
  );
  if (!r.affectedRows) throw httpErr(404, 'User tidak ditemukan atau tidak dapat dihapus');
  res.json({ ok: true, user_id: Number(req.params.userId), status: 'inactive' });
}));

module.exports = router;
