import * as pdfjsLib from "pdfjs-dist";

// Point the worker at the bundled worker file
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

/**
 * Extract all text from a PDF file as a single string (all pages joined).
 */
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

/**
 * Pull the first dollar amount that appears after a label in text.
 * Returns raw numeric string like "36150.00" or null.
 */
function dollarAfter(text, label) {
  const idx = text.toLowerCase().indexOf(label.toLowerCase());
  if (idx === -1) return null;
  const after = text.slice(idx + label.length, idx + label.length + 200);
  const m = after.match(/\$?([\d,]+(?:\.\d{2})?)/);
  return m ? m[1].replace(/,/g, "") : null;
}

/**
 * Parse a Nissan/dealer invoice PDF and return auto-fill values.
 *
 * Returns an object with any of:
 *   vin, year, model, trim, color, stock,
 *   invoicePrice, holdback, collectionsHoldback, hasCollections
 *
 * Any field that can't be found is omitted.
 */
export async function parseInvoicePDF(file) {
  let text;
  try {
    text = await extractText(file);
  } catch (e) {
    console.warn("PDF parse error:", e);
    return {};
  }

  const result = {};

  // ── VIN ──────────────────────────────────────────────────────────────────
  const vinMatch = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  if (vinMatch) result.vin = vinMatch[1];

  // ── Stock Number ─────────────────────────────────────────────────────────
  const stockMatch = text.match(
    /(?:stock\s*(?:no\.?|#|number)?|dealer\s*stock\s*(?:no\.?|#)?)\s*[:\-]?\s*([A-Z0-9\-]+)/i
  );
  if (stockMatch) result.stock = stockMatch[1].trim();

  // ── Year ─────────────────────────────────────────────────────────────────
  const yearMatch = text.match(/\b(20\d{2}|19\d{2})\b/);
  if (yearMatch) result.year = yearMatch[1];

  // ── Model / Trim / Color ─────────────────────────────────────────────────
  // Try to find "NISSAN <MODEL>" pattern near the top
  const nissanModel = text.match(/NISSAN\s+([A-Z][A-Z0-9\- ]{2,20})/i);
  if (nissanModel) {
    const parts = nissanModel[1].trim().split(/\s+/);
    result.model = parts[0];
    if (parts.length > 1) result.trim = parts.slice(1).join(" ");
  }

  // Try explicit Model label
  const modelLabel = text.match(/\bModel[:\s]+([A-Z][A-Z0-9 \-]{2,25})/i);
  if (!result.model && modelLabel) result.model = modelLabel[1].trim();

  // Color
  const colorMatch = text.match(
    /(?:exterior\s+color|color)[:\s]+([A-Za-z][A-Za-z0-9 \/]{2,30}?)(?:\s{2,}|\n|,)/i
  );
  if (colorMatch) result.color = colorMatch[1].trim();

  // ── Invoice Price ("Pay This Amount" or "Total Invoice") ─────────────────
  const payLabels = [
    "pay this amount",
    "total invoice price",
    "total invoice",
    "invoice total",
    "amount due",
    "net price",
  ];
  for (const label of payLabels) {
    const val = dollarAfter(text, label);
    if (val) {
      result.invoicePrice = val;
      break;
    }
  }

  // ── Collections Holdback ─────────────────────────────────────────────────
  const chLabels = [
    "collections holdback",
    "collection holdback",
    "holdback collections",
  ];
  for (const label of chLabels) {
    const val = dollarAfter(text, label);
    if (val) {
      result.collectionsHoldback = val;
      result.hasCollections = true;
      break;
    }
  }

  // ── Regular Holdback (if no collections holdback) ────────────────────────
  if (!result.hasCollections) {
    const hbLabels = ["holdback", "hold back", "dealer holdback"];
    for (const label of hbLabels) {
      const val = dollarAfter(text, label);
      if (val) {
        result.holdback = val;
        break;
      }
    }
  }

  return result;
}
