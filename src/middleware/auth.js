const jwt = require('jsonwebtoken');
const db = require('../db');

const sign = (user) => jwt.sign({ uid: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

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

module.exports = { sign, auth };
