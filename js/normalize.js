/* normalize.js — PURE. Turns parsed input (tabular rows from CSV/XLSX, or raw
   text from PDF/DOCX) into a common transaction shape:
     { date:'YYYY-MM-DD'|null, desc, amount:Number>0, direction:'debit'|'credit',
       balance:Number|null, raw }
   Banks differ wildly, so we detect columns by header synonyms and fall back to
   a line-by-line regex for text formats. */

const H = {
  date: ["date", "txn date", "transaction date", "value date", "posting date", "tran date"],
  desc: ["description", "narration", "particulars", "details", "remarks", "transaction details", "naration"],
  debit: ["debit", "withdrawal", "withdrawal amt", "dr", "withdrawal (dr)", "amount debited", "paid out"],
  credit: ["credit", "deposit", "deposit amt", "cr", "deposit (cr)", "amount credited", "paid in"],
  amount: ["amount", "amount (inr)", "transaction amount", "amt"],
  balance: ["balance", "closing balance", "running balance", "available balance", "bal"],
};

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z ]/g, "").trim();

function matchHeader(cell) {
  const n = norm(cell);
  if (!n) return null;
  for (const key in H) if (H[key].some((syn) => n === syn || n.includes(syn))) return key;
  return null;
}

export function parseAmount(v) {
  if (v == null) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[₹$€£,\s]/g, "");
  let neg = /^\(.*\)$/.test(s) || /(dr|debit)$/i.test(String(v).trim());
  s = s.replace(/[()]/g, "").replace(/(cr|dr|credit|debit)$/i, "");
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

export function parseDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v)) return iso(v);
  const s = String(v).trim();
  let m;
  // dd/mm/yyyy or dd-mm-yyyy (also yy)
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/))) {
    let [_, d, mo, y] = m; y = y.length === 2 ? "20" + y : y;
    return iso(new Date(+y, +mo - 1, +d));
  }
  // yyyy-mm-dd
  if ((m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/))) {
    let [_, y, mo, d] = m;
    return iso(new Date(+y, +mo - 1, +d));
  }
  // dd MMM yyyy  /  dd-MMM-yy
  if ((m = s.match(/^(\d{1,2})[\s\-]([A-Za-z]{3,})[\s\-](\d{2,4})$/))) {
    let [_, d, mon, y] = m; y = y.length === 2 ? "20" + y : y;
    const mi = MONTHS.indexOf(mon.slice(0, 3).toLowerCase());
    if (mi >= 0) return iso(new Date(+y, mi, +d));
  }
  const t = Date.parse(s);
  return isNaN(t) ? null : iso(new Date(t));
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ---- tabular (CSV / XLSX): rows = array of arrays ---------------------------
export function rowsToTransactions(rows) {
  // find the header row: the row that maps the most known columns
  let headerIdx = -1, best = 0, map = {};
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const m = {}; let hits = 0;
    rows[i].forEach((cell, c) => { const k = matchHeader(cell); if (k && !(k in m)) { m[k] = c; hits++; } });
    if (hits > best) { best = hits; headerIdx = i; map = m; }
  }
  if (best < 2) throw new Error("Couldn't find a transaction table — need at least a date and an amount/description column.");

  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]; if (!r || !r.length) continue;
    const date = parseDate(r[map.date]);
    const desc = String(r[map.desc] ?? "").trim();
    if (!date && !desc) continue;

    let amount = null, direction = null;
    if (map.debit != null || map.credit != null) {
      const dr = parseAmount(r[map.debit]); const cr = parseAmount(r[map.credit]);
      if (dr) { amount = Math.abs(dr); direction = "debit"; }
      else if (cr) { amount = Math.abs(cr); direction = "credit"; }
    } else if (map.amount != null) {
      const a = parseAmount(r[map.amount]);
      if (a != null) { amount = Math.abs(a); direction = a < 0 ? "debit" : "credit"; }
    }
    if (amount == null) continue;
    out.push({ date, desc, amount, direction, balance: map.balance != null ? parseAmount(r[map.balance]) : null, raw: r });
  }
  if (!out.length) throw new Error("Found a table header but no transaction rows.");
  return out;
}

// ---- text (PDF / DOCX): best-effort line regex ------------------------------
// A line that starts with a date and ends with amount(s)/balance.
const LINE_RE = /^(\d{1,2}[\/\-.][A-Za-z0-9]{2,}[\/\-.]\d{2,4})\s+(.*?)\s+([\d,]+\.\d{2})(?:\s+(Cr|Dr))?(?:\s+([\d,]+\.\d{2}))?\s*$/;

export function textToTransactions(text) {
  const out = [];
  let prevBal = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(LINE_RE);
    if (!m) continue;
    const date = parseDate(m[1]);
    const desc = m[2].trim();
    const amount = Math.abs(parseAmount(m[3]));
    const crdr = m[4];
    const bal = m[5] != null ? parseAmount(m[5]) : null;
    let direction;
    if (crdr) direction = /cr/i.test(crdr) ? "credit" : "debit";
    else if (bal != null && prevBal != null) direction = bal >= prevBal ? "credit" : "debit";
    else direction = "debit"; // best guess
    if (bal != null) prevBal = bal;
    if (amount) out.push({ date, desc, amount, direction, balance: bal, raw: line });
  }
  if (!out.length) throw new Error("No transactions found in this document. PDF/Word layouts vary — try the bank's CSV/Excel export for best results.");
  return out;
}
