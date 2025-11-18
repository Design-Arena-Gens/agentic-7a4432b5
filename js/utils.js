// Utils: format currency, hashing, dates
const Utils = {
  formatINR(amount) {
    if (isNaN(amount)) return '?0';
    return '?' + Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
  },
  async sha256(text) {
    try {
      const enc = new TextEncoder();
      const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      // Fallback naive hash
      let h = 0; for (let i = 0; i < text.length; i++) { h = (h << 5) - h + text.charCodeAt(i); h |= 0; }
      return (h >>> 0).toString(16);
    }
  },
  todayISO() {
    const d = new Date();
    return d.toISOString().slice(0,10);
  },
  monthKey(dateStr) { // YYYY-MM
    return (dateStr || Utils.todayISO()).slice(0,7);
  },
  sum(arr) { return arr.reduce((a,b)=>a+Number(b||0),0); },
  clamp(n,min,max){ return Math.max(min, Math.min(max, n)); },
  uid(prefix='id') { return prefix + '_' + Math.random().toString(36).slice(2,9); },
  downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  },
};
