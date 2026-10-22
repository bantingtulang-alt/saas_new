const router = require('express').Router();
const { auth } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requireRole } = require('../middleware/permissions');
const { wrap } = require('../util');
const db = require('../db');

router.get('/modules', auth, tenant, wrap(async (req, res) => {
  const [rows] = await db.query(
    `SELECT m.code, m.name, m.description, COALESCE(bm.enabled,0) AS enabled
       FROM modules m LEFT JOIN business_modules bm ON bm.module_id = m.id AND bm.business_id = ?
      WHERE m.is_active = 1 ORDER BY m.id`, [req.tenant.id]);
  res.json(rows.map((r) => ({ ...r, enabled: !!r.enabled })));
}));

router.put('/modules/:code', auth, tenant, requireRole(['owner', 'admin']), wrap(async (req, res) => {
  const { enabled } = require('zod').z.object({ enabled: require('zod').z.boolean() }).parse(req.body);
  const [m] = await db.query('SELECT id FROM modules WHERE code = ? AND is_active = 1', [req.params.code]);
  if (!m.length) return res.status(404).json({ error: 'Modul tidak ditemukan' });
  await db.query(
    `INSERT INTO business_modules (business_id,module_id,enabled) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`, [req.tenant.id, m[0].id, enabled ? 1 : 0]);
  res.json({ code: req.params.code, enabled });
}));

module.exports = router;
