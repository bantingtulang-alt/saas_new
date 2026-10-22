const router = require('express').Router();
const { auth, tenant, requireModule } = require('./auth');
const { wrap, httpErr, today } = require('./util');

const guard = [auth, tenant, requireModule('finance')];
const DATE = require('zod').z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function range(q) { const t = today(); return { from: DATE.safeParse(q.from).success ? q.from : t.slice(0, 8) + '01', to: DATE.safeParse(q.to).success ? q.to : t }; }

router.get('/finance/summary', guard, wrap(async (req, res) => {
  const { from, to } = range(req.query), bid = req.tenant.id;
  const sum = async (table, col) => {
    const [[r]] = await require('./db').query(`SELECT COALESCE(SUM(amount),0) t FROM ${table} WHERE business_id=? AND ${col} BETWEEN ? AND ?`, [bid, from, to]);
    return Number(r.t);
  };
  const income = await sum('incomes', 'income_date'), expense = await sum('expenses', 'expense_date');
  const [cats] = await require('./db').query(
    'SELECT category, SUM(amount) total FROM expenses WHERE business_id=? AND expense_date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC', [bid, from, to]);
  res.json({ from, to, income, expense, profit: income - expense, expense_by_category: cats.map((c) => ({ category: c.category, total: Number(c.total) })) });
}));

module.exports = router;
