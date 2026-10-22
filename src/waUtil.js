// Normalisasi nomor HP ke format WhatsApp (digit saja, kode negara tanpa +).
// 0812... / 812... -> 62812...; "+kode negara" dipertahankan apa adanya.
function normalizePhone(raw) {
  const s = String(raw || '').trim();
  const plus = s.startsWith('+');
  let d = s.replace(/\D/g, '');
  if (!plus) {
    if (d.startsWith('00')) d = d.slice(2);
    else if (d.startsWith('0')) d = '62' + d.slice(1);
    else if (d.startsWith('8')) d = '62' + d;
  }
  return /^\d{9,15}$/.test(d) ? d : null;
}
const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
module.exports = { normalizePhone, rp };
