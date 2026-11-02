/* ============================================
   Gamaspace — Bukti Pengajuan (Proof Card)
   --------------------------------------------
   Menghasilkan kartu bukti peminjaman (PNG, 2x resolusi)
   lengkap dengan QR code verifikasi (qrcode-generator, vendor lokal).
   Dipakai di halaman Summary (setelah submit) dan Riwayat (Peminjaman Saya).

   API: CFB.proof.show(booking)  → modal pratinjau + tombol unduh PNG
        CFB.proof.draw(canvas, booking)
   ============================================ */
window.CFB = window.CFB || {};
(function () {
  'use strict';

  const T = CFB.i18n ? CFB.i18n.t : (k) => k;
  const esc = CFB.util.esc;

  const W = 1000, H = 620;   // ukuran logis; canvas aktual 2x agar tajam

  const STATUS = {
    Approved: { label: 'book.Approved', fg: '#15803D', bg: '#F0FDF4', line: '#BBF7D0' },
    Rejected: { label: 'book.Rejected', fg: '#B91C1C', bg: '#FEF2F2', line: '#FECACA' },
    Pending:  { label: 'book.Pending',  fg: '#B45309', bg: '#FFFBEB', line: '#FDE68A' }
  };

  /* ---------- QR ---------- */
  function qrMatrix(text) {
    if (typeof qrcode !== 'function') return null;
    try {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount(), m = [];
      for (let r = 0; r < n; r++) { m.push([]); for (let c = 0; c < n; c++) m[r].push(qr.isDark(r, c)); }
      return m;
    } catch (e) { return null; }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function txt(ctx, str, x, y, font, color, opts) {
    opts = opts || {};
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = opts.base || 'alphabetic';
    ctx.textAlign = opts.align || 'left';
    if (opts.letter) {
      // letter-spacing manual
      let cx = x;
      const chars = String(str).split('');
      chars.forEach(ch => { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + opts.letter; });
    } else {
      ctx.fillText(str, x, y);
    }
    ctx.textAlign = 'left';
  }

  /* ---------- Kartu ---------- */
  function draw(canvas, b) {
    const dpr = 2;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const st = STATUS[b.status] || STATUS.Pending;
    const L = CFB.i18n ? CFB.i18n.locale() : 'id-ID';
    const ink = '#0F172A', sub = '#64748B', faint = '#94A3B8', line = '#E2E8F0';
    const inter = 'Inter, -apple-system, "Segoe UI", system-ui, sans-serif';
    const mono = '"SFMono-Regular", ui-monospace, Menlo, monospace';

    // latar & bingkai
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = line; ctx.lineWidth = 2;
    roundRect(ctx, 1, 1, W - 2, H - 2, 18); ctx.stroke();

    // aksen kiri
    ctx.fillStyle = '#1E3A8A';
    ctx.fillRect(0, 0, 7, H);

    // ===== header =====
    txt(ctx, T('proof.title'), 44, 62, '700 15px ' + inter, '#1E3A8A', { letter: 2.4 });
    txt(ctx, T('proof.brand'), 44, 86, '500 12px ' + inter, sub);

    // badge status (kanan atas)
    const stLabel = T(st.label).toUpperCase();
    ctx.font = '700 12px ' + inter;
    const stw = ctx.measureText(stLabel).width + 46;
    roundRect(ctx, W - 44 - stw, 44, stw, 30, 15);
    ctx.fillStyle = st.bg; ctx.fill();
    ctx.strokeStyle = st.line; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.beginPath(); ctx.arc(W - 44 - stw + 18, 59, 4, 0, Math.PI * 2); ctx.fillStyle = st.fg; ctx.fill();
    txt(ctx, stLabel, W - 44 - stw + 30, 63.5, '700 12px ' + inter, st.fg, { base: 'middle' });

    // nomor referensi besar
    txt(ctx, String(b.id || ''), 44, 148, '800 34px ' + mono, ink);

    // garis pemisah
    ctx.strokeStyle = line; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(44, 176); ctx.lineTo(W - 44, 176); ctx.stroke();

    // ===== QR (kanan) =====
    const qrText = ['GMS-PROOF', b.id, b.facilityId, b.date,
      (b.startHour != null ? (String(b.startHour).padStart(2, '0') + ':00') : '') + '-' +
      (b.endHour != null ? (String(b.endHour).padStart(2, '0') + ':00') : ''), b.nim].join('|');
    const m = qrMatrix(qrText);
    const qrBox = 168, qrX = W - 44 - qrBox, qrY = 204;
    roundRect(ctx, qrX, qrY, qrBox, qrBox, 12);
    ctx.fillStyle = '#FFFFFF'; ctx.fill();
    ctx.strokeStyle = line; ctx.lineWidth = 1.4; ctx.stroke();
    if (m) {
      const pad = 14, cell = (qrBox - pad * 2) / m.length;
      ctx.fillStyle = '#0F172A';
      for (let r = 0; r < m.length; r++) {
        for (let c = 0; c < m.length; c++) {
          if (m[r][c]) ctx.fillRect(qrX + pad + c * cell, qrY + pad + r * cell, Math.ceil(cell), Math.ceil(cell));
        }
      }
    }
    txt(ctx, T('proof.qr'), qrX + qrBox / 2, qrY + qrBox + 22, '600 11.5px ' + inter, sub, { align: 'center' });

    // ===== kolom data (kiri) =====
    const fields = [
      [T('sum.f.facility'), b.facilityName],
      [T('sum.f.location'), b.location],
      [T('sum.f.date'), b.dateLabel || b.date],
      [T('sum.f.time'), (b.slotLabel || '') + ' WIB · ' + T('sched.durUnit', { n: (b.durationHours || 2) })],
      [T('sum.f.borrower'), b.name],
      [T('sum.f.nim'), b.nim],
      [T('sum.f.participants'), (b.participants || '') + ' ' + T('unit.people')],
      [T('sum.f.org'), b.organization]
    ];
    const colW = (W - 88 - qrBox - 36) / 2;
    const x0 = 44, y0 = 218;
    fields.forEach((f, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = x0 + col * (colW + 20), y = y0 + row * 66;
      txt(ctx, f[0].toUpperCase(), x, y, '600 10px ' + inter, faint, { letter: 1.2 });
      txt(ctx, String(f[1] == null ? '' : f[1]), x, y + 24, '600 14.5px ' + inter, ink);
    });

    // ===== footer =====
    ctx.strokeStyle = line;
    ctx.beginPath(); ctx.moveTo(44, H - 74); ctx.lineTo(W - 44, H - 74); ctx.stroke();
    txt(ctx, T('proof.show'), 44, H - 44, '500 12.5px ' + inter, sub);
    const genDate = new Date().toLocaleString(L, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    txt(ctx, T('proof.generated', { date: genDate }), 44, H - 24, '400 11px ' + inter, faint);
    txt(ctx, 'campus-facility-booking', W - 44, H - 24, '400 11px ' + mono, faint, { align: 'right' });
    return canvas;
  }

  /* ---------- Unduh PNG ---------- */
  function download(b) {
    try {
      const c = document.createElement('canvas');
      draw(c, b);
      c.toBlob((blob) => {
        if (!blob) { CFB.notify.error(T('proof.err'), ''); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'bukti-' + String(b.id || 'pengajuan').replace(/[^A-Za-z0-9._-]/g, '') + '.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }, 'image/png');
    } catch (e) {
      CFB.notify.error(T('proof.err'), (e && e.message) || '');
    }
  }

  /* ---------- Modal pratinjau ---------- */
  function show(b) {
    if (!b) return;
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.innerHTML =
      '<div class="modal-card proof-modal" role="dialog" aria-modal="true">' +
      '  <div class="modal-head">' +
      '    <div><p class="modal-eyebrow">' + esc(T('sum.sent.ref')) + ' ' + esc(b.id) + '</p>' +
      '    <h3 class="modal-title">' + esc(T('proof.previewTitle')) + '</h3></div>' +
      '    <button type="button" class="tc-close pm-close" aria-label="' + esc(T('proof.close')) + '">' + CFB.icons.close + '</button>' +
      '  </div>' +
      '  <div class="proof-preview"><canvas id="proofCanvas"></canvas></div>' +
      '  <div class="modal-actions">' +
      '    <button type="button" class="btn-ghost" data-close>' + esc(T('proof.close')) + '</button>' +
      '    <button type="button" class="btn-primary" data-dl>' +
      '      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>' +
           esc(T('proof.dl')) + '</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('show'));
    draw(ov.querySelector('#proofCanvas'), b);

    const close = () => { ov.classList.remove('show'); setTimeout(() => ov.remove(), 200); };
    ov.querySelector('.pm-close').addEventListener('click', close);
    ov.querySelector('[data-close]').addEventListener('click', close);
    ov.querySelector('[data-dl]').addEventListener('click', () => download(b));
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
  }

  CFB.proof = { show, download, draw };
})();
