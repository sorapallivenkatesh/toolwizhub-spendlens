# SpendLens — see where your money goes, privately

Drop in a bank statement — **CSV, Excel, PDF, or Word** — and SpendLens breaks it
down by **payment type** and **category**, finds **recurring payments**, and charts
your cash flow. It runs **100% in your browser**: the file is parsed locally and
**nothing is ever uploaded**. No account, no servers.

## What it does

- **Segregate by payment type** — UPI, card, NEFT/IMPS/RTGS, ATM, auto-debit, cheque, fees…
- **Categorize spending** — food, groceries, shopping, transport, bills, rent, etc. (editable; it remembers your fixes)
- **Recurring / subscription detector** — repeating debits at a steady amount
- **Top merchants**, **monthly cash-flow** chart, **money in/out/net** summary
- **Export** the categorized data as CSV or JSON

## Run

```
npm run site    # serve on http://localhost:8092
```
Open it, then drop a statement or click **Try a sample statement**.

## Layout

```
index.html        the app shell (upload + dashboard)
css/styles.css    ToolWizHub house theme (gradient-mesh, glass nav + footer)
js/parse.js       file → rows/text (uses vendored libs)
js/normalize.js   rows/text → common transaction shape   (pure)
js/categorize.js  channel + category detection            (pure)
js/dashboard.js   renders the breakdowns + table
js/main.js        orchestration, overrides, splash/theme
lib/              vendored SheetJS / pdf.js / mammoth (no build step)
sample/           a demo statement
```

## Privacy

Everything is processed in the browser. The only network request the app makes is
loading the bundled sample CSV. Your statements never leave your device.

Part of [ToolWizHub](https://toolwizhub.com).
