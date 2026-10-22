const router = require('express').Router();
const { auth } = require('./auth');
const { tenant } = require('./tenant');
const { wrap } = require('../util');

router.get('/permissions', auth, tenant, wrap(async (req, res) => {
  res.json({
    role: req.tenant.role,
    permissions: req.tenant.permissions || [],
  });
}));

module.exports = router;
