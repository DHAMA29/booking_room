/* ============================================
   Gamaspace — Floor Plan (Denah Ruangan)
   --------------------------------------------
   Renderer SVG denah ruangan: proyektor, layar, sound system,
   papan tulis, podium, meja, pintu + susunan bangku.
   Dipakai bersama oleh:
   - app.js  → section "Denah ruangan" di halaman detail
   - admin.js → editor denah (drag & drop, admin dapat kustomisasi)

   Model data (tersimpan pada fasilitas sebagai `layout`):
   {
     w: 12, h: 8,            // ukuran ruangan dalam satuan grid (meter-ish)
     seats: 40,              // jumlah bangku (ditampilkan & digambar)
     items: [ { type:'screen', x:6, y:0.8, rot:0 }, ... ]
   }
   ============================================ */
window.CFB = window.CFB || {};
(function () {
  'use strict';

  const S = 48;                 // piksel per satuan grid
  const T = CFB.i18n ? CFB.i18n.t : (k) => k;

  /* w = lebar jejak kaki (footprint) dalam meter — revisi proporsi Task 9:
     ikon kini digambar berskala 1 unit grid = 1 meter.
     Layar 2,6 m; panggung 5 m; papan tulis 2 m; podium 0,75 m; pintu 1 m. */
  const TYPES = {
    screen:     { label: 'plan.screen',     w: 2.6, solid: true },
    stage:      { label: 'plan.stage',      w: 5.0, solid: true },
    projector:  { label: 'plan.projector',  w: 1.1, solid: true },
    sound:      { label: 'plan.sound',      w: 0.7, solid: true },
    whiteboard: { label: 'plan.whiteboard', w: 2.0, solid: true },
    podium:     { label: 'plan.podium',     w: 0.75, solid: true },
    table:      { label: 'plan.table',      w: 1.9, solid: true },
    door:       { label: 'plan.door',       w: 1.0, solid: false }
  };

  /* ---------- Sanitasi input (aman terhadap data korup) ---------- */
  function r05(n) { return Math.round(Number(n) * 2) / 2; }

  function parseLayout(raw) {
    const out = { w: 12, h: 8, seats: 0, items: [] };
    if (!raw || typeof raw !== 'object') return out;
    out.w = Math.min(30, Math.max(6, r05(raw.w) || 12));
    out.h = Math.min(24, Math.max(5, r05(raw.h) || 8));
    out.seats = Math.min(2000, Math.max(0, parseInt(raw.seats, 10) || 0));
    if (Array.isArray(raw.items)) {
      raw.items.slice(0, 40).forEach(it => {
        if (!it || !TYPES[it.type]) return;
        out.items.push({
          type: it.type,
          x: Math.min(out.w, Math.max(0, r05(it.x))),
          y: Math.min(out.h, Math.max(0, r05(it.y))),
          rot: [0, 90, 180, 270].includes(parseInt(it.rot, 10)) ? parseInt(it.rot, 10) : 0
        });
      });
    }
    return out;
  }

  function hasLayout(f) {
    return !!(f && f.layout && typeof f.layout === 'object' &&
      ((Array.isArray(f.layout.items) && f.layout.items.length) || parseInt(f.layout.seats, 10) > 0));
  }

  /* ---------- Ikon perangkat (digambar pada koordinat lokal, origin = pusat item) ---------- */
  function iconSVG(type) {
    const st = 'fill="none" stroke="#1E3A8A" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"';
    const fillSoft = '#EFF4FF';
    switch (type) {
      /* Layar: bilah tipis 2,6 m × 0,2 m menempel dinding — skala meter. */
      case 'screen':
        return '<rect x="-62" y="-8" width="124" height="16" rx="3" fill="' + fillSoft + '" ' + st + '/>' +
               '<line x1="-50" y1="0" x2="50" y2="0" ' + st.replace('2.1', '1.3') + '/>';
      /* Panggung: platform 5 m × 1,2 m dengan bidang inset + garis depan. */
      case 'stage':
        return '<rect x="-120" y="-29" width="240" height="58" rx="6" fill="' + fillSoft + '" ' + st + '/>' +
               '<rect x="-113" y="-22" width="226" height="44" rx="3" fill="none" stroke="#A9BCD6" stroke-width="1.3"/>' +
               '<line x1="-40" y1="22" x2="40" y2="22" stroke="#A9BCD6" stroke-width="1.3"/>';
      case 'projector':
        return '<rect x="-17" y="-10" width="34" height="19" rx="4" fill="' + fillSoft + '" ' + st + '/>' +
               '<circle cx="11" cy="-0.5" r="3.4" fill="' + fillSoft + '" ' + st + '/>' +
               '<line x1="-11" y1="-14" x2="3" y2="-14" ' + st + '/>' +
               '<line x1="-11" y1="-14" x2="-11" y2="-10" ' + st + '/>' +
               '<line x1="3" y1="-14" x2="3" y2="-10" ' + st + '/>';
      case 'sound':
        return '<rect x="-10" y="-16" width="20" height="32" rx="3.5" fill="' + fillSoft + '" ' + st + '/>' +
               '<circle cx="0" cy="-7.5" r="3" fill="' + fillSoft + '" ' + st + '/>' +
               '<circle cx="0" cy="6" r="6" fill="' + fillSoft + '" ' + st + '/>';
      /* Papan tulis: bilah dinding 2 m dengan rak spidol di bawah. */
      case 'whiteboard':
        return '<rect x="-48" y="-7" width="96" height="14" rx="3" fill="' + fillSoft + '" ' + st + '/>' +
               '<line x1="-38" y1="12" x2="38" y2="12" ' + st.replace('2.1', '1.3') + '/>';
      /* Podium: jejak kaki 0,7 × 0,5 m — garis bidang baca + titik
         dudukan mikrofon (tidak lagi menjulang tidak proporsional). */
      case 'podium':
        return '<rect x="-17" y="-12" width="34" height="24" rx="4" fill="' + fillSoft + '" ' + st + '/>' +
               '<line x1="-12" y1="6" x2="12" y2="6" ' + st.replace('2.1', '1.4') + '/>' +
               '<circle cx="0" cy="-6" r="2.2" fill="#1E3A8A" stroke="none"/>';
      case 'table':
        return '<rect x="-24" y="-11" width="48" height="22" rx="4" fill="' + fillSoft + '" ' + st + '/>' +
               '<line x1="-17" y1="-11" x2="-17" y2="11" ' + st + '/>' +
               '<line x1="17" y1="-11" x2="17" y2="11" ' + st + '/>';
      /* Pintu: simbol arsitektural standar — ambang 1 m (garis tebal),
         daun pintu 1 m (tegak), lengkung ayunan 90° (putus-putus).
         Leaf mengayun ke arah -y lokal; rot mengatur orientasi dinding:
         0 = dinding bawah/atas, 90 = dinding kiri, 270 = dinding kanan. */
      case 'door':
        return '<line x1="-24" y1="0" x2="24" y2="0" stroke="#1E3A8A" stroke-width="3" stroke-linecap="round"/>' +
               '<line x1="-24" y1="0" x2="-24" y2="-48" stroke="#1E3A8A" stroke-width="2" stroke-linecap="round"/>' +
               '<path d="M-24 -48 A 48 48 0 0 1 24 0" stroke="#1E3A8A" stroke-width="1.4" fill="none" stroke-dasharray="5 4" stroke-linecap="round"/>';
      default: return '';
    }
  }

  /* ---------- Bangku ---------- */
  function chairGlyph(cx, cy) {
    return '<g class="fp-chair" transform="translate(' + cx + ' ' + cy + ')">' +
      '<rect x="-8" y="-6" width="16" height="12" rx="2.6"/>' +
      '<line x1="-8" y1="-9.5" x2="8" y2="-9.5"/>' +
      '</g>';
  }

  /* Bangku digambar sebagai deretan menghadap area depan (atas).
     Maksimal 60 glyph digambar — jumlah sebenarnya tampil pada badge. */
  function seatsSVG(layout, uid) {
    const seats = Math.min(layout.seats, 60);
    if (seats <= 0) return '';
    const cols = Math.min(10, Math.max(3, Math.ceil(Math.sqrt(seats * 1.7))));
    const rows = Math.ceil(seats / cols);
    const areaTop = layout.h * 0.32;
    const areaH = layout.h - areaTop - 0.8;
    const stepX = (layout.w - 1.6) / Math.max(1, cols - 0);
    const stepY = Math.min(stepX, areaH / Math.max(1, rows));
    const startX = 0.8 + stepX / 2;
    const startY = areaTop + Math.max(0.7, (areaH - (rows - 1) * stepY) / 2);
    let s = '';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (idx >= seats) break;
        s += chairGlyph((startX + c * stepX) * S, (startY + r * stepY) * S);
      }
    }
    return s;
  }

  /* ---------- Renderer utama ----------
     opts: { interactive:bool, uid:string, selected:index|null, showLegend:bool } */
  function render(layoutRaw, opts) {
    opts = opts || {};
    const layout = parseLayout(layoutRaw);
    const uid = opts.uid || ('fp' + Math.random().toString(36).slice(2, 8));
    const W = layout.w * S, H = layout.h * S;

    let grid = '';
    for (let gx = 1; gx < layout.w; gx++) grid += '<line x1="' + gx * S + '" y1="0" x2="' + gx * S + '" y2="' + H + '"/>';
    for (let gy = 1; gy < layout.h; gy++) grid += '<line x1="0" y1="' + gy * S + '" x2="' + W + '" y2="' + gy * S + '"/>';

    let items = '';
    layout.items.forEach((it, i) => {
      const sel = (opts.selected === i) ? ' fp-sel' : '';
      items +=
        '<g class="fp-item' + sel + '" data-idx="' + i + '"' + (opts.interactive ? ' tabindex="0" role="button" aria-label="' + T(TYPES[it.type].label) + '"' : '') +
        ' transform="translate(' + (it.x * S) + ' ' + (it.y * S) + ') rotate(' + it.rot + ')">' +
        '<title>' + T(TYPES[it.type].label) + '</title>' +
        iconSVG(it.type) +
        '</g>';
    });

    const seats = seatsSVG(layout, uid);

    const svg =
      '<svg class="fp-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" preserveAspectRatio="xMidYMid meet" ' +
      'aria-label="' + (opts.aria || 'Floor plan') + '">' +
      '<defs>' +
      '  <pattern id="' + uid + '-grid" width="' + S + '" height="' + S + '" patternUnits="userSpaceOnUse">' +
      '    <path d="M ' + S + ' 0 L 0 0 0 ' + S + '" fill="none" stroke="#E8EEF7" stroke-width="1"/>' +
      '  </pattern>' +
      '</defs>' +
      '<rect x="1.5" y="1.5" width="' + (W - 3) + '" height="' + (H - 3) + '" rx="10" fill="#FDFEFF" stroke="#C7D4E8" stroke-width="2.5"/>' +
      '<rect x="1.5" y="1.5" width="' + (W - 3) + '" height="' + (H - 3) + '" rx="10" fill="url(#' + uid + '-grid)"/>' +
      (layout.seats > 60 ? '' : '') +
      seats +
      items +
      '</svg>';

    return { svg: svg, layout: layout };
  }

  /* ---------- Legenda (di bawah denah, sisi pengguna) ---------- */
  function legendHTML(layoutRaw) {
    const layout = parseLayout(layoutRaw);
    const chips = [];
    layout.items.forEach(it => {
      if (!chips.includes(it.type)) chips.push(it.type);
    });
    let html = '<div class="fp-legend">';
    if (layout.seats > 0) html += '<span class="fp-chip fp-chip-seat"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="9" width="14" height="9" rx="2"/><path d="M8 9V6.5A1.5 1.5 0 0 1 9.5 5h5A1.5 1.5 0 0 1 16 6.5V9"/></svg>' + T('detail.plan.seats', { n: layout.seats }) + '</span>';
    chips.forEach(ty => {
      html += '<span class="fp-chip">' + T(TYPES[ty].label) + '</span>';
    });
    html += '</div>';
    return html;
  }

  CFB.floorplan = { TYPES, parseLayout, hasLayout, render, legendHTML, iconSVG, S };
})();
