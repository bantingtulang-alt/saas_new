// WhatsApp via Baileys (WhatsApp Web, tidak resmi). Satu sesi per bisnis, berjalan di proses yang sama.
// Pengiriman lewat antrean: jeda acak antar pesan per bisnis + batas harian, agar akun tidak terlihat seperti spam.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { httpErr, today } = require('./util');
const { normalizePhone, rp } = require('./waUtil');

const DIR = process.env.WA_SESSION_DIR || path.join(__dirname, '../wa_sessions'); // simpan DI LUAR folder public
const DELAY_MIN = Number(process.env.WA_DELAY_MIN || 8) * 1000;
const DELAY_MAX = Math.max(DELAY_MIN, Number(process.env.WA_DELAY_MAX || 20) * 1000);
const MAX_SESSIONS = Number(process.env.WA_MAX_SESSIONS || 5);
const MAX_DAILY = Number(process.env.WA_MAX_DAILY || 200);
const MAX_BACKLOG = 100;

const sessions = new Map(); // businessId -> { sock, status, qr, phone, nextAt, busy, stopping }
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dirOf = (bid) => path.join(DIR, String(Number(bid)));

let lib = null; // dimuat saat dibutuhkan agar aplikasi tetap hidup walau Baileys belum terpasang
function baileys() {
  if (!lib) lib = { B: require('@whiskeysockets/baileys'), logger: require('pino')({ level: 'silent' }) };
  return lib;
}

async function persist(bid, status, phone = null) {
  await db.query(
    `INSERT INTO whatsapp_sessions (business_id,status,phone) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE status = VALUES(status), phone = VALUES(phone)`, [bid, status, phone]);
}
async function setStatus(bid, s, status) { s.status = status; await persist(bid, status, s.phone); }

async function connect(bid, retries = 0) {
  const cur = sessions.get(bid);
  if (cur && ['connected', 'connecting', 'qr'].includes(cur.status)) return cur;
  if (!cur && sessions.size >= MAX_SESSIONS) throw httpErr(503, 'Kapasitas WhatsApp di server ini penuh');
  const { B, logger } = baileys();
  const makeWASocket = B.default || B.makeWASocket;
  fs.mkdirSync(dirOf(bid), { recursive: true });
  const { state, saveCreds } = await B.useMultiFileAuthState(dirOf(bid));
  let version;
  try { ({ version } = await B.fetchLatestBaileysVersion()); } catch { /* pakai versi bawaan */ }

  const sock = makeWASocket({ auth: state, version, logger, browser: ['UMKM SaaS', 'Chrome', '1.0'],
    printQRInTerminal: false, markOnlineOnConnect: false, syncFullHistory: false });
  const s = { sock, status: 'connecting', qr: null, phone: cur?.phone || null, nextAt: Date.now() + 5000, busy: false, stopping: false };
  sessions.set(bid, s);
  await persist(bid, 'connecting', s.phone);

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (u) => {
    try {
      if (u.qr) { s.qr = u.qr; await setStatus(bid, s, 'qr'); }
      if (u.connection === 'open') {
        s.qr = null;
        s.phone = String(sock.user?.id || '').split(':')[0].split('@')[0] || null;
        await setStatus(bid, s, 'connected');
      }
      if (u.connection === 'close') {
        if (s.stopping) return;
        const code = u.lastDisconnect?.error?.output?.statusCode;
        if (sessions.get(bid) === s) sessions.delete(bid);
        if (code === B.DisconnectReason.loggedOut) { // perangkat dikeluarkan dari HP
          fs.rmSync(dirOf(bid), { recursive: true, force: true });
          await failQueued(bid, 'WhatsApp terputus dari HP');
          return persist(bid, 'logged_out', null);
        }
        if (code === B.DisconnectReason.timedOut && s.status === 'qr') // QR tidak dipindai
          return persist(bid, 'disconnected', null);
        const wait = code === B.DisconnectReason.restartRequired ? 500 : Math.min(60000, 3000 * 2 ** retries);
        await persist(bid, 'connecting', s.phone);
        setTimeout(() => connect(bid, code === B.DisconnectReason.restartRequired ? 0 : retries + 1)
          .catch((e) => console.error('[wa] reconnect', bid, e.message)), wait);
      }
    } catch (e) { console.error('[wa] event', bid, e.message); }
  });
  return s;
}

async function failQueued(bid, why) {
  await db.query("UPDATE whatsapp_messages SET status='failed', error=? WHERE business_id=? AND status IN ('queued','sending')", [why, bid]);
}

async function disconnect(bid) {
  const s = sessions.get(bid);
  if (s) {
    s.stopping = true;
    try { await s.sock.logout(); } catch { try { s.sock.end(); } catch { /* sudah putus */ } }
    sessions.delete(bid);
  }
  fs.rmSync(dirOf(bid), { recursive: true, force: true });
  await failQueued(bid, 'WhatsApp diputus');
  await persist(bid, 'disconnected', null);
}

// ---------- Antrean ----------
async function sentToday(bid) {
  const [[c]] = await db.query(
    `SELECT COUNT(*) n FROM whatsapp_messages WHERE business_id=? AND status IN ('queued','sending','sent')
        AND DATE(DATE_ADD(created_at, INTERVAL 7 HOUR)) = ?`, [bid, today()]);
  return c.n;
}

async function enqueue(bid, { phone, body, source = 'automation' }) {
  const to = normalizePhone(phone);
  if (!to) throw httpErr(400, 'Nomor HP tidak valid');
  const [[ss]] = await db.query('SELECT status, daily_limit FROM whatsapp_sessions WHERE business_id=?', [bid]);
  if (!ss || !['connected', 'connecting'].includes(ss.status)) throw httpErr(409, 'WhatsApp belum terhubung');
  if ((await sentToday(bid)) >= ss.daily_limit) throw httpErr(429, `Batas harian WhatsApp tercapai (${ss.daily_limit} pesan)`);
  const [[q]] = await db.query("SELECT COUNT(*) n FROM whatsapp_messages WHERE business_id=? AND status IN ('queued','sending')", [bid]);
  if (q.n >= MAX_BACKLOG) throw httpErr(429, 'Antrean WhatsApp penuh, coba lagi nanti');
  const [r] = await db.query('INSERT INTO whatsapp_messages (business_id,to_phone,body,source) VALUES (?,?,?,?)', [bid, to, String(body).slice(0, 3000), source]);
  return r.insertId;
}

async function processOne(bid, s) {
  const [rows] = await db.query("SELECT id,to_phone,body,attempts FROM whatsapp_messages WHERE business_id=? AND status='queued' ORDER BY id LIMIT 1", [bid]);
  if (!rows.length) return;
  const m = rows[0];
  const [u] = await db.query("UPDATE whatsapp_messages SET status='sending', attempts=attempts+1 WHERE id=? AND business_id=? AND status='queued'", [m.id, bid]);
  if (!u.affectedRows) return;
  try {
    const jid = `${m.to_phone}@s.whatsapp.net`;
    const [ex] = await s.sock.onWhatsApp(jid);
    if (!ex || !ex.exists) {
      await db.query("UPDATE whatsapp_messages SET status='failed', error='Nomor tidak terdaftar di WhatsApp' WHERE id=? AND business_id=?", [m.id, bid]);
      s.nextAt = Date.now() + 2000;
      return;
    }
    const to = ex.jid || jid;
    try { await s.sock.presenceSubscribe(to); await s.sock.sendPresenceUpdate('composing', to); await sleep(rand(1500, 3500)); await s.sock.sendPresenceUpdate('paused', to); } catch { /* tidak kritis */ }
    await s.sock.sendMessage(to, { text: m.body });
    await db.query("UPDATE whatsapp_messages SET status='sent', error=NULL, sent_at=NOW() WHERE id=? AND business_id=?", [m.id, bid]);
  } catch (e) {
    const final = m.attempts + 1 >= 3;
    await db.query('UPDATE whatsapp_messages SET status=?, error=? WHERE id=? AND business_id=?', [final ? 'failed' : 'queued', String(e.message).slice(0, 250), m.id, bid]);
  }
  s.nextAt = Date.now() + rand(DELAY_MIN, DELAY_MAX); // jeda acak sebelum pesan berikutnya
}

function tick() {
  for (const [bid, s] of sessions) {
    if (s.status !== 'connected' || s.busy || Date.now() < s.nextAt) continue;
    s.busy = true;
    processOne(bid, s).catch((e) => console.error('[wa] kirim', bid, e.message)).finally(() => { s.busy = false; });
  }
}

// ---------- Status & util ----------
async function status(bid) {
  const [[ss]] = await db.query('SELECT status, phone, daily_limit FROM whatsapp_sessions WHERE business_id=?', [bid]);
  const s = sessions.get(bid);
  const st = s ? s.status : ss && ss.status === 'connected' ? 'connecting' : ss ? ss.status : 'disconnected';
  let qr = null;
  if (s && s.status === 'qr' && s.qr) qr = await require('qrcode').toDataURL(s.qr, { margin: 1, width: 280 });
  const [[q]] = await db.query("SELECT COUNT(*) n FROM whatsapp_messages WHERE business_id=? AND status IN ('queued','sending')", [bid]);
  return { status: st, phone: (s && s.phone) || (ss && ss.phone) || null, qr,
    daily_limit: ss ? ss.daily_limit : 30, max_daily: MAX_DAILY, sent_today: await sentToday(bid), queued: q.n };
}

async function receiptText(bid, saleId) {
  const [[s]] = await db.query(
    `SELECT s.invoice_number, s.total, s.discount, s.payment_status, b.name AS business
       FROM sales s JOIN businesses b ON b.id = s.business_id WHERE s.id=? AND s.business_id=?`, [saleId, bid]);
  if (!s) return '';
  const [items] = await db.query('SELECT item_name, quantity, unit_price, subtotal FROM sale_items WHERE sale_id=? AND business_id=?', [saleId, bid]);
  const [[p]] = await db.query("SELECT COALESCE(SUM(amount),0) paid FROM payments WHERE sale_id=? AND business_id=? AND status='paid'", [saleId, bid]);
  const lines = items.map((i) => `${Number(i.quantity)}x ${i.item_name} @ ${rp(i.unit_price)} = ${rp(i.subtotal)}`);
  const out = [`*${s.business}*`, `Struk ${s.invoice_number}`, '', ...lines];
  if (Number(s.discount) > 0) out.push(`Diskon: ${rp(s.discount)}`);
  out.push(`*Total: ${rp(s.total)}*`);
  out.push(Number(p.paid) >= Number(s.total) ? 'Status: Lunas' : `Dibayar: ${rp(p.paid)} (sisa ${rp(Number(s.total) - Number(p.paid))})`);
  return out.join('\n');
}

// Dipanggil saat server start: pulihkan pesan 'sending' yang tertinggal & sambungkan ulang sesi tersimpan.
async function start() {
  try {
    await db.query("UPDATE whatsapp_messages SET status='queued' WHERE status='sending'");
    const [rows] = await db.query("SELECT business_id FROM whatsapp_sessions WHERE status IN ('connected','connecting','qr')");
    let i = 0;
    for (const r of rows) {
      if (!fs.existsSync(path.join(dirOf(r.business_id), 'creds.json'))) { await persist(r.business_id, 'disconnected', null); continue; }
      setTimeout(() => connect(r.business_id).catch((e) => console.error('[wa] resume', r.business_id, e.message)), 2000 * i++);
    }
    setInterval(tick, 3000).unref();
  } catch (e) { console.error('[wa] start', e.message); }
}

function stopAll() { for (const s of sessions.values()) { s.stopping = true; try { s.sock.end(); } catch { /* abaikan */ } } }

module.exports = { start, stopAll, connect, disconnect, enqueue, status, receiptText, MAX_DAILY };
