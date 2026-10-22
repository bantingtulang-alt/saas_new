const db = require('../db');

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

module.exports = { requireModule };
