import { useState, useRef } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../convex/_generated/api";
import jsPDF from "jspdf";
import { PDFDocument } from "pdf-lib";
import { parseInvoicePDF } from "./pdfParser";

// ── Helpers ────────────────────────────────────────────────────────────────
const parseNum = (v) =>
  parseFloat((v || "").toString().replace(/[^0-9.\-]/g, "")) || 0;

const fmtCurrency = (n) =>
  "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const calcCheck = (invoice, holdback, collectionsHoldback, hasCollections, accessories) => {
  const acc = parseNum(accessories);
  if (hasCollections && collectionsHoldback && parseNum(collectionsHoldback) > 0) {
    return parseNum(invoice) + acc - 2 * parseNum(collectionsHoldback);
  }
  return parseNum(invoice) + acc - parseNum(holdback);
};

const EMPTY = {
  tradeDate: "", manager: "", oursTheirs: "Theirs", sellingCA: "Josh",
  dealerName: "", dealerContact: "", dealerCode: "",
  outStock: "", outYear: "", outModel: "", outTrim: "", outColor: "", outVIN: "",
  outInvoice: "", outHoldback: "", outCollectionsHoldback: "", outHasCollections: false, outAccessories: "",
  inStock: "", inYear: "", inModel: "", inTrim: "", inColor: "", inVIN: "",
  inInvoice: "", inHoldback: "", inCollectionsHoldback: "", inHasCollections: false, inAccessories: "",
  notes: "", outInvoiceStorageId: undefined, inInvoiceStorageId: undefined,
};

// ── Top-level sub-components (MUST be outside DealerTradeApp to prevent remount on every render) ──

function InvoiceUploadBtn({ side, fileRef, parsing, file, onUpload }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <input
        type="file"
        accept="application/pdf"
        ref={fileRef}
        style={{ display: "none" }}
        onChange={(e) => onUpload(side, e.target.files[0])}
      />
      <button
        style={{ ...s.uploadBtn, ...(parsing ? { opacity: 0.6, cursor: "wait" } : {}) }}
        onClick={() => fileRef.current?.click()}
        disabled={parsing}
      >
        {parsing ? "Parsing PDF..." : "Upload Invoice PDF"}
      </button>
      {file && (
        <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 500 }}>✓ {file.name}</span>
      )}
    </div>
  );
}

function CollectionsToggle({ side, form, onChange, check }) {
  const hasKey = side === "out" ? "outHasCollections" : "inHasCollections";
  const chKey  = side === "out" ? "outCollectionsHoldback" : "inCollectionsHoldback";
  const hbKey  = side === "out" ? "outHoldback" : "inHoldback";
  const invKey = side === "out" ? "outInvoice" : "inInvoice";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          style={{ ...s.toggleBtn, ...(form[hasKey] ? {} : s.toggleActive) }}
          onClick={() => onChange(hasKey, false)}
        >
          Manual Holdback
        </button>
        <button
          style={{ ...s.toggleBtn, ...(form[hasKey] ? s.toggleActive : {}) }}
          onClick={() => onChange(hasKey, true)}
        >
          Collections HB
        </button>
      </div>

      {form[hasKey] ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Field label="Collections Holdback (base value)">
            <input
              type="text"
              value={form[chKey]}
              onChange={(e) => onChange(chKey, e.target.value)}
              placeholder="325.00"
              style={{ ...s.input, ...s.mono }}
              onFocus={(e) => { e.target.style.borderColor = "#93c5fd"; e.target.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.1)"; }}
              onBlur={(e)  => { e.target.style.borderColor = "#e5e7eb"; e.target.style.boxShadow = "none"; }}
            />
          </Field>
          {form[chKey] && parseNum(form[chKey]) > 0 && (
            <div style={s.chFormula}>×2 = {fmtCurrency(2 * parseNum(form[chKey]))}</div>
          )}
        </div>
      ) : (
        <Field label="Holdback (manual)">
          <input
            type="text"
            value={form[hbKey]}
            onChange={(e) => onChange(hbKey, e.target.value)}
            placeholder="974.00"
            style={{ ...s.input, ...s.mono }}
            onFocus={(e) => { e.target.style.borderColor = "#93c5fd"; e.target.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.1)"; }}
            onBlur={(e)  => { e.target.style.borderColor = "#e5e7eb"; e.target.style.boxShadow = "none"; }}
          />
        </Field>
      )}

      <Field label="Net Check (auto-calculated)">
        <div style={{ ...s.input, ...s.mono, background: "#f1f5f9", color: "#1e40af", fontWeight: 700, cursor: "default" }}>
          {parseNum(form[invKey]) > 0 ? fmtCurrency(check) : "Fill Invoice first"}
        </div>
      </Field>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function DealerTradeApp() {
  const [form, setForm] = useState({ ...EMPTY, tradeDate: today() });
  const [editingId, setEditingId] = useState(null);
  const [toast, setToast] = useState(null);
  const [parsing, setParsing] = useState({ out: false, in: false });
  const [sending, setSending] = useState(false);
  const [outFile, setOutFile] = useState(null);
  const [inFile, setInFile] = useState(null);
  const outFileRef = useRef();
  const inFileRef = useRef();

  const trades = useQuery(api.trades.list) ?? [];
  const createTrade = useMutation(api.trades.create);
  const updateTrade = useMutation(api.trades.update);
  const removeTrade = useMutation(api.trades.remove);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const sendEmail = useAction(api.email.sendTradeEmail);

  const showToast = (msg, err) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 3000);
  };

  // Single field setter — stable reference for sub-components
  const handleChange = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  const outCheck = calcCheck(form.outInvoice, form.outHoldback, form.outCollectionsHoldback, form.outHasCollections, form.outAccessories);
  const inCheck  = calcCheck(form.inInvoice,  form.inHoldback,  form.inCollectionsHoldback,  form.inHasCollections,  form.inAccessories);
  const diff = inCheck - outCheck;

  // ── PDF Upload & Parse ────────────────────────────────────────────────────
  const handleInvoiceUpload = async (side, file) => {
    if (!file) return;
    side === "out" ? setOutFile(file) : setInFile(file);
    setParsing((p) => ({ ...p, [side]: true }));

    try {
      const parsed = await parseInvoicePDF(file);

      // Upload to Convex storage (non-blocking — don't fail parse if this fails)
      let storageId;
      try {
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/pdf" },
          body: file,
        });
        storageId = (await res.json()).storageId;
      } catch (e) {
        console.warn("Convex storage upload failed:", e);
      }

      const filled = [];
      setForm((prev) => {
        const u = {};
        const p = side === "out";
        if (parsed.vin)          { u[p?"outVIN":"inVIN"]     = parsed.vin;          filled.push("VIN"); }
        if (parsed.stock)        { u[p?"outStock":"inStock"]  = parsed.stock;        filled.push("Stock"); }
        if (parsed.year)         { u[p?"outYear":"inYear"]    = parsed.year;         filled.push("Year"); }
        if (parsed.model)        { u[p?"outModel":"inModel"]  = parsed.model;        filled.push("Model"); }
        if (parsed.color)        { u[p?"outColor":"inColor"]  = parsed.color;        filled.push("Color"); }
        if (parsed.invoicePrice) { u[p?"outInvoice":"inInvoice"] = parsed.invoicePrice; filled.push("Invoice"); }
        if (parsed.collectionsHoldback) {
          u[p?"outCollectionsHoldback":"inCollectionsHoldback"] = parsed.collectionsHoldback;
          u[p?"outHasCollections":"inHasCollections"]           = true;
          filled.push("Collections HB");
        } else if (parsed.holdback) {
          u[p?"outHoldback":"inHoldback"] = parsed.holdback;
          filled.push("Holdback");
        }
        if (storageId) u[p?"outInvoiceStorageId":"inInvoiceStorageId"] = storageId;
        return { ...prev, ...u };
      });

      if (filled.length > 0) {
        showToast(`Filled: ${filled.join(", ")}`);
      } else {
        showToast("PDF parsed but no fields found — fill manually", true);
      }
    } catch (e) {
      console.error("PDF parse error:", e);
      showToast(`Parse error: ${e.message || "unknown error"}`, true);
    } finally {
      setParsing((p) => ({ ...p, [side]: false }));
    }
  };

  // ── Save / Update ─────────────────────────────────────────────────────────
  const save = async () => {
    if (!form.outModel && !form.inModel) { showToast("Enter at least one vehicle model", true); return; }
    const payload = {
      tradeDate: form.tradeDate, manager: form.manager, oursTheirs: form.oursTheirs,
      sellingCA: form.sellingCA, dealerName: form.dealerName, dealerContact: form.dealerContact,
      dealerCode: form.dealerCode,
      outStock: form.outStock, outYear: form.outYear, outModel: form.outModel,
      outTrim: form.outTrim, outColor: form.outColor, outVIN: form.outVIN,
      outInvoice: form.outInvoice, outHoldback: form.outHoldback,
      outCollectionsHoldback: form.outCollectionsHoldback || undefined,
      outHasCollections: form.outHasCollections || undefined,
      outAccessories: form.outAccessories,
      inStock: form.inStock, inYear: form.inYear, inModel: form.inModel,
      inTrim: form.inTrim, inColor: form.inColor, inVIN: form.inVIN,
      inInvoice: form.inInvoice, inHoldback: form.inHoldback,
      inCollectionsHoldback: form.inCollectionsHoldback || undefined,
      inHasCollections: form.inHasCollections || undefined,
      inAccessories: form.inAccessories, notes: form.notes,
      outInvoiceStorageId: form.outInvoiceStorageId || undefined,
      inInvoiceStorageId: form.inInvoiceStorageId || undefined,
    };
    if (editingId) {
      await updateTrade({ id: editingId, ...payload });
      setEditingId(null);
      showToast("Trade updated!");
    } else {
      await createTrade(payload);
      showToast("Trade saved!");
    }
  };

  const load = (t) => { setForm({ ...EMPTY, ...t }); setEditingId(t._id); setOutFile(null); setInFile(null); };

  const del = async (t) => {
    await removeTrade({ id: t._id });
    if (editingId === t._id) clearForm();
    showToast("Trade deleted");
  };

  const clearForm = () => {
    setForm({ ...EMPTY, tradeDate: today() });
    setEditingId(null); setOutFile(null); setInFile(null);
    if (outFileRef.current) outFileRef.current.value = "";
    if (inFileRef.current) inFileRef.current.value = "";
  };

  // ── PDF ───────────────────────────────────────────────────────────────────
  const buildPDFDoc = (d, oCheck, iCheck) => {
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const W = doc.internal.pageSize.getWidth();
    const margin = 40;
    const colW = (W - margin * 2 - 20) / 2;
    let y = 0;

    const accent = [37,99,235], outRed = [220,38,38], inGreen = [22,163,74];
    const amber = [217,119,6], dark = [15,23,42], mid = [107,114,128];
    const light = [241,245,249], white = [255,255,255];

    const sectionHeader = (label, color) => {
      doc.setFillColor(...color);
      doc.roundedRect(margin, y, W - margin*2, 22, 4, 4, "F");
      doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...white);
      doc.text(label.toUpperCase(), margin+10, y+14);
      y += 28;
    };

    const lv = (lbl, val, x, vy, maxW) => {
      doc.setFont("helvetica","normal"); doc.setFontSize(6.5); doc.setTextColor(...mid);
      doc.text(lbl.toUpperCase(), x, vy);
      doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(...dark);
      const lines = doc.splitTextToSize(val || "—", maxW || 160);
      doc.text(lines, x, vy+10);
    };

    const vehicleBlock = (title, titleColor, fields, x, yTop) => {
      const lineH = 22, bH = fields.length*lineH + 50;
      const bgR = titleColor[0]===220 ? [254,242,242] : [240,253,244];
      doc.setFillColor(...bgR); doc.setDrawColor(...titleColor);
      doc.roundedRect(x, yTop, colW, bH, 6, 6, "FD");
      doc.setFillColor(...titleColor);
      doc.roundedRect(x+8, yTop-8, 74, 16, 8, 8, "F");
      doc.setFont("helvetica","bold"); doc.setFontSize(6.5); doc.setTextColor(...white);
      doc.text(title, x+12, yTop+3);
      let vy = yTop+20;
      fields.forEach(([lbl,val]) => { lv(lbl, val, x+8, vy, colW-16); vy += lineH; });
      return bH;
    };

    // HEADER
    doc.setFillColor(...dark); doc.rect(0,0,W,60,"F");
    doc.setFont("helvetica","bold"); doc.setFontSize(18); doc.setTextColor(...white);
    doc.text("DEALER TRADE FORM", margin, 35);
    doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(148,163,184);
    doc.text("Empire Lakewood Nissan", margin, 50);
    doc.setFont("helvetica","bold"); doc.setFontSize(9);
    doc.text(`Date: ${d.tradeDate}`, W-margin, 35, { align:"right" });
    y = 72;

    // TRADE INFO
    sectionHeader("Trade Info", accent);
    const infoFields = [["Manager",d.manager],["Ours / Theirs",d.oursTheirs],["Dealer Name",d.dealerName],["Contact",d.dealerContact],["Dealer Code",d.dealerCode]];
    const colW3 = (W - margin*2)/3;
    infoFields.forEach(([lbl,val],i) => lv(lbl,val, margin+(i%3)*colW3, y+Math.floor(i/3)*30, colW3-10));
    y += Math.ceil(infoFields.length/3)*30 + 12;

    // VEHICLES
    sectionHeader("Vehicles", [234,88,12]);
    const outFields = [
      ["Stock #", d.outStock], ["Year / Model", `${d.outYear} ${d.outModel}`],
      ["Color", d.outColor], ["VIN", d.outVIN],
      ["Invoice", d.outInvoice ? `$${d.outInvoice}` : ""],
      d.outHasCollections && d.outCollectionsHoldback
        ? ["Collections HB ×2", `$${d.outCollectionsHoldback} × 2 = ${fmtCurrency(2*parseNum(d.outCollectionsHoldback))}`]
        : ["Holdback", d.outHoldback ? `$${d.outHoldback}` : ""],
    ];
    const inFields = [
      ["Stock #", d.inStock], ["Year / Model", `${d.inYear} ${d.inModel}`],
      ["Color", d.inColor], ["VIN", d.inVIN],
      ["Invoice", d.inInvoice ? `$${d.inInvoice}` : ""],
      d.inHasCollections && d.inCollectionsHoldback
        ? ["Collections HB ×2", `$${d.inCollectionsHoldback} × 2 = ${fmtCurrency(2*parseNum(d.inCollectionsHoldback))}`]
        : ["Holdback", d.inHoldback ? `$${d.inHoldback}` : ""],
    ];
    const outH = vehicleBlock("OUTGOING", outRed, outFields, margin, y);
    const inH  = vehicleBlock("INCOMING", inGreen, inFields, margin+colW+20, y);
    y += Math.max(outH, inH) + 14;

    // CHECKS
    sectionHeader("Settlement — Net Checks", amber);
    const checkBlock = (color, checkAmt, invoice, holdback, colHB, hasCol, bx) => {
      const bgR = color[0]===220 ? [254,242,242] : [240,253,244];
      doc.setFillColor(...bgR); doc.setDrawColor(...color);
      doc.roundedRect(bx, y, colW, 72, 6, 6, "FD");
      doc.setFillColor(...color);
      doc.roundedRect(bx+8, y+8, 50, 20, 5, 5, "F");
      doc.setFont("helvetica","bold"); doc.setFontSize(7); doc.setTextColor(...white);
      doc.text("CHECK", bx+11, y+21);
      doc.setFont("helvetica","bold"); doc.setFontSize(15); doc.setTextColor(...dark);
      doc.text(fmtCurrency(checkAmt), bx+70, y+25);
      doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(...mid);
      const formula = hasCol && colHB && parseNum(colHB)>0
        ? `$${invoice} − 2 × $${colHB} (Collections HB)`
        : holdback ? `$${invoice} − $${holdback} (Holdback)` : "";
      if (formula) doc.text(doc.splitTextToSize(formula, colW-18), bx+8, y+46);
    };
    checkBlock(outRed,  oCheck, d.outInvoice, d.outHoldback, d.outCollectionsHoldback, d.outHasCollections, margin);
    checkBlock(inGreen, iCheck, d.inInvoice,  d.inHoldback,  d.inCollectionsHoldback,  d.inHasCollections,  margin+colW+20);
    y += 82;

    // NOTES
    if (d.notes) {
      sectionHeader("Notes / Comments", [107,114,128]);
      doc.setFillColor(249,250,251); doc.setDrawColor(229,231,235);
      const noteLines = doc.splitTextToSize(d.notes, W-margin*2-20);
      const noteH = noteLines.length*12+20;
      doc.roundedRect(margin, y, W-margin*2, noteH, 6, 6, "FD");
      doc.setFont("helvetica","normal"); doc.setFontSize(9.5); doc.setTextColor(...dark);
      doc.text(noteLines, margin+10, y+14);
      y += noteH+10;
    }

    // FOOTER
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFillColor(...light); doc.rect(0, pageH-26, W, 26, "F");
    doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(...mid);
    doc.text("Empire Lakewood Nissan — Dealer Trade Form", margin, pageH-9);
    doc.text(`Generated ${d.tradeDate}`, W-margin, pageH-9, { align:"right" });

    return doc;
  };

  const buildMergedPDFBytes = async (d, oFile, iFile) => {
    const oC = calcCheck(d.outInvoice, d.outHoldback, d.outCollectionsHoldback, d.outHasCollections, d.outAccessories);
    const iC = calcCheck(d.inInvoice,  d.inHoldback,  d.inCollectionsHoldback,  d.inHasCollections,  d.inAccessories);
    const tradeBytes = buildPDFDoc(d, oC, iC).output("arraybuffer");
    const merged = await PDFDocument.create();
    const addPdf = async (bytes) => {
      const src = await PDFDocument.load(bytes);
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    };
    await addPdf(tradeBytes);
    if (oFile) await addPdf(await oFile.arrayBuffer());
    if (iFile) await addPdf(await iFile.arrayBuffer());
    return merged.save();
  };

  const downloadPDF = async (d = form, oFile = outFile, iFile = inFile) => {
    const mergedBytes = await buildMergedPDFBytes(d, oFile, iFile);
    const blob = new Blob([mergedBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dealer-trade_${d.tradeDate}_${(d.outModel||"OUT").replace(/\s+/g,"-")}_${(d.inModel||"IN").replace(/\s+/g,"-")}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleEmail = async (d = form) => {
    const oC = calcCheck(d.outInvoice, d.outHoldback, d.outCollectionsHoldback, d.outHasCollections, d.outAccessories);
    const iC = calcCheck(d.inInvoice,  d.inHoldback,  d.inCollectionsHoldback,  d.inHasCollections,  d.inAccessories);
    // Download one merged PDF (trade form + invoices)
    await downloadPDF(d, outFile, inFile);
    const subject = `Dealer Trade: ${d.outYear} ${d.outModel} ↔ ${d.inYear} ${d.inModel} | ${d.tradeDate}`;
    const body = [
      `DEALER TRADE FORM — Empire Lakewood Nissan`,`Date: ${d.tradeDate}`,
      `Manager: ${d.manager}  |  Ours/Theirs: ${d.oursTheirs}`,
      `Dealer: ${d.dealerName}  |  Contact: ${d.dealerContact}  |  Code: ${d.dealerCode}`,``,
      `--- OUTGOING ---`,`Stock: ${d.outStock}  |  ${d.outYear} ${d.outModel}  |  Color: ${d.outColor}`,`VIN: ${d.outVIN}`,
      d.outHasCollections&&d.outCollectionsHoldback?`Collections HB: $${d.outCollectionsHoldback} × 2 = ${fmtCurrency(2*parseNum(d.outCollectionsHoldback))}`:`Holdback: $${d.outHoldback}`,
      `Invoice: $${d.outInvoice}`,`NET CHECK: ${fmtCurrency(oC)}`,``,
      `--- INCOMING ---`,`Stock: ${d.inStock}  |  ${d.inYear} ${d.inModel}  |  Color: ${d.inColor}`,`VIN: ${d.inVIN}`,
      d.inHasCollections&&d.inCollectionsHoldback?`Collections HB: $${d.inCollectionsHoldback} × 2 = ${fmtCurrency(2*parseNum(d.inCollectionsHoldback))}`:`Holdback: $${d.inHoldback}`,
      `Invoice: $${d.inInvoice}`,`NET CHECK: ${fmtCurrency(iC)}`,
      d.notes?`\nNOTES: ${d.notes}`:"",``,`(Attach the downloaded PDFs before sending)`,
    ].filter(Boolean).join("\n");
    window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,"_self");
    showToast("Merged PDF downloaded — attach it to the email");
  };

  const handleSubmitTrade = async (d = form) => {
    setSending(true);
    try {
      const mergedBytes = await buildMergedPDFBytes(d, outFile, inFile);
      const bytes = new Uint8Array(mergedBytes);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const pdfBase64 = btoa(binary);
      const filename = `dealer-trade_${d.tradeDate}_${(d.outModel||"OUT").replace(/\s+/g,"-")}_${(d.inModel||"IN").replace(/\s+/g,"-")}.pdf`;
      const oC = calcCheck(d.outInvoice, d.outHoldback, d.outCollectionsHoldback, d.outHasCollections);
      const iC = calcCheck(d.inInvoice,  d.inHoldback,  d.inCollectionsHoldback,  d.inHasCollections);
      const subject = `Dealer Trade: ${d.outYear} ${d.outModel} ↔ ${d.inYear} ${d.inModel} | ${d.tradeDate}`;
      const body = [
        `DEALER TRADE FORM — Empire Lakewood Nissan`,`Date: ${d.tradeDate}`,
        `Manager: ${d.manager}  |  Ours/Theirs: ${d.oursTheirs}`,
        `Dealer: ${d.dealerName}  |  Contact: ${d.dealerContact}  |  Code: ${d.dealerCode}`,``,
        `--- OUTGOING ---`,`Stock: ${d.outStock}  |  ${d.outYear} ${d.outModel}  |  Color: ${d.outColor}`,`VIN: ${d.outVIN}`,
        d.outHasCollections&&d.outCollectionsHoldback?`Collections HB: $${d.outCollectionsHoldback} × 2 = ${fmtCurrency(2*parseNum(d.outCollectionsHoldback))}`:`Holdback: $${d.outHoldback}`,
        `Invoice: $${d.outInvoice}`,`NET CHECK: ${fmtCurrency(oC)}`,``,
        `--- INCOMING ---`,`Stock: ${d.inStock}  |  ${d.inYear} ${d.inModel}  |  Color: ${d.inColor}`,`VIN: ${d.inVIN}`,
        d.inHasCollections&&d.inCollectionsHoldback?`Collections HB: $${d.inCollectionsHoldback} × 2 = ${fmtCurrency(2*parseNum(d.inCollectionsHoldback))}`:`Holdback: $${d.inHoldback}`,
        `Invoice: $${d.inInvoice}`,`NET CHECK: ${fmtCurrency(iC)}`,
        d.notes?`\nNOTES: ${d.notes}`:"",
      ].filter(Boolean).join("\n");
      await sendEmail({ subject, body, pdfBase64, filename });
      // Auto-save the trade
      const payload = {
        tradeDate: d.tradeDate, manager: d.manager, oursTheirs: d.oursTheirs,
        sellingCA: d.sellingCA, dealerName: d.dealerName, dealerContact: d.dealerContact,
        dealerCode: d.dealerCode,
        outStock: d.outStock, outYear: d.outYear, outModel: d.outModel,
        outTrim: d.outTrim, outColor: d.outColor, outVIN: d.outVIN,
        outInvoice: d.outInvoice, outHoldback: d.outHoldback,
        outCollectionsHoldback: d.outCollectionsHoldback || undefined,
        outHasCollections: d.outHasCollections || undefined,
        outAccessories: d.outAccessories,
        inStock: d.inStock, inYear: d.inYear, inModel: d.inModel,
        inTrim: d.inTrim, inColor: d.inColor, inVIN: d.inVIN,
        inInvoice: d.inInvoice, inHoldback: d.inHoldback,
        inCollectionsHoldback: d.inCollectionsHoldback || undefined,
        inHasCollections: d.inHasCollections || undefined,
        inAccessories: d.inAccessories, notes: d.notes,
        outInvoiceStorageId: d.outInvoiceStorageId || undefined,
        inInvoiceStorageId: d.inInvoiceStorageId || undefined,
      };
      if (editingId) {
        await updateTrade({ id: editingId, ...payload });
      } else {
        const newId = await createTrade(payload);
        setEditingId(newId);
      }
      showToast("Trade submitted and saved!");
    } catch (e) {
      const msg = e?.data ?? e?.message ?? String(e);
      showToast(`Send failed: ${msg}`, true);
    } finally {
      setSending(false);
    }
  };

  // Simple inline input (not a component — avoids remount issues)
  const inp = (key, placeholder, mono, type) => (
    <input
      type={type || "text"}
      value={form[key]}
      onChange={(e) => handleChange(key, e.target.value)}
      placeholder={placeholder}
      style={{ ...s.input, ...(mono ? s.mono : {}) }}
      onFocus={(e) => { e.target.style.borderColor="#93c5fd"; e.target.style.boxShadow="0 0 0 3px rgba(59,130,246,0.1)"; }}
      onBlur={(e)  => { e.target.style.borderColor="#e5e7eb"; e.target.style.boxShadow="none"; }}
    />
  );

  return (
    <div style={s.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        ::placeholder { color: #c4c8cf; }
      `}</style>

      <div style={s.header}>
        <div>
          <h1 style={s.h1}>Dealer Trade Form</h1>
          <p style={s.subtitle}>Empire Lakewood Nissan</p>
        </div>
      </div>

      {/* Trade Info */}
      <div style={s.card}>
        <SectionHead color="#2563eb" label="Trade Info" />
        <div style={s.grid2}>
          <Field label="Date">{inp("tradeDate","","","date")}</Field>
          <Field label="Manager">{inp("manager","Gene")}</Field>
          <Field label="Ours / Theirs">
            <select value={form.oursTheirs} onChange={(e)=>handleChange("oursTheirs",e.target.value)} style={s.input}>
              <option value="Theirs">Theirs</option>
              <option value="Ours">Ours</option>
            </select>
          </Field>
          <Field label="Dealer Name">{inp("dealerName","Empire")}</Field>
          <Field label="Contact">{inp("dealerContact","Dave")}</Field>
          <Field label="Dealer Code">{inp("dealerCode","5356",true)}</Field>
        </div>
      </div>

      {/* Vehicles */}
      <div style={s.card}>
        <SectionHead color="#ea580c" label="Vehicles" />
        <div style={s.grid2}>
          {/* Outgoing */}
          <div style={s.colOut}>
            <span style={s.pillOut}>OUTGOING</span>
            <div style={{ marginTop:14, display:"flex", flexDirection:"column", gap:10 }}>
              <InvoiceUploadBtn side="out" fileRef={outFileRef} parsing={parsing.out} file={outFile} onUpload={handleInvoiceUpload} />
              <Field label="Stock #">{inp("outStock","6N0234",true)}</Field>
              <div style={s.grid2Inner}>
                <Field label="Year">{inp("outYear","26",true)}</Field>
                <Field label="Model">{inp("outModel","Rogue")}</Field>
              </div>
              <Field label="Color">{inp("outColor","Gun Metallic")}</Field>
              <Field label="VIN">{inp("outVIN","5N1BT3BB7TC740725",true)}</Field>
              <Field label="Invoice (Pay This Amount)">{inp("outInvoice","36150.00",true)}</Field>
              <Field label="Accessories">{inp("outAccessories","0.00",true)}</Field>
              <CollectionsToggle side="out" form={form} onChange={handleChange} check={outCheck} />
            </div>
          </div>

          {/* Incoming */}
          <div style={s.colIn}>
            <span style={s.pillIn}>INCOMING</span>
            <div style={{ marginTop:14, display:"flex", flexDirection:"column", gap:10 }}>
              <InvoiceUploadBtn side="in" fileRef={inFileRef} parsing={parsing.in} file={inFile} onUpload={handleInvoiceUpload} />
              <Field label="Stock #">{inp("inStock","6N0341",true)}</Field>
              <div style={s.grid2Inner}>
                <Field label="Year">{inp("inYear","26",true)}</Field>
                <Field label="Model">{inp("inModel","Rogue")}</Field>
              </div>
              <Field label="Color">{inp("inColor","Brilliant Silver")}</Field>
              <Field label="VIN">{inp("inVIN","JN8BT3DD1TW312462",true)}</Field>
              <Field label="Invoice (Pay This Amount)">{inp("inInvoice","39809.00",true)}</Field>
              <Field label="Accessories">{inp("inAccessories","0.00",true)}</Field>
              <CollectionsToggle side="in" form={form} onChange={handleChange} check={inCheck} />
            </div>
          </div>
        </div>

      </div>

      {/* Settlement */}
      <div style={s.card}>
        <SectionHead color="#d97706" label="Settlement — Net Checks" />
        <div style={s.grid2}>
          <div style={s.settleOut}>
            <span style={s.methodOut}>CHECK</span>
            <div style={{ flex:1 }}>
              <div style={s.fieldLabel}>OUTGOING NET CHECK</div>
              <div style={{ ...s.mono, fontSize:20, fontWeight:700, color:"#dc2626", marginTop:4 }}>
                {parseNum(form.outInvoice)>0 ? fmtCurrency(outCheck) : "—"}
              </div>
              <div style={{ fontSize:10, color:"#9ca3af", marginTop:2 }}>
                {form.outHasCollections&&form.outCollectionsHoldback?`$${form.outInvoice} − 2×$${form.outCollectionsHoldback}`:form.outHoldback?`$${form.outInvoice} − $${form.outHoldback}`:""}
              </div>
            </div>
          </div>
          <div style={s.settleIn}>
            <span style={s.methodIn}>CHECK</span>
            <div style={{ flex:1 }}>
              <div style={s.fieldLabel}>INCOMING NET CHECK</div>
              <div style={{ ...s.mono, fontSize:20, fontWeight:700, color:"#16a34a", marginTop:4 }}>
                {parseNum(form.inInvoice)>0 ? fmtCurrency(inCheck) : "—"}
              </div>
              <div style={{ fontSize:10, color:"#9ca3af", marginTop:2 }}>
                {form.inHasCollections&&form.inCollectionsHoldback?`$${form.inInvoice} − 2×$${form.inCollectionsHoldback}`:form.inHoldback?`$${form.inInvoice} − $${form.inHoldback}`:""}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div style={s.card}>
        <SectionHead color="#9ca3af" label="Notes / Comments" />
        <textarea
          value={form.notes}
          onChange={(e)=>handleChange("notes",e.target.value)}
          placeholder="Additional notes for accounting..."
          style={{ ...s.input, minHeight:80, resize:"vertical" }}
          onFocus={(e)=>{ e.target.style.borderColor="#93c5fd"; e.target.style.boxShadow="0 0 0 3px rgba(59,130,246,0.1)"; }}
          onBlur={(e) =>{ e.target.style.borderColor="#e5e7eb"; e.target.style.boxShadow="none"; }}
        />
      </div>

      {/* Actions */}
      <div style={s.btnRow}>
        <button style={s.btnPrimary} onClick={save}>{editingId?"Update Trade":"Save Trade"}</button>
        <button style={s.btnBlue}    onClick={()=>downloadPDF()}>Download PDF</button>
        <button style={{ ...s.btnGreen, ...(sending?{opacity:0.6,cursor:"wait"}:{}) }} onClick={()=>handleSubmitTrade()} disabled={sending}>{sending?"Sending…":"Submit Trade"}</button>
        <button style={s.btnDanger}  onClick={clearForm}>Clear</button>
      </div>

      {/* Saved Trades */}
      <div style={{ ...s.card, marginTop:4 }}>
        <SectionHead color="#16a34a" label="Saved Trades" />
        {trades.length===0 ? (
          <p style={{ textAlign:"center", color:"#d1d5db", fontSize:14, padding:24 }}>No saved trades yet.</p>
        ) : trades.map((t) => (
          <div key={t._id}
            style={{ ...s.tradeItem, ...(editingId===t._id?{borderColor:"#93c5fd",background:"#eff6ff"}:{}) }}
            onClick={()=>load(t)}
            onMouseEnter={(e)=>{ if(editingId!==t._id){e.currentTarget.style.borderColor="#d1d5db";e.currentTarget.style.background="#f9fafb";} }}
            onMouseLeave={(e)=>{ if(editingId!==t._id){e.currentTarget.style.borderColor="#e5e7eb";e.currentTarget.style.background="#ffffff";} }}
          >
            <div style={{ display:"flex", gap:16, flexWrap:"wrap", flex:1, minWidth:0 }}>
              <div>
                <div style={{ fontWeight:600, fontSize:13, color:"#dc2626" }}>OUT: {t.outYear} {t.outModel} {t.outColor&&`— ${t.outColor}`}</div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:"#9ca3af" }}>{t.outStock||"No stock #"}</div>
              </div>
              <div>
                <div style={{ fontWeight:600, fontSize:13, color:"#16a34a" }}>IN: {t.inYear} {t.inModel} {t.inColor&&`— ${t.inColor}`}</div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:"#9ca3af" }}>{t.inStock||"No stock #"}</div>
              </div>
              <div style={{ fontSize:11, color:"#6b7280", alignSelf:"center" }}>{t.tradeDate}</div>
            </div>
            <div style={{ display:"flex", gap:6, flexShrink:0 }}>
              <button style={s.smallBtn} onClick={(e)=>{ e.stopPropagation(); load(t); setTimeout(()=>handleEmail(t),100); }}>Email</button>
              <button style={s.smallBtn} onClick={(e)=>{ e.stopPropagation(); downloadPDF(t); }}>PDF</button>
              <button style={s.smallBtnDel} onClick={(e)=>{ e.stopPropagation(); del(t); }}>Del</button>
            </div>
          </div>
        ))}
      </div>

      {toast && (
        <div style={{ position:"fixed", bottom:20, right:20, zIndex:999, padding:"12px 22px", borderRadius:12,
          fontFamily:"'Outfit',sans-serif", fontWeight:500, fontSize:14, boxShadow:"0 4px 24px rgba(0,0,0,0.1)",
          background:toast.err?"#fef2f2":"#f0fdf4", border:`1px solid ${toast.err?"#fecaca":"#bbf7d0"}`,
          color:toast.err?"#dc2626":"#16a34a" }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function SectionHead({ color, label }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:18 }}>
      <div style={{ width:8, height:8, borderRadius:"50%", background:color, flexShrink:0 }} />
      <h2 style={{ fontFamily:"'Outfit',sans-serif", fontWeight:600, fontSize:14, textTransform:"uppercase", letterSpacing:1.5, color:"#1f2937", margin:0 }}>{label}</h2>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
      <label style={s.fieldLabel}>{label}</label>
      {children}
    </div>
  );
}

const s = {
  page:      { fontFamily:"'Outfit',sans-serif", background:"#f8fafc", color:"#1f2937", minHeight:"100vh", padding:20, maxWidth:900, margin:"0 auto" },
  header:    { display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 },
  h1:        { fontWeight:700, fontSize:24, color:"#0f172a", margin:0 },
  subtitle:  { fontSize:13, color:"#6b7280", margin:0 },
  card:      { background:"#ffffff", border:"1px solid #e5e7eb", borderRadius:14, padding:20, marginBottom:14, boxShadow:"0 1px 3px rgba(0,0,0,0.04)" },
  grid2:     { display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 },
  grid2Inner:{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 },
  input:     { fontFamily:"'Outfit',sans-serif", fontSize:14, fontWeight:400, color:"#1f2937", background:"#f9fafb", border:"1px solid #e5e7eb", borderRadius:10, padding:"11px 13px", outline:"none", width:"100%", boxSizing:"border-box", transition:"all 0.2s ease" },
  mono:      { fontFamily:"'JetBrains Mono',monospace", fontWeight:500, fontSize:13 },
  fieldLabel:{ fontFamily:"'Outfit',sans-serif", fontWeight:500, fontSize:10, textTransform:"uppercase", letterSpacing:1.5, color:"#6b7280" },
  colOut:    { background:"#fef2f2", border:"1px solid #fecaca", borderRadius:14, padding:18, position:"relative" },
  colIn:     { background:"#f0fdf4", border:"1px solid #bbf7d0", borderRadius:14, padding:18, position:"relative" },
  pillOut:   { position:"absolute", top:-9, left:16, padding:"2px 12px", borderRadius:20, fontWeight:600, fontSize:10, textTransform:"uppercase", letterSpacing:2, background:"#dc2626", color:"#ffffff" },
  pillIn:    { position:"absolute", top:-9, left:16, padding:"2px 12px", borderRadius:20, fontWeight:600, fontSize:10, textTransform:"uppercase", letterSpacing:2, background:"#16a34a", color:"#ffffff" },
  diffBox:   { marginTop:16, padding:"14px 18px", background:"#f1f5f9", border:"1px solid #e2e8f0", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 },
  diffLabel: { fontFamily:"'Outfit',sans-serif", fontWeight:500, fontSize:10, textTransform:"uppercase", letterSpacing:1.5, color:"#6b7280", marginBottom:4 },
  settleOut: { display:"flex", alignItems:"center", gap:14, background:"#fef2f2", border:"1px solid #fecaca", borderRadius:14, padding:"14px 16px" },
  settleIn:  { display:"flex", alignItems:"center", gap:14, background:"#f0fdf4", border:"1px solid #bbf7d0", borderRadius:14, padding:"14px 16px" },
  methodOut: { fontWeight:600, fontSize:11, textTransform:"uppercase", letterSpacing:1, padding:"6px 12px", borderRadius:8, background:"#dc2626", color:"#ffffff", flexShrink:0 },
  methodIn:  { fontWeight:600, fontSize:11, textTransform:"uppercase", letterSpacing:1, padding:"6px 12px", borderRadius:8, background:"#16a34a", color:"#ffffff", flexShrink:0 },
  uploadBtn: { fontFamily:"'Outfit',sans-serif", fontWeight:500, fontSize:12, background:"#eff6ff", color:"#2563eb", border:"1px solid #bfdbfe", borderRadius:8, padding:"7px 14px", cursor:"pointer" },
  toggleBtn: { fontFamily:"'Outfit',sans-serif", fontWeight:500, fontSize:11, background:"#f3f4f6", color:"#6b7280", border:"1px solid #e5e7eb", borderRadius:8, padding:"6px 12px", cursor:"pointer", flex:1 },
  toggleActive:{ background:"#1e40af", color:"#ffffff", border:"1px solid #1e40af" },
  chFormula: { fontFamily:"'JetBrains Mono',monospace", fontSize:11, fontWeight:600, color:"#7c3aed", background:"#f5f3ff", border:"1px solid #ddd6fe", borderRadius:6, padding:"4px 10px" },
  btnRow:    { display:"flex", gap:10, flexWrap:"wrap", marginBottom:14 },
  btnPrimary:{ fontFamily:"'Outfit',sans-serif", fontWeight:500, fontSize:14, background:"#2563eb", color:"white", border:"none", borderRadius:10, padding:"12px 22px", cursor:"pointer" },
  btnBlue:   { fontFamily:"'Outfit',sans-serif", fontWeight:500, fontSize:14, background:"#0f172a", color:"white", border:"none", borderRadius:10, padding:"12px 22px", cursor:"pointer" },
  btnGreen:  { fontFamily:"'Outfit',sans-serif", fontWeight:500, fontSize:14, background:"#16a34a", color:"white", border:"none", borderRadius:10, padding:"12px 22px", cursor:"pointer" },
  btnAmber:  { fontFamily:"'Outfit',sans-serif", fontWeight:500, fontSize:14, background:"#d97706", color:"white", border:"none", borderRadius:10, padding:"12px 22px", cursor:"pointer" },
  btnDanger: { fontFamily:"'Outfit',sans-serif", fontWeight:500, fontSize:14, background:"#ffffff", color:"#dc2626", border:"1px solid #fecaca", borderRadius:10, padding:"12px 22px", cursor:"pointer" },
  tradeItem: { background:"#ffffff", border:"1px solid #e5e7eb", borderRadius:12, padding:"14px 18px", marginBottom:8, display:"flex", alignItems:"center", gap:14, cursor:"pointer", transition:"all 0.2s ease" },
  smallBtn:    { fontFamily:"'Outfit',sans-serif", fontSize:11, fontWeight:500, background:"#f3f4f6", border:"1px solid #e5e7eb", borderRadius:8, color:"#6b7280", padding:"5px 10px", cursor:"pointer" },
  smallBtnDel: { fontFamily:"'Outfit',sans-serif", fontSize:11, fontWeight:500, background:"#fef2f2", border:"1px solid #fecaca", borderRadius:8, color:"#dc2626", padding:"5px 10px", cursor:"pointer" },
};
