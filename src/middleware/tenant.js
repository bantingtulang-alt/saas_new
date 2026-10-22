const db = require('../db');

async function tenant(req, res, next) {
  try {
    if (process.env.REQUIRE_VERIFIED === '1' && !req.emailVerified)
      return res.status(403).json({ error: 'Verifikasi email Anda terlebih dahulu', code: 'email_unverified' });
    const bid = Number(req.headers['x-business-id']);
    if (!bid) return res.status(400).json({ error: 'Header X-Business-Id wajib' });
    const [r] = await db.query(
      `SELECT ro.name AS role FROM business_users bu
         JOIN roles ro ON ro.id = bu.role_id
         JOIN businesses b ON b.id = bu.business_id
        WHERE bu.user_id = ? AND bu.business_id = ? AND bu.status = 'active' AND b.status = 'active'`,
      [req.uid, bid]
    );
    if (!r.length) return res.status(403).json({ error: 'Anda tidak punya akses ke bisnis ini' });
    req.tenant = { id: bid, role: r[0].role };
    next();
  } catch (e) { next(e); }
}

module.exports = { tenant };
