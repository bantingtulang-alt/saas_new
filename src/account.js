// Keamanan akun: verifikasi email, lupa/reset password, ganti password.
const router = require('express').Router();
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const mailer = require('./mailer');
const { sign, auth } = require('./auth');
const { wrap, httpErr } = require('./util');

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const appUrl = () => (process.env.APP_URL || '').replace(/\/$/, '');
const nowSec = () => Math.floor(Date.now() / 1000);
const password = z.string().min(8).max(100);

const mailLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 8, message: { error: 'Terlalu banyak permintaan, coba lagi nanti' } });
const tokenLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, message: { error: 'Terlalu banyak percobaan, coba lagi nanti' } });

// Buat token sekali pakai; token lama jenis yang sama dicabut. Yang disimpan hanya hash-nya.
async function issueToken(userId, type, minutes) {
  const raw = crypto.randomBytes(32).toString('hex');
  await db.query('UPDATE auth_tokens SET used_at = NOW() WHERE user_id = ? AND type = ? AND used_at IS NULL', [userId, type]);
  await db.query('INSERT INTO auth_tokens (user_id,type,token_hash,expires_at) VALUES (?,?,?,DATE_ADD(NOW(), INTERVAL ? MINUTE))',
    [userId, type, sha(raw), minutes]);
  return raw;
}

async function sendVerification(user) {
  const t = await issueToken(user.id, 'verify_email', 24 * 60);
  await mailer.sendVerification(user, `${appUrl()}/#verify=${t}`);
}

async function findValid(raw, type, conn = db) {
  const [r] = await conn.query(
    `SELECT id, user_id FROM auth_tokens
      WHERE token_hash = ? AND type = ? AND used_at IS NULL AND expires_at > NOW() FOR UPDATE`, [sha(String(raw)), type]);
  return r[0] || null;
}

// ---- Verifikasi email ----
router.post('/auth/verify-email', tokenLimit, wrap(async (req, res) => {
  const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.body);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const t = await findValid(token, 'verify_email', conn);
    if (!t) throw httpErr(400, 'Tautan tidak valid atau sudah kedaluwarsa');
    await conn.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = ?', [t.user_id]);
    await conn.query('UPDATE auth_tokens SET used_at = NOW() WHERE id = ?', [t.id]);
    await conn.commit();
    res.json({ verified: true });
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}));

router.post('/auth/resend-verification', auth, mailLimit, wrap(async (req, res) => {
  const [[u]] = await db.query('SELECT id,name,email,email_verified_at FROM users WHERE id = ?', [req.uid]);
  if (u.email_verified_at) return res.json({ sent: false, message: 'Email sudah terverifikasi' });
  try { await sendVerification(u); } catch (e) { console.error('[mail]', e.message); throw httpErr(502, 'Email gagal dikirim, coba lagi nanti'); }
  res.json({ sent: true });
}));

// ---- Lupa & reset password ----
// Selalu membalas sama, baik email terdaftar maupun tidak (tidak membocorkan daftar akun).
router.post('/auth/forgot-password', mailLimit, wrap(async (req, res) => {
  const { email } = z.object({ email: z.string().email().max(191) }).parse(req.body);
  const [r] = await db.query("SELECT id,name,email FROM users WHERE email = ? AND status = 'active'", [email.toLowerCase()]);
  if (r.length) {
    // Tidak ditunggu agar waktu respons tidak membedakan email terdaftar atau tidak.
    issueToken(r[0].id, 'reset_password', 60)
      .then((t) => mailer.sendReset(r[0], `${appUrl()}/#reset=${t}`))
      .catch((e) => console.error('[mail]', e.message));
  }
  res.json({ message: 'Jika email terdaftar, tautan reset password sudah dikirim.' });
}));

router.post('/auth/reset-password', tokenLimit, wrap(async (req, res) => {
  const d = z.object({ token: z.string().min(20).max(200), password }).parse(req.body);
  const hash = await bcrypt.hash(d.password, 12);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const t = await findValid(d.token, 'reset_password', conn);
    if (!t) throw httpErr(400, 'Tautan tidak valid atau sudah kedaluwarsa');
    // Berhasil lewat email = kepemilikan email terbukti, sekaligus mencabut semua sesi lama.
    await conn.query(
      'UPDATE users SET password_hash = ?, password_changed_at = FROM_UNIXTIME(?), email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = ?',
      [hash, nowSec(), t.user_id]);
    await conn.query('UPDATE auth_tokens SET used_at = NOW() WHERE user_id = ? AND type = ? AND used_at IS NULL', [t.user_id, 'reset_password']);
    await conn.commit();
    res.json({ reset: true });
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}));

// ---- Ganti password (sudah login) ----
router.post('/auth/change-password', auth, tokenLimit, wrap(async (req, res) => {
  const d = z.object({ current_password: z.string().min(1), new_password: password }).parse(req.body);
  const [[u]] = await db.query('SELECT id, password_hash FROM users WHERE id = ?', [req.uid]);
  if (!(await bcrypt.compare(d.current_password, u.password_hash))) throw httpErr(400, 'Password saat ini salah');
  await db.query('UPDATE users SET password_hash = ?, password_changed_at = FROM_UNIXTIME(?) WHERE id = ?',
    [await bcrypt.hash(d.new_password, 12), nowSec(), u.id]);
  res.json({ changed: true, token: sign(u) }); // sesi lain otomatis keluar; sesi ini mendapat token baru
}));

module.exports = { router, sendVerification };
