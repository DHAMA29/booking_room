/* ============================================
   Gamaspace — Floor Plan (Denah Ruangan)
   --------------------------------------------
   Renderer SVG denah ruangan: proyektor, layar, sound system,
   papan tulis, podium, meja, meja bundar, pintu + susunan bangku,
   serta denah lapangan olahraga berskala meter: basket (28×15 m),
   futsal (20×10 m), bulu tangkis (13,4×6,1 m), dan voli (18×9 m).
   Dipakai bersama oleh:
   - app.js  → section "Denah ruangan" di halaman detail
   - admin.js → editor denah (drag & drop, admin dapat kustomisasi)

   Model data (tersimpan pada fasilitas sebagai `layout`):
   {
     w: 12, h: 8,              // ukuran ruangan dalam satuan grid (meter-ish)
     seats: 40,                // jumlah bangku (dihitung ulang utk mode rounds/custom)
     seatMode: 'rows'          // 'rows' | 'circle' | 'rounds' | 'utable' | 'custom'
     roundTables: 8,           // (mode rounds) jumlah meja bundar
     roundChairs: 8,           // (mode rounds) kursi per meja
     seatsCustom: [{x,y,rot}], // (mode custom) bangku manual — bisa digeser satu per satu
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
     Layar 2,6 m; panggung 5 m; papan tulis 2 m; podium 0,75 m; pintu 1 m.
     Lapangan olahraga mengikuti dimensi standar: basket 28×15 m (FIBA),
     futsal 20×10 m, bulu tangkis 13,4×6,1 m (ganda), voli 18×9 m. */
  const TYPES = {
    screen:      { label: 'plan.screen',      w: 2.6,  solid: true },
    stage:       { label: 'plan.stage',       w: 5.0,  solid: true },
    projector:   { label: 'plan.projector',   w: 1.1,  solid: true },
    sound:       { label: 'plan.sound',       w: 0.7,  solid: true },
    whiteboard:  { label: 'plan.whiteboard',  w: 2.0,  solid: true },
    podium:      { label: 'plan.podium',      w: 0.75, solid: true },
    table:       { label: 'plan.table',       w: 1.9,  solid: true },
    'table-round': { label: 'plan.tableRound', w: 1.0, solid: true },
    door:        { label: 'plan.door',        w: 1.0,  solid: false },
    'court-basket':   { label: 'plan.courtBasket',   w: 28,  solid: true },
    'court-futsal':   { label: 'plan.courtFutsal',   w: 20,  solid: true },
    'court-badminton':{ label: 'plan.courtBadminton',w: 13.4, solid: true },
    'court-volley':   { label: 'plan.courtVolley',   w: 18,  solid: true }
  };

  /* Mode susunan bangku — dipakai parseLayout & editor admin */
  const SEAT_MODES = ['rows', 'circle', 'rounds', 'utable', 'custom'];

  /* ---------- Sanitasi input (aman terhadap data korup) ---------- */
  function r05(n) { return Math.round(Number(n) * 2) / 2; }

  function parseLayout(raw) {
    const out = { w: 12, h: 8, seats: 0, seatMode: 'rows',
      roundTables: 4, roundChairs: 8, seatsCustom: [], items: [] };
    if (!raw || typeof raw !== 'object') return out;
    out.w = Math.min(30, Math.max(6, r05(raw.w) || 12));
    out.h = Math.min(24, Math.max(5, r05(raw.h) || 8));
    out.seats = Math.min(2000, Math.max(0, parseInt(raw.seats, 10) || 0));
    out.seatMode = SEAT_MODES.indexOf(raw.seatMode) >= 0 ? raw.seatMode : 'rows';
    out.roundTables = Math.min(12, Math.max(1, parseInt(raw.roundTables, 10) || 4));
    out.roundChairs = Math.min(12, Math.max(3, parseInt(raw.roundChairs, 10) || 8));
    /* Bangku manual (mode custom) — maksimal 300 titik */
    if (Array.isArray(raw.seatsCustom)) {
      raw.seatsCustom.slice(0, 300).forEach(sp => {
        if (!sp || typeof sp !== 'object') return;
        out.seatsCustom.push({
          x: Math.min(out.w, Math.max(0, r05(sp.x))),
          y: Math.min(out.h, Math.max(0, r05(sp.y))),
          rot: ((parseInt(sp.rot, 10) || 0) % 360 + 360) % 360
        });
      });
    }
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
    /* Jumlah bangku selalu konsisten dengan mode susunannya */
    if (out.seatMode === 'custom') out.seats = out.seatsCustom.length;
    else if (out.seatMode === 'rounds') out.seats = out.roundTables * out.roundChairs;
    return out;
  }

  function hasLayout(f) {
    return !!(f && f.layout && typeof f.layout === 'object' &&
      ((Array.isArray(f.layout.items) && f.layout.items.length) || parseInt(f.layout.seats, 10) > 0));
  }

  /* ---------- Denah lapangan olahraga ----------
     Digambar pada koordinat lokal berskala 1 unit grid = 1 meter (S px/m),
     sama dengan ikon perangkat lain, mengikuti dimensi standar:
       - basket 28×15 m (FIBA): lingkaran tengah r1,8 · busur 3 angka r6,75
         dari titik ring (1,575 m dari garis akhir) · area lemparan bebas
         4,9×5,8 m · papan ring & ring pada kedua ujung;
       - futsal 20×10 m: lingkaran tengah r3 · area penalti seperempat-
         lingkaran r6 dari tiap tiang gawang (dipotong batas lapangan) ·
         titik penalti 6 m · busur sudut r1 · gawang 3 m;
       - bulu tangkis 13,4×6,1 m (ganda): net · garis servis pendek 1,98 m ·
         garis servis panjang ganda 0,76 m dari garis belakang · garis sisi
         tunggal 0,46 m dari garis samping · garis tengah;
       - voli 18×9 m: garis tengah (net) · garis serang 3 m dari tengah.
     Warna garis: navy untuk basket/futsal/voli, teal untuk bulu tangkis
     agar tetap terbaca bila ditumpuk pada satu lapangan serbaguna. */
  const COURT_LINE = 'fill="none" stroke="#1E3A8A" stroke-width="2.6" stroke-linecap="round"';
  const COURT_EDGE = 'fill="none" stroke="#1E3A8A" stroke-width="3.6" stroke-linecap="round"';
  const LINE_TEAL  = 'fill="none" stroke="#0F766E" stroke-width="2.4" stroke-linecap="round"';
  const EDGE_TEAL  = 'fill="none" stroke="#0F766E" stroke-width="3.4" stroke-linecap="round"';

  function n2(v) { return Math.round(v * 100) / 100; }

  /* Penanda unik utk clipPath — bertambah setiap kali digambar agar tidak
     ada id kembar bila satu halaman memuat beberapa denah lapangan. */
  let courtSeq = 0;

  /* Basket — setengah lapangan sisi kiri; sisi kanan hasil pencerminan. */
  function courtBasketHalfSVG() {
    const L = 14 * S, s = S;
    const rimX = -L + 1.575 * s, rimR = 0.2286 * s;
    return (
      /* area lemparan bebas ("paint") 4,9 × 5,8 m dari garis akhir */
      '<rect x="' + (-L) + '" y="' + (-2.45 * s) + '" width="' + (5.8 * s) + '" height="' + (4.9 * s) + '" ' + COURT_LINE + '/>' +
      /* lingkaran lemparan bebas r 1,8 m */
      '<circle cx="' + (-L + 5.8 * s) + '" cy="0" r="' + (1.8 * s) + '" ' + COURT_LINE + '/>' +
      /* garis pojok 3 angka — 0,9 m dari garis samping */
      '<line x1="' + (-L) + '" y1="' + (-6.6 * s) + '" x2="' + (-L + 2.99 * s) + '" y2="' + (-6.6 * s) + '" ' + COURT_LINE + '/>' +
      '<line x1="' + (-L) + '" y1="' + (6.6 * s) + '" x2="' + (-L + 2.99 * s) + '" y2="' + (6.6 * s) + '" ' + COURT_LINE + '/>' +
      /* busur 3 angka r 6,75 m dari titik ring */
      '<path d="M ' + n2(-L + 2.99 * s) + ' ' + n2(-6.6 * s) + ' A ' + (6.75 * s) + ' ' + (6.75 * s) + ' 0 0 1 ' + n2(-L + 2.99 * s) + ' ' + n2(6.6 * s) + '" ' + COURT_LINE + '/>' +
      /* area larangan (no-charge) r 1,25 m di bawah ring */
      '<path d="M ' + n2(rimX) + ' ' + n2(-1.25 * s) + ' A ' + (1.25 * s) + ' ' + (1.25 * s) + ' 0 0 1 ' + n2(rimX) + ' ' + n2(1.25 * s) + '" ' + COURT_LINE + '/>' +
      /* papan ring (1,2 m dari garis akhir) + ring */
      '<line x1="' + (-L + 1.2 * s) + '" y1="' + (-0.9 * s) + '" x2="' + (-L + 1.2 * s) + '" y2="' + (0.9 * s) + '" stroke="#1E3A8A" stroke-width="4.2" stroke-linecap="round"/>' +
      '<circle cx="' + n2(rimX) + '" cy="0" r="' + n2(rimR) + '" fill="none" stroke="#1E3A8A" stroke-width="2.6"/>'
    );
  }

  function courtBasketSVG() {
    const L = 14 * S, W = 7.5 * S;
    const half = courtBasketHalfSVG();
    return (
      /* lantai kayu lembut + garis batas */
      '<rect x="' + (-L) + '" y="' + (-W) + '" width="' + (28 * S) + '" height="' + (15 * S) + '" fill="#F8F1E7"/>' +
      '<rect x="' + (-L) + '" y="' + (-W) + '" width="' + (28 * S) + '" height="' + (15 * S) + '" ' + COURT_EDGE + '/>' +
      /* garis tengah + lingkaran tengah r 1,8 m */
      '<line x1="0" y1="' + (-W) + '" x2="0" y2="' + W + '" ' + COURT_LINE + '/>' +
      '<circle cx="0" cy="0" r="' + (1.8 * S) + '" ' + COURT_LINE + '/>' +
      half +
      '<g transform="scale(-1,1)">' + half + '</g>'
    );
  }

  /* Futsal — area penalti (busur r6 dari tiang gawang) dipotong batas
     lapangan memakai clipPath agar tidak keluar garis samping. */
  function courtFutsalSVG() {
    const L = 10 * S, W = 5 * S, s = S;
    const lc = COURT_LINE;
    const clipId = 'fp-clip-futsal-' + (++courtSeq);
    /* busur sudut r 1 m — dx/dy = arah masuk lapangan dari sudut */
    function corner(cx, cy, dx, dy) {
      return '<path d="M ' + n2(cx + dx * s) + ' ' + cy + ' A ' + s + ' ' + s + ' 0 0 ' + (dx * dy > 0 ? 1 : 0) + ' ' + cx + ' ' + n2(cy + dy * s) + '" ' + lc + '/>';
    }
    /* area penalti sisi kiri: busur dari tiang atas & bawah + garis penghubung 3,16 m */
    const pen =
      '<path d="M ' + n2(-L + 6 * s) + ' ' + n2(-1.58 * s) + ' A ' + (6 * s) + ' ' + (6 * s) + ' 0 0 0 ' + (-L) + ' ' + n2(-7.5 * s) + '" ' + lc + '/>' +
      '<path d="M ' + n2(-L + 6 * s) + ' ' + n2(1.58 * s) + ' A ' + (6 * s) + ' ' + (6 * s) + ' 0 0 1 ' + (-L) + ' ' + n2(7.5 * s) + '" ' + lc + '/>' +
      '<line x1="' + n2(-L + 6 * s) + '" y1="' + n2(-1.58 * s) + '" x2="' + n2(-L + 6 * s) + '" y2="' + n2(1.58 * s) + '" ' + lc + '/>';
    const goal =
      '<rect x="' + n2(-L - 0.6 * s) + '" y="' + (-1.5 * s) + '" width="' + (0.6 * s) + '" height="' + (3 * s) + '" fill="#EFF4FF" stroke="#1E3A8A" stroke-width="2.4"/>';
    return (
      '<clipPath id="' + clipId + '"><rect x="' + (-L) + '" y="' + (-W) + '" width="' + (20 * S) + '" height="' + (10 * S) + '"/></clipPath>' +
      '<rect x="' + (-L) + '" y="' + (-W) + '" width="' + (20 * S) + '" height="' + (10 * S) + '" fill="#EAF3EC"/>' +
      '<rect x="' + (-L) + '" y="' + (-W) + '" width="' + (20 * S) + '" height="' + (10 * S) + '" ' + COURT_EDGE + '/>' +
      '<line x1="0" y1="' + (-W) + '" x2="0" y2="' + W + '" ' + lc + '/>' +
      '<circle cx="0" cy="0" r="' + (3 * s) + '" ' + lc + '/>' +
      '<circle cx="0" cy="0" r="4" fill="#1E3A8A"/>' +
      '<g clip-path="url(#' + clipId + ')">' + pen +
      '<g transform="scale(-1,1)">' + pen + '</g></g>' +
      /* titik penalti 6 m dari garis gawang */
      '<circle cx="' + n2(-L + 6 * s) + '" cy="0" r="4" fill="#1E3A8A"/>' +
      '<circle cx="' + n2(L - 6 * s) + '" cy="0" r="4" fill="#1E3A8A"/>' +
      corner(-L, -W, 1, 1) + corner(L, -W, -1, 1) + corner(-L, W, 1, -1) + corner(L, W, -1, -1) +
      goal + '<g transform="scale(-1,1)">' + goal + '</g>'
    );
  }

  /* Bulu tangkis — garis teal, tanpa isian, agar aman ditumpuk di atas
     lapangan lain (mis. lapangan serbaguna). */
  function courtBadmintonSVG() {
    const L = 6.7 * S, W = 3.05 * S, s = S;
    return (
      '<rect x="' + (-L) + '" y="' + (-W) + '" width="' + (13.4 * S) + '" height="' + (6.1 * S) + '" ' + EDGE_TEAL + '/>' +
      /* garis sisi tunggal 0,46 m dari garis samping */
      '<line x1="' + (-L) + '" y1="' + n2(-2.59 * s) + '" x2="' + L + '" y2="' + n2(-2.59 * s) + '" ' + LINE_TEAL + '/>' +
      '<line x1="' + (-L) + '" y1="' + n2(2.59 * s) + '" x2="' + L + '" y2="' + n2(2.59 * s) + '" ' + LINE_TEAL + '/>' +
      /* garis servis pendek 1,98 m dari net */
      '<line x1="' + n2(-1.98 * s) + '" y1="' + (-W) + '" x2="' + n2(-1.98 * s) + '" y2="' + W + '" ' + LINE_TEAL + '/>' +
      '<line x1="' + n2(1.98 * s) + '" y1="' + (-W) + '" x2="' + n2(1.98 * s) + '" y2="' + W + '" ' + LINE_TEAL + '/>' +
      /* garis servis panjang ganda 0,76 m dari garis belakang */
      '<line x1="' + n2(-5.94 * s) + '" y1="' + (-W) + '" x2="' + n2(-5.94 * s) + '" y2="' + W + '" ' + LINE_TEAL + '/>' +
      '<line x1="' + n2(5.94 * s) + '" y1="' + (-W) + '" x2="' + n2(5.94 * s) + '" y2="' + W + '" ' + LINE_TEAL + '/>' +
      /* garis tengah tiap sisi (dari garis servis pendek ke garis belakang) */
      '<line x1="' + n2(-1.98 * s) + '" y1="0" x2="' + (-L) + '" y2="0" ' + LINE_TEAL + '/>' +
      '<line x1="' + n2(1.98 * s) + '" y1="0" x2="' + L + '" y2="0" ' + LINE_TEAL + '/>' +
      /* net + tiang net */
      '<line x1="0" y1="' + n2(-W - 0.15 * s) + '" x2="0" y2="' + n2(W + 0.15 * s) + '" stroke="#0F766E" stroke-width="3.4" stroke-linecap="round"/>' +
      '<rect x="' + n2(-0.08 * s) + '" y="' + n2(-W - 0.23 * s) + '" width="' + n2(0.16 * s) + '" height="' + n2(0.16 * s) + '" fill="#0F766E"/>' +
      '<rect x="' + n2(-0.08 * s) + '" y="' + n2(W + 0.07 * s) + '" width="' + n2(0.16 * s) + '" height="' + n2(0.16 * s) + '" fill="#0F766E"/>'
    );
  }

  /* Voli — garis serang 3 m dari garis tengah, net lebih lebar dari lapangan. */
  function courtVolleySVG() {
    const L = 9 * S, W = 4.5 * S, s = S;
    return (
      '<rect x="' + (-L) + '" y="' + (-W) + '" width="' + (18 * S) + '" height="' + (9 * S) + '" ' + COURT_EDGE + '/>' +
      /* garis tengah memanjang sedikit melewati garis samping */
      '<line x1="0" y1="' + n2(-W - 0.25 * s) + '" x2="0" y2="' + n2(W + 0.25 * s) + '" stroke="#1E3A8A" stroke-width="3.4" stroke-linecap="round"/>' +
      /* garis serang */
      '<line x1="' + (-3 * s) + '" y1="' + (-W) + '" x2="' + (-3 * s) + '" y2="' + W + '" ' + COURT_LINE + '/>' +
      '<line x1="' + (3 * s) + '" y1="' + (-W) + '" x2="' + (3 * s) + '" y2="' + W + '" ' + COURT_LINE + '/>' +
      /* tiang net di luar garis samping */
      '<rect x="' + n2(-0.09 * s) + '" y="' + n2(-W - 0.34 * s) + '" width="' + n2(0.18 * s) + '" height="' + n2(0.18 * s) + '" fill="#1E3A8A"/>' +
      '<rect x="' + n2(-0.09 * s) + '" y="' + n2(W + 0.16 * s) + '" width="' + n2(0.18 * s) + '" height="' + n2(0.18 * s) + '" fill="#1E3A8A"/>'
    );
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
      /* Meja bundar: lingkaran Ø 1 m dengan titik pusat — untuk susunan
         rapat melingkar (bisa juga ditata manual dari editor). */
      case 'table-round':
        return '<circle r="24" fill="' + fillSoft + '" ' + st + '/>' +
               '<circle r="7" fill="none" stroke="#A9BCD6" stroke-width="1.3"/>';
      /* Pintu: simbol arsitektural standar — ambang 1 m (garis tebal),
         daun pintu 1 m (tegak), lengkung ayunan 90° (putus-putus).
         Leaf mengayun ke arah -y lokal; rot mengatur orientasi dinding:
         0 = dinding bawah/atas, 90 = dinding kiri, 270 = dinding kanan. */
      case 'door':
        return '<line x1="-24" y1="0" x2="24" y2="0" stroke="#1E3A8A" stroke-width="3" stroke-linecap="round"/>' +
               '<line x1="-24" y1="0" x2="-24" y2="-48" stroke="#1E3A8A" stroke-width="2" stroke-linecap="round"/>' +
               '<path d="M-24 -48 A 48 48 0 0 1 24 0" stroke="#1E3A8A" stroke-width="1.4" fill="none" stroke-dasharray="5 4" stroke-linecap="round"/>';
      /* Lapangan olahraga — dimensi standar, berskala meter (lihat blok
         Denah lapangan olahraga di atas untuk rincian garisnya). */
      case 'court-basket':    return courtBasketSVG();
      case 'court-futsal':    return courtFutsalSVG();
      case 'court-badminton': return courtBadmintonSVG();
      case 'court-volley':    return courtVolleySVG();
      default: return '';
    }
  }

  /* ---------- Bangku ----------
     Sandaran digambar di sisi +y lokal → kursi "menghadap" arah -y.
     rot (derajat, searah jarum jam) memutar arah hadap:
       0 = menghadap atas (area depan/panggung), 90 = kanan, 270 = kiri, 180 = bawah. */
  const CHAIR_GLYPH = '<rect x="-8" y="-6" width="16" height="12" rx="2.6"/>' +
                      '<line x1="-8" y1="9.5" x2="8" y2="9.5"/>';

  /* Meja bundar otomatis pada mode "rounds" (bukan item yang bisa dipilih) */
  function roundTableGlyph(cx, cy) {
    return '<g class="fp-rtable" transform="translate(' + cx + ' ' + cy + ')">' +
      '<circle r="24" fill="#F7FAFF" stroke="#A9BCD6" stroke-width="1.5"/>' +
      '<circle r="7" fill="none" stroke="#C7D4E8" stroke-width="1.3"/>' +
      '</g>';
  }

  /* ---------- Posisi bangku per mode susunan ----------
     Menghasilkan { seats: [{x, y, rot}], tables: [{x, y}], pitch: number }
     dalam satuan grid. `pitch` = jarak antar-pusat bangku terkecil pada
     mode otomatis — dipakai untuk mengecilkan ikon bangku bila ruangan
     sempit (bug: 150 kursi atau lebih berdempetan / tidak menyesuaikan). */
  function seatPositions(layout) {
    const seats = [], tables = [];
    const L = layout;
    const areaTop = L.h * 0.32;          // area depan (panggung/perangkat) 32% atas
    const cx = L.w / 2;
    const cy = areaTop + (L.h - areaTop) / 2;

    /* Manual — setiap bangku punya posisi & arah hadap sendiri */
    if (L.seatMode === 'custom') {
      (L.seatsCustom || []).forEach(sp => seats.push({ x: sp.x, y: sp.y, rot: sp.rot || 0 }));
      return { seats: seats, tables: tables, pitch: 0 };
    }

    /* Meja bundar — grid meja bulat, kursi melingkar mengelilingi tiap meja */
    if (L.seatMode === 'rounds') {
      const nT = Math.max(1, Math.min(12, L.roundTables | 0 || 4));
      const per = Math.max(3, Math.min(12, L.roundChairs | 0 || 8));
      const bandL = 1.35, bandT = areaTop + 1.35;
      const bandW = Math.max(0, L.w - 2 * bandL);
      const bandH = Math.max(0, (L.h - 1.35) - bandT);
      /* grid secukupnya: kolom maksimal agar meja tidak berhimpit */
      const maxCols = Math.max(1, Math.min(nT, Math.floor(bandW / 2.5) + 1));
      const maxRows = Math.max(1, Math.floor(bandH / 2.5) + 1);
      let cols = Math.min(nT, maxCols);
      let rowsT = Math.ceil(nT / cols);
      if (rowsT > maxRows) {
        cols = Math.min(nT, Math.max(maxCols, Math.ceil(nT / maxRows)));
        rowsT = Math.ceil(nT / cols);
      }
      const stepX = cols > 1 ? Math.min(2.9, bandW / (cols - 1)) : 0;
      const stepY = rowsT > 1 ? Math.min(2.9, bandH / (rowsT - 1)) : 0;
      const startX = cx - (stepX * (cols - 1)) / 2;
      const startY = bandT + (bandH - stepY * (rowsT - 1)) / 2;
      const orbit = per > 8 ? 1.2 : 1.05;
      let pitch = (2 * Math.PI * orbit) / per;          // jarak busur antar-kursi
      let cross = Infinity;                            // jarak kursi antar-meja terdekat
      for (let t = 0; t < nT; t++) {
        const tx = startX + (t % cols) * stepX;
        const ty = startY + Math.floor(t / cols) * stepY;
        tables.push({ x: tx, y: ty });
        for (let c = 0; c < per; c++) {
          const deg = -90 + c * 360 / per;               // mulai dari atas meja
          const th = deg * Math.PI / 180;
          seats.push({
            x: tx + orbit * Math.cos(th),
            y: ty + orbit * Math.sin(th),
            rot: ((deg - 90) % 360 + 360) % 360           // menghadap pusat meja
          });
        }
        if (stepX > 0) cross = Math.min(cross, stepX - 2 * orbit);
        if (stepY > 0) cross = Math.min(cross, stepY - 2 * orbit);
      }
      if (cross < pitch) pitch = cross;
      return { seats: seats, tables: tables, pitch: Math.max(0.2, pitch) };
    }

    /* Lingkaran — bangku pada elips menghadap pusat ruangan.
       Revisi: cincin konsentris dari luar ke dalam; titik tiap cincin
       dibagi rata sepanjang BUSUR (bukan sudut) agar jarak seragam.
       Bila n melebihi kapasitas nyaman seluruh cincin, sisanya dibagikan
       proporsional-merata ke semua cincin (padat, tanpa tumpuk). */
    if (L.seatMode === 'circle') {
      const n = Math.max(0, Math.min(2000, L.seats | 0));
      const PITCH = 0.55, GAP = 0.62, MAXR = 8;
      const rings = [];
      let rx = Math.max(1.6, L.w / 2 - 1.2);
      let ry = Math.max(1.3, (L.h - areaTop) / 2 - 1.0);
      while (rings.length < MAXR && ry >= 0.55 && rx >= 0.8) {
        rings.push({ rx: rx, ry: ry, per: ellipsePerim(rx, ry) });
        const nextRy = ry - GAP;
        if (nextRy < 0.55) break;
        rx = rx * (nextRy / ry);   // cincin sejenis — jarak atas tepat GAP
        ry = nextRy;
      }
      const P = rings.reduce((a, r) => a + r.per, 0);
      let worst = Infinity;
      if (n > 0 && P > 0 && rings.length) {
        const capTotal = Math.floor(P / PITCH);
        if (n <= capTotal) {
          /* muat: isi tiap cincin dari luar sesuai kapasitas — tampilan
             ruangan terkonfigurasi baik tetap seperti sebelumnya */
          let remaining = n;
          rings.forEach(rg => {
            if (remaining <= 0) return;
            const cap = Math.max(4, Math.floor(rg.per / PITCH));
            const m = Math.min(remaining, cap);
            ringSeats(cx, cy, rg.rx, rg.ry, m, 0, seats);
            const p = rg.per / Math.max(1, m);
            if (p < worst) worst = p;
            remaining -= m;
          });
          if (remaining > 0) {          // pengaman — seharusnya tak terjadi
            const last = rings[rings.length - 1];
            ringSeats(cx, cy, last.rx, last.ry, remaining, 0.5, seats);
            const p = last.per / remaining;
            if (p < worst) worst = p;
          }
        } else {
          /* tidak muat pada jarak nyaman: bagikan proporsional ke semua
             cincin (padat merata) — penskalaan ikon menangani sisanya */
          const ms = rings.map(() => 0);
          let placed = 0;
          rings.forEach((rg, k) => {
            if (k < rings.length - 1) {
              ms[k] = Math.max(1, Math.round(n * rg.per / P));
              placed += ms[k];
            }
          });
          ms[rings.length - 1] = Math.max(1, n - placed);
          rings.forEach((rg, k) => ringSeats(cx, cy, rg.rx, rg.ry, ms[k], 0, seats));
          worst = P / n;
        }
      }
      return { seats: seats, tables: tables, pitch: worst === Infinity ? 0 : Math.max(0.18, worst) };
    }

    /* Bentuk U — dua lengan vertikal + satu sisi bawah, terbuka ke area depan.
       Revisi: seluruh n kursi terbagi proporsional (tanpa drop tersembunyi);
       kepadatan berlebih ditangani penskalaan ikon bangku. */
    if (L.seatMode === 'utable') {
      const n = Math.max(0, Math.min(2000, L.seats | 0));
      if (n) {
        const top = areaTop + 0.7, bot = L.h - 0.9;
        const left = 1.1, right = L.w - 1.1;
        const colH = Math.max(0.5, bot - top);
        const botW = Math.max(0.5, right - left);
        const perim = 2 * colH + botW;
        let nL = Math.max(1, Math.round(n * colH / perim));
        if (nL * 2 > n) nL = Math.max(0, Math.floor(n / 2));
        let nR = nL;
        let nB = Math.max(0, n - nL - nR);
        if (nB === 0 && n <= 2) { nL = Math.ceil(n / 2); nR = n - nL; }
        for (let i = 0; i < nL; i++) seats.push({ x: left,  y: top + colH * (i + 0.5) / nL, rot: 90 });   // menghadap kanan
        for (let i = 0; i < nR; i++) seats.push({ x: right, y: top + colH * (i + 0.5) / nR, rot: 270 });  // menghadap kiri
        for (let i = 0; i < nB; i++) seats.push({ x: left + botW * (i + 0.5) / nB, y: bot, rot: 0 });     // menghadap atas
        const pL = nL ? colH / nL : Infinity;
        const pR = nR ? colH / nR : Infinity;
        const pB = nB ? botW / nB : Infinity;
        return { seats: seats, tables: tables, pitch: Math.min(pL, pR, pB) };
      }
      return { seats: seats, tables: tables, pitch: 0 };
    }

    /* Baris (teater) — deretan menghadap area depan (atas).
       Revisi: jumlah kolom dipilih agar jarak antar-bangku TERKECIL
       sebesar mungkin (maksimum dari min(langkahX, langkahY)) — dulu
       dikunci maks 10 kolom sehingga 150+ kursi berhimpit vertikal. */
    const n = Math.max(0, Math.min(2000, L.seats | 0));
    if (n) {
      const areaH = L.h - areaTop - 0.8;
      const spanX = L.w - 1.6;
      let best = null;
      const maxCols = Math.max(3, Math.min(30, n));
      for (let c = 3; c <= maxCols; c++) {
        const r = Math.ceil(n / c);
        const sx = spanX / c;
        const sy = areaH > 0 ? areaH / r : sx;
        const m = Math.min(sx, sy);
        if (!best || m > best.m) best = { c: c, r: r, m: m, sx: sx, sy: sy };
      }
      const cols = best.c, rows = best.r;
      const stepX = best.sx;
      const stepY = Math.min(stepX, best.sy);   // grid rapi: vertikal mengikuti horizontal
      const startX = 0.8 + stepX / 2;
      const startY = areaTop + Math.max(0.7, (areaH - (rows - 1) * stepY) / 2);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          if (idx >= n) break;
          seats.push({ x: startX + c * stepX, y: startY + r * stepY, rot: 0 });
        }
      }
      return { seats: seats, tables: tables, pitch: best.m };
    }
    return { seats: seats, tables: tables, pitch: 0 };
  }

  /* Keliling elips — aproksimasi Ramanujan #2 */
  function ellipsePerim(rx, ry) {
    return Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  }

  /* Titik merata sepanjang BUSUR elips — distribusi merata sudut
     justru menumpuk kursi di sisi kiri/kanan elips. */
  function ringSeats(cx, cy, rx, ry, m, phase, seats) {
    if (m <= 0) return;
    const N = 720;
    const arc = new Array(N + 1);
    arc[0] = 0;
    let px = rx, py = 0, total = 0;
    for (let i = 1; i <= N; i++) {
      const th = (i / N) * Math.PI * 2;
      const nx = rx * Math.cos(th), ny = ry * Math.sin(th);
      total += Math.hypot(nx - px, ny - py);
      arc[i] = total;
      px = nx; py = ny;
    }
    for (let i = 0; i < m; i++) {
      const s = ((i + (phase || 0)) / m) * total;
      let lo = 0, hi = N;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (arc[mid] < s) lo = mid + 1; else hi = mid; }
      const i1 = Math.max(1, lo);
      const t0 = arc[i1 - 1], t1 = arc[i1];
      const f = t1 > t0 ? (s - t0) / (t1 - t0) : 0;
      const th = ((i1 - 1) + f) / N * Math.PI * 2;
      const deg = th * 180 / Math.PI;
      seats.push({
        x: cx + rx * Math.cos(th),
        y: cy + ry * Math.sin(th),
        rot: ((deg - 90) % 360 + 360) % 360   // menghadap pusat
      });
    }
  }

  /* Skala ikon bangku bila jarak antar-bangku terlalu rapat —
     kursi tetap terpisah jelas walau ruangan padat (150+). */
  function chairScale(pitch) {
    if (!pitch || pitch >= 0.55) return 1;
    return Math.max(0.35, pitch / 0.55);
  }

  /* Bangku digambar dari seatPositions — mode otomatis menggambar
     seluruh bangku (maks. 2000); jarak rapat ditangani penskalaan ikon.
     Mode manual menggambar semua & opsional interaktif (editor admin). */
  function seatsSVG(layout, uid, opts) {
    opts = opts || {};
    const pos = seatPositions(layout);
    if (!pos.seats.length && !pos.tables.length) return '';
    let s = '';
    (pos.tables || []).forEach(t => { s += roundTableGlyph(t.x * S, t.y * S); });
    const manual = layout.seatMode === 'custom';
    const list = manual ? pos.seats : pos.seats.slice(0, 2000);
    const sc = chairScale(pos.pitch);
    list.forEach((p, i) => {
      const inter = manual && opts.interactive;
      s += '<g class="fp-chair' + (inter ? ' fp-seat' : '') + (inter && opts.selSeat === i ? ' fp-sel' : '') + '"' +
        (inter ? ' data-seat="' + i + '" tabindex="0" role="button" aria-label="' + T('plan.seat') + '"' : '') +
        ' transform="translate(' + (p.x * S) + ' ' + (p.y * S) + ')' + (p.rot ? ' rotate(' + p.rot + ')' : '') + (sc < 1 ? ' scale(' + sc + ')' : '') + '">' +
        (inter ? '<title>' + T('plan.seat') + '</title>' : '') +
        CHAIR_GLYPH +
        '</g>';
    });
    return s;
  }

  /* ---------- Renderer utama ----------
     opts: { interactive:bool, uid:string, selected:index|null, selSeat:index|null, showLegend:bool } */
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

    const seats = seatsSVG(layout, uid, opts);

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

  CFB.floorplan = { TYPES, SEAT_MODES, parseLayout, hasLayout, render, legendHTML, iconSVG, seatPositions, chairScale, ellipsePerim, ringSeats, S };
})();
