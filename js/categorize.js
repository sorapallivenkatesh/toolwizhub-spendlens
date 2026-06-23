/* categorize.js — PURE (no DOM, no libs). Detects the payment CHANNEL and the
   spending CATEGORY of a transaction from its description, using regex + keyword
   rules. User overrides (by merchant key) win over rules. Kept pure so it can be
   unit-tested with plain node. */

// ---- payment channel (how money moved) -------------------------------------
const CHANNELS = [
  ["UPI",        /\bupi\b|@(?:ok|ybl|paytm|ibl|axl|axis|hdfc|sbi|apl)\b|\bvpa\b|\/upi\//i],
  ["IMPS",       /\bimps\b/i],
  ["NEFT",       /\bneft\b/i],
  ["RTGS",       /\brtgs\b/i],
  ["ATM",        /\b(atm|nwd|cash\s?wd?l?|cwdr|cash withdrawal)\b/i],
  ["Card",       /\b(pos|vps|ecom|e-?com|debit card|credit card|visa|master(?:card)?|rupay|card no)\b/i],
  ["Auto-debit", /\b(ach|nach|e?cs|si\b|standing instruction|auto ?debit|mandate|emi)\b/i],
  ["Cheque",     /\b(chq|cheque|clearing|clg|inward clg|outward clg)\b/i],
  ["Net banking",/\b(net ?banking|ib transfer|internet banking|funds? transfer)\b/i],
  ["Wallet",     /\b(paytm wallet|wallet|amazon pay|mobikwik|freecharge)\b/i],
  ["Interest",   /\b(int\.?|interest)\s|credit interest|int pd/i],
  ["Bank fee",   /\b(charges?|chrg|fee|amc|gst|cgst|sgst|penalty|sms (?:chrg|charge))\b/i],
];

export function detectChannel(desc = "") {
  for (const [name, re] of CHANNELS) if (re.test(desc)) return name;
  return "Other";
}

// ---- spending category (what it was for) -----------------------------------
const CATEGORY_RULES = [
  ["Food & Dining",  ["swiggy", "zomato", "restaurant", "cafe", "coffee", "dominos", "mcdonald", "kfc", "starbucks", "pizza", "eatery", "dineout", "magicpin"]],
  ["Groceries",      ["bigbasket", "blinkit", "zepto", "dmart", "d-mart", "grofers", "instamart", "supermarket", "reliance fresh", "more retail", "kirana"]],
  ["Shopping",       ["amazon", "flipkart", "myntra", "ajio", "nykaa", "meesho", "tatacliq", "lifestyle", "decathlon", "ikea", "croma"]],
  ["Transport",      ["uber", "ola", "rapido", "irctc", "petrol", "fuel", "hpcl", "iocl", "bpcl", "shell", "metro", "fastag", "redbus", "namma yatri", "blusmart"]],
  ["Bills & Utilities", ["electricity", "water bill", "gas", "broadband", "airtel", "jio", "vodafone", " vi ", "bsnl", "dth", "recharge", "bescom", "tneb", "act fibernet", "tata power"]],
  ["Entertainment",  ["netflix", "spotify", "hotstar", "prime video", "youtube", "bookmyshow", "jiocinema", "sonyliv", "zee5", "disney"]],
  ["Health",         ["pharmacy", "apollo", "medplus", "hospital", "clinic", "1mg", "pharmeasy", "netmeds", "diagnostic", "lab", "practo"]],
  ["Rent & Housing", ["rent", "maintenance", "society", "landlord", "nobroker", "housing"]],
  ["Investments",    ["zerodha", "groww", "mutual fund", "sip", "upstox", "nps", "ppf", "indmoney", "smallcase", "coin", "kuvera"]],
  ["Education",      ["udemy", "coursera", "school", "college", "tuition", "byju", "unacademy", "fees"]],
  ["Income",         ["salary", "payroll", "sal cr", "refund", "cashback", "dividend", "reversal", "imps cr", "neft cr"]],
];

// rough heuristic: a person-to-person transfer vs a merchant payment
const TRANSFER_HINT = /\b(transfer|to [a-z ]+ via|p2p|sent to|received from|family|friend)\b/i;

export function categorize(txn, rules = CATEGORY_RULES) {
  const d = (txn.desc || "").toLowerCase();
  for (const [cat, words] of rules) {
    if (words.some((w) => d.includes(w))) {
      // "salary/refund/cashback" only count as Income when money came in
      if (cat === "Income" && txn.direction !== "credit") continue;
      return cat;
    }
  }
  if (txn.channel === "Bank fee") return "Fees & Charges";
  if (txn.channel === "Interest") return "Income";
  // Indian UPI/IMPS tags: P2A = person-to-person (a transfer), P2M = merchant payment
  if (/\bp2a\b/.test(d)) return "Transfers";
  if (["UPI", "IMPS", "NEFT", "Net banking"].includes(txn.channel) && TRANSFER_HINT.test(d)) return "Transfers";
  if (/\bp2m\b/.test(d) && txn.direction === "debit") return "Shopping";
  if (txn.direction === "credit") return "Income";
  return "Uncategorized";
}

// a stable key to remember a user's category override for a merchant
export function merchantKey(desc = "") {
  return cleanMerchant(desc).toLowerCase().slice(0, 40);
}

// turn "UPI/AMZN*MKTPLACE/9876@ybl/Payment" into something human ("Amzn Mktplace")
export function cleanMerchant(desc = "") {
  let s = String(desc)
    .replace(/\b(upi|imps|neft|rtgs|pos|vps|ach|nach|ecs|ib|nwd|atm|chq)\b[\/:-]?/gi, " ")
    .replace(/@[a-z0-9.]+/gi, " ")          // vpa handles
    .replace(/\b\d{6,}\b/g, " ")            // long ref numbers
    .replace(/[*_\/|]+/g, " ")
    .replace(/\b(payment|txn|transaction|ref|no|to|from|paid|received)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) s = desc.trim();
  return s.split(" ").slice(0, 3).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

export const ALL_CATEGORIES = [
  ...CATEGORY_RULES.map((r) => r[0]).filter((c) => c !== "Income"),
  "Income", "Transfers", "Fees & Charges", "Uncategorized",
].filter((c, i, a) => a.indexOf(c) === i);

export { CATEGORY_RULES };
