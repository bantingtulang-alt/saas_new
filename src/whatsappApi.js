const router = require('express').Router();
const { z } = require('zod');
const db = require('./db');
const wa = require('./whatsapp');
const { auth, tenant, requireModule } = require('./auth');
const { wrap, httpErr } = require('./util');

const guard = [auth, tenant, requireModule('whatsapp')];
const admin = (req, res, next) => (['owner', 'admin'].includes(req.tenant.role) ? next() : res.status(403).json({ error: 'Hanya owner/admin' }));

router.get('/whatsapp/status', guard, wrap(async (req, res) => res.json(await wa.status(req.tenant.id))));

router.post('/whatsapp/connect', guard, admin, wrap(async (req, res) => {
  try { await wa.connect(req.tenant.id); }
  catch (e) { if (e.code === 'MODULE_NOT_FOUND') throw httpErr(503, 'Pustaka WhatsApp belum terpasang di server (jalankan npm install)'); throw e; }
  res.json({ ok: true });
}));

router.post('/whatsapp/disconnect', guard, admin, wrap(async (req, res) => { await wa.disconnect(req.tenant.id); res.json({ ok: true }); }));

router.put('/whatsapp/settings', guard, admin, wrap(async (req, res) => {
  const { daily_limit } = z.object({ daily_limit: z.coerce.number().int().min(1).max(wa.MAX_DAILY) }).parse(req.body);
  await db.query(
    'INSERT INTO whatsapp_sessions (business_id,daily_limit) VALUES (?,?) ON DUPLICATE KEY UPDATE daily_limit = VALUES(daily_limit)',
    [req.tenant.id, daily_limit]);
  res.json({ daily_limit });
}));

router.post('/whatsapp/test', guard, admin, wrap(async (req, res) => {
  const d = z.object({ phone: z.string().min(5).max(30), message: z.string().min(1).max(1000) }).parse(req.body);
  res.status(202).json({ id: await wa.enqueue(req.tenant.id, { phone: d.phone, body: d.message, source: 'manual' }) });
}));

router.get('/whatsapp/messages', guard, wrap(async (req, res) => {
  const [rows] = await db.query(
    'SELECT id,to_phone,body,status,error,source,created_at,sent_at FROM whatsapp_messages WHERE business_id=? ORDER BY id DESC LIMIT 30', [req.tenant.id]);
  res.json(rows);
}));

module.exports = router;
