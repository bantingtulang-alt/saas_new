const router = require('express').Router();
const { z } = require('zod');
const db = require('../db');
const events = require('../events');
const { auth } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requireModule } = require('../middleware/requireModule');
const { wrap } = require('../util');

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

module.exports = router;
