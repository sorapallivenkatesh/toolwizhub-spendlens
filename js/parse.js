/* parse.js — reads a File into normalized transactions, all in the browser.
   CSV/TSV: own parser (keeps dd-mm-yyyy text intact). XLSX: SheetJS.
   PDF: coordinate-based table extraction (pdf.js) — clusters text into rows by
   y, maps x→columns, merges multi-line transaction blocks. DOCX: text + regex.
   Uses vendored globals window.XLSX / pdfjsLib / mammoth. */

import { rowsToTransactions, textToTransactions } from "./normalize.js";

const ext = (name) => name.toLowerCase().split(".").pop();

export async function parseFile(file, password) {
  const e = ext(file.name);
  if (e === "csv" || e === "tsv") return rowsToTransactions(csvToRows(await file.text(), e === "tsv" ? "\t" : ","));
  if (e === "xlsx" || e === "xls") return rowsToTransactions(await readExcel(file));
  if (e === "pdf") {
    const r = await readPdf(file, password);
    return r.rows ? rowsToTransactions(r.rows) : textToTransactions(r.text);
  }
  if (e === "docx" || e === "doc") return textToTransactions(await readDocx(file));
  // unknown: sniff
  const text = await file.text();
  if (text.includes(",") && text.includes("\n")) { try { return rowsToTransactions(csvToRows(text, ",")); } catch {} }
  try { return rowsToTransactions(await readExcel(file)); }
  catch { return textToTransactions(text); }
}

/* ---- CSV/TSV (own parser so ambiguous dd-mm-yyyy dates stay text) ---------- */
function csvToRows(text, delim) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

async function readExcel(file) {
  const wb = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
}

async function readDocx(file) {
  const res = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return res.value || "";
}

/* ---- PDF: coordinate-based table extraction ------------------------------- */
const AMT = /^-?[\d,]+\.\d{2}$/;
const isAmt = (s) => AMT.test(s.replace(/\s+/g, ""));
const DATE_RE = /\b(\d{1,2}[\s\/\-][A-Za-z]{3,9}[\s\/\-]\d{2,4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/;
const SYN = {
  date: /^date$/i, desc: /description|narration|particulars|details/i, cheque: /cheque|chq/i,
  credit: /deposit|credit/i, debit: /withdrawal|debit/i, balance: /balance/i, amount: /^amount$/i,
};

function clusterLines(items) {
  const sorted = [...items].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const lines = []; let cur = null;
  for (const it of sorted) {
    if (cur && Math.abs(cur.y - it.y) <= 3) cur.items.push(it);
    else { cur = { y: it.y, items: [it] }; lines.push(cur); }
  }
  lines.forEach((l) => l.items.sort((a, b) => a.x - b.x));
  return lines;
}

function findColumns(lines) {
  for (const line of lines) {
    const j = line.items.map((i) => i.s).join(" ").toLowerCase();
    if (/balance/.test(j) && /description|narration|particulars/.test(j) && /(withdrawal|debit|deposit|credit|amount)/.test(j)) {
      const cols = {};
      for (const it of line.items) for (const k in SYN) if (cols[k] == null && SYN[k].test(it.s)) cols[k] = it.x;
      if (cols.balance != null && cols.desc != null) return { cols, headerY: line.y };
    }
  }
  return null;
}

function parseTable(pages) {
  let cols = null;
  for (const items of pages) { const f = findColumns(clusterLines(items)); if (f) { cols = f.cols; break; } }
  if (!cols) return null;
  const amountCols = [
    cols.credit != null && { name: "credit", x: cols.credit },
    cols.debit != null && { name: "debit", x: cols.debit },
    cols.amount != null && { name: "amount", x: cols.amount },
    cols.balance != null && { name: "balance", x: cols.balance },
  ].filter(Boolean);
  if (!amountCols.length) return null;
  const minAmtX = Math.min(...amountCols.map((c) => c.x));

  const out = [["Date", "Description", "Credit", "Debit", "Amount", "Balance"]];
  let rec = blank(), lastDate = null;
  function blank() { return { date: null, desc: [], credit: "", debit: "", amount: "", balance: "" }; }
  function flush() {
    if (rec.date) lastDate = rec.date;
    const desc = rec.desc.join(" ").replace(/\s+/g, " ").trim();
    const move = rec.credit !== "" || rec.debit !== "" || rec.amount !== "";
    if (move && !/^(total|closing balance|opening balance|balance b\/?f|balance forward)/i.test(desc)) {
      out.push([rec.date || lastDate || "", desc, rec.credit, rec.debit, rec.amount, rec.balance]);
    }
    rec = blank();
  }

  for (const items of pages) {
    const lines = clusterLines(items);
    const f = findColumns(lines);
    const headerY = f ? f.headerY : Infinity;
    for (const line of lines) {
      if (line.y >= headerY) continue; // skip page header + boilerplate above it
      const texts = line.items.filter((i) => !isAmt(i.s));
      const nums = line.items.filter((i) => isAmt(i.s));

      // date: only from the date column (header-label x ≠ data x across banks, so
      // anchor to cols.date) — avoids grabbing date-like tokens out of the narration
      const dateBand = (cols.date != null ? cols.date : 0) + 45;
      if (!rec.date) {
        const dtok = texts.find((i) => i.x <= dateBand && DATE_RE.test(i.s));
        if (dtok) rec.date = dtok.s.match(DATE_RE)[1];
      }
      // description: everything between the date column and the amount columns
      // (don't rely on the "Particulars/Description" header x — data is often left of it)
      const descToks = texts.filter((i) => i.x > dateBand && i.x < minAmtX - 5 && !DATE_RE.test(i.s));
      if (descToks.length) rec.desc.push(descToks.map((i) => i.s).join(" "));

      for (const n of nums) {
        let best = amountCols[0], bd = Infinity;
        for (const c of amountCols) { const d = Math.abs(n.x - c.x); if (d < bd) { bd = d; best = c; } }
        rec[best.name] = n.s.replace(/\s+/g, "");
      }
      if (rec.balance !== "") flush();
    }
    flush();
  }
  return out.length > 1 ? out : null;
}

async function readPdf(file, password) {
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.js";
  // If the PDF is encrypted, getDocument rejects with a PasswordException
  // (name === "PasswordException") — the UI catches it and re-calls with a password.
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer(), password }).promise;
  const pages = [], flat = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    const items = content.items.filter((it) => it.str && it.str.trim())
      .map((it) => ({ x: it.transform[4], y: Math.round(it.transform[5]), w: it.width || 0, s: it.str.trim() }));
    pages.push(items);
    // also build a flat text fallback (lines by y)
    clusterLines(items).forEach((l) => flat.push(l.items.map((i) => i.s).join(" ")));
  }
  const rows = parseTable(pages);
  return rows ? { rows } : { text: flat.join("\n") };
}
