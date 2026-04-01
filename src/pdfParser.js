import * as pdfjsLib from "pdfjs-dist";

// Use CDN worker so the PDF parsing runs off the main thread
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

// Known Nissan model names — checked before anything else
const NISSAN_MODELS = [
  "VERSA","ROGUE","ALTIMA","SENTRA","MAXIMA","MURANO","PATHFINDER",
  "FRONTIER","TITAN","KICKS","LEAF","ARMADA","ARIYA","NV200","NV",
  "GT-R","JUKE","XTERRA","QUEST","CUBE","NOTE","PULSAR","STANZA",
  "PATROL","NAVARA",
];

// Transmission tokens — stop trim parsing here
const TRANS = ["CVT","AT","MT","DCT","AMT","4AT","5AT","6MT","4WD","AWD","2WD","FWD"];

async function extractText(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  return pages.join("\n");
}

function dollarAfter(text, label) {
  const idx = text.toLowerCase().indexOf(label.toLowerCase());
  if (idx === -1) return null;
  const after = text.slice(idx + label.length, idx + label.length + 300);
  const m = after.match(/\$?([\d,]+(?:\.\d{2})?)/);
  return m ? m[1].replace(/,/g, "") : null;
}

export async function parseInvoicePDF(file) {
  let text;
  try {
    text = await extractText(file);
  } catch (e) {
    console.warn("PDF parse error:", e);
    return {};
  }

  const result = {};

  // ── VIN ───────────────────────────────────────────────────────────────────
  // Nissan invoices label it "FED VIN:" — grab that first, fall back to raw match
  const fedVin = text.match(/FED\s+VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i);
  const rawVin = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  const vin = fedVin ? fedVin[1] : rawVin ? rawVin[1] : null;
  if (vin) result.vin = vin;

  // ── Stock # — always last 8 chars of VIN ──────────────────────────────────
  if (vin) result.stock = vin.slice(-8);

  // ── Year ─────────────────────────────────────────────────────────────────
  // Nissan invoices show 2-digit year in the item row: "001 25 10115 ..."
  // Try 4-digit first, then 2-digit prefixed with 20
  const year4 = text.match(/\b(20\d{2}|19\d{2})\b/);
  if (year4) {
    result.year = year4[1];
  } else {
    // 2-digit year in item line: "001 " then 2-digit year
    const year2 = text.match(/\b0{0,2}1\b\s+(\d{2})\s+\d{4,}/);
    if (year2) result.year = "20" + year2[1];
  }

  // ── Model & Trim ──────────────────────────────────────────────────────────
  // Strategy: search for known Nissan model names in the text (uppercase).
  // After the model name, collect words until we hit a transmission code or a number.
  const upperText = text.toUpperCase();
  for (const model of NISSAN_MODELS) {
    // Must be a whole word match
    const modelRe = new RegExp(`\\b${model}\\b`);
    const idx = upperText.search(modelRe);
    if (idx === -1) continue;

    result.model = model;

    // Grab the substring after the model name and parse trim
    const after = upperText.slice(idx + model.length).trim();
    const tokens = after.split(/\s+/);
    const trimParts = [];
    for (const tok of tokens) {
      if (!tok || /^\d/.test(tok)) break;          // stop at numbers
      if (TRANS.includes(tok)) break;               // stop at transmission
      if (/^\$/.test(tok)) break;                   // stop at price
      if (tok.length > 12) break;                   // stop at long words (descriptions)
      trimParts.push(tok);
      if (trimParts.length >= 3) break;             // max 3 trim tokens
    }
    if (trimParts.length) result.trim = trimParts.join(" ");
    break;
  }

  // ── Color ─────────────────────────────────────────────────────────────────
  // Nissan invoice format: after the suggested price, color appears as
  // "GUN METALL KADG" — color name (1-3 words) followed by a 4-letter color code.
  // Pattern: look for [WORD(S)] [4-LETTER-CODE] near the item price line.
  // The 4-letter color code is all caps, exactly 4 chars, not a common word.
  const colorBlockRe = /([A-Z][A-Z ]{2,20}?)\s+([A-Z]{4})\s*(?:\n|\s{2,}|\d)/g;
  // Common 4-letter codes to skip (not color codes)
  const skipCodes = new Set(["ITEM","YEAR","PART","DISC","CODE","PAGE","SHIP","DRAFT","TYPE","BACK","TERM","DATE","AMER","CORP","PKWY","IRVI","COLF","LAKW","EMPI","NISS","NORT","INCA","UNIT"]);
  let colorMatch;
  while ((colorBlockRe.lastIndex = 0, colorMatch = colorBlockRe.exec(upperText)) !== null) {
    const code = colorMatch[2];
    if (skipCodes.has(code)) { colorBlockRe.lastIndex++; continue; }
    // Color codes are typically 4 letters and appear after a price in the item row
    // Make sure this is near a dollar amount (within 200 chars before)
    const before = upperText.slice(Math.max(0, colorMatch.index - 200), colorMatch.index);
    if (/\d{2,3},\d{3}\.\d{2}/.test(before) || /\d{4,5}\.\d{2}/.test(before)) {
      // Capitalize properly: "GUN METALL" → "Gun Metallic" is too aggressive; keep as-is but trim
      result.color = colorMatch[1].trim();
      break;
    }
    colorBlockRe.lastIndex++;
  }

  // Fallback color: look for known color names if the above didn't work
  if (!result.color) {
    const knownColors = ["GUN METALL","SUPER BLACK","PEARL WHITE","BRILLIANT SILVER","DEEP BLUE","CAYENNE RED","STORM BLUE","ELECTRIC BLUE","MONARCH ORANGE","GLACIER WHITE","MAGNETIC BLACK","CHAMPAGNE SILVER","COULIS RED","SCARLET EMBER","BAJA STORM","ASPEN WHITE","FRESH POWDER","BOULDER GREY","MIDNIGHT STAR","STROM BLUE"];
    for (const c of knownColors) {
      if (upperText.includes(c)) { result.color = c.charAt(0) + c.slice(1).toLowerCase(); break; }
    }
  }

  // ── Invoice Price — "THIS AMOUNT DUE" ────────────────────────────────────
  const payLabels = [
    "this amount due",
    "pay this amount",
    "total invoice price",
    "total invoice",
    "invoice total",
    "amount due",
  ];
  for (const label of payLabels) {
    const val = dollarAfter(text, label);
    if (val) { result.invoicePrice = val; break; }
  }

  // ── Collections Holdback ─────────────────────────────────────────────────
  const chLabels = ["collections holdback","collection holdback","holdback collections","collections,rebates,holdback"];
  for (const label of chLabels) {
    // Only count it if there's an actual dollar figure after the label
    const val = dollarAfter(text, label);
    if (val && parseFloat(val) > 0 && parseFloat(val) < 5000) {
      result.collectionsHoldback = val;
      result.hasCollections = true;
      break;
    }
  }

  // ── Regular Holdback ─────────────────────────────────────────────────────
  if (!result.hasCollections) {
    const hbLabels = ["holdback amount","dealer holdback","holdback"];
    for (const label of hbLabels) {
      const val = dollarAfter(text, label);
      // Skip holdback if the number is clearly part of a sentence (very large or 0)
      if (val && parseFloat(val) > 0 && parseFloat(val) < 10000) {
        result.holdback = val;
        break;
      }
    }
  }

  return result;
}
