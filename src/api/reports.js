const router = require('express').Router();
const { z } = require('zod');
const db = require('../db');
const { auth, tenant, requireModule } = require('../auth');
const { wrap, today } = require('../util');

const guard = [auth, tenant, requireModule('sales')];
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function range(q) {
  const t = today();
  return { from: DATE.safeParse(q.from).success ? q.from : t.slice(0, 8) + '01', to: DATE.safeParse(q.to).success ? q.to : t };
}
const DAY = 'DATE(DATE_ADD(s.sold_at, INTERVAL 7 HOUR))';
const num = (v) => Number(v || 0);

router.get('/reports/sales', guard, wrap(async (req, res) => {
  const { from, to } = range(req.query), bid = req.tenant.id;
  const [rows] = await db.query(
    `SELECT ${DAY} AS day, COUNT(DISTINCT s.id) AS transactions, SUM(si.subtotal) AS gross_sales,
            SUM(si.quantity * COALESCE(si.unit_cost, 0)) AS cogs
       FROM sales s JOIN sale_items si ON si.sale_id = s.id AND si.business_id = s.business_id
      WHERE s.business_id = ? AND s.status = 'completed' AND ${DAY} BETWEEN ? AND ?
      GROUP BY day ORDER BY day`, [bid, from, to]);
  const [disc] = await db.query(
    `SELECT ${DAY} AS day, SUM(s.discount) AS discount FROM sales s
      WHERE s.business_id = ? AND s.status = 'completed' AND ${DAY} BETWEEN ? AND ? GROUP BY day`, [bid, from, to]);
  const dmap = Object.fromEntries(disc.map((d) => [String(d.day).slice(0, 10), num(d.discount)]));
  const days = rows.map((r) => {
    const day = String(r.day).slice(0, 10);
    const sales = num(r.gross_sales) - (dmap[day] || 0), cogs = num(r.cogs);
    return { day, transactions: num(r.transactions), sales, cogs, gross_profit: sales - cogs };
  });
  const sum = days.reduce((a, d) => ({ transactions: a.transactions + d.transactions, sales: a.sales + d.sales, cogs: a.cogs + d.cogs }), { transactions: 0, sales: 0, cogs: 0 });
  res.json({ from, to, ...sum, gross_profit: sum.sales - sum.cogs,
    margin_pct: sum.sales > 0 ? Math.round(((sum.sales - sum.cogs) / sum.sales) * 1000) / 10 : 0, days });
}));

router.get('/reports/top-products', guard, wrap(async (req, res) => {
  const { from, to } = range(req.query), bid = req.tenant.id;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  const [rows] = await db.query(
    `SELECT si.item_id, si.item_name, SUM(si.quantity) AS qty, SUM(si.subtotal) AS revenue,
            SUM(si.subtotal - si.quantity * COALESCE(si.unit_cost, 0)) AS gross_profit
       FROM sales s JOIN sale_items si ON si.sale_id = s.id AND si.business_id = s.business_id
      WHERE s.business_id = ? AND s.status = 'completed' AND ${DAY} BETWEEN ? AND ?
      GROUP BY si.item_id, si.item_name ORDER BY qty DESC, revenue DESC LIMIT ?`, [bid, from, to, limit]);
  res.json(rows.map((r) => ({ item_id: r.item_id, name: r.item_name, qty: num(r.qty), revenue: num(r.revenue), gross_profit: num(r.gross_profit) })));
}));

module.exports = router;
