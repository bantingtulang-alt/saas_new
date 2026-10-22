const jwt = require('jsonwebtoken');
const db = require('./db');

const sign = (user) => jwt.sign({ uid: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

// Verifikasi token + cek akun ke database (akun nonaktif, password diganti setelah token terbit,
// dan email belum terverifikasi bila REQUIRE_VERIFIED=1).
async function auth(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Login diperlukan' });
  let p;
  try { p = jwt.verify(h.slice(7), process.env.JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa' }); }
  try {
    const [r] = await db.query(
      'SELECT status, email_verified_at, UNIX_TIMESTAMP(password_changed_at) AS pca FROM users WHERE id = ?', [p.uid]);
    const u = r[0];
    if (!u || u.status !== 'active') return res.status(401).json({ error: 'Akun tidak aktif' });
    if (u.pca && p.iat < Number(u.pca)) return res.status(401).json({ error: 'Password telah diganti, silakan login ulang' });
    req.uid = p.uid;
    req.emailVerified = !!u.email_verified_at;
    next();
  } catch (e) { next(e); }
}

// Tenant diambil dari header, TAPI selalu diverifikasi ke tabel business_users.
async function tenant(req, res, next) {
  try {
    // Semua rute bisnis butuh email terverifikasi bila REQUIRE_VERIFIED=1.
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

const requireModule = (code) => async (req, res, next) => {
  try {
    const [r] = await db.query(
      `SELECT 1 FROM business_modules bm JOIN modules m ON m.id = bm.module_id
        WHERE bm.business_id = ? AND m.code = ? AND bm.enabled = 1`,
      [req.tenant.id, code]
    );
    if (!r.length) return res.status(403).json({ error: `Modul "${code}" belum diaktifkan` });
    next();
  } catch (e) { next(e); }
};

module.exports = { sign, auth, tenant, requireModule };
