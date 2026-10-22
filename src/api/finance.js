const router = require('express').Router();
const { z } = require('zod');
const db = require('../db');
const { auth, tenant, requireModule } = require('../auth');
const { wrap, httpErr, today } = require('../util');

const guard = [auth, tenant, requireModule('finance')];
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function range(q) {
  const t = today();
  return { from: DATE.safeParse(q.from).success ? q.from : t.slice(0, 8) + '01', to: DATE.safeParse(q.to).success ? q.to : t };
}

router.get('/finance/summary', guard, wrap(async (req, res) => {
  const { from, to } = range(req.query), bid = req.tenant.id;
  const sum = async (table, col) => {
    const [[r]] = await db.query(`SELECT COALESCE(SUM(amount),0) t FROM ${table} WHERE business_id=? AND ${col} BETWEEN ? AND ?`, [bid, from, to]);
    return Number(r.t);
  };
  const income = await sum('incomes', 'income_date'), expense = await sum('expenses', 'expense_date');
  const [cats] = await db.query(
    'SELECT category, SUM(amount) total FROM expenses WHERE business_id=? AND expense_date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC', [bid, from, to]);
  res.json({ from, to, income, expense, profit: income - expense, expense_by_category: cats.map((c) => ({ category: c.category, total: Number(c.total) })) });
}));

router.get('/finance/transactions', guard, wrap(async (req, res) => {
  const { from, to } = range(req.query), bid = req.tenant.id;
  const [rows] = await db.query(
    `(SELECT 'income' AS kind, id, category, description, amount, income_date AS d, reference_type
        FROM incomes WHERE business_id=? AND income_date BETWEEN ? AND ?)
     UNION ALL
     (SELECT 'expense', id, category, description, amount, expense_date, NULL
        FROM expenses WHERE business_id=? AND expense_date BETWEEN ? AND ?)
     ORDER BY d DESC, id DESC LIMIT 100`, [bid, from, to, bid, from, to]);
  res.json(rows);
}));

const entry = z.object({
  category: z.string().min(1).max(100),
  description: z.string().max(500).nullish(),
  amount: z.coerce.number().positive().max(1e12),
  date: DATE.optional(),
  payment_method: z.string().max(30).nullish(),
});

router.post('/finance/expenses', guard, wrap(async (req, res) => {
  const d = entry.parse(req.body);
  const [r] = await db.query(
    'INSERT INTO expenses (business_id,category,description,amount,payment_method,expense_date,created_by) VALUES (?,?,?,?,?,?,?)',
    [req.tenant.id, d.category, d.description || null, d.amount, d.payment_method || null, d.date || today(), req.uid]);
  res.status(201).json({ id: r.insertId });
}));

router.post('/finance/incomes', guard, wrap(async (req, res) => {
  const d = entry.parse(req.body);
  const [r] = await db.query(
    'INSERT INTO incomes (business_id,category,description,amount,income_date,created_by) VALUES (?,?,?,?,?,?)',
    [req.tenant.id, d.category, d.description || null, d.amount, d.date || today(), req.uid]);
  res.status(201).json({ id: r.insertId });
}));

router.delete('/finance/expenses/:id', guard, wrap(async (req, res) => {
  const [r] = await db.query('DELETE FROM expenses WHERE id=? AND business_id=?', [req.params.id, req.tenant.id]);
  if (!r.affectedRows) throw httpErr(404, 'Data tidak ditemukan');
  res.json({ deleted: true });
}));

router.delete('/finance/incomes/:id', guard, wrap(async (req, res) => {
  const [r] = await db.query('DELETE FROM incomes WHERE id=? AND business_id=? AND reference_type IS NULL', [req.params.id, req.tenant.id]);
  if (!r.affectedRows) throw httpErr(404, 'Data tidak ditemukan atau berasal dari penjualan');
  res.json({ deleted: true });
}));

module.exports = router;
