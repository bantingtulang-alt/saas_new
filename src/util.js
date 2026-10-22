const db = require('./db');
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const httpErr = (status, message) => Object.assign(new Error(message), { status });

// Ambil batas paket aktif untuk bisnis. col: max_items | max_customers | ...
async function planLimit(bid, col) {
  const [[p]] = await db.query(
    `SELECT p.${col} AS lim FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.business_id = ? AND s.status IN ('trial','active') AND s.current_period_end > NOW()
      ORDER BY s.id DESC LIMIT 1`, [bid]);
  if (!p) throw httpErr(402, 'Langganan tidak aktif');
  return p.lim;
}
module.exports = { wrap, httpErr, planLimit };

// Tanggal hari ini di zona waktu Jakarta (YYYY-MM-DD)
module.exports.today = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
