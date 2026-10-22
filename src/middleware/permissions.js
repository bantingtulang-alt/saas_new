const ROLE_PERMISSIONS = {
  owner: ['customer:read', 'customer:write', 'items:read', 'items:write', 'sales:read', 'sales:write', 'finance:read', 'finance:write', 'whatsapp:read', 'whatsapp:write', 'automation:read', 'automation:write'],
  admin: ['customer:read', 'customer:write', 'items:read', 'items:write', 'sales:read', 'sales:write', 'finance:read', 'finance:write', 'whatsapp:read', 'whatsapp:write', 'automation:read', 'automation:write'],
  staff: ['customer:read', 'items:read', 'sales:read', 'sales:write', 'finance:read'],
  accountant: ['finance:read', 'finance:write', 'sales:read', 'customer:read'],
};

function normalizeRoles(roles) {
  return Array.isArray(roles) ? roles : [roles];
}

function getPermissionsForRole(role) {
  return ROLE_PERMISSIONS[role] || [];
}

function requireRole(roles) {
  return (req, res, next) => {
    const allowed = normalizeRoles(roles);
    if (!req.tenant || !req.tenant.role) {
      return res.status(403).json({ error: 'Akses bisnis tidak tersedia' });
    }
    if (!allowed.includes(req.tenant.role)) {
      return res.status(403).json({ error: 'Akses ditolak untuk role ini' });
    }
    next();
  };
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.tenant || !Array.isArray(req.tenant.permissions)) {
      return res.status(403).json({ error: 'Hak akses bisnis tidak tersedia' });
    }
    if (!req.tenant.permissions.includes(permission)) {
      return res.status(403).json({ error: `Anda tidak memiliki izin untuk ${permission}` });
    }
    next();
  };
}

module.exports = {
  ROLE_PERMISSIONS,
  getPermissionsForRole,
  requireRole,
  requirePermission,
};
