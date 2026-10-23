const { auth } = require('./middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requireRole, requirePermission } = require('../middleware/permissions');
const { sign, auth: authMiddleware } = require('./middleware/auth');

module.exports = { sign, auth: authMiddleware, tenant, requireRole, requirePermission };
