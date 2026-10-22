const errorHandler = (err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.name === 'ZodError')
    return res.status(400).json({ error: 'Data tidak valid', detail: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Data sudah terdaftar (misalnya email)' });
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan pada server' });
};

module.exports = { errorHandler };
