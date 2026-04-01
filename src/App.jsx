import { useState, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import jsPDF from "jspdf";
import { parseInvoicePDF } from "./pdfParser";

// ── Helpers ────────────────────────────────────────────────────────────────
const parseNum = (v) =>
  parseFloat((v || "").toString().replace(/[^0-9.\-]/g, "")) || 0;

const fmtCurrency = (n) =>
  "$" +
  Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const calcCheck = (invoice, holdback, collectionsHoldback, hasCollections) => {
  if (hasCollections && collectionsHoldback && parseNum(collectionsHoldback) > 0) {
    return parseNum(invoice) - 3 * parseNum(collectionsHoldback);
  }
  return parseNum(invoice) - parseNum(holdback);
};

const EMPTY = {
  tradeDate: "",
  manager: "",
  oursTheirs: "Theirs",
  sellingCA: "Josh",
  dealerName: "",
  dealerContact: "",
  dealerCode: "",
  outStock: "",
  outYear: "",
  outModel: "",
  outTrim: "",
  outColor: "",
  outVIN: "",
  outInvoice: "",
  outHoldback: "",
  outCollectionsHoldback: "",
  outHasCollections: false,
  outAccessories: "",
  inStock: "",
  inYear: "",
  inModel: "",
  inTrim: "",
  inColor: "",
  inVIN: "",
  inInvoice: "",
  inHoldback: "",
  inCollectionsHoldback: "",
  inHasCollections: false,
  inAccessories: "",
  notes: "",
  outInvoiceStorageId: undefined,
  inInvoiceStorageId: undefined,
};

export default function DealerTradeApp() {
  const [form, setForm] = useState({ ...EMPTY, tradeDate: today() });
  const [editingId, setEditingId] = useState(null);
  const [toast, setToast] = useState(null);
  const [parsing, setParsing] = useState({ out: false, in: false });
  const [outFile, setOutFile] = useState(null);
  const [inFile, setInFile] = useState(null);
  const outFileRef = useRef();
  const inFileRef = useRef();

  // Convex
  const trades = useQuery(api.trades.list) ?? [];
  const createTrade = useMutation(api.trades.create);
  const updateTrade = useMutation(api.trades.update);
  const removeTrade = useMutation(api.trades.remove);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);

  const showToast = (msg, err) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 3000);
  };

  const set = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  // ── Computed check amounts ────────────────────────────────────────────────
  const outCheck = calcCheck(
    form.outInvoice,
    form.outHoldback,
    form.outCollectionsHoldback,
    form.outHasCollections
  );
  const inCheck = calcCheck(
    form.inInvoice,
    form.inHoldback,
    form.inCollectionsHoldback,
    form.inHasCollections
  );
  const diff = inCheck - outCheck;

  // ── Invoice PDF Upload & Parse ────────────────────────────────────────────
  const handleInvoiceUpload = async (side, file) => {
    if (!file) return;
    side === "out" ? setOutFile(file) : setInFile(file);
    setParsing((p) => ({ ...p, [side]: true }));

    try {
      const parsed = await parseInvoicePDF(file);

      let storageId;
      try {
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/pdf" },
          body: file,
        });
        const json = await res.json();
        storageId = json.storageId;
      } catch (e) {
        console.warn("Convex storage upload failed:", e);
      }

      setForm((prev) => {
        const u = {};
        if (side === "out") {
          if (parsed.vin)    u.outVIN   = parsed.vin;
          if (parsed.stock)  u.outStock = parsed.stock;
          if (parsed.year)   u.outYear  = parsed.year;
          if (parsed.model)  u.outModel = parsed.model;
          if (parsed.trim)   u.outTrim  = parsed.trim;
          if (parsed.color)  u.outColor = parsed.color;
          if (parsed.invoicePrice) u.outInvoice = parsed.invoicePrice;
          if (parsed.collectionsHoldback) {
            u.outCollectionsHoldback = parsed.collectionsHoldback;
            u.outHasCollections = true;
          } else if (parsed.holdback) {
            u.outHoldback = parsed.holdback;
          }
          if (storageId) u.outInvoiceStorageId = storageId;
        } else {
          if (parsed.vin)    u.inVIN   = parsed.vin;
          if (parsed.stock)  u.inStock = parsed.stock;
          if (parsed.year)   u.inYear  = parsed.year;
          if (parsed.model)  u.inModel = parsed.model;
          if (parsed.trim)   u.inTrim  = parsed.trim;
          if (parsed.color)  u.inColor = parsed.color;
          if (parsed.invoicePrice) u.inInvoice = parsed.invoicePrice;
          if (parsed.collectionsHoldback) {
            u.inCollectionsHoldback = parsed.collectionsHoldback;
            u.inHasCollections = true;
          } else if (parsed.holdback) {
            u.inHoldback = parsed.holdback;
          }
          if (storageId) u.inInvoiceStorageId = storageId;
        }
        return { ...prev, ...u };
      });

      showToast("Invoice parsed — fields auto-filled");
    } catch (e) {
      showToast("Could not parse PDF — fill fields manually", true);
    } finally {
      setParsing((p) => ({ ...p, [side]: false }));
    }
  };

  // ── Save / Update ────────────────────────────────────────────────────────
  const save = async () => {
    if (!form.outModel && !form.inModel) {
      showToast("Enter at least one vehicle model", true);
      return;
    }
    const payload = {
      tradeDate: form.tradeDate,
      manager: form.manager,
      oursTheirs: form.oursTheirs,
      sellingCA: form.sellingCA,
      dealerName: form.dealerName,
      dealerContact: form.dealerContact,
      dealerCode: form.dealerCode,
      outStock: form.outStock,
      outYear: form.outYear,
      outModel: form.outModel,
      outTrim: form.outTrim,
      outColor: form.outColor,
      outVIN: form.outVIN,
      outInvoice: form.outInvoice,
      outHoldback: form.outHoldback,
      outCollectionsHoldback: form.outCollectionsHoldback || undefined,
      outHasCollections: form.outHasCollections || undefined,
      outAccessories: form.outAccessories,
      inStock: form.inStock,
      inYear: form.inYear,
      inModel: form.inModel,
      inTrim: form.inTrim,
      inColor: form.inColor,
      inVIN: form.inVIN,
      inInvoice: form.inInvoice,
      inHoldback: form.inHoldback,
      inCollectionsHoldback: form.inCollectionsHoldback || undefined,
      inHasCollections: form.inHasCollections || undefined,
      inAccessories: form.inAccessories,
      notes: form.notes,
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

  const load = (t) => {
    setForm({ ...EMPTY, ...t });
    setEditingId(t._id);
    setOutFile(null);
    setInFile(null);
  };

  const del = async (t) => {
    await removeTrade({ id: t._id });
    if (editingId === t._id) clearForm();
    showToast("Trade deleted");
  };

  const clearForm = () => {
    setForm({ ...EMPTY, tradeDate: today() });
    setEditingId(null);
    setOutFile(null);
    setInFile(null);
    if (outFileRef.current) outFileRef.current.value = "";
    if (inFileRef.current) inFileRef.current.value = "";
  };

  // ── PDF Generation ────────────────────────────────────────────────────────
  const buildPDFDoc = (d, oCheck, iCheck) => {
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const W = doc.internal.pageSize.getWidth();
    const margin = 40;
    const colW = (W - margin * 2 - 20) / 2;
    let y = 0;

    const accent  = [37, 99, 235];
    const outRed  = [220, 38, 38];
    const inGreen = [22, 163, 74];
    const amber   = [217, 119, 6];
    const dark    = [15, 23, 42];
    const mid     = [107, 114, 128];
    const light   = [241, 245, 249];
    const white   = [255, 255, 255];

    const sectionHeader = (label, color) => {
      doc.setFillColor(...color);
      doc.roundedRect(margin, y, W - margin * 2, 22, 4, 4, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...white);
      doc.text(label.toUpperCase(), margin + 10, y + 14);
      y += 28;
    };

    const lv = (lbl, val, x, vy, maxW) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(...mid);
      doc.text(lbl.toUpperCase(), x, vy);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...dark);
      const lines = doc.splitTextToSize(val || "—", maxW || 160);
      doc.text(lines, x, vy + 10);
      return vy + 10 + (lines.length - 1) * 9;
    };

    const vehicleBlock = (title, titleColor, fields, x, yTop) => {
      const lineH = 22;
      const bH = fields.length * lineH + 50;
      const bgR = titleColor[0] === 220 ? [254, 242, 242] : [240, 253, 244];
      doc.setFillColor(...bgR);
      doc.setDrawColor(...titleColor);
      doc.roundedRect(x, yTop, colW, bH, 6, 6, "FD");
      doc.setFillColor(...titleColor);
      doc.roundedRect(x + 8, yTop - 8, 74, 16, 8, 8, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(...white);
      doc.text(title, x + 12, yTop + 3);
      let vy = yTop + 20;
      fields.forEach(([lbl, val]) => {
        lv(lbl, val, x + 8, vy, colW - 16);
        vy += lineH;
      });
      return bH;
    };

    // HEADER
    doc.setFillColor(...dark);
    doc.rect(0, 0, W, 60, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(...white);
    doc.text("DEALER TRADE FORM", margin, 35);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184);
    doc.text("Empire Lakewood Nissan", margin, 50);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`Date: ${d.tradeDate}`, W - margin, 35, { align: "right" });
    y = 72;

    // TRADE INFO
    sectionHeader("Trade Info", accent);
    const infoFields = [
      ["Manager", d.manager],
      ["Ours / Theirs", d.oursTheirs],
      ["Selling CA", d.sellingCA],
      ["Dealer Name", d.dealerName],
      ["Contact", d.dealerContact],
      ["Dealer Code", d.dealerCode],
    ];
    const colW3 = (W - margin * 2) / 3;
    infoFields.forEach(([lbl, val], i) => {
      lv(lbl, val, margin + (i % 3) * colW3, y + Math.floor(i / 3) * 30, colW3 - 10);
    });
    y += Math.ceil(infoFields.length / 3) * 30 + 12;

    // VEHICLES
    sectionHeader("Vehicles", [234, 88, 12]);
    const outFields = [
      ["Stock #", d.outStock],
      ["Year / Model", `${d.outYear} ${d.outModel}`],
      ["Trim", d.outTrim],
      ["Color", d.outColor],
      ["VIN", d.outVIN],
      ["Invoice", d.outInvoice ? `$${d.outInvoice}` : ""],
      d.outHasCollections && d.outCollectionsHoldback
        ? ["Collections HB ×3", `$${d.outCollectionsHoldback} × 3 = ${fmtCurrency(3 * parseNum(d.outCollectionsHoldback))}`]
        : ["Holdback", d.outHoldback ? `$${d.outHoldback}` : ""],
    ];
    const inFields = [
      ["Stock #", d.inStock],
      ["Year / Model", `${d.inYear} ${d.inModel}`],
      ["Trim", d.inTrim],
      ["Color", d.inColor],
      ["VIN", d.inVIN],
      ["Invoice", d.inInvoice ? `$${d.inInvoice}` : ""],
      d.inHasCollections && d.inCollectionsHoldback
        ? ["Collections HB ×3", `$${d.inCollectionsHoldback} × 3 = ${fmtCurrency(3 * parseNum(d.inCollectionsHoldback))}`]
        : ["Holdback", d.inHoldback ? `$${d.inHoldback}` : ""],
    ];
    const outH = vehicleBlock("OUTGOING", outRed, outFields, margin, y);
    const inH  = vehicleBlock("INCOMING", inGreen, inFields, margin + colW + 20, y);
    y += Math.max(outH, inH) + 14;

    // SETTLEMENT DIFF
    const diffVal = iCheck - oCheck;
    const diffColor = diffVal > 0 ? outRed : diffVal < 0 ? inGreen : mid;
    doc.setFillColor(...light);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, y, W - margin * 2, 36, 6, 6, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...mid);
    doc.text("SETTLEMENT DIFFERENCE", margin + 10, y + 12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...diffColor);
    doc.text(fmtCurrency(diffVal), margin + 10, y + 27);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...mid);
    const diffNote =
      diffVal > 0
        ? `We owe them ${fmtCurrency(diffVal)}`
        : diffVal < 0
        ? `They owe us ${fmtCurrency(Math.abs(diffVal))}`
        : "Even trade";
    doc.text(diffNote, W - margin - 10, y + 22, { align: "right" });
    y += 46;

    // CHECKS
    sectionHeader("Settlement — Net Checks", amber);
    const checkBlock = (color, oCheckAmt, invoice, holdback, colHB, hasCol, bx) => {
      const bgR = color[0] === 220 ? [254, 242, 242] : [240, 253, 244];
      doc.setFillColor(...bgR);
      doc.setDrawColor(...color);
      doc.roundedRect(bx, y, colW, 72, 6, 6, "FD");
      doc.setFillColor(...color);
      doc.roundedRect(bx + 8, y + 8, 50, 20, 5, 5, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(...white);
      doc.text("CHECK", bx + 11, y + 21);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.setTextColor(...dark);
      doc.text(fmtCurrency(oCheckAmt), bx + 70, y + 25);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...mid);
      let formula = "";
      if (hasCol && colHB && parseNum(colHB) > 0) {
        formula = `$${invoice} − 3 × $${colHB} (Collections HB)`;
      } else if (holdback) {
        formula = `$${invoice} − $${holdback} (Holdback)`;
      }
      if (formula) {
        const fl = doc.splitTextToSize(formula, colW - 18);
        doc.text(fl, bx + 8, y + 46);
      }
    };
    checkBlock(outRed, oCheck, d.outInvoice, d.outHoldback, d.outCollectionsHoldback, d.outHasCollections, margin);
    checkBlock(inGreen, iCheck, d.inInvoice, d.inHoldback, d.inCollectionsHoldback, d.inHasCollections, margin + colW + 20);
    y += 82;

    // NOTES
    if (d.notes) {
      sectionHeader("Notes / Comments", [107, 114, 128]);
      doc.setFillColor(249, 250, 251);
      doc.setDrawColor(229, 231, 235);
      const noteLines = doc.splitTextToSize(d.notes, W - margin * 2 - 20);
      const noteH = noteLines.length * 12 + 20;
      doc.roundedRect(margin, y, W - margin * 2, noteH, 6, 6, "FD");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(...dark);
      doc.text(noteLines, margin + 10, y + 14);
      y += noteH + 10;
    }

    // FOOTER
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFillColor(...light);
    doc.rect(0, pageH - 26, W, 26, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...mid);
    doc.text("Empire Lakewood Nissan — Dealer Trade Form", margin, pageH - 9);
    doc.text(`Generated ${d.tradeDate}`, W - margin, pageH - 9, { align: "right" });

    return doc;
  };

  const downloadPDF = (d = form) => {
    const oCheck = calcCheck(d.outInvoice, d.outHoldback, d.outCollectionsHoldback, d.outHasCollections);
    const iCheck = calcCheck(d.inInvoice, d.inHoldback, d.inCollectionsHoldback, d.inHasCollections);
    const doc = buildPDFDoc(d, oCheck, iCheck);
    doc.save(`dealer-trade_${d.tradeDate}_${(d.outModel || "OUT").replace(/\s+/g, "-")}_${(d.inModel || "IN").replace(/\s+/g, "-")}.pdf`);
  };

  // ── Email ──────────────────────────────────────────────────────────────────
  const handleEmail = async (d = form) => {
    const oCheck = calcCheck(d.outInvoice, d.outHoldback, d.outCollectionsHoldback, d.outHasCollections);
    const iCheck = calcCheck(d.inInvoice, d.inHoldback, d.inCollectionsHoldback, d.inHasCollections);

    // 1. Download trade form PDF
    buildPDFDoc(d, oCheck, iCheck).save(
      `dealer-trade_${d.tradeDate}_${(d.outModel || "OUT").replace(/\s+/g, "-")}.pdf`
    );

    // 2. Download uploaded invoice PDFs
    const dlBlob = (blob, name) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    if (outFile) dlBlob(outFile, `invoice-outgoing-${d.outVIN || "out"}.pdf`);
    if (inFile)  dlBlob(inFile,  `invoice-incoming-${d.inVIN  || "in"}.pdf`);

    // 3. Open mailto
    const subject = `Dealer Trade: ${d.outYear} ${d.outModel} ${d.outTrim} ↔ ${d.inYear} ${d.inModel} ${d.inTrim} | ${d.tradeDate}`;
    const body = [
      `DEALER TRADE FORM — Empire Lakewood Nissan`,
      `Date: ${d.tradeDate}`,
      `Manager: ${d.manager}  |  Ours/Theirs: ${d.oursTheirs}  |  Selling CA: ${d.sellingCA}`,
      `Dealer: ${d.dealerName}  |  Contact: ${d.dealerContact}  |  Code: ${d.dealerCode}`,
      ``,
      `--- OUTGOING ---`,
      `Stock: ${d.outStock}  |  ${d.outYear} ${d.outModel} ${d.outTrim}  |  Color: ${d.outColor}`,
      `VIN: ${d.outVIN}`,
      d.outHasCollections && d.outCollectionsHoldback
        ? `Collections HB: $${d.outCollectionsHoldback} × 3 = ${fmtCurrency(3 * parseNum(d.outCollectionsHoldback))}`
        : `Holdback: $${d.outHoldback}`,
      `Invoice: $${d.outInvoice}`,
      `NET CHECK: ${fmtCurrency(oCheck)}`,
      ``,
      `--- INCOMING ---`,
      `Stock: ${d.inStock}  |  ${d.inYear} ${d.inModel} ${d.inTrim}  |  Color: ${d.inColor}`,
      `VIN: ${d.inVIN}`,
      d.inHasCollections && d.inCollectionsHoldback
        ? `Collections HB: $${d.inCollectionsHoldback} × 3 = ${fmtCurrency(3 * parseNum(d.inCollectionsHoldback))}`
        : `Holdback: $${d.inHoldback}`,
      `Invoice: $${d.inInvoice}`,
      `NET CHECK: ${fmtCurrency(iCheck)}`,
      d.notes ? `\nNOTES: ${d.notes}` : "",
      ``,
      `(Attach the downloaded PDFs before sending)`,
    ]
      .filter(Boolean)
      .join("\n");

    window.open(
      `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      "_self"
    );
    showToast("PDFs downloaded — attach them to the email");
  };

  // ── Input helpers ─────────────────────────────────────────────────────────
  const inp = (key, placeholder, mono, type) => (
    <input
      type={type || "text"}
      value={form[key]}
      onChange={(e) => set(key, e.target.value)}
      placeholder={placeholder}
      style={{ ...s.input, ...(mono ? s.mono : {}) }}
      onFocus={(e) => {
        e.target.style.borderColor = "#93c5fd";
        e.target.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.1)";
      }}
      onBlur={(e) => {
        e.target.style.borderColor = "#e5e7eb";
        e.target.style.boxShadow = "none";
      }}
    />
  );

  const readonlyVal = (val, placeholder) => (
    <div style={{ ...s.input, ...s.mono, background: "#f1f5f9", color: "#1e40af", fontWeight: 700, cursor: "default", userSelect: "text" }}>
      {val || placeholder || "—"}
    </div>
  );

  const InvoiceUploadBtn = ({ side, fileRef }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <input
        type="file"
        accept="application/pdf"
        ref={fileRef}
        style={{ display: "none" }}
        onChange={(e) => handleInvoiceUpload(side, e.target.files[0])}
      />
      <button
        style={{ ...s.uploadBtn, ...(parsing[side] ? { opacity: 0.6, cursor: "wait" } : {}) }}
        onClick={() => fileRef.current?.click()}
        disabled={parsing[side]}
      >
        {parsing[side] ? "Parsing PDF..." : "Upload Invoice PDF"}
      </button>
      {(side === "out" ? outFile : inFile) && (
        <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 500 }}>
          ✓ {(side === "out" ? outFile : inFile).name}
        </span>
      )}
    </div>
  );

  const CollectionsToggle = ({ side }) => {
    const hasKey = side === "out" ? "outHasCollections" : "inHasCollections";
    const chKey  = side === "out" ? "outCollectionsHoldback" : "inCollectionsHoldback";
    const hbKey  = side === "out" ? "outHoldback" : "inHoldback";
    const invKey = side === "out" ? "outInvoice" : "inInvoice";
    const check  = side === "out" ? outCheck : inCheck;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            style={{ ...s.toggleBtn, ...(form[hasKey] ? {} : s.toggleActive) }}
            onClick={() => set(hasKey, false)}
          >
            Manual Holdback
          </button>
          <button
            style={{ ...s.toggleBtn, ...(form[hasKey] ? s.toggleActive : {}) }}
            onClick={() => set(hasKey, true)}
          >
            Collections HB
          </button>
        </div>
        {form[hasKey] ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Field label="Collections Holdback (base value)">{inp(chKey, "325.00", true)}</Field>
            {form[chKey] && parseNum(form[chKey]) > 0 && (
              <div style={s.chFormula}>
                ×3 = {fmtCurrency(3 * parseNum(form[chKey]))}
              </div>
            )}
          </div>
        ) : (
          <Field label="Holdback (manual)">{inp(hbKey, "974.00", true)}</Field>
        )}
        <Field label="Net Check (auto-calculated)">
          {readonlyVal(parseNum(form[invKey]) > 0 ? fmtCurrency(check) : null, "Fill Invoice first")}
        </Field>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
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
          <Field label="Date">{inp("tradeDate", "", "", "date")}</Field>
          <Field label="Manager">{inp("manager", "Gene")}</Field>
          <Field label="Ours / Theirs">
            <select value={form.oursTheirs} onChange={(e) => set("oursTheirs", e.target.value)} style={s.input}>
              <option value="Theirs">Theirs</option>
              <option value="Ours">Ours</option>
            </select>
          </Field>
          <Field label="Selling CA">{inp("sellingCA", "Josh")}</Field>
          <Field label="Dealer Name">{inp("dealerName", "Empire")}</Field>
          <Field label="Contact">{inp("dealerContact", "Dave")}</Field>
          <Field label="Dealer Code">{inp("dealerCode", "5356", true)}</Field>
        </div>
      </div>

      {/* Vehicles */}
      <div style={s.card}>
        <SectionHead color="#ea580c" label="Vehicles" />
        <div style={s.grid2}>
          <div style={s.colOut}>
            <span style={s.pillOut}>OUTGOING</span>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <InvoiceUploadBtn side="out" fileRef={outFileRef} />
              <Field label="Stock #">{inp("outStock", "6N0234", true)}</Field>
              <div style={s.grid2Inner}>
                <Field label="Year">{inp("outYear", "26", true)}</Field>
                <Field label="Model">{inp("outModel", "Rogue")}</Field>
              </div>
              <div style={s.grid2Inner}>
                <Field label="Trim">{inp("outTrim", "Dark Armor")}</Field>
                <Field label="Color">{inp("outColor", "Blue")}</Field>
              </div>
              <Field label="VIN">{inp("outVIN", "5N1BT3BB7TC740725", true)}</Field>
              <Field label="Invoice (Pay This Amount)">{inp("outInvoice", "36150.00", true)}</Field>
              <Field label="Accessories">{inp("outAccessories", "0.00", true)}</Field>
              <CollectionsToggle side="out" />
            </div>
          </div>

          <div style={s.colIn}>
            <span style={s.pillIn}>INCOMING</span>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <InvoiceUploadBtn side="in" fileRef={inFileRef} />
              <Field label="Stock #">{inp("inStock", "6N0341", true)}</Field>
              <div style={s.grid2Inner}>
                <Field label="Year">{inp("inYear", "26", true)}</Field>
                <Field label="Model">{inp("inModel", "Rogue")}</Field>
              </div>
              <div style={s.grid2Inner}>
                <Field label="Trim">{inp("inTrim", "Platinum")}</Field>
                <Field label="Color">{inp("inColor", "Gray")}</Field>
              </div>
              <Field label="VIN">{inp("inVIN", "JN8BT3DD1TW312462", true)}</Field>
              <Field label="Invoice (Pay This Amount)">{inp("inInvoice", "39809.00", true)}</Field>
              <Field label="Accessories">{inp("inAccessories", "0.00", true)}</Field>
              <CollectionsToggle side="in" />
            </div>
          </div>
        </div>

        <div style={s.diffBox}>
          <div>
            <div style={s.diffLabel}>SETTLEMENT DIFFERENCE</div>
            <div style={{
              fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, fontSize: 22,
              color: diff > 0 ? "#dc2626" : diff < 0 ? "#16a34a" : "#9ca3af",
            }}>
              {fmtCurrency(diff)}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            {diff > 0 ? `We owe them ${fmtCurrency(diff)}` : diff < 0 ? `They owe us ${fmtCurrency(Math.abs(diff))}` : "Even trade"}
          </div>
        </div>
      </div>

      {/* Settlement */}
      <div style={s.card}>
        <SectionHead color="#d97706" label="Settlement — Net Checks" />
        <div style={s.grid2}>
          <div style={s.settleOut}>
            <span style={s.methodOut}>CHECK</span>
            <div style={{ flex: 1 }}>
              <div style={s.fieldLabel}>OUTGOING NET CHECK</div>
              <div style={{ ...s.mono, fontSize: 20, fontWeight: 700, color: "#dc2626", marginTop: 4 }}>
                {parseNum(form.outInvoice) > 0 ? fmtCurrency(outCheck) : "—"}
              </div>
              <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>
                {form.outHasCollections && form.outCollectionsHoldback
                  ? `$${form.outInvoice} − 3×$${form.outCollectionsHoldback}`
                  : form.outHoldback ? `$${form.outInvoice} − $${form.outHoldback}` : ""}
              </div>
            </div>
          </div>
          <div style={s.settleIn}>
            <span style={s.methodIn}>CHECK</span>
            <div style={{ flex: 1 }}>
              <div style={s.fieldLabel}>INCOMING NET CHECK</div>
              <div style={{ ...s.mono, fontSize: 20, fontWeight: 700, color: "#16a34a", marginTop: 4 }}>
                {parseNum(form.inInvoice) > 0 ? fmtCurrency(inCheck) : "—"}
              </div>
              <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>
                {form.inHasCollections && form.inCollectionsHoldback
                  ? `$${form.inInvoice} − 3×$${form.inCollectionsHoldback}`
                  : form.inHoldback ? `$${form.inInvoice} − $${form.inHoldback}` : ""}
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
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Additional notes for accounting..."
          style={{ ...s.input, minHeight: 80, resize: "vertical" }}
          onFocus={(e) => { e.target.style.borderColor = "#93c5fd"; e.target.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.1)"; }}
          onBlur={(e) => { e.target.style.borderColor = "#e5e7eb"; e.target.style.boxShadow = "none"; }}
        />
      </div>

      {/* Actions */}
      <div style={s.btnRow}>
        <button style={s.btnPrimary} onClick={save}>{editingId ? "Update Trade" : "Save Trade"}</button>
        <button style={s.btnBlue} onClick={() => downloadPDF()}>Download PDF</button>
        <button style={s.btnGreen} onClick={() => handleEmail()}>Email to Office</button>
        <button style={s.btnDanger} onClick={clearForm}>Clear</button>
      </div>

      {/* Saved Trades */}
      <div style={{ ...s.card, marginTop: 4 }}>
        <SectionHead color="#16a34a" label="Saved Trades" />
        {trades.length === 0 ? (
          <p style={{ textAlign: "center", color: "#d1d5db", fontSize: 14, padding: 24 }}>
            No saved trades yet. Fill out the form and hit Save.
          </p>
        ) : trades.map((t) => (
          <div key={t._id} style={{ ...s.tradeItem, ...(editingId === t._id ? { borderColor: "#93c5fd", background: "#eff6ff" } : {}) }}
            onClick={() => load(t)}
            onMouseEnter={(e) => { if (editingId !== t._id) { e.currentTarget.style.borderColor = "#d1d5db"; e.currentTarget.style.background = "#f9fafb"; } }}
            onMouseLeave={(e) => { if (editingId !== t._id) { e.currentTarget.style.borderColor = "#e5e7eb"; e.currentTarget.style.background = "#ffffff"; } }}
          >
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#dc2626" }}>OUT: {t.outYear} {t.outModel} {t.outTrim}</div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#9ca3af" }}>{t.outStock || "No stock #"} | {t.outColor}</div>
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#16a34a" }}>IN: {t.inYear} {t.inModel} {t.inTrim}</div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#9ca3af" }}>{t.inStock || "No stock #"} | {t.inColor}</div>
              </div>
              <div style={{ fontSize: 11, color: "#6b7280", alignSelf: "center" }}>{t.tradeDate}</div>
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <button style={s.smallBtn} onClick={(e) => { e.stopPropagation(); load(t); setTimeout(() => handleEmail(t), 100); }}>Email</button>
              <button style={s.smallBtn} onClick={(e) => { e.stopPropagation(); downloadPDF(t); }}>PDF</button>
              <button style={s.smallBtnDel} onClick={(e) => { e.stopPropagation(); del(t); }}>Del</button>
            </div>
          </div>
        ))}
      </div>

      {toast && (
        <div style={{
          position: "fixed", bottom: 20, right: 20, zIndex: 999,
          padding: "12px 22px", borderRadius: 12,
          fontFamily: "'Outfit',sans-serif", fontWeight: 500, fontSize: 14,
          boxShadow: "0 4px 24px rgba(0,0,0,0.1)",
          background: toast.err ? "#fef2f2" : "#f0fdf4",
          border: `1px solid ${toast.err ? "#fecaca" : "#bbf7d0"}`,
          color: toast.err ? "#dc2626" : "#16a34a",
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function SectionHead({ color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <h2 style={{ fontFamily: "'Outfit',sans-serif", fontWeight: 600, fontSize: 14, textTransform: "uppercase", letterSpacing: 1.5, color: "#1f2937", margin: 0 }}>
        {label}
      </h2>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={s.fieldLabel}>{label}</label>
      {children}
    </div>
  );
}

const s = {
  page: { fontFamily: "'Outfit',sans-serif", background: "#f8fafc", color: "#1f2937", minHeight: "100vh", padding: 20, maxWidth: 900, margin: "0 auto" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  h1: { fontWeight: 700, fontSize: 24, color: "#0f172a", margin: 0 },
  subtitle: { fontSize: 13, color: "#6b7280", margin: 0 },
  card: { background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 20, marginBottom: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 },
  grid2Inner: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  input: { fontFamily: "'Outfit',sans-serif", fontSize: 14, fontWeight: 400, color: "#1f2937", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: "11px 13px", outline: "none", width: "100%", boxSizing: "border-box", transition: "all 0.2s ease" },
  mono: { fontFamily: "'JetBrains Mono',monospace", fontWeight: 500, fontSize: 13 },
  fieldLabel: { fontFamily: "'Outfit',sans-serif", fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, color: "#6b7280" },
  colOut: { background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 14, padding: 18, position: "relative" },
  colIn:  { background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 14, padding: 18, position: "relative" },
  pillOut: { position: "absolute", top: -9, left: 16, padding: "2px 12px", borderRadius: 20, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: 2, background: "#dc2626", color: "#ffffff" },
  pillIn:  { position: "absolute", top: -9, left: 16, padding: "2px 12px", borderRadius: 20, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: 2, background: "#16a34a", color: "#ffffff" },
  diffBox: { marginTop: 16, padding: "14px 18px", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 },
  diffLabel: { fontFamily: "'Outfit',sans-serif", fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, color: "#6b7280", marginBottom: 4 },
  settleOut: { display: "flex", alignItems: "center", gap: 14, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 14, padding: "14px 16px" },
  settleIn:  { display: "flex", alignItems: "center", gap: 14, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 14, padding: "14px 16px" },
  methodOut: { fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, padding: "6px 12px", borderRadius: 8, background: "#dc2626", color: "#ffffff", flexShrink: 0 },
  methodIn:  { fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, padding: "6px 12px", borderRadius: 8, background: "#16a34a", color: "#ffffff", flexShrink: 0 },
  uploadBtn: { fontFamily: "'Outfit',sans-serif", fontWeight: 500, fontSize: 12, background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe", borderRadius: 8, padding: "7px 14px", cursor: "pointer" },
  toggleBtn: { fontFamily: "'Outfit',sans-serif", fontWeight: 500, fontSize: 11, background: "#f3f4f6", color: "#6b7280", border: "1px solid #e5e7eb", borderRadius: 8, padding: "6px 12px", cursor: "pointer", flex: 1 },
  toggleActive: { background: "#1e40af", color: "#ffffff", border: "1px solid #1e40af" },
  chFormula: { fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 600, color: "#7c3aed", background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 6, padding: "4px 10px" },
  btnRow: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 },
  btnPrimary: { fontFamily: "'Outfit',sans-serif", fontWeight: 500, fontSize: 14, background: "#2563eb", color: "white", border: "none", borderRadius: 10, padding: "12px 22px", cursor: "pointer" },
  btnBlue:    { fontFamily: "'Outfit',sans-serif", fontWeight: 500, fontSize: 14, background: "#0f172a", color: "white", border: "none", borderRadius: 10, padding: "12px 22px", cursor: "pointer" },
  btnGreen:   { fontFamily: "'Outfit',sans-serif", fontWeight: 500, fontSize: 14, background: "#16a34a", color: "white", border: "none", borderRadius: 10, padding: "12px 22px", cursor: "pointer" },
  btnDanger:  { fontFamily: "'Outfit',sans-serif", fontWeight: 500, fontSize: 14, background: "#ffffff", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 10, padding: "12px 22px", cursor: "pointer" },
  tradeItem: { background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "14px 18px", marginBottom: 8, display: "flex", alignItems: "center", gap: 14, cursor: "pointer", transition: "all 0.2s ease" },
  smallBtn:    { fontFamily: "'Outfit',sans-serif", fontSize: 11, fontWeight: 500, background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 8, color: "#6b7280", padding: "5px 10px", cursor: "pointer" },
  smallBtnDel: { fontFamily: "'Outfit',sans-serif", fontSize: 11, fontWeight: 500, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, color: "#dc2626", padding: "5px 10px", cursor: "pointer" },
};
