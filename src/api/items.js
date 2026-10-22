const router = require('express').Router();
const { z } = require('zod');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requireModule } = require('../middleware/requireModule');
const { wrap, httpErr, planLimit } = require('../util');

const guard = [auth, tenant, requireModule('items')];
const itemSchema = z.object({
  name: z.string().min(1).max(150),
  type: z.enum(['product', 'service']).default('product'),
  sku: z.string().max(100).nullish(),
  price: z.coerce.number().min(0),
  cost_price: z.coerce.number().min(0).default(0),
  stock: z.coerce.number().min(0).default(0),
  minimum_stock: z.coerce.number().min(0).default(0),
});

const LIST_SQL = `
  SELECT i.id, i.name, i.type, i.sku, i.track_stock, v.id AS variant_id, v.cost_price,
         v.stock_quantity, v.minimum_stock,
         (SELECT p.price FROM item_prices p WHERE p.variant_id = v.id AND p.business_id = i.business_id
            AND p.price_type = 'retail' ORDER BY p.id DESC LIMIT 1) AS price
    FROM items i JOIN item_variants v ON v.item_id = i.id AND v.deleted_at IS NULL
   WHERE i.business_id = ? AND i.deleted_at IS NULL`;

router.get('/items', guard, wrap(async (req, res) => {
  const [rows] = await db.query(LIST_SQL + ' ORDER BY i.id DESC', [req.tenant.id]);
  res.json(rows);
}));

router.post('/items', guard, wrap(async (req, res) => {
  const d = itemSchema.parse(req.body);
  const bid = req.tenant.id;
  const lim = await planLimit(bid, 'max_items');
  if (lim !== null) {
    const [[c]] = await db.query('SELECT COUNT(*) n FROM items WHERE business_id = ? AND deleted_at IS NULL', [bid]);
    if (c.n >= lim) throw httpErr(402, 'Batas produk paket Anda tercapai');
  }
  const track = d.type === 'product';
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [i] = await conn.query('INSERT INTO items (business_id,sku,name,type,track_stock) VALUES (?,?,?,?,?)',
      [bid, d.sku || null, d.name, d.type, track ? 1 : 0]);
    const [v] = await conn.query(
      'INSERT INTO item_variants (business_id,item_id,name,cost_price,stock_quantity,minimum_stock) VALUES (?,?,?,?,?,?)',
      [bid, i.insertId, 'Default', d.cost_price, track ? d.stock : 0, d.minimum_stock]);
    await conn.query("INSERT INTO item_prices (business_id,item_id,variant_id,price_type,price) VALUES (?,?,?,'retail',?)",
      [bid, i.insertId, v.insertId, d.price]);
    if (track && d.stock > 0)
      await conn.query("INSERT INTO stock_movements (business_id,item_id,variant_id,type,quantity,notes,created_by) VALUES (?,?,?,'opening',?,'Stok awal',?)",
        [bid, i.insertId, v.insertId, d.stock, req.uid]);
    await conn.commit();
    res.status(201).json({ id: i.insertId, variant_id: v.insertId });
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}));

async function variantOf(bid, itemId) {
  const [r] = await db.query(
    'SELECT id FROM item_variants WHERE item_id = ? AND business_id = ? AND deleted_at IS NULL ORDER BY id LIMIT 1', [itemId, bid]);
  if (!r.length) throw httpErr(404, 'Produk tidak ditemukan');
  return r[0].id;
}

router.put('/items/:id', guard, wrap(async (req, res) => {
  const d = itemSchema.omit({ stock: true, type: true }).extend({ cost_price: z.coerce.number().min(0).optional() }).parse(req.body);
  const bid = req.tenant.id, id = Number(req.params.id);
  const vid = await variantOf(bid, id);
  await db.query('UPDATE items SET name=?, sku=? WHERE id=? AND business_id=?', [d.name, d.sku || null, id, bid]);
  await db.query('UPDATE item_variants SET cost_price=COALESCE(?,cost_price), minimum_stock=? WHERE id=? AND business_id=?', [d.cost_price ?? null, d.minimum_stock, vid, bid]);
  const [[cur]] = await db.query(
    "SELECT price FROM item_prices WHERE variant_id=? AND business_id=? AND price_type='retail' ORDER BY id DESC LIMIT 1", [vid, bid]);
  if (!cur || Number(cur.price) !== d.price)
    await db.query("INSERT INTO item_prices (business_id,item_id,variant_id,price_type,price) VALUES (?,?,?,'retail',?)", [bid, id, vid, d.price]);
  res.json({ id });
}));

router.post('/items/:id/adjust', guard, wrap(async (req, res) => {
  const d = z.object({ quantity: z.coerce.number().refine((n) => n !== 0), notes: z.string().max(255).nullish() }).parse(req.body);
  const bid = req.tenant.id, id = Number(req.params.id);
  const vid = await variantOf(bid, id);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[v]] = await conn.query('SELECT stock_quantity FROM item_variants WHERE id=? AND business_id=? FOR UPDATE', [vid, bid]);
    if (Number(v.stock_quantity) + d.quantity < 0) throw httpErr(409, 'Stok tidak boleh negatif');
    await conn.query('UPDATE item_variants SET stock_quantity = stock_quantity + ? WHERE id=? AND business_id=?', [d.quantity, vid, bid]);
    await conn.query("INSERT INTO stock_movements (business_id,item_id,variant_id,type,quantity,notes,created_by) VALUES (?,?,?,'adjustment',?,?,?)",
      [bid, id, vid, d.quantity, d.notes || null, req.uid]);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}));

router.delete('/items/:id', guard, wrap(async (req, res) => {
  const bid = req.tenant.id;
  const [r] = await db.query('UPDATE items SET deleted_at = NOW() WHERE id=? AND business_id=? AND deleted_at IS NULL', [req.params.id, bid]);
  if (!r.affectedRows) throw httpErr(404, 'Produk tidak ditemukan');
  await db.query('UPDATE item_variants SET deleted_at = NOW() WHERE item_id=? AND business_id=?', [req.params.id, bid]);
  res.json({ deleted: true });
}));

module.exports = router;
