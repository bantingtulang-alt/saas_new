const DEFAULT_PORT = 3000;

function validateConfig(env = process.env) {
  const normalized = {
    ...env,
    PORT: env.PORT ? Number(env.PORT) : DEFAULT_PORT,
  };

  const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
  const missing = required.filter((key) => !String(normalized[key] || '').trim());

  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (!normalized.JWT_SECRET || String(normalized.JWT_SECRET).trim().length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters long');
  }

  return normalized;
}

module.exports = {
  DEFAULT_PORT,
  validateConfig,
  config: validateConfig(process.env),
};
