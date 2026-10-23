const { sign, auth } = require('./middleware/auth');
const { tenant } = require('./middleware/tenant');
const { requireRole, requirePermission } = require('./middleware/permissions');
const { requireModule } = require('./middleware/requireModule');

module.exports = {
  sign,
  auth,
  tenant,
  requireRole,
  requirePermission,
  requireModule,
};
