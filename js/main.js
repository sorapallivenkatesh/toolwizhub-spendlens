/* main.js — orchestrates the pipeline and the UI shell.
   file → parse.js → normalize → categorize → dashboard. 100% in-browser. */

import { parseFile } from "./parse.js";
import { detectChannel, categorize, merchantKey } from "./categorize.js";
import { render, bindControls, setRecategorizeHandler } from "./dashboard.js";

const $ = (id) => document.getElementById(id);
const OVERRIDE_KEY = "spendlens:overrides";

let txns = [];                 // current categorized transactions (in memory only)
let overrides = loadOverrides();

function loadOverrides() { try { return JSON.parse(localStorage.getItem(OVERRIDE_KEY)) || {}; } catch { return {}; } }
function saveOverrides() { try { localStorage.setItem(OVERRIDE_KEY, JSON.stringify(overrides)); } catch {} }

// apply channel + category (overrides win) to raw normalized txns
function classify(list) {
  return list.map((t) => {
    const channel = detectChannel(t.desc);
    const withCh = { ...t, channel };
    const ov = overrides[merchantKey(t.desc)];
    return { ...withCh, category: ov || categorize(withCh) };
  });
}

let pendingFile = null; // a PDF awaiting its password

async function handleFile(file, password) {
  setStatus(`Reading ${file.name}…`);
  try {
    const raw = await parseFile(file, password);   // normalized {date,desc,amount,direction,balance}
    txns = classify(raw);
    pendingFile = null;
    $("pass-block").hidden = true;
    setStatus(`Loaded ${txns.length} transactions from ${file.name}. Nothing was uploaded.`);
    render(txns);
    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    // encrypted PDF → ask for the password and retry (decryption happens locally)
    if (err && err.name === "PasswordException") {
      pendingFile = file;
      $("pass-block").hidden = false;
      $("pass-msg").textContent = err.code === 2
        ? "Incorrect password — try again."
        : "This PDF is password-protected. Enter its password to unlock it.";
      const inp = $("pdf-pass"); inp.value = ""; inp.focus();
      setStatus("");
      return;
    }
    setStatus(`⚠️ ${err.message || err}`, true);
  }
}

function setStatus(msg, isErr) {
  const s = $("status");
  s.textContent = msg;
  s.classList.toggle("status--err", !!isErr);
}

// ---- recategorize from the table: remember the override, reclassify, redraw --
setRecategorizeHandler((key, category) => {
  overrides[key] = category;
  saveOverrides();
  txns = classify(txns.map((t) => ({ date: t.date, desc: t.desc, amount: t.amount, direction: t.direction, balance: t.balance, raw: t.raw })));
  render(txns);
});

bindControls(() => txns);

// ---- file input + drag & drop ----------------------------------------------
const drop = $("drop");
$("file").addEventListener("change", (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); });
drop.addEventListener("click", () => $("file").click());
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drop--over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("drop--over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault(); drop.classList.remove("drop--over");
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

// ---- encrypted-PDF password prompt -----------------------------------------
function submitPassword() {
  const pw = $("pdf-pass").value;
  if (pendingFile && pw) handleFile(pendingFile, pw);
}
$("pdf-unlock").addEventListener("click", submitPassword);
$("pdf-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submitPassword(); } });

// close the modal (X, backdrop click, or Escape)
const closePass = () => { $("pass-block").hidden = true; };
$("pass-block").addEventListener("click", (e) => { if (e.target.dataset.close !== undefined) closePass(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("pass-block").hidden) closePass(); });

async function loadSample() {
  const res = await fetch("sample/sample-statement.csv");
  const blob = await res.blob();
  handleFile(new File([blob], "sample-statement.csv", { type: "text/csv" }));
}
$("sample").addEventListener("click", (e) => { e.preventDefault(); loadSample(); });
if (location.hash === "#sample") loadSample();   // deep-link for demos

$("clear-rules")?.addEventListener("click", () => {
  overrides = {}; saveOverrides();
  if (txns.length) { txns = classify(txns); render(txns); }
  setStatus("Your category overrides were cleared.");
});

// ---- shell: splash + mobile nav (ToolWizHub house) --------------------------
(() => {
  try { sessionStorage.setItem("spendlens:splashed", "1"); } catch {}
  const yr = $("year"); if (yr) yr.textContent = new Date().getFullYear();

  const nav = $("nav"), toggle = $("nav-toggle"), links = $("nav-links");
  if (nav && toggle && links) {
    const close = () => { nav.classList.remove("is-open"); toggle.setAttribute("aria-expanded", "false"); };
    toggle.addEventListener("click", () => toggle.setAttribute("aria-expanded", String(nav.classList.toggle("is-open"))));
    links.querySelectorAll("a").forEach((a) => a.addEventListener("click", close));
  }
})();
