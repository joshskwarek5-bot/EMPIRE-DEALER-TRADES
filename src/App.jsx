import { useState, useEffect } from "react";
import jsPDF from "jspdf";

const FIELDS = {
  tradeDate: '', manager: '', oursTheirs: 'Theirs', sellingCA: 'Josh',
  dealerName: '', dealerContact: '', dealerCode: '',
  outStock: '', outYear: '', outModel: '', outTrim: '', outColor: '', outVIN: '',
  outInvoice: '', outHoldback: '', outAccessories: '',
  inStock: '', inYear: '', inModel: '', inTrim: '', inColor: '', inVIN: '',
  inInvoice: '', inHoldback: '', inAccessories: '',
  outCheck: '', inCheck: '', notes: ''
};

const parseNum = (v) => parseFloat((v || '').replace(/[^0-9.\-]/g, '')) || 0;
const fmtCurrency = (n) => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

export default function DealerTradeApp() {
  const [form, setForm] = useState({ ...FIELDS, tradeDate: today() });
  const [trades, setTrades] = useState([]);
  const [toast, setToast] = useState(null);
  const [editingIdx, setEditingIdx] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get('dealer-trades');
        if (res?.value) setTrades(JSON.parse(res.value));
      } catch(e) {}
    })();
  }, []);

  const persistTrades = async (updated) => {
    setTrades(updated);
    try { await window.storage.set('dealer-trades', JSON.stringify(updated)); } catch(e) {}
  };

  const showToast = (msg, err) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 2500);
  };

  const set = (key, val) => setForm(p => ({ ...p, [key]: val }));

  const outNet = parseNum(form.outInvoice) - parseNum(form.outHoldback) + parseNum(form.outAccessories);
  const inNet = parseNum(form.inInvoice) - parseNum(form.inHoldback) + parseNum(form.inAccessories);
  const diff = inNet - outNet;

  const save = () => {
    if (!form.outModel && !form.inModel) { showToast('Enter at least one vehicle model', true); return; }
    let updated;
    if (editingIdx !== null) {
      updated = [...trades];
      updated[editingIdx] = { ...form, id: trades[editingIdx].id };
      setEditingIdx(null);
    } else {
      updated = [{ ...form, id: Date.now() }, ...trades];
    }
    persistTrades(updated);
    showToast(editingIdx !== null ? 'Trade updated!' : 'Trade saved!');
  };

  const load = (t, idx) => { setForm(t); setEditingIdx(idx); };

  const del = (idx) => {
    const updated = trades.filter((_, i) => i !== idx);
    persistTrades(updated);
    if (editingIdx === idx) { setEditingIdx(null); clearForm(); }
    showToast('Trade deleted');
  };

  const clearForm = () => {
    setForm({ ...FIELDS, tradeDate: today() });
    setEditingIdx(null);
  };

  const buildPDF = (d = form) => {
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const W = doc.internal.pageSize.getWidth();
    const margin = 40;
    const colW = (W - margin * 2 - 20) / 2;
    let y = 0;

    // ── helpers ──────────────────────────────────────────────────────────────
    const accent  = [37, 99, 235];   // blue
    const outRed  = [220, 38, 38];
    const inGreen = [22, 163, 74];
    const amber   = [217, 119, 6];
    const dark    = [15, 23, 42];
    const mid     = [107, 114, 128];
    const light   = [241, 245, 249];
    const white   = [255, 255, 255];

    const rgb = (arr) => ({ r: arr[0], g: arr[1], b: arr[2] });

    const sectionHeader = (label, color) => {
      doc.setFillColor(...color);
      doc.roundedRect(margin, y, W - margin * 2, 24, 4, 4, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...white);
      doc.text(label.toUpperCase(), margin + 10, y + 15.5);
      y += 32;
    };

    const rowPair = (pairs, xStart, yStart, colWidth) => {
      let rx = xStart;
      let ry = yStart;
      pairs.forEach(([lbl, val], i) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...mid);
        doc.text(lbl.toUpperCase(), rx, ry);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(...dark);
        doc.text(val || '—', rx, ry + 12);
        rx += colWidth;
        if (i % 2 === 1) { rx = xStart; ry += 30; }
      });
      return ry + (pairs.length % 2 !== 0 ? 30 : 0);
    };

    const vehicleBlock = (title, titleColor, fields, x, yTop) => {
      const bH = 210;
      doc.setFillColor(titleColor[0] === 220 ? 254 : 240,
                       titleColor[0] === 220 ? 242 : 253,
                       titleColor[0] === 220 ? 242 : 244);
      doc.setDrawColor(...titleColor);
      doc.roundedRect(x, yTop, colW, bH, 6, 6, 'FD');

      // pill label
      doc.setFillColor(...titleColor);
      doc.roundedRect(x + 10, yTop - 8, 64, 16, 8, 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...white);
      doc.text(title, x + 14, yTop + 4);

      let vy = yTop + 22;
      const colHalf = colW / 2 - 6;

      fields.forEach(([lbl, val, wide]) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...mid);
        doc.text(lbl.toUpperCase(), x + 10, vy);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(...dark);
        doc.text(val || '—', x + 10, vy + 11);
        vy += wide ? 26 : 26;
      });
    };

    // ── HEADER ────────────────────────────────────────────────────────────────
    doc.setFillColor(...dark);
    doc.rect(0, 0, W, 64, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(...white);
    doc.text('DEALER TRADE FORM', margin, 38);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184);
    doc.text('Empire Lakewood Nissan', margin, 54);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184);
    doc.text(`Date: ${d.tradeDate}`, W - margin, 38, { align: 'right' });
    y = 80;

    // ── TRADE INFO ────────────────────────────────────────────────────────────
    sectionHeader('Trade Info', accent);
    const infoFields = [
      ['Manager', d.manager],
      ['Ours / Theirs', d.oursTheirs],
      ['Selling CA', d.sellingCA],
      ['Dealer Name', d.dealerName],
      ['Contact', d.dealerContact],
      ['Dealer Code', d.dealerCode],
    ];
    const colW3 = (W - margin * 2) / 3;
    infoFields.forEach(([lbl, val], i) => {
      const cx = margin + (i % 3) * colW3;
      const cy = y + Math.floor(i / 3) * 34;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...mid);
      doc.text(lbl.toUpperCase(), cx, cy);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...dark);
      doc.text(val || '—', cx, cy + 13);
    });
    y += Math.ceil(infoFields.length / 3) * 34 + 10;

    // ── VEHICLES ──────────────────────────────────────────────────────────────
    sectionHeader('Vehicles', [234, 88, 12]);
    const outFields = [
      ['Stock #', d.outStock],
      ['Year', d.outYear],
      ['Model', d.outModel, true],
      ['Trim', d.outTrim, true],
      ['Color', d.outColor],
      ['VIN', d.outVIN, true],
      ['Invoice', d.outInvoice ? `$${d.outInvoice}` : ''],
      ['Holdback', d.outHoldback ? `$${d.outHoldback}` : ''],
    ];
    const inFields = [
      ['Stock #', d.inStock],
      ['Year', d.inYear],
      ['Model', d.inModel, true],
      ['Trim', d.inTrim, true],
      ['Color', d.inColor],
      ['VIN', d.inVIN, true],
      ['Invoice', d.inInvoice ? `$${d.inInvoice}` : ''],
      ['Holdback', d.inHoldback ? `$${d.inHoldback}` : ''],
    ];
    vehicleBlock('OUTGOING', outRed, outFields, margin, y);
    vehicleBlock('INCOMING', inGreen, inFields, margin + colW + 20, y);
    y += 220;

    // settlement diff banner
    const diffVal = (parseNum(d.inInvoice) - parseNum(d.inHoldback) + parseNum(d.inAccessories))
                  - (parseNum(d.outInvoice) - parseNum(d.outHoldback) + parseNum(d.outAccessories));
    const diffColor = diffVal > 0 ? outRed : diffVal < 0 ? inGreen : mid;
    doc.setFillColor(...light);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, y, W - margin * 2, 38, 6, 6, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...mid);
    doc.text('SETTLEMENT DIFFERENCE', margin + 12, y + 13);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...diffColor);
    doc.text(fmtCurrency(diffVal), margin + 12, y + 29);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...mid);
    const diffNote = diffVal > 0
      ? `We owe them ${fmtCurrency(diffVal)}`
      : diffVal < 0 ? `They owe us ${fmtCurrency(diffVal)}` : 'Even trade';
    doc.text(diffNote, W - margin - 12, y + 22, { align: 'right' });
    y += 50;

    // ── SETTLEMENT ────────────────────────────────────────────────────────────
    sectionHeader('Settlement', amber);
    [[outRed, 'OUTGOING CHECK', d.outCheck ? `$${d.outCheck}` : '—'],
     [inGreen, 'INCOMING CHECK', d.inCheck ? `$${d.inCheck}` : '—']
    ].forEach(([color, label, val], i) => {
      const bx = margin + i * (colW + 20);
      doc.setFillColor(color[0] === 220 ? 254 : 240,
                       color[0] === 220 ? 242 : 253,
                       color[0] === 220 ? 242 : 244);
      doc.setDrawColor(...color);
      doc.roundedRect(bx, y, colW, 42, 6, 6, 'FD');
      doc.setFillColor(...color);
      doc.roundedRect(bx + 10, y + 10, 52, 22, 5, 5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...white);
      doc.text('CHECK', bx + 14, y + 24);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(...dark);
      doc.text(val, bx + 74, y + 27);
    });
    y += 56;

    // ── NOTES ─────────────────────────────────────────────────────────────────
    if (d.notes) {
      sectionHeader('Notes / Comments', [107, 114, 128]);
      doc.setFillColor(249, 250, 251);
      doc.setDrawColor(229, 231, 235);
      doc.roundedRect(margin, y, W - margin * 2, 54, 6, 6, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(...dark);
      const lines = doc.splitTextToSize(d.notes, W - margin * 2 - 20);
      doc.text(lines, margin + 10, y + 16);
      y += 64;
    }

    // ── FOOTER ────────────────────────────────────────────────────────────────
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFillColor(...light);
    doc.rect(0, pageH - 28, W, 28, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...mid);
    doc.text('Empire Lakewood Nissan — Dealer Trade Form', margin, pageH - 10);
    doc.text(`Generated ${d.tradeDate}`, W - margin, pageH - 10, { align: 'right' });

    const filename = `dealer-trade_${d.tradeDate}_${(d.outModel || 'OUT').replace(/\s+/g,'-')}_${(d.inModel || 'IN').replace(/\s+/g,'-')}.pdf`;
    doc.save(filename);
    return filename;
  };

  const buildEmail = () => {
    const d = form;
    buildPDF(d);
    const subject = `Dealer Trade: ${d.outYear} ${d.outModel} ${d.outTrim} <> ${d.inYear} ${d.inModel} ${d.inTrim} | ${d.tradeDate}`;
    const body = [
      `DEALER TRADE FORM`,
      `Date: ${d.tradeDate}`,
      `Manager: ${d.manager}  |  Ours/Theirs: ${d.oursTheirs}  |  Selling CA: ${d.sellingCA}`,
      `Dealer: ${d.dealerName}  |  Contact: ${d.dealerContact}  |  Code: ${d.dealerCode}`,
      ``,
      `--- OUTGOING ---`,
      `Stock: ${d.outStock}  |  ${d.outYear} ${d.outModel} ${d.outTrim}  |  Color: ${d.outColor}`,
      `VIN: ${d.outVIN}`,
      `Invoice: $${d.outInvoice}  |  Holdback: $${d.outHoldback}  |  Accessories: $${d.outAccessories}`,
      `CHECK: $${d.outCheck}`,
      ``,
      `--- INCOMING ---`,
      `Stock: ${d.inStock}  |  ${d.inYear} ${d.inModel} ${d.inTrim}  |  Color: ${d.inColor}`,
      `VIN: ${d.inVIN}`,
      `Invoice: $${d.inInvoice}  |  Holdback: $${d.inHoldback}  |  Accessories: $${d.inAccessories}`,
      `CHECK: $${d.inCheck}`,
      d.notes ? `\nNOTES: ${d.notes}` : '',
      ``,
      `(PDF attachment downloaded to your device — please attach before sending)`
    ].filter(l => l !== undefined).join('\n');
    window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_self');
    showToast('PDF downloaded — email opening...');
  };

  const inp = (key, placeholder, mono, type) => (
    <input
      type={type || 'text'}
      value={form[key]}
      onChange={e => set(key, e.target.value)}
      placeholder={placeholder}
      style={{
        ...s.input,
        ...(mono ? s.mono : {})
      }}
      onFocus={e => { e.target.style.borderColor='#93c5fd'; e.target.style.boxShadow='0 0 0 3px rgba(59,130,246,0.1)'; }}
      onBlur={e => { e.target.style.borderColor='#e5e7eb'; e.target.style.boxShadow='none'; }}
    />
  );

  return (
    <div style={s.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        ::placeholder { color: #c4c8cf; }
      `}</style>

      {/* Header */}
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
          <Field label="Date">{inp('tradeDate','','', 'date')}</Field>
          <Field label="Manager">{inp('manager','Gene')}</Field>
          <Field label="Ours / Theirs">
            <select value={form.oursTheirs} onChange={e=>set('oursTheirs',e.target.value)} style={s.input}>
              <option value="Theirs">Theirs</option>
              <option value="Ours">Ours</option>
            </select>
          </Field>
          <Field label="Selling CA">{inp('sellingCA','Josh')}</Field>
          <Field label="Dealer Name">{inp('dealerName','Empire')}</Field>
          <Field label="Contact">{inp('dealerContact','Dave')}</Field>
          <Field label="Dealer Code">{inp('dealerCode','5356', true)}</Field>
        </div>
      </div>

      {/* Vehicles */}
      <div style={s.card}>
        <SectionHead color="#ea580c" label="Vehicles" />
        <div style={s.grid2}>
          {/* Outgoing */}
          <div style={s.colOut}>
            <span style={s.pillOut}>OUTGOING</span>
            <div style={{marginTop:14,display:'flex',flexDirection:'column',gap:10}}>
              <Field label="Stock #">{inp('outStock','6N0234', true)}</Field>
              <div style={s.grid2Inner}>
                <Field label="Year">{inp('outYear','26', true)}</Field>
                <Field label="Model">{inp('outModel','Rogue')}</Field>
              </div>
              <div style={s.grid2Inner}>
                <Field label="Trim">{inp('outTrim','Dark Armor')}</Field>
                <Field label="Color">{inp('outColor','Blue')}</Field>
              </div>
              <Field label="VIN">{inp('outVIN','5N1BT3BB7TC740725', true)}</Field>
              <Field label="Invoice">{inp('outInvoice','36,150.00', true)}</Field>
              <div style={s.grid2Inner}>
                <Field label="Holdback">{inp('outHoldback','974.00', true)}</Field>
                <Field label="Accessories">{inp('outAccessories','0.00', true)}</Field>
              </div>
            </div>
          </div>
          {/* Incoming */}
          <div style={s.colIn}>
            <span style={s.pillIn}>INCOMING</span>
            <div style={{marginTop:14,display:'flex',flexDirection:'column',gap:10}}>
              <Field label="Stock #">{inp('inStock','6N0341', true)}</Field>
              <div style={s.grid2Inner}>
                <Field label="Year">{inp('inYear','26', true)}</Field>
                <Field label="Model">{inp('inModel','Rogue')}</Field>
              </div>
              <div style={s.grid2Inner}>
                <Field label="Trim">{inp('inTrim','Platinum')}</Field>
                <Field label="Color">{inp('inColor','Gray')}</Field>
              </div>
              <Field label="VIN">{inp('inVIN','JN8BT3DD1TW312462', true)}</Field>
              <Field label="Invoice">{inp('inInvoice','39,809.00', true)}</Field>
              <div style={s.grid2Inner}>
                <Field label="Holdback">{inp('inHoldback','1,076.00', true)}</Field>
                <Field label="Accessories">{inp('inAccessories','0.00', true)}</Field>
              </div>
            </div>
          </div>
        </div>

        {/* Diff */}
        <div style={s.diffBox}>
          <div>
            <div style={s.diffLabel}>SETTLEMENT DIFFERENCE</div>
            <div style={{
              fontFamily:"'JetBrains Mono',monospace",fontWeight:700,fontSize:22,
              color: diff>0?'#dc2626':diff<0?'#16a34a':'#9ca3af'
            }}>
              {fmtCurrency(diff)}
            </div>
          </div>
          <div style={{fontSize:12,color:'#6b7280'}}>
            {diff>0 ? `We owe them ${fmtCurrency(diff)}` : diff<0 ? `They owe us ${fmtCurrency(diff)}` : 'Even trade'}
          </div>
        </div>
      </div>

      {/* Settlement */}
      <div style={s.card}>
        <SectionHead color="#d97706" label="Settlement" />
        <div style={s.grid2}>
          <div style={s.settleOut}>
            <span style={s.methodOut}>CHECK</span>
            <div style={{flex:1}}>
              <Field label="Outgoing Check">{inp('outCheck','35,176.00', true)}</Field>
            </div>
          </div>
          <div style={s.settleIn}>
            <span style={s.methodIn}>CHECK</span>
            <div style={{flex:1}}>
              <Field label="Incoming Check">{inp('inCheck','38,733.00', true)}</Field>
            </div>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div style={s.card}>
        <SectionHead color="#9ca3af" label="Notes / Comments" />
        <textarea
          value={form.notes}
          onChange={e=>set('notes',e.target.value)}
          placeholder="Additional notes for accounting..."
          style={{...s.input, minHeight:80, resize:'vertical'}}
          onFocus={e => { e.target.style.borderColor='#93c5fd'; e.target.style.boxShadow='0 0 0 3px rgba(59,130,246,0.1)'; }}
          onBlur={e => { e.target.style.borderColor='#e5e7eb'; e.target.style.boxShadow='none'; }}
        />
      </div>

      {/* Actions */}
      <div style={s.btnRow}>
        <button style={s.btnPrimary} onClick={save}
          onMouseEnter={e=>e.target.style.transform='translateY(-1px)'}
          onMouseLeave={e=>e.target.style.transform='translateY(0)'}>
          {editingIdx !== null ? 'Update Trade' : 'Save Trade'}
        </button>
        <button style={s.btnGreen} onClick={buildEmail}
          onMouseEnter={e=>e.target.style.transform='translateY(-1px)'}
          onMouseLeave={e=>e.target.style.transform='translateY(0)'}>
          Email to Office
        </button>
        <button style={s.btnDanger} onClick={clearForm}
          onMouseEnter={e=>{e.target.style.background='#fef2f2';e.target.style.transform='translateY(-1px)';}}
          onMouseLeave={e=>{e.target.style.background='#ffffff';e.target.style.transform='translateY(0)';}}>
          Clear
        </button>
      </div>

      {/* Saved */}
      <div style={{...s.card, marginTop:4}}>
        <SectionHead color="#16a34a" label="Saved Trades" />
        {trades.length === 0 ? (
          <p style={{textAlign:'center',color:'#d1d5db',fontSize:14,padding:24}}>
            No saved trades yet. Fill out the form and hit Save.
          </p>
        ) : trades.map((t,i) => (
          <div key={t.id} style={{
            ...s.tradeItem,
            ...(editingIdx===i ? {borderColor:'#93c5fd',background:'#eff6ff'} : {})
          }} onClick={()=>load(t,i)}
            onMouseEnter={e=>{if(editingIdx!==i){e.currentTarget.style.borderColor='#d1d5db';e.currentTarget.style.background='#f9fafb';}}}
            onMouseLeave={e=>{if(editingIdx!==i){e.currentTarget.style.borderColor='#e5e7eb';e.currentTarget.style.background='#ffffff';}}}>
            <div style={{display:'flex',gap:16,flexWrap:'wrap',flex:1,minWidth:0}}>
              <div>
                <div style={{fontWeight:600,fontSize:13,color:'#dc2626'}}>
                  OUT: {t.outYear} {t.outModel} {t.outTrim}
                </div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'#9ca3af'}}>
                  {t.outStock || 'No stock #'} | {t.outColor}
                </div>
              </div>
              <div>
                <div style={{fontWeight:600,fontSize:13,color:'#16a34a'}}>
                  IN: {t.inYear} {t.inModel} {t.inTrim}
                </div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'#9ca3af'}}>
                  {t.inStock || 'No stock #'} | {t.inColor}
                </div>
              </div>
            </div>
            <div style={{display:'flex',gap:6,flexShrink:0}}>
              <button style={s.smallBtn} onClick={e=>{e.stopPropagation();load(t,i);setTimeout(buildEmail,100);}}>Email</button>
              <button style={s.smallBtnDel} onClick={e=>{e.stopPropagation();del(i);}}>Del</button>
            </div>
          </div>
        ))}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position:'fixed',bottom:20,right:20,zIndex:999,
          padding:'12px 22px',borderRadius:12,
          fontFamily:"'Outfit',sans-serif",fontWeight:500,fontSize:14,
          boxShadow:'0 4px 24px rgba(0,0,0,0.1)',
          background: toast.err ? '#fef2f2' : '#f0fdf4',
          border: `1px solid ${toast.err ? '#fecaca' : '#bbf7d0'}`,
          color: toast.err ? '#dc2626' : '#16a34a',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function SectionHead({ color, label }) {
  return (
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:18}}>
      <div style={{width:8,height:8,borderRadius:'50%',background:color,flexShrink:0}} />
      <h2 style={{
        fontFamily:"'Outfit',sans-serif",fontWeight:600,fontSize:14,
        textTransform:'uppercase',letterSpacing:1.5,color:'#1f2937'
      }}>{label}</h2>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:5}}>
      <label style={{
        fontFamily:"'Outfit',sans-serif",fontWeight:500,fontSize:10,
        textTransform:'uppercase',letterSpacing:1.5,color:'#6b7280'
      }}>{label}</label>
      {children}
    </div>
  );
}

const s = {
  page: {
    fontFamily:"'Outfit',sans-serif",
    background:'#f8fafc',color:'#1f2937',
    minHeight:'100vh',padding:20,
    position:'relative'
  },
  header: {
    display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20
  },
  h1: {
    fontWeight:700,fontSize:24,color:'#0f172a',margin:0
  },
  subtitle: { fontSize:13,color:'#6b7280',margin:0 },
  card: {
    background:'#ffffff',
    border:'1px solid #e5e7eb',
    borderRadius:14,padding:20,marginBottom:14,
    boxShadow:'0 1px 3px rgba(0,0,0,0.04)'
  },
  grid2: { display:'grid',gridTemplateColumns:'1fr 1fr',gap:14 },
  grid2Inner: { display:'grid',gridTemplateColumns:'1fr 1fr',gap:10 },
  input: {
    fontFamily:"'Outfit',sans-serif",fontSize:14,fontWeight:400,
    color:'#1f2937',
    background:'#f9fafb',
    border:'1px solid #e5e7eb',
    borderRadius:10,padding:'11px 13px',outline:'none',
    width:'100%',boxSizing:'border-box',
    transition:'all 0.2s ease'
  },
  mono: { fontFamily:"'JetBrains Mono',monospace",fontWeight:500,fontSize:13 },
  colOut: {
    background:'#fef2f2',border:'1px solid #fecaca',
    borderRadius:14,padding:18,position:'relative'
  },
  colIn: {
    background:'#f0fdf4',border:'1px solid #bbf7d0',
    borderRadius:14,padding:18,position:'relative'
  },
  pillOut: {
    position:'absolute',top:-9,left:16,
    padding:'2px 12px',borderRadius:20,
    fontWeight:600,fontSize:10,textTransform:'uppercase',letterSpacing:2,
    background:'#dc2626',color:'#ffffff'
  },
  pillIn: {
    position:'absolute',top:-9,left:16,
    padding:'2px 12px',borderRadius:20,
    fontWeight:600,fontSize:10,textTransform:'uppercase',letterSpacing:2,
    background:'#16a34a',color:'#ffffff'
  },
  diffBox: {
    marginTop:16,padding:'14px 18px',
    background:'#f1f5f9',
    border:'1px solid #e2e8f0',
    borderRadius:12,
    display:'flex',alignItems:'center',justifyContent:'space-between',
    flexWrap:'wrap',gap:12
  },
  diffLabel: {
    fontFamily:"'Outfit',sans-serif",fontWeight:500,fontSize:10,
    textTransform:'uppercase',letterSpacing:1.5,color:'#6b7280',marginBottom:4
  },
  settleOut: {
    display:'flex',alignItems:'center',gap:14,
    background:'#fef2f2',border:'1px solid #fecaca',
    borderRadius:14,padding:'14px 16px'
  },
  settleIn: {
    display:'flex',alignItems:'center',gap:14,
    background:'#f0fdf4',border:'1px solid #bbf7d0',
    borderRadius:14,padding:'14px 16px'
  },
  methodOut: {
    fontWeight:600,fontSize:11,textTransform:'uppercase',letterSpacing:1,
    padding:'6px 12px',borderRadius:8,
    background:'#dc2626',color:'#ffffff',flexShrink:0
  },
  methodIn: {
    fontWeight:600,fontSize:11,textTransform:'uppercase',letterSpacing:1,
    padding:'6px 12px',borderRadius:8,
    background:'#16a34a',color:'#ffffff',flexShrink:0
  },
  btnRow: {
    display:'flex',gap:10,flexWrap:'wrap',marginBottom:14
  },
  btnPrimary: {
    fontFamily:"'Outfit',sans-serif",fontWeight:500,fontSize:14,
    background:'#2563eb',color:'white',
    border:'none',borderRadius:10,padding:'12px 22px',cursor:'pointer',
    boxShadow:'0 2px 8px rgba(37,99,235,0.25)',transition:'all 0.2s ease'
  },
  btnGreen: {
    fontFamily:"'Outfit',sans-serif",fontWeight:500,fontSize:14,
    background:'#16a34a',color:'white',
    border:'none',borderRadius:10,padding:'12px 22px',cursor:'pointer',
    boxShadow:'0 2px 8px rgba(22,163,74,0.2)',transition:'all 0.2s ease'
  },
  btnDanger: {
    fontFamily:"'Outfit',sans-serif",fontWeight:500,fontSize:14,
    background:'#ffffff',color:'#dc2626',
    border:'1px solid #fecaca',borderRadius:10,padding:'12px 22px',cursor:'pointer',
    transition:'all 0.2s ease'
  },
  tradeItem: {
    background:'#ffffff',border:'1px solid #e5e7eb',
    borderRadius:12,padding:'14px 18px',marginBottom:8,
    display:'flex',alignItems:'center',gap:14,cursor:'pointer',
    transition:'all 0.2s ease'
  },
  smallBtn: {
    fontFamily:"'Outfit',sans-serif",fontSize:11,fontWeight:500,
    background:'#f3f4f6',border:'1px solid #e5e7eb',
    borderRadius:8,color:'#6b7280',padding:'5px 10px',cursor:'pointer'
  },
  smallBtnDel: {
    fontFamily:"'Outfit',sans-serif",fontSize:11,fontWeight:500,
    background:'#fef2f2',border:'1px solid #fecaca',
    borderRadius:8,color:'#dc2626',padding:'5px 10px',cursor:'pointer'
  }
};
