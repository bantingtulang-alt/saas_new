// Automation Engine: Event -> cari workflow aktif -> cek kondisi -> jalankan aksi -> catat log.
const db = require('./db');
const events = require('./events');
const { rp } = require('./waUtil');

// Trigger yang didukung beserta field yang boleh dipakai di kondisi & template {{field}}
const TRIGGERS = {
  'sale.created': { label: 'Penjualan baru', entity: ['sale', 'sale_id'], fields: ['total', 'subtotal', 'payment_status', 'invoice_number', 'customer_id'] },
  'stock.low': { label: 'Stok menipis', entity: ['variant', 'variant_id'], fields: ['stock', 'minimum_stock', 'item_name'] },
  'customer.created': { label: 'Pelanggan baru', entity: ['customer', 'customer_id'], fields: ['name', 'phone'] },
};

const OPS = {
  eq: (a, b) => String(a) === String(b),
  ne: (a, b) => String(a) !== String(b),
  gt: (a, b) => Number(a) > Number(b),
  gte: (a, b) => Number(a) >= Number(b),
  lt: (a, b) => Number(a) < Number(b),
  lte: (a, b) => Number(a) <= Number(b),
  contains: (a, b) => String(a ?? '').toLowerCase().includes(String(b).toLowerCase()),
};

const render = (tpl, p) => String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (p[k] === undefined || p[k] === null ? '' : String(p[k])));

// Daftar aksi. Tambah aksi baru (WhatsApp, email, dll.) cukup dengan menambah fungsi di sini.
const ACTIONS = {
  async notification(cfg, payload, ctx) {
    await db.query('INSERT INTO notifications (business_id,title,message,source) VALUES (?,?,?,?)',
      [ctx.business_id, render(cfg.title, payload).slice(0, 150), render(cfg.message, payload), 'automation']);
    return { created: true };
  },

  // Antrean pesan WhatsApp. to = 'customer' (nomor pelanggan pada event) atau nomor tetap (mis. nomor pemilik).
  async whatsapp(cfg, payload, ctx) {
    const wa = require('./whatsapp');
    const p = { ...payload };
    if (p.total !== undefined) p.total_rp = rp(p.total);
    let phone = cfg.to;
    if (!phone || phone === 'customer') {
      if (!p.customer_id) return { skipped: 'transaksi tanpa pelanggan' };
      const [[c]] = await db.query('SELECT name, phone FROM customers WHERE id=? AND business_id=? AND deleted_at IS NULL', [p.customer_id, ctx.business_id]);
      if (!c || !c.phone) return { skipped: 'pelanggan tanpa nomor HP' };
      phone = c.phone; p.customer_name = c.name;
    } else if (p.customer_id) {
      const [[c]] = await db.query('SELECT name FROM customers WHERE id=? AND business_id=?', [p.customer_id, ctx.business_id]);
      if (c) p.customer_name = c.name;
    }
    let body = render(cfg.message, p);
    if (cfg.include_receipt && p.sale_id) body += '\n\n' + await wa.receiptText(ctx.business_id, p.sale_id);
    return { queued: await wa.enqueue(ctx.business_id, { phone, body, source: 'automation' }) };
  },
};

function passes(conds, p) {
  if (!conds.length) return true;
  let res = null;
  for (const c of conds) {
    const fn = OPS[c.operator];
    const ok = fn ? fn(p[c.field_path], c.value) : false;
    res = res === null ? ok : c.logical_operator === 'OR' ? res || ok : res && ok;
  }
  return res;
}

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v || {});

async function handle(event, payload) {
  const bid = payload.business_id;
  const [mod] = await db.query(
    "SELECT 1 FROM business_modules bm JOIN modules m ON m.id = bm.module_id WHERE bm.business_id=? AND m.code='automation' AND bm.enabled=1", [bid]);
  if (!mod.length) return;
  const [wfs] = await db.query(
    "SELECT w.id FROM workflows w JOIN workflow_triggers t ON t.workflow_id = w.id WHERE w.business_id=? AND w.status='active' AND t.event_name=?", [bid, event]);
  const [etype, ekey] = TRIGGERS[event].entity;

  for (const w of wfs) {
    const [conds] = await db.query('SELECT field_path,operator,value,logical_operator FROM workflow_conditions WHERE workflow_id=? ORDER BY sort_order,id', [w.id]);
    if (!passes(conds, payload)) continue;
    const [run] = await db.query(
      "INSERT INTO automation_runs (business_id,workflow_id,trigger_event,entity_type,entity_id,status,started_at) VALUES (?,?,?,?,?,'running',NOW())",
      [bid, w.id, event, etype, payload[ekey] || null]);
    let failure = null;
    const [acts] = await db.query("SELECT id,action_type,config FROM workflow_actions WHERE workflow_id=? AND status='active' ORDER BY sort_order,id", [w.id]);
    for (const a of acts) {
      try {
        const fn = ACTIONS[a.action_type];
        if (!fn) throw new Error('Aksi tidak dikenal: ' + a.action_type);
        const out = await fn(parse(a.config), payload, { business_id: bid });
        await db.query("INSERT INTO automation_logs (business_id,automation_run_id,action_id,status,message,output_data) VALUES (?,?,?,'success',?,?)",
          [bid, run.insertId, a.id, a.action_type + ' berhasil', JSON.stringify(out)]);
      } catch (e) {
        failure = e.message;
        await db.query("INSERT INTO automation_logs (business_id,automation_run_id,action_id,status,message) VALUES (?,?,?,'failed',?)",
          [bid, run.insertId, a.id, e.message.slice(0, 500)]);
      }
    }
    await db.query('UPDATE automation_runs SET status=?, completed_at=NOW(), error_message=? WHERE id=? AND business_id=?',
      [failure ? 'failed' : 'completed', failure, run.insertId, bid]);
  }
}

function start() {
  for (const ev of Object.keys(TRIGGERS))
    events.on(ev, (p) => { handle(ev, p).catch((e) => console.error('[automation]', ev, e.message)); });
}

module.exports = { start, TRIGGERS, OPS };
