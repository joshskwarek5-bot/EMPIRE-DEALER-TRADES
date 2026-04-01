import * as pdfjsLib from "pdfjs-dist";

// Use the locally bundled worker — avoids CDN version mismatch issues
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const NISSAN_MODELS = [
  "VERSA","ROGUE","ALTIMA","SENTRA","MAXIMA","MURANO","PATHFINDER",
  "FRONTIER","TITAN","KICKS","LEAF","ARMADA","ARIYA","NV200","NV",
  "GT-R","JUKE","XTERRA","QUEST","PULSAR","STANZA","NAVARA",
];

const TRANS = ["CVT","AT","MT","DCT","AMT","4AT","5AT","6MT","4WD","AWD","2WD","FWD","AUTO","MANUAL"];

/**
 * Extract text from a PDF, sorted top-to-bottom left-to-right by position.
 * Returns newline-separated rows.
 */
async function extractText(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const allLines = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    // Pull each item with its x/y position
    const items = content.items
      .filter((item) => item.str && item.str.trim().length > 0)
      .map((item) => ({
        str: item.str.trim(),
        x: item.transform[4],
        y: item.transform[5],
      }));

    if (items.length === 0) continue;

    // Cluster items into rows: items within 5pt of each other share a row
    const rows = [];
    for (const item of items) {
      const existing = rows.find((r) => Math.abs(r.y - item.y) <= 5);
      if (existing) {
        existing.items.push(item);
      } else {
        rows.push({ y: item.y, items: [item] });
      }
    }

    // Sort rows top-to-bottom (PDF y-axis is bottom-up, so higher y = higher on page)
    rows.sort((a, b) => b.y - a.y);

    // Within each row sort left-to-right
    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);
      allLines.push(row.items.map((i) => i.str).join(" "));
    }
  }

  return allLines.join("\n");
}

function dollarAfter(text, label) {
  const idx = text.toLowerCase().indexOf(label.toLowerCase());
  if (idx === -1) return null;
  const after = text.slice(idx + label.length, idx + label.length + 300);
  const m = after.match(/\$?([\d,]+(?:\.\d{2})?)/);
  return m ? m[1].replace(/,/g, "") : null;
}

/**
 * Parse a Nissan dealer invoice PDF.
 * Throws on extraction failure (caller handles error toast).
 * Returns an object — any field not found is simply absent.
 */
export async function parseInvoicePDF(file) {
  // Let extraction errors propagate — don't swallow them
  const text = await extractText(file);

  if (!text || text.trim().length < 20) {
    throw new Error("PDF appears to have no extractable text");
  }

  const result = {};
  const upper = text.toUpperCase();

  // ── VIN ───────────────────────────────────────────────────────────────────
  // Nissan invoices label it "FED VIN:" on its own line
  const fedVin = text.match(/FED\s+VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i);
  const rawVin = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  if (fedVin) result.vin = fedVin[1];
  else if (rawVin) result.vin = rawVin[1];

  // ── Stock # — last 8 chars of VIN ─────────────────────────────────────────
  if (result.vin) result.stock = result.vin.slice(-8);

  // ── Year ──────────────────────────────────────────────────────────────────
  // Try invoice date first (e.g. 09/08/2025 → 2025 = model year approximation)
  // Then try 2-digit year in item row "001 25 10115..."
  const year4 = text.match(/\b(20\d{2})\b/);
  if (year4) {
    result.year = year4[1];
  } else {
    // "001 25 " pattern — item number then 2-digit year
    const year2 = text.match(/\b0*1\b\s+(\d{2})\s+\d{3,}/);
    if (year2) result.year = "20" + year2[1];
  }

  // ── Model & Trim ──────────────────────────────────────────────────────────
  for (const model of NISSAN_MODELS) {
    const re = new RegExp(`\\b${model}\\b`);
    const idx = upper.search(re);
    if (idx === -1) continue;

    result.model = model;

    // Collect words after the model until a transmission token, number, or long word
    const after = upper.slice(idx + model.length).trimStart();
    const tokens = after.split(/\s+/);
    const trimParts = [];
    for (const tok of tokens) {
      if (!tok || /^\d/.test(tok) || /^\$/.test(tok)) break;
      if (TRANS.includes(tok)) break;
      if (tok.length > 14) break;
      trimParts.push(tok);
      if (trimParts.length >= 3) break;
    }
    if (trimParts.length) result.trim = trimParts.join(" ");
    break;
  }

  // DEBUG — log full extracted text
  console.log("FULL PDF TEXT:", text);

  // ── Color ─────────────────────────────────────────────────────────────────
  // Nissan invoice: "COLOR" label on its own line, value on the next line
  const lines = text.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim().toUpperCase() === "COLOR") {
      const val = lines[i + 1].trim();
      if (val && val.length > 1 && /^[A-Za-z]/.test(val)) {
        result.color = val;
        break;
      }
    }
  }
  // Fallback: "COLOR" appears inline followed by the color name on the same line
  if (!result.color) {
    const colorLine = upper.match(/\bCOLOR[:\s]+([A-Z][A-Z ]{2,25}?)(?:\s{2,}|\n|$)/);
    if (colorLine) result.color = colorLine[1].trim();
  }

  // ── Invoice price — "THIS AMOUNT DUE" ────────────────────────────────────
  for (const label of ["this amount due","pay this amount","total invoice price","total invoice","amount due"]) {
    const val = dollarAfter(text, label);
    if (val && parseFloat(val) > 1000) { result.invoicePrice = val; break; }
  }

  // ── Collections Holdback ─────────────────────────────────────────────────
  // Nissan format: "COLLECTIONS:\nHB: 1,147.00" — search for "collections:" and grab the number after it
  for (const label of ["collections:","collections holdback","collection holdback","coll holdback","collections hb","coll hb"]) {
    const val = dollarAfter(text, label);
    // Must be a realistic holdback amount (not a sentence fragment match)
    if (val && parseFloat(val) > 0 && parseFloat(val) < 5000) {
      result.collectionsHoldback = val;
      result.hasCollections = true;
      break;
    }
  }

  // ── Regular Holdback ─────────────────────────────────────────────────────
  if (!result.hasCollections) {
    for (const label of ["dealer holdback","holdback amount"]) {
      const val = dollarAfter(text, label);
      if (val && parseFloat(val) > 0 && parseFloat(val) < 10000) {
        result.holdback = val;
        break;
      }
    }
  }

  return result;
}
