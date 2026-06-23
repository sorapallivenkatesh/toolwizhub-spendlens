/* dashboard.js — renders the analysis from a list of categorized transactions.
   Pure-ish DOM rendering; all maths from the in-memory transactions. */

import { ALL_CATEGORIES, cleanMerchant, merchantKey } from "./categorize.js";

const $ = (id) => document.getElementById(id);
const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const money = (n) => "₹" + INR.format(Math.round(n));
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };

let onRecategorize = () => {}; // set by main: (merchantKey, category) => void

export function setRecategorizeHandler(fn) { onRecategorize = fn; }

export function render(txns) {
  $("results").hidden = false;
  renderSummary(txns);
  renderBreakdown("channel", txns);
  renderBreakdown("category", txns);
  renderRecurring(txns);
  renderMerchants(txns);
  renderTrend(txns);
  renderTable(txns);
}

function sum(arr) { return arr.reduce((a, b) => a + b, 0); }

function renderSummary(txns) {
  const debit = txns.filter((t) => t.direction === "debit");
  const credit = txns.filter((t) => t.direction === "credit");
  const out = sum(debit.map((t) => t.amount));
  const inc = sum(credit.map((t) => t.amount));
  const dates = txns.map((t) => t.date).filter(Boolean).sort();
  $("sum-in").textContent = money(inc);
  $("sum-out").textContent = money(out);
  $("sum-net").textContent = (inc - out >= 0 ? "+" : "−") + money(Math.abs(inc - out));
  $("sum-net").className = "kpi__num " + (inc - out >= 0 ? "pos" : "neg");
  $("sum-count").textContent = txns.length;
  $("sum-period").textContent = dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : "—";
}

function aggregate(txns, key) {
  const m = {};
  for (const t of txns) if (t.direction === "debit") m[t[key]] = (m[t[key]] || 0) + t.amount;
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

function renderBreakdown(key, txns) {
  const rows = aggregate(txns, key);
  const host = $(key === "channel" ? "channels" : "categories");
  host.replaceChildren();
  if (!rows.length) { host.append(el("p", "empty", "No spending to break down.")); return; }
  const max = rows[0][1];
  for (const [label, amt] of rows) {
    const row = el("div", "bar");
    row.append(el("span", "bar__l", label));
    const track = el("span", "bar__t"); const fill = el("span", "bar__f"); fill.style.width = `${Math.max(3, (amt / max) * 100)}%`;
    track.append(fill); row.append(track);
    row.append(el("span", "bar__v", money(amt)));
    host.append(row);
  }
}

function renderMerchants(txns) {
  const m = {};
  for (const t of txns) if (t.direction === "debit") {
    const name = cleanMerchant(t.desc) || "Unknown";
    m[name] = m[name] || { amt: 0, n: 0 };
    m[name].amt += t.amount; m[name].n++;
  }
  const rows = Object.entries(m).sort((a, b) => b[1].amt - a[1].amt).slice(0, 10);
  const host = $("merchants"); host.replaceChildren();
  if (!rows.length) { host.append(el("p", "empty", "No merchants found.")); return; }
  for (const [name, v] of rows) {
    const li = el("div", "mrow");
    li.append(el("span", "mrow__n", name));
    li.append(el("span", "mrow__c", `${v.n}×`));
    li.append(el("span", "mrow__a", money(v.amt)));
    host.append(li);
  }
}

// recurring: same merchant, 3+ times, similar amount → likely a subscription/bill
function renderRecurring(txns) {
  const groups = {};
  for (const t of txns) if (t.direction === "debit") {
    const k = merchantKey(t.desc);
    (groups[k] = groups[k] || []).push(t);
  }
  const found = [];
  for (const k in groups) {
    const g = groups[k];
    if (g.length < 3) continue;
    const amts = g.map((t) => t.amount);
    const avg = sum(amts) / amts.length;
    const spread = Math.max(...amts) - Math.min(...amts);
    if (spread <= avg * 0.25) found.push({ name: cleanMerchant(g[0].desc) || k, n: g.length, avg });
  }
  found.sort((a, b) => b.avg - a.avg);
  const host = $("recurring"); host.replaceChildren();
  $("recurring-count").textContent = found.length ? `${found.length} found` : "none found";
  if (!found.length) { host.append(el("p", "empty", "No recurring payments detected yet.")); return; }
  for (const r of found) {
    const li = el("div", "mrow");
    li.append(el("span", "mrow__n", r.name));
    li.append(el("span", "mrow__c", `${r.n}× · ~${money(r.avg)}`));
    host.append(li);
  }
}

function renderTrend(txns) {
  const m = {};
  for (const t of txns) {
    if (!t.date) continue;
    const mo = t.date.slice(0, 7);
    m[mo] = m[mo] || { in: 0, out: 0 };
    m[mo][t.direction === "credit" ? "in" : "out"] += t.amount;
  }
  const months = Object.keys(m).sort();
  const host = $("trend"); host.replaceChildren();
  if (!months.length) { host.append(el("p", "empty", "No dated transactions to chart.")); return; }
  const max = Math.max(1, ...months.map((k) => Math.max(m[k].in, m[k].out)));
  for (const k of months) {
    const col = el("div", "tcol");
    const bars = el("div", "tcol__bars");
    const bin = el("span", "tbar tbar--in"); bin.style.height = `${(m[k].in / max) * 100}%`; bin.title = "In " + money(m[k].in);
    const bout = el("span", "tbar tbar--out"); bout.style.height = `${(m[k].out / max) * 100}%`; bout.title = "Out " + money(m[k].out);
    bars.append(bin, bout); col.append(bars);
    col.append(el("span", "tcol__l", k.slice(2)));
    host.append(col);
  }
}

function renderTable(txns) {
  const host = $("rows");
  const search = ($("search").value || "").toLowerCase();
  host.replaceChildren();
  const shown = txns.filter((t) => !search || (t.desc || "").toLowerCase().includes(search));
  $("rowcount").textContent = `${shown.length} transaction${shown.length === 1 ? "" : "s"}`;
  for (const t of shown) {
    const tr = el("div", "tr");
    tr.append(el("span", "td td--date", t.date || "—"));
    tr.append(el("span", "td td--desc", t.desc));
    tr.append(el("span", "td", t.channel));
    // editable category
    const sel = document.createElement("select"); sel.className = "catsel";
    for (const c of ALL_CATEGORIES) { const o = el("option", null, c); o.value = c; if (c === t.category) o.selected = true; sel.append(o); }
    sel.addEventListener("change", () => onRecategorize(merchantKey(t.desc), sel.value));
    const tdc = el("span", "td td--cat"); tdc.append(sel); tr.append(tdc);
    const amt = el("span", "td td--amt " + (t.direction === "credit" ? "pos" : "neg"));
    amt.textContent = (t.direction === "credit" ? "+" : "−") + money(t.amount);
    tr.append(amt);
    host.append(tr);
  }
}

export function bindControls(getTxns) {
  $("search").addEventListener("input", () => renderTable(getTxns()));
  $("export-csv").addEventListener("click", () => exportCsv(getTxns()));
  $("export-json").addEventListener("click", () => exportJson(getTxns()));
}

function download(name, type, data) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportJson(txns) { download("spendlens-export.json", "application/json", JSON.stringify(txns, null, 2)); }
function exportCsv(txns) {
  const head = "date,description,channel,category,direction,amount\n";
  const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const body = txns.map((t) => [t.date, esc(t.desc), t.channel, t.category, t.direction, t.amount].join(",")).join("\n");
  download("spendlens-export.csv", "text/csv", head + body);
}
