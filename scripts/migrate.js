require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    multipleStatements: true,
  });
  const dir = path.join(__dirname, '../db');
  const [t] = await conn.query("SHOW TABLES LIKE 'users'");
  if (t.length) console.log('schema.sql dilewati (tabel sudah ada).');
  else { await conn.query(fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8')); console.log('schema.sql dijalankan.'); }
  // File migrasi tambahan (00x_*.sql) bersifat idempotent (IF NOT EXISTS)
  for (const f of fs.readdirSync(dir).filter((x) => /^\d{3}_.*\.sql$/.test(x)).sort()) {
    await conn.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    console.log(f + ' dijalankan.');
  }
  await conn.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
