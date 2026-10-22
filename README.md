# UMKM SaaS (Node.js + MariaDB)

Isi: auth, multi-tenant, modul on/off per bisnis, trial subscription, modul Customer (contoh), UI sederhana.
Skema database lengkap (37 tabel) ada di `db/schema.sql`.

## Deploy di Hostinger hPanel
1. **Database**: hPanel → Databases → MySQL Databases → buat database + user. Catat nama DB, user, password.
2. **Buat tabel**: pilih salah satu
   - phpMyAdmin → pilih database → Import → upload `db/schema.sql`, atau
   - lewat SSH: `npm run migrate` (setelah `.env` terisi).
3. **Upload aplikasi**: Websites → Add Website → Node.js Apps → upload ZIP ini (atau hubungkan GitHub).
4. **Pengaturan**: Node version 18+ / 20, Entry file `src/server.js`, Start command `npm start`.
5. **Environment variables** (isi seperti `.env.example`): DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, JWT_SECRET.
6. Deploy, lalu buka `https://domain-anda/api/health` → harus `{"ok":true,...}`. Buka `/` untuk UI.

## Update database (instalasi lama)
Jalankan `db/002_notifications.sql`, `db/003_sale_item_cost.sql`, lalu `db/004_account_security.sql`, `db/005_whatsapp.sql` di phpMyAdmin (Import) secara berurutan. Aman diulang.

## Keamanan akun
Verifikasi email, lupa/reset password, ganti password. Butuh `npm install` (nodemailer) dan variabel SMTP_* + APP_URL di environment.
Setelah email terbukti terkirim, set `REQUIRE_VERIFIED=1` agar akun baru wajib verifikasi.

## Uji isolasi tenant
Daftar 2 akun/usaha berbeda. Dengan token akun A, kirim header `X-Business-Id` milik akun B ke `/api/customers`
→ harus `403`. Data pelanggan usaha A tidak pernah muncul di usaha B.

## Berikutnya
Laporan sudah ada (`src/reports.js`). Jalankan `db/003_sale_item_cost.sql` agar laba kotor memakai harga modal. Berikutnya: keamanan akun (reset password, verifikasi email), WhatsApp.

## WhatsApp (Baileys)
- Butuh `npm install` (baileys, qrcode, pino). Set `WA_SESSION_DIR` ke folder DI LUAR folder aplikasi (mis. `/home/uXXXX/wa_sessions`) supaya login WhatsApp tidak hilang saat upload ulang.
- Aktifkan modul **WhatsApp** di menu, klik Hubungkan, scan QR dengan nomor khusus usaha.
- Pesan masuk antrean: jeda acak 8-20 detik antar pesan per bisnis, batas harian per bisnis (default 30, maksimal `WA_MAX_DAILY`).
- Aksi automasi `whatsapp`: kirim ke pelanggan (nomor dari data pelanggan) atau ke nomor tetap, dengan opsi struk.
- Jalankan hanya satu instance aplikasi (jangan cluster), karena sesi WhatsApp hidup di memori proses.
