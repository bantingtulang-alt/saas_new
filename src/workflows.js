const router = require('express').Router();
const { z } = require('zod');
const db = require('./db');
const { auth, tenant, requireModule } = require('./auth');
const { wrap, httpErr, planLimit } = require('./util');
const { TRIGGERS, OPS } = require('./automation');
const { normalizePhone } = require('./waUtil');

const guard = [auth, tenant, requireModule('automation')];

const wfSchema = z.object({
  name: z.string().min(1).max(150),
  trigger: z.enum(Object.keys(TRIGGERS)),
  conditions: z.array(z.object({
    field: z.string().max(100),
    operator: z.enum(Object.keys(OPS)),
    value: z.union([z.string(), z.number()]).transform(String),
    logical: z.enum(['AND', 'OR']).default('AND'),
  })).max(5).default([]),
  actions: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('notification'),
      config: z.object({ title: z.string().min(1).max(150), message: z.string().max(1000).default('') }) }),
    z.object({ type: z.literal('whatsapp'),
      config: z.object({ to: z.string().max(30).default('customer'), message: z.string().min(1).max(1000), include_receipt: z.boolean().default(false) }) }),
  ])).min(1).max(5),
  status: z.enum(['active', 'paused']).default('active'),
});

router.get('/automation/meta', guard, (req, res) => {
  res.json({ triggers: TRIGGERS, operators: Object.keys(OPS), actions: ['notification', 'whatsapp'] });
});

router.get('/workflows', guard, wrap(async (req, res) => {
  const bid = req.tenant.id;
  const [wfs] = await db.query(
    `SELECT w.id, w.name, w.status, w.trigger_type, w.created_at FROM workflows w
      WHERE w.business_id=? AND w.status <> 'archived' ORDER BY w.id DESC`, [bid]);
  if (!wfs.length) return res.json([]);
  const ids = wfs.map((w) => w.id);
  const [conds] = await db.query('SELECT workflow_id,field_path,operator,value,logical_operator FROM workflow_conditions WHERE workflow_id IN (?) ORDER BY sort_order,id', [ids]);
  const [acts] = await db.query('SELECT workflow_id,action_type,config FROM workflow_actions WHERE workflow_id IN (?) ORDER BY sort_order,id', [ids]);
  res.json(wfs.map((w) => ({
    ...w,
    conditions: conds.filter((c) => c.workflow_id === w.id),
    actions: acts.filter((a) => a.workflow_id === w.id).map((a) => ({ ...a, config: typeof a.config === 'string' ? JSON.parse(a.config) : a.config })),
  })));
}));

router.post('/workflows', guard, wrap(async (req, res) => {
  const d = wfSchema.parse(req.body);
  const bid = req.tenant.id;
  for (const a of d.actions) {
    if (a.type !== 'whatsapp') continue;
    if (a.config.to !== 'customer' && !normalizePhone(a.config.to)) throw httpErr(400, 'Nomor tujuan WhatsApp tidak valid');
    const [m] = await db.query("SELECT 1 FROM business_modules bm JOIN modules mo ON mo.id=bm.module_id WHERE bm.business_id=? AND mo.code='whatsapp' AND bm.enabled=1", [bid]);
    if (!m.length) throw httpErr(400, 'Aktifkan modul WhatsApp terlebih dahulu');
  }
  const allowed = TRIGGERS[d.trigger].fields;
  for (const c of d.conditions) if (!allowed.includes(c.field)) throw httpErr(400, `Field "${c.field}" tidak tersedia untuk trigger ini`);
  const lim = await planLimit(bid, 'max_automations');
  if (lim !== null) {
    const [[n]] = await db.query("SELECT COUNT(*) n FROM workflows WHERE business_id=? AND status <> 'archived'", [bid]);
    if (n.n >= lim) throw httpErr(402, 'Batas automasi paket Anda tercapai');
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [w] = await conn.query('INSERT INTO workflows (business_id,name,status,trigger_type,created_by) VALUES (?,?,?,?,?)',
      [bid, d.name, d.status, d.trigger, req.uid]);
    await conn.query('INSERT INTO workflow_triggers (workflow_id,event_name) VALUES (?,?)', [w.insertId, d.trigger]);
    for (const [i, c] of d.conditions.entries())
      await conn.query('INSERT INTO workflow_conditions (workflow_id,field_path,operator,value,logical_operator,sort_order) VALUES (?,?,?,?,?,?)',
        [w.insertId, c.field, c.operator, c.value, c.logical, i]);
    for (const [i, a] of d.actions.entries())
      await conn.query('INSERT INTO workflow_actions (workflow_id,action_type,config,sort_order) VALUES (?,?,?,?)',
        [w.insertId, a.type, JSON.stringify(a.config), i]);
    await conn.commit();
    res.status(201).json({ id: w.insertId });
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}));

router.patch('/workflows/:id/status', guard, wrap(async (req, res) => {
  const { status } = z.object({ status: z.enum(['active', 'paused']) }).parse(req.body);
  const [r] = await db.query("UPDATE workflows SET status=? WHERE id=? AND business_id=? AND status <> 'archived'", [status, req.params.id, req.tenant.id]);
  if (!r.affectedRows) throw httpErr(404, 'Automasi tidak ditemukan');
  res.json({ status });
}));

router.delete('/workflows/:id', guard, wrap(async (req, res) => {
  const [r] = await db.query("UPDATE workflows SET status='archived' WHERE id=? AND business_id=? AND status <> 'archived'", [req.params.id, req.tenant.id]);
  if (!r.affectedRows) throw httpErr(404, 'Automasi tidak ditemukan');
  res.json({ deleted: true });
}));

router.get('/automation/runs', guard, wrap(async (req, res) => {
  const [rows] = await db.query(
    `SELECT r.id, w.name AS workflow, r.trigger_event, r.status, r.started_at, r.error_message
       FROM automation_runs r JOIN workflows w ON w.id = r.workflow_id AND w.business_id = r.business_id
      WHERE r.business_id=? ORDER BY r.id DESC LIMIT 30`, [req.tenant.id]);
  res.json(rows);
}));

// Notifikasi dalam aplikasi
router.get('/notifications', auth, tenant, wrap(async (req, res) => {
  const [rows] = await db.query('SELECT id,title,message,is_read,created_at FROM notifications WHERE business_id=? ORDER BY id DESC LIMIT 30', [req.tenant.id]);
  res.json(rows.map((r) => ({ ...r, is_read: !!r.is_read })));
}));
router.post('/notifications/read-all', auth, tenant, wrap(async (req, res) => {
  await db.query('UPDATE notifications SET is_read=1 WHERE business_id=? AND is_read=0', [req.tenant.id]);
  res.json({ ok: true });
}));

module.exports = router;
