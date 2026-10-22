// Pengirim email via SMTP (Hostinger: smtp.hostinger.com, port 465, SSL).
const nodemailer = require('nodemailer');

let tx = null;
function transport() {
  if (tx) return tx;
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const port = Number(process.env.SMTP_PORT || 465);
  tx = nodemailer.createTransport({ host: SMTP_HOST, port, secure: port === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  return tx;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function send({ to, subject, text, html }) {
  const t = transport();
  if (!t) throw new Error('SMTP belum dikonfigurasi (SMTP_HOST, SMTP_USER, SMTP_PASS)');
  await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text, html });
}

const button = (url, label) =>
  `<p><a href="${esc(url)}" style="background:#2563eb;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;display:inline-block">${esc(label)}</a></p>` +
  `<p style="color:#667">Jika tombol tidak berfungsi, salin tautan ini:<br>${esc(url)}</p>`;

const sendVerification = (u, url) => send({
  to: u.email, subject: 'Verifikasi email UMKM SaaS',
  text: `Halo ${u.name},\n\nVerifikasi email Anda dengan membuka tautan ini (berlaku 24 jam):\n${url}\n\nAbaikan email ini jika Anda tidak mendaftar.`,
  html: `<p>Halo ${esc(u.name)},</p><p>Verifikasi email Anda (berlaku 24 jam):</p>${button(url, 'Verifikasi email')}<p style="color:#667">Abaikan email ini jika Anda tidak mendaftar.</p>`,
});

const sendReset = (u, url) => send({
  to: u.email, subject: 'Reset password UMKM SaaS',
  text: `Halo ${u.name},\n\nUntuk membuat password baru, buka tautan ini (berlaku 1 jam):\n${url}\n\nJika Anda tidak memintanya, abaikan email ini; password Anda tidak berubah.`,
  html: `<p>Halo ${esc(u.name)},</p><p>Buat password baru (berlaku 1 jam):</p>${button(url, 'Reset password')}<p style="color:#667">Jika Anda tidak memintanya, abaikan email ini; password Anda tidak berubah.</p>`,
});

module.exports = { sendVerification, sendReset };
