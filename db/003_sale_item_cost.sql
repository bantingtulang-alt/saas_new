-- Simpan harga modal per baris penjualan (snapshot) agar laba kotor akurat. Aman dijalankan berulang.
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(15,2) NULL AFTER unit_price;

-- Isi data lama dengan harga modal produk saat ini (perkiraan; transaksi baru akan tercatat tepat).
UPDATE sale_items si
  JOIN item_variants v ON v.id = si.variant_id AND v.business_id = si.business_id
   SET si.unit_cost = v.cost_price
 WHERE si.unit_cost IS NULL;
