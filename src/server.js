require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const path = require('path');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET belum diisi atau kurang dari 32 karakter');
  process.exit(1);
}
const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', require('./routes'));
app.use(express.static(path.join(__dirname, '../public')));

app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.name === 'ZodError')
    return res.status(400).json({ error: 'Data tidak valid', detail: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Data sudah terdaftar (misalnya email)' });
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan pada server' });
});

require('./automation').start();
require('./whatsapp').start();
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { require('./whatsapp').stopAll(); process.exit(0); });
app.listen(process.env.PORT || 3000, () => console.log('UMKM SaaS berjalan'));
