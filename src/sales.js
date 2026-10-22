const router = require('express').Router();
const { z } = require('zod');
const crypto = require('crypto');
const db = require('./db');
const events = require('./events');
const { auth, tenant, requireModule } = require('./auth');
const { wrap, httpErr, today } = require('./util');

const guard = [auth, tenant, requireModule('sales')];
const saleSchema = z.object({
  customer_id: z.coerce.number().int().positive().nullish(),
  items: z.array(z.object({
    variant_id: z.coerce.number().int().positive(),
    quantity: z.coerce.number().positive().max(1000000),
    discount: z.coerce.number().min(0).default(0),
  })).min(1).max(100),
  discount: z.coerce.number().min(0).default(0),
  payment: z.object({ method: z.string().min(1).max(30), amount: z.coerce.number().min(0) }).nullish(),
  notes: z.string().max(1000).nullish(),
});

const invoiceNo = () => {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `INV-${d}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
};

router.post('/sales', guard, wrap(async (req, res) => {
  const d = saleSchema.parse(req.body);
  const bid = req.tenant.id;
  const conn = await db.getConnection();
  let result;
  const inv = invoiceNo();
  const lows = [];
  try {
    await conn.beginTransaction();
    if (d.customer_id) {
      const [c] = await conn.query('SELECT id FROM customers WHERE id=? AND business_id=? AND deleted_at IS NULL', [d.customer_id, bid]);
      if (!c.length) throw httpErr(400, 'Pelanggan tidak valid');
    }
    const [s] = await conn.query(
      "INSERT INTO sales (business_id,customer_id,invoice_number,status,notes,created_by) VALUES (?,?,?,'completed',?,?)",
      [bid, d.customer_id || null, inv, d.notes || null, req.uid]);
    const saleId = s.insertId;
    let subtotal = 0;

    for (const l of d.items) {
      // Harga & stok SELALU dari database, bukan dari klien.
      const [r] = await conn.query(
        `SELECT v.id vid, v.name vname, v.stock_quantity, v.minimum_stock, v.cost_price, i.id iid, i.name iname, i.track_stock,
                (SELECT p.price FROM item_prices p WHERE p.variant_id = v.id AND p.business_id = v.business_id
                   AND p.price_type = 'retail' ORDER BY p.id DESC LIMIT 1) AS price
           FROM item_variants v JOIN items i ON i.id = v.item_id
          WHERE v.id = ? AND v.business_id = ? AND v.deleted_at IS NULL AND i.deleted_at IS NULL AND i.status = 'active'
          FOR UPDATE`, [l.variant_id, bid]);
      if (!r.length) throw httpErr(400, 'Produk tidak ditemukan');
      const v = r[0];
      if (v.price === null) throw httpErr(400, `Harga ${v.iname} belum diatur`);
      if (v.track_stock && Number(v.stock_quantity) < l.quantity)
        throw httpErr(409, `Stok ${v.iname} tidak cukup (sisa ${Number(v.stock_quantity)})`);
      const price = Number(v.price);
      const lineSub = Math.max(0, price * l.quantity - l.discount);
      subtotal += lineSub;
      await conn.query(
        `INSERT INTO sale_items (business_id,sale_id,item_id,variant_id,item_name,variant_name,quantity,unit_price,unit_cost,discount,subtotal)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [bid, saleId, v.iid, v.vid, v.iname, v.vname, l.quantity, price, Number(v.cost_price), l.discount, lineSub]);
      if (v.track_stock) {
        await conn.query('UPDATE item_variants SET stock_quantity = stock_quantity - ? WHERE id=? AND business_id=?', [l.quantity, v.vid, bid]);
        await conn.query(
          "INSERT INTO stock_movements (business_id,item_id,variant_id,type,quantity,reference_type,reference_id,created_by) VALUES (?,?,?,'sale',?,'sale',?,?)",
          [bid, v.iid, v.vid, -l.quantity, saleId, req.uid]);
        const left = Number(v.stock_quantity) - l.quantity;
        if (left <= Number(v.minimum_stock))
          lows.push({ business_id: bid, variant_id: v.vid, item_id: v.iid, item_name: v.iname, stock: left, minimum_stock: Number(v.minimum_stock) });
      }
    }

    const total = Math.max(0, subtotal - d.discount);
    const paid = Math.min(total, d.payment ? d.payment.amount : 0);
    const pstatus = total === 0 || paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
    await conn.query('UPDATE sales SET subtotal=?, discount=?, total=?, payment_status=? WHERE id=? AND business_id=?',
      [subtotal, d.discount, total, pstatus, saleId, bid]);
    if (paid > 0)
      await conn.query("INSERT INTO payments (business_id,sale_id,amount,method,status,paid_at) VALUES (?,?,?,?, 'paid', NOW())",
        [bid, saleId, paid, d.payment.method]);
    if (paid > 0) // pemasukan otomatis masuk ke Keuangan, dalam transaksi yang sama
      await conn.query("INSERT INTO incomes (business_id,category,description,amount,income_date,reference_type,reference_id,created_by) VALUES (?,'Penjualan',?,?,?,'sale',?,?)",
        [bid, inv, paid, today(), saleId, req.uid]);
    if (d.customer_id)
      await conn.query('UPDATE customers SET total_spending = total_spending + ?, last_transaction_at = NOW() WHERE id=? AND business_id=?',
        [total, d.customer_id, bid]);
    await conn.commit();
    result = { id: saleId, subtotal, discount: d.discount, total, paid, change: d.payment ? Math.max(0, d.payment.amount - total) : 0, payment_status: pstatus };
    events.emit('sale.created', { business_id: bid, sale_id: saleId, invoice_number: inv, customer_id: d.customer_id || null, subtotal, total, payment_status: pstatus });
    for (const l of lows) events.emit('stock.low', l);
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
  res.status(201).json(result);
}));

router.get('/sales', guard, wrap(async (req, res) => {
  const [rows] = await db.query(
    `SELECT s.id, s.invoice_number, s.total, s.payment_status, s.status, s.sold_at, c.name AS customer_name
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id AND c.business_id = s.business_id
      WHERE s.business_id = ? ORDER BY s.id DESC LIMIT 50`, [req.tenant.id]);
  res.json(rows);
}));

router.get('/sales/:id', guard, wrap(async (req, res) => {
  const bid = req.tenant.id;
  const [s] = await db.query('SELECT * FROM sales WHERE id=? AND business_id=?', [req.params.id, bid]);
  if (!s.length) throw httpErr(404, 'Transaksi tidak ditemukan');
  const [items] = await db.query('SELECT item_name,variant_name,quantity,unit_price,discount,subtotal FROM sale_items WHERE sale_id=? AND business_id=?', [req.params.id, bid]);
  const [payments] = await db.query('SELECT amount,method,status,paid_at FROM payments WHERE sale_id=? AND business_id=?', [req.params.id, bid]);
  res.json({ ...s[0], items, payments });
}));

router.post('/sales/:id/cancel', guard, wrap(async (req, res) => {
  const bid = req.tenant.id, id = Number(req.params.id);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [s] = await conn.query("SELECT * FROM sales WHERE id=? AND business_id=? AND status='completed' FOR UPDATE", [id, bid]);
    if (!s.length) throw httpErr(404, 'Transaksi tidak ditemukan atau sudah dibatalkan');
    const [lines] = await conn.query(
      `SELECT si.item_id, si.variant_id, si.quantity, i.track_stock FROM sale_items si
         JOIN items i ON i.id = si.item_id WHERE si.sale_id=? AND si.business_id=?`, [id, bid]);
    for (const l of lines) {
      if (!l.track_stock || !l.variant_id) continue;
      await conn.query('UPDATE item_variants SET stock_quantity = stock_quantity + ? WHERE id=? AND business_id=?', [l.quantity, l.variant_id, bid]);
      await conn.query(
        "INSERT INTO stock_movements (business_id,item_id,variant_id,type,quantity,reference_type,reference_id,notes,created_by) VALUES (?,?,?,'return',?,'sale',?,'Pembatalan penjualan',?)",
        [bid, l.item_id, l.variant_id, l.quantity, id, req.uid]);
    }
    await conn.query("UPDATE sales SET status='cancelled', payment_status = IF(payment_status IN ('paid','partial'),'refunded',payment_status) WHERE id=? AND business_id=?", [id, bid]);
    await conn.query("DELETE FROM incomes WHERE business_id=? AND reference_type='sale' AND reference_id=?", [bid, id]);
    await conn.query("UPDATE payments SET status='refunded' WHERE sale_id=? AND business_id=? AND status='paid'", [id, bid]);
    if (s[0].customer_id)
      await conn.query('UPDATE customers SET total_spending = GREATEST(0, total_spending - ?) WHERE id=? AND business_id=?', [s[0].total, s[0].customer_id, bid]);
    await conn.commit();
    events.emit('sale.cancelled', { business_id: bid, sale_id: id });
    res.json({ cancelled: true });
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}));

module.exports = router;
