/* ============================================
   Gamaspace — Admin Panel (admin.html)
   Dashboard + Gate RBAC + Admin + Pengguna + Pengajuan + Fasilitas
   Bergantung pada: core.js, data.js
   ============================================ */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = CFB.util.esc;
  const T = (k, p) => (window.CFB.i18n ? CFB.i18n.t(k, p) : k);

  const ui = { tab: 'dashboard', role: 'admin', bkFilter: 'all', bkQuery: '', accQuery: '',
    accounts: [], adminEmailsDb: [], petugasEmailsDb: [], isRoot: false };

  const STATUS_LABEL = { Pending: 'Menunggu Persetujuan', Approved: 'Disetujui', Rejected: 'Ditolak',
    'Checked-in': 'Sudah Check-in', 'Selesai': 'Selesai', 'Cancelled': 'Dibatalkan' };
  /* Status ringkas untuk kolom sempit pada laporan PDF */
  const EXP_STATUS_SHORT = { Pending: 'Menunggu', Approved: 'Disetujui', Rejected: 'Ditolak',
    'Checked-in': 'Berlangsung', 'Selesai': 'Selesai', 'Cancelled': 'Batal' };
  function badge(s) {
    return '<span class="status-badge status-' + String(s).toLowerCase() + '">' + (STATUS_LABEL[s] || s) + '</span>';
  }

  // ============ Modal generik (animasi) ============
  function openModal(html, opts) {
    opts = opts || {};
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.innerHTML = '<div class="modal-card' + (opts.wide ? ' modal-wide' : '') + '" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('show'));
    const close = () => {
      ov.classList.remove('show');
      setTimeout(() => ov.remove(), 200);
    };
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    return { ov, close };
  }

  /* ============ RBAC — Gate admin via Firebase Auth (Task 9/10) ============
     Login HANYA memakai email + kata sandi (bisa daftar akun baru langsung
     dari gate). Akses diberikan bila email:
       0. sama dengan rootAdminEmail (pengelola utama — selalu diizinkan), atau
       1. terdaftar pada adminEmails (assets/js/firebase-config.js), atau
       2. terdaftar pada node /admins di Realtime Database.
     Admin baru HANYA ditambahkan oleh pengelola utama lewat tab
     "Admin" (langsung aktif, tanpa proses persetujuan).
     Bila rootAdminEmail belum diatur DAN kedua daftar kosong, login
     PERTAMA mencoba mendaftarkan dirinya ke /admins (first-claim) —
     set "allowFirstAdminClaim": false untuk menonaktifkannya. */
  const CFG = window.CFB_FIREBASE || {};
  let lastAdminUid = null;

  function gateState(name) {          // 'login' | 'checking' | 'denied'
    $('#adminGate').hidden = false;
    $('#adminShell').hidden = true;
    $('#gateLogin').hidden = name !== 'login';
    $('#gateChecking').hidden = name !== 'checking';
    $('#gateDenied').hidden = name !== 'denied';
    if (name === 'login') { gateError(''); setTimeout(() => $('#gateEmail').focus(), 80); }
  }

  function gateError(msg) {
    const el = $('#gateError');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function cfgAdminEmails() {
    return (Array.isArray(CFG.adminEmails) ? CFG.adminEmails : [])
      .map(e => String(e || '').toLowerCase().trim()).filter(Boolean);
  }

  /* /admins/<key-aman> = "email@contoh.com" */
  function adminKey(email) {
    return String(email || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  async function fetchAdminEmails() {
    const raw = await CFB.data.fbNodeGet('admins');
    if (!raw || typeof raw !== 'object') return [];
    const out = [];
    Object.keys(raw).forEach(k => {
      const v = raw[k];
      if (typeof v === 'string' && v.includes('@')) out.push(v.toLowerCase());
    });
    return out;
  }

  /* ===== Petugas Lapangan — daftar email (config + node /petugas) =====
     Peran terbatas: Scanner + Pengajuan baca-saja (lihat TABS & checkAdmin). */
  function cfgPetugasEmails() {
    return (Array.isArray(CFG.petugasEmails) ? CFG.petugasEmails : [])
      .map(e => String(e || '').toLowerCase().trim()).filter(Boolean);
  }
  async function fetchPetugasEmails() {
    const raw = await CFB.data.fbNodeGet('petugas');
    if (!raw || typeof raw !== 'object') return [];
    const out = [];
    Object.keys(raw).forEach(k => {
      const v = raw[k];
      if (typeof v === 'string' && v.includes('@')) out.push(v.toLowerCase());
    });
    return out;
  }

  /* Jam admin panel — SELALU WIB (waktu resmi sistem), detik berjalan.
     Menempel di bawah brand sidebar: sederhana, bersih, membantu
     pemilik memverifikasi jadwal tanpa terpengaruh jam perangkat. */
  let clockTimer = 0;
  function tickClock() {
    const tEl = $('#scTime'), dEl = $('#scDate');
    if (!tEl) return;
    /* new Date() (instant mentah) + timeZone Asia/Jakarta → WIB murni,
       sekali konversi (jangan pakai nowWIB() di sini — bisa geser ganda). */
    const now = new Date();
    const loc = CFB.i18n ? CFB.i18n.locale() : 'id-ID';
    const tz = { timeZone: CFB.util.WIB_TZ, hour12: false };
    tEl.textContent = now.toLocaleTimeString(loc, Object.assign({ hour: '2-digit', minute: '2-digit', second: '2-digit' }, tz)) + ' WIB';
    if (dEl) dEl.textContent = now.toLocaleDateString(loc, Object.assign({ weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }, tz));
  }
  function startClock() {
    const sc = $('#sideClock');
    if (sc) sc.title = T('adm.clock.tip');
    tickClock();
    if (!clockTimer) clockTimer = setInterval(tickClock, 1000);
  }

  function enterShell(user, source, role) {
    lastAdminUid = user.uid;
    ui.role = (role === 'petugas') ? 'petugas' : 'admin';
    $('#adminGate').hidden = true;
    $('#adminShell').hidden = false;
    document.body.classList.toggle('role-petugas', ui.role === 'petugas');
    startClock();
    /* Identitas akun di kaki sidebar — HANYA email + chip peran, tanpa nama
       tampilan (revisi: profil disembunyikan).
       Nama tampilan (mis. "Dhamashidqiputra2007") sengaja disembunyikan. */
    const who = $('#adminWho');
    if (who) {
      const email = String(user.email || user.name || 'admin');
      const nameEl = $('#whoName');
      if (nameEl) { nameEl.textContent = ''; nameEl.hidden = true; }
      const em = $('#whoEmail');
      if (em) { em.textContent = email; em.title = email; }
      const roleEl = $('#whoRole');
      if (roleEl) {
        roleEl.textContent = T('role.' + (ui.role === 'petugas' ? 'petugas' : 'admin'));
        roleEl.classList.toggle('is-petugas', ui.role === 'petugas');
        roleEl.hidden = false;
      }
      who.classList.remove('is-root');
      who.hidden = false;
    }
    /* Tautan nav yang tampak mengikuti peran (CSS body.role-petugas) */
    $$('.side-nav a.petugas-only').forEach(a => { a.hidden = false; });
    /* Tab default sesuai peran — bila hash mentah bukan tab yang diizinkan
       (mis. petugas membuka #dashboard), arahkan ke tab default peran. */
    const rawTab = location.hash.replace(/^#\/?/, '');
    if (!TABS(ui.role).includes(rawTab)) {
      location.hash = ui.role === 'petugas' ? '#scanner' : '#dashboard';
    }
    renderTab();
  }

  function showDenied(email) {
    $('#gdEmail').textContent = email || '—';
    const root = rootAdminEmail();
    const contact = $('#gdContact');
    if (contact) {
      if (root) {
        $('#gdRootEmail').textContent = root;
        contact.hidden = false;
      } else contact.hidden = true;
    }
    gateState('denied');
  }

  async function checkAdmin(user) {
    const email = String((user && user.email) || '').toLowerCase();
    if (!email) { showDenied(email); return; }
    const root = rootAdminEmail();
    if (root && email === root) { enterShell(user, 'root', 'admin'); return; }
    const cfgList = cfgAdminEmails();
    const dbList = await fetchAdminEmails();
    if (cfgList.includes(email) || dbList.includes(email)) { enterShell(user, 'config', 'admin'); return; }

    /* Bukan admin → cek daftar Petugas Lapangan (config + node /petugas).
       Petugas masuk ke shell yang sama dengan menu terbatas. */
    const ptgDb = await fetchPetugasEmails();
    if (cfgPetugasEmails().includes(email) || ptgDb.includes(email)) {
      enterShell(user, 'petugas', 'petugas');
      return;
    }

    /* First-claim hanya berlaku bila pengelola utama belum diatur
       (kondisi instalasi pertama) — mencegah pihak lain mengklaim akses. */
    const empty = !root && !cfgList.length && !dbList.length;
    if (empty && CFG.allowFirstAdminClaim !== false) {
      const res = await CFB.data.fbNodePut('admins/' + adminKey(email), email);
      if (res.ok) {
        CFB.notify.success('Terdaftar sebagai admin', email + ' tersimpan pada node /admins — akses permanen untuk akun ini.');
        enterShell(user, 'claim', 'admin');
        return;
      }
      showDenied(email);   // Rules /admins belum mengizinkan → petunjuk di layar
      return;
    }
    showDenied(email);
  }

  async function handleAuthState() {
    const u = (CFB.auth && CFB.auth.getUser) ? CFB.auth.getUser() : null;
    if (!u) { lastAdminUid = null; gateState('login'); return; }
    if (u.uid === lastAdminUid && !$('#adminShell').hidden) return; // sudah masuk
    gateState('checking');
    try { await checkAdmin(u); }
    catch (e) { showDenied(u.email || ''); }
  }

  async function doGateLogin(fn, btn) {
    gateError('');
    if (!CFB.auth || !CFB.auth.available()) {
      gateError('Login belum dikonfigurasi — isi apiKey & authDomain pada assets/js/firebase-config.js.');
      return;
    }
    btn.disabled = true;
    btn.classList.add('is-loading');
    try { await fn(); }               // hasil datang via cfb:auth → handleAuthState
    catch (e) { gateError(CFB.auth.errText(e)); }
    finally { btn.disabled = false; btn.classList.remove('is-loading'); }
  }

  // ============ Tab (via hash) — daftar tab mengikuti peran ============
  /* Petugas Lapangan : Scanner + Pengajuan (baca-saja)
     Admin / Root     : seluruh tab (tanpa Scanner — Scanner khusus petugas) */
  function TABS(role) {
    return (role === 'petugas') ? ['scanner', 'pengajuan']
                                : ['dashboard', 'admin', 'users', 'pengajuan', 'fasilitas'];
  }
  function currentTabFromHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const allowed = TABS(ui.role);
    return allowed.includes(h) ? h : allowed[0];
  }

  async function renderTab() {
    const prev = ui.tab;
    ui.tab = currentTabFromHash();
    if (prev === 'scanner' && ui.tab !== 'scanner') stopCamera();
    TABS(ui.role).forEach(t => {
      const sec = $('#tab-' + t);
      if (sec) sec.hidden = t !== ui.tab;
    });
    /* Tab di luar peran pasti tersembunyi (mis. sisa sesi login sebelumnya
       pada halaman yang sama tanpa muat ulang) */
    ['dashboard', 'admin', 'users', 'pengajuan', 'fasilitas', 'scanner'].forEach(t => {
      if (!TABS(ui.role).includes(t)) {
        const sec = $('#tab-' + t);
        if (sec) sec.hidden = true;
      }
    });
    $$('.side-nav a').forEach(a => a.classList.toggle('active', a.dataset.tab === ui.tab));
    /* Segarkan pengajuan & kunci dari Firebase sebelum menampilkan tab data
       (scanner, dashboard & pengajuan — semuanya memakai data pengajuan). */
    if (ui.tab === 'scanner' || ui.tab === 'dashboard' || ui.tab === 'pengajuan') {
      if (CFB.data.getMode() === 'firebase') {
        try { await CFB.data.refreshBookings(); } catch (e) { /* offline */ }
        try { await CFB.data.refreshKeys(); } catch (e) { /* offline */ }
      }
      /* Sweep lifecycle: Pending >48 jam & Approved tanpa check-in yang
         slotnya sudah lewat → batal otomatis; Checked-in yang waktunya
         habis → Selesai otomatis (senyap — tidak menaikkan notifikasi). */
      const changed = await CFB.data.sweepLifecycle();
      if (changed) {
        CFB.notify.info(T('admc.sweep.t'), T('admc.sweep.m', { n: changed }));
      }
    }
    if (ui.tab === 'scanner') renderScanner();
    if (ui.tab === 'dashboard') renderDashboard();
    if (ui.tab === 'admin') await renderAdminTab();
    if (ui.tab === 'users') await renderUsersTab();
    if (ui.tab === 'pengajuan') renderBookings();
    if (ui.tab === 'fasilitas') renderFacilities();
    updatePendingBadge();
  }

  function updatePendingBadge() {
    const n = CFB.data.getBookings().filter(b => b.status === 'Pending').length;
    const el = $('#pendingBadge');
    if (n > 0) { el.textContent = n; el.hidden = false; } else el.hidden = true;
  }

  // ============ Dashboard / Analitik (dikembalikan seperti semula) ============
  /* Segmen status untuk donat — urutan & warna konsisten dengan badge status. */
  const DONUT_SEGS = [
    { k: 'Pending', label: 'Menunggu', cls: 'pending', color: '#D97706' },
    { k: 'Approved', label: 'Disetujui', cls: 'approved', color: '#16A34A' },
    { k: 'Checked-in', label: 'Sudah Check-in', cls: 'checkedin', color: '#2563EB' },
    { k: 'Selesai', label: 'Selesai', cls: 'selesai', color: '#0D9488' },
    { k: 'Rejected', label: 'Ditolak', cls: 'rejected', color: '#DC2626' },
    { k: 'Cancelled', label: 'Dibatalkan', cls: 'cancelled', color: '#94A3B8' }
  ];

  function renderDashboard() {
    const facilities = CFB.data.getFacilities();
    const bookings = CFB.data.getBookings();
    const dates = CFB.data.bookableDates();
    const fbMode = CFB.data.getMode() === 'firebase';

    const counts = {};
    bookings.forEach(b => { counts[b.status] = (counts[b.status] || 0) + 1; });
    const nPend = counts.Pending || 0;
    const nApp = counts.Approved || 0;
    const nLive = counts['Checked-in'] || 0;

    // KPI dengan animasi angka
    $('#kpiRow').innerHTML =
      kpi('Total Pengajuan', bookings.length, '') +
      kpi('Menunggu', nPend, 'pending') +
      kpi('Disetujui', nApp, 'approved') +
      kpi('Berlangsung', nLive, 'live') +
      kpi('Fasilitas Aktif', facilities.filter(f => f.status !== 'Unavailable').length, '');
    $$('#kpiRow [data-target]').forEach(el => CFB.util.countUp(el, +el.dataset.target));
    CFB.util.stagger($('#kpiRow'));

    // Catatan jumlah data + sumber analitik
    const note = $('#dashNote');
    if (note) {
      note.textContent = bookings.length
        ? bookings.length + ' pengajuan tersimpan pada ' + (fbMode ? 'basis data online.' : 'perangkat ini.')
        : 'Belum ada pengajuan pada ' + (fbMode ? 'basis data online.' : 'perangkat ini.');
    }
    const srcNote = $('#dashSrcNote');
    if (srcNote) {
      srcNote.innerHTML = fbMode
        ? 'Analitik dihitung dari data pengajuan tersambung (Firebase Realtime Database) yang dipakai bersama seluruh perangkat.'
        : 'Analitik dihitung dari data pengajuan (LocalStorage) di atas data awal <code>data/*.json</code>. Klik <em>Muat data contoh</em> untuk melihat tampilan analitik.';
    }

    if (!bookings.length) {
      $('#chartStatus').innerHTML = $('#chartFacility').innerHTML = $('#chartDate').innerHTML =
        '<div class="chart-empty-card">' +
        '  <p class="ce-title">Belum ada data pengajuan</p>' +
        '  <p class="ce-hint">Grafik analitik akan terisi setelah ada pengajuan dari mahasiswa' + (fbMode ? '.' : ', atau gunakan tombol <strong>Muat data contoh</strong> di atas untuk melihat tampilannya.') + '</p>' +
        '</div>';
      $('#recentList').innerHTML = '<p class="chart-empty">Belum ada pengajuan.</p>';
      return;
    }

    // Donut status (conic-gradient) — seluruh siklus hidup pengajuan
    const total = bookings.length;
    let pos = 0;
    const stops = [];
    DONUT_SEGS.forEach(s => {
      const n = counts[s.k] || 0;
      if (!n) return;
      const pct = n / total * 100;
      stops.push(s.color + ' ' + pos.toFixed(2) + '% ' + (pos + pct).toFixed(2) + '%');
      pos += pct;
    });
    $('#chartStatus').innerHTML =
      '<div class="donut-wrap">' +
      '  <div class="donut" style="background:conic-gradient(' + stops.join(', ') + ')">' +
      '    <div class="donut-hole"><strong>' + total + '</strong><span>pengajuan</span></div>' +
      '  </div>' +
      '  <div class="donut-legend">' + DONUT_SEGS.map(s => {
        const n = counts[s.k] || 0;
        if (!n) return '';
        return '<span class="lg ' + s.cls + '">' + s.label + ' ' + n + ' (' + Math.round(n / total * 100) + '%)</span>';
      }).join('') + '</div>' +
      '</div>';

    // Horizontal bar: pengajuan per fasilitas
    const byFac = {};
    bookings.forEach(b => { byFac[b.facilityName] = (byFac[b.facilityName] || 0) + 1; });
    let names = facilities.map(f => f.name);
    Object.keys(byFac).forEach(k => { if (!names.includes(k)) names.push(k); });
    const facCounts = names.map(n => ({ name: n, n: byFac[n] || 0 })).sort((a, b) => b.n - a.n);
    const maxFac = Math.max(1, ...facCounts.map(x => x.n));
    $('#chartFacility').innerHTML = '<div class="hbar-list">' + facCounts.map(x =>
      '<div class="hbar-row">' +
      '  <span class="hbar-name" title="' + esc(x.name) + '">' + esc(x.name) + '</span>' +
      '  <div class="hbar-track"><div class="hbar-fill" data-w="' + Math.max(2, (x.n / maxFac) * 100) + '"></div></div>' +
      '  <span class="hbar-val">' + x.n + '</span>' +
      '</div>').join('') + '</div>';
    requestAnimationFrame(() => {
      setTimeout(() => $$('#chartFacility .hbar-fill').forEach((el, i) => {
        el.style.transitionDelay = (i * 40) + 'ms';
        el.style.width = el.dataset.w + '%';
      }), 30);
    });

    // Vertical bar: pengajuan per tanggal (rentang bisa dipesan)
    const dateTitle = $('#chartDateTitle');
    if (dateTitle) dateTitle.textContent = 'Pengajuan per tanggal (' + dates.length + ' hari ke depan)';
    const byDate = {};
    bookings.forEach(b => { byDate[b.date] = (byDate[b.date] || 0) + 1; });
    const maxD = Math.max(1, ...dates.map(d => byDate[d] || 0));
    $('#chartDate').innerHTML = '<div class="vbar-chart">' + dates.map((d, i) => {
      const n = byDate[d] || 0;
      return '<div class="vbar-col' + (n === 0 ? ' zero' : '') + '">' +
        '  <span class="vbar-val">' + (n || '') + '</span>' +
        '  <div class="vbar-bar" data-h="' + Math.max(3, Math.round((n / maxD) * 120)) + '" style="transition-delay:' + (i * 30) + 'ms"></div>' +
        '  <span class="vbar-label">' + CFB.util.dateParts(d).date + '</span>' +
        '</div>';
    }).join('') + '</div>';
    requestAnimationFrame(() => {
      setTimeout(() => $$('#chartDate .vbar-bar').forEach(el => { el.style.height = el.dataset.h + 'px'; }), 30);
    });

    // Pengajuan terbaru (5)
    const recent = bookings.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
    $('#recentList').innerHTML = recent.map(b =>
      '<div class="recent-row">' +
      '  <div>' +
      '    <p class="rr-name">' + esc(b.facilityName) + ' <span class="rr-ref">' + esc(b.id) + '</span></p>' +
      '    <p class="rr-meta">' + esc(b.name) + ' \u00b7 ' + esc(b.dateLabel || b.date) + ' \u00b7 ' + esc(b.slotLabel || '') + ' WIB</p>' +
      '  </div>' +
      '  <div class="recent-side">' + badge(b.status) + '</div>' +
      '</div>').join('');
  }

  function kpi(label, value, cls) {
    return '<div class="stat-item"><p class="si-value ' + cls + '" data-target="' + value + '">0</p><p class="si-label">' + label + '</p></div>';
  }

  /* ===== Data contoh (untuk demo analitik dashboard) =====
     createdAt disimpan dalam rentang < 30 jam terakhir agar TIDAK
     ikut dibatalkan otomatis oleh sweep Pending > 48 jam. */
  async function seedDemoBookings() {
    const demo = [
      { f: 'FAC-001', day: 1, h: 10, dur: 2, name: 'Dimas Prasetyo', nim: '23/456781/PA/20014', org: 'Ilmu Komunikasi 2023', part: 32, purpose: 'Latihan presentasi tugas besar mata kuliah Komunikasi Publik.', status: 'Pending' },
      { f: 'FAC-002', day: 2, h: 13, dur: 2, name: 'Siti Rahmawati', nim: '22/415672/PA/19880', org: 'BEM Fakultas', part: 100, purpose: 'Rapat koordinasi kerja cabinet BEM periode 2026.', status: 'Pending' },
      { f: 'FAC-004', day: 2, h: 8, dur: 1, name: 'Bagas Nugroho', nim: '24/478912/PA/21045', org: 'Informatika 2024', part: 28, purpose: 'Praktikum mandiri struktur data dan algoritma.', status: 'Approved' },
      { f: 'FAC-006', day: 3, h: 15, dur: 2, name: 'Ahmad Fauzi', nim: '21/438221/PA/19320', org: 'UKM Basket', part: 24, purpose: 'Latihan rutin tim basket menjelang lomba antar fakultas.', status: 'Approved' },
      { f: 'FAC-009', day: 4, h: 9, dur: 2, name: 'Dewi Lestari', nim: '22/423390/PA/19912', org: 'Sekretariat Seminar', part: 350, purpose: 'Seminar nasional teknologi berkelanjutan dengan pembicara praktisi.', status: 'Pending' },
      { f: 'FAC-010', day: 4, h: 13, dur: 1, name: 'Rina Kurniawati', nim: '23/451230/PA/20077', org: 'Manajemen 2023', part: 45, purpose: 'Diskusi kelompok tugas analisis kasus manajemen operasional.', status: 'Pending' },
      { f: 'FAC-003', day: 5, h: 11, dur: 2, name: 'Fajar Ramadhan', nim: '24/469001/PA/20988', org: 'Sastra Inggris 2024', part: 20, purpose: 'Praktik speaking persiapan tes TOEFL ITP.', status: 'Rejected', reason: 'Bentrok dengan kegiatan resmi fakultas.' },
      { f: 'FAC-005', day: 5, h: 16, dur: 2, name: 'Nur Aisyah', nim: '21/440118/PA/19450', org: 'KMK Fortissimo', part: 90, purpose: 'Gladi resik paduan suara sebelum konser tahunan.', status: 'Pending' },
      { f: 'FAC-008', day: 6, h: 8, dur: 2, name: 'Yoga Pratama', nim: '23/457789/PA/20032', org: 'HMPS Biologi', part: 60, purpose: 'Kegiatan outbound dan games bonding mahasiswa baru.', status: 'Approved' },
      { f: 'FAC-001', day: 0, h: 8, dur: 2, name: 'Gita Savitri', nim: '22/417853/PA/19855', org: 'Keluarga Mahasiswa Teknik', part: 44, purpose: 'Koordinasi teknis lomba kartun teknik tingkat nasional.', status: 'Checked-in' },
      { f: 'FAC-007', day: 0, h: 10, dur: 2, name: 'Bima Sakti', nim: '21/431209/PA/19377', org: 'KSM Fotografi', part: 26, purpose: 'Workshop editing foto untuk anggota baru.', status: 'Selesai' },
      { f: 'FAC-004', day: 7, h: 9, dur: 1, name: 'Maya Anggraini', nim: '24/470231/PA/21001', org: 'Akuntansi 2024', part: 35, purpose: 'Belajar bersama persiapan ujian tengah semester.', status: 'Pending' },
      { f: 'FAC-002', day: 9, h: 10, dur: 2, name: 'Rizky Maulana', nim: '22/416785/PA/19826', org: 'Dewan Mahasiswa', part: 140, purpose: 'Musyawarah besar evaluasi program kerja tahunan.', status: 'Approved' },
      { f: 'FAC-010', day: 12, h: 9, dur: 2, name: 'Laila Fitriani', nim: '22/428901/PA/19945', org: 'Psikologi 2022', part: 55, purpose: 'Workshop public speaking untuk mahasiswa semester awal.', status: 'Cancelled', reason: 'user' }
    ];

    const dates = CFB.data.bookableDates();
    let added = 0;
    for (let i = 0; i < demo.length; i++) {
      const d = demo[i];
      const f = CFB.data.getFacilityById(d.f);
      if (!f) continue;
      const date = dates[Math.min(d.day, dates.length - 1)];
      if (!CFB.data.isRangeFree(f.id, date, d.h, d.dur)) continue; // hindari bentrok dengan seed
      const created = new Date(Date.now() - (demo.length - i) * 2 * 3600 * 1000).toISOString();
      const email = d.name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '') + '@mail.ugm.ac.id';
      const rec = {
        id: CFB.data.generateBookingId(),
        facilityId: f.id, facilityName: f.name, category: f.category || '', location: f.location, capacity: f.capacity,
        date, dateLabel: CFB.util.dateParts(date).full,
        startHour: d.h, endHour: d.h + d.dur, durationHours: d.dur,
        slotLabel: CFB.util.rangeLabel(d.h, d.h + d.dur),
        name: d.name, nim: d.nim, email, phone: '+62 812-3456-78' + (10 + i),
        participants: d.part, organization: d.org, purpose: d.purpose, notes: '',
        status: d.status, createdAt: created
      };
      /* Lengkapi jejak siklus hidup agar demo realistis */
      if (d.status === 'Approved' || d.status === 'Checked-in' || d.status === 'Selesai') {
        rec.checkinCode = CFB.data.generateCheckinCode();
        rec.decidedAt = created;
      }
      if (d.status === 'Checked-in') {
        rec.checkedInAt = new Date(Date.now() - 3600 * 1000).toISOString();
        rec.checkedInBy = 'petugas@mail.ugm.ac.id';
      }
      if (d.status === 'Selesai') {
        rec.checkedInAt = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
        rec.checkedInBy = 'petugas@mail.ugm.ac.id';
        rec.completedAt = new Date(Date.now() - 1800 * 1000).toISOString();
        rec.checkoutBy = 'user';
      }
      if (d.status === 'Rejected') { rec.rejectReason = d.reason; rec.decidedAt = created; }
      if (d.status === 'Cancelled') { rec.cancelReason = d.reason; rec.decidedAt = created; }
      const saved = await CFB.data.addBooking(rec);
      if (saved) added++;
    }
    CFB.notify.success('Data contoh dimuat', added + ' pengajuan contoh ditambahkan untuk mengisi analitik.');
    await renderTab();
  }

  async function seedDemoFlow() {
    const fbMode = CFB.data.getMode() === 'firebase';
    if (CFB.data.getBookings().length) {
      const ok = await CFB.confirm({
        title: T('admc.seed.t'),
        html: T('admc.seed.m') + (fbMode ? ' ' + T('admc.seed.fb') : ''),
        confirmText: T('admc.seed.yes')
      });
      if (!ok) return;
    }
    await seedDemoBookings();
  }

  // ============ Kelola Pengajuan ============
  function filteredBookings() {
    const q = ui.bkQuery.trim().toLowerCase();
    return CFB.data.getBookings().filter(b => {
      if (ui.bkFilter !== 'all' && b.status !== ui.bkFilter) return false;
      if (!q) return true;
      return [b.id, b.name, b.nim, b.email, b.facilityName, b.organization]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
  }

  function renderBookings() {
    updatePendingBadge();
    const all = CFB.data.getBookings();
    updateExportButtons(all);
    const ro = isPetugas();          // petugas lapangan: baca-saja
    const banner = $('#bkReadOnlyBanner');
    if (banner) banner.hidden = !ro;
    const list = filteredBookings();
    $('#bkCount').textContent = list.length + ' dari ' + all.length + ' pengajuan';
    const wrap = $('#bkList');
    wrap.innerHTML = '';
    $('#bkEmpty').hidden = !!list.length;
    if (!list.length) {
      $('#bkEmpty').querySelector('.empty-hint').textContent = all.length
        ? 'Tidak ada pengajuan yang cocok dengan filter/pencarian.'
        : 'Pengajuan dari mahasiswa akan muncul di sini.';
      return;
    }
    list.forEach(b => {
      const isPending = b.status === 'Pending';
      const isCheckedIn = b.status === 'Checked-in';
      const div = document.createElement('div');
      div.className = 'bk-row';
      div.innerHTML =
        '<div class="bk-info">' +
        '  <p class="bk-title">' + esc(b.facilityName) + '</p>' +
        '  <p class="bk-meta">' +
        '    <span>' + esc(b.dateLabel || b.date) + '</span>' +
        '    <span class="bm-sep">\u00b7</span>' +
        '    <span class="bm-time">' + esc(b.slotLabel || '') + ' WIB (' + (b.durationHours || 2) + ' jam)</span>' +
        '    <span class="bm-sep">\u00b7</span>' +
        '    <span>' + b.participants + ' peserta</span>' +
        '  </p>' +
        '  <p class="bk-person">' +
        '    <span class="bp-name">' + esc(b.name) + '</span>' +
        '    <span class="bp-sep">\u00b7</span>' +
        '    <span class="bp-nim">' + esc(b.nim) + '</span>' +
        (b.organization ? '<span class="bp-sep">\u00b7</span><span class="bp-org">' + esc(b.organization) + '</span>' : '') +
        '  </p>' +
        '  <p class="bk-refline">' + esc(b.id) + ' \u00b7 diajukan ' + CFB.util.fmtDateTime(b.createdAt) + '</p>' +
        '</div>' +
        '<div class="bk-side">' +
        '  ' + badge(b.status) +
        '  <div class="bk-actions">' +
        '    <button type="button" class="btn-icon" data-detail="' + esc(b.id) + '" title="Lihat rincian lengkap">' + CFB.icons.eye + '</button>' +
        /* Check-in tidak lagi berupa tombol di sini — terjadi otomatis
           saat petugas lapangan memindai QR peminjam di menu Scanner. */
        (!ro && isPending
          ? '<button type="button" class="btn-mini ok" data-approve="' + esc(b.id) + '">' + CFB.icons.check + ' Setujui</button>' +
            '<button type="button" class="btn-mini no" data-reject="' + esc(b.id) + '">' + CFB.icons.x + ' Tolak</button>'
          : '') +
        (!ro && isCheckedIn
          ? '<button type="button" class="btn-mini ok" data-complete="' + esc(b.id) + '">' + CFB.icons.check + ' Tandai Selesai</button>'
          : '') +
        '  </div>' +
        '</div>';
      wrap.appendChild(div);
    });
    CFB.util.stagger(wrap);
    $$('#bkList [data-detail]').forEach(b => b.addEventListener('click', () => openDetailModal(b.dataset.detail)));
    $$('#bkList [data-approve]').forEach(b => b.addEventListener('click', () => approveBooking(b.dataset.approve)));
    $$('#bkList [data-reject]').forEach(b => b.addEventListener('click', () => rejectBooking(b.dataset.reject)));
    $$('#bkList [data-complete]').forEach(b => b.addEventListener('click', () => completeBooking(b.dataset.complete)));
  }

  function openDetailModal(id) {
    const b = CFB.data.getBookingById(id);
    if (!b) return;
    const rows = [
      ['Nomor referensi', b.id], ['Fasilitas', b.facilityName], ['Kategori', b.category || '—'],
      ['Lokasi', b.location], ['Tanggal', b.dateLabel || b.date],
      ['Waktu', (b.slotLabel || '') + ' WIB \u00b7 ' + (b.durationHours || 2) + ' jam'],
      ['Jumlah peserta', b.participants + ' orang (kapasitas ' + b.capacity + ')'],
      ['Peminjam', b.name], ['NIM', b.nim], ['Email', b.email], ['Telepon', b.phone],
      ['Organisasi / Prodi', b.organization], ['Diajukan', CFB.util.fmtDateTime(b.createdAt)],
      ['Diputuskan', b.decidedAt ? CFB.util.fmtDateTime(b.decidedAt) : '\u2014']
    ];
    if (b.accountEmail) rows.push(['Akun', b.accountEmail + (b.uid ? ' (uid ' + String(b.uid).slice(0, 8) + '\u2026)' : '')]);
    if (b.checkinCode) rows.push(['Kode pengambilan kunci', String(b.checkinCode).toUpperCase()]);
    if (b.keyId || b.keyLabel) rows.push(['Kunci diserahkan', b.keyLabel || b.keyId]);
    if (b.checkedInBy) rows.push(['Check-in oleh', b.checkedInBy]);
    if (b.checkedInAt) rows.push(['Check-in pada', CFB.util.fmtDateTime(b.checkedInAt)]);
    if (b.completedAt) rows.push(['Diselesaikan', CFB.util.fmtDateTime(b.completedAt)]);
    if (b.autoClosed) rows.push(['Penutupan', 'Otomatis oleh sistem (waktu sewa habis)']);
    else if (b.checkoutBy === 'user') rows.push(['Checkout', 'Ditekan peminjam']);
    if (b.cancelReason) {
      const crMap = { user: 'Dibatalkan oleh peminjam', expired: 'Kedaluwarsa (tidak ditinjau 48 jam)', 'no-show': 'Tidak check-in (no-show)' };
      rows.push(['Alasan pembatalan', crMap[b.cancelReason] || b.cancelReason]);
    }
    if (b.resubmittedAs) rows.push(['Diajukan ulang sebagai', b.resubmittedAs]);
    const m = openModal(
      '<div class="modal-head">' +
      '  <div><p class="modal-eyebrow">Detail Pengajuan</p><h3 class="modal-title">' + esc(b.facilityName) + '</h3></div>' +
      '  ' + badge(b.status) +
      '</div>' +
      '<div class="detail-grid">' + rows.map(r =>
        '<div class="dg-item"><span class="dg-label">' + r[0] + '</span><span class="dg-value">' + esc(String(r[1])) + '</span></div>'
      ).join('') +
      '<div class="dg-item dg-wide"><span class="dg-label">Tujuan peminjaman</span><span class="dg-value">' + esc(b.purpose) + '</span></div>' +
      (b.notes ? '<div class="dg-item dg-wide"><span class="dg-label">Catatan</span><span class="dg-value">' + esc(b.notes) + '</span></div>' : '') +
      (b.rejectReason ? '<div class="dg-item dg-wide"><span class="dg-label">Alasan penolakan</span><span class="dg-value">' + esc(b.rejectReason) + '</span></div>' : '') +
      '</div>' +
      '<div class="modal-actions">' +
      '  <button type="button" class="btn-ghost" data-close>Tutup</button>' +
      (!isPetugas() && b.status === 'Pending'
        ? '<button type="button" class="btn-primary" data-ok>' + CFB.icons.check + ' Setujui</button>'
        : '') +
      (!isPetugas() && b.status === 'Checked-in'
        ? '<button type="button" class="btn-primary" data-complete-modal>' + CFB.icons.check + ' Tandai Selesai</button>'
        : '') +
      '</div>', { wide: true });
    m.ov.querySelector('[data-close]').addEventListener('click', m.close);
    const okBtn = m.ov.querySelector('[data-ok]');
    if (okBtn) okBtn.addEventListener('click', () => { m.close(); approveBooking(id); });
    const cpBtn = m.ov.querySelector('[data-complete-modal]');
    if (cpBtn) cpBtn.addEventListener('click', () => { m.close(); completeBooking(id); });
  }

  async function approveBooking(id) {
    const b = CFB.data.getBookingById(id);
    if (!b) return;
    /* Pengaman alur: slot yang waktunya sudah berakhir TIDAK dapat
       disetujui. Sebelumnya menyetujui slot lewat membuat pengajuan
       langsung dibatalkan otomatis oleh aturan no-show — membingungkan
       peminjam. Kini admin diberi pesan jelas dan akses ditolak. */
    if (CFB.data.slotEnded(b)) {
      CFB.notify.error(T('admc.approve.pastT'), T('admc.approve.pastM', { id: b.id }));
      renderBookings();
      return;
    }
    const ok = await CFB.confirm({
      title: T('admc.approve.title'),
      html: T('admc.approve.msg', { id: esc(b.id), fac: esc(b.facilityName), date: esc(b.dateLabel || b.date), slot: esc(b.slotLabel || '') }),
      confirmText: T('admc.approve.yes')
    });
    if (!ok) return;
    const code = CFB.data.generateCheckinCode();
    const updated = await CFB.data.updateBookingStatus(id, 'Approved', { checkinCode: code });
    if (!updated) return; // toast error sudah ditampilkan data layer
    CFB.notify.success(T('admc.approve.okT'), T('admc.approve.okM', { id: b.id }));
    renderBookings();
  }

  /* ===== Scanner kunci (KHUSUS peran Petugas Lapangan) =====
     Petugas memindai QR kartu bukti peminjam lewat kamera ATAU mengetik
     kode 6 karakter (fallback). Sistem memvalidasi otomatis: pengajuan
     ada, berstatus Approved, dan berjadwal HARI INI. Saat cocok, petugas
     memilih kunci yang diserahkan lalu mengonfirmasi — status pengajuan
     menjadi Checked-in tanpa input manual lain. Perubahan status lain
     (checkout peminjam, penutupan otomatis) dikelola sistem. */
  function isPetugas() { return ui.role === 'petugas'; }

  const cam = { stream: null, raf: 0, active: false, lastPayload: '', lastAt: 0 };

  function renderScanner() {
    renderQueue();
  }

  /* Antrean hari ini (Approved) + pemakaian berlangsung (Checked-in) */
  function renderQueue() {
    const ql = $('#queueList'), ll = $('#liveList');
    if (!ql || !ll) return;
    const today = CFB.data.todayISO();
    const nowHour = CFB.util.nowHour();   // jam WIB — waktu resmi sistem
    const all = CFB.data.getBookings();
    const waiting = all.filter(b => b.status === 'Approved' && b.date === today)
      .sort((a, b) => (a.startHour || 0) - (b.startHour || 0));
    const live = all.filter(b => b.status === 'Checked-in')
      .sort((a, b) => new Date(b.checkedInAt || 0) - new Date(a.checkedInAt || 0));
    ql.innerHTML = waiting.length ? waiting.map(b => {
      const late = (b.startHour || 0) < nowHour;
      return '<div class="q-row">' +
        '  <span class="q-time">' + CFB.util.pad2(b.startHour || 0) + ':00</span>' +
        '  <span class="q-info">' +
        '    <span class="q-name">' + esc(b.name) + '</span>' +
        '    <span class="q-meta">' + esc(b.facilityName) + ' \u00b7 ' + esc(b.slotLabel || '') + ' WIB</span>' +
        '  </span>' +
        '  <span class="q-state ' + (late ? 'late' : 'wait') + '">' + esc(late ? T('scn.queue.late') : T('scn.queue.waiting')) + '</span>' +
        '</div>';
    }).join('') : '<p class="q-empty">' + esc(T('scn.queue.empty')) + '</p>';
    ll.innerHTML = live.length ? live.map(b => {
      return '<div class="q-row">' +
        '  <span class="q-time">' + CFB.util.pad2(b.startHour || 0) + ':00</span>' +
        '  <span class="q-info">' +
        '    <span class="q-name">' + esc(b.name) + '</span>' +
        '    <span class="q-meta">' + esc(b.facilityName) + ' \u00b7 ' + esc(b.slotLabel || '') + ' WIB' +
        (b.keyLabel || b.keyId ? ' \u00b7 ' + esc(b.keyLabel || b.keyId) : '') + '</span>' +
        '  </span>' +
        '  <span class="q-state live">' + esc(T('scn.queue.live.short')) + '</span>' +
        '</div>';
    }).join('') : '<p class="q-empty">' + esc(T('scn.queue.live.empty')) + '</p>';
  }

  function scanError(msg) {
    const el = $('#scanError');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }
  function camNote(msg) {
    const el = $('#camNote');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }
  function updateCamToggle() {
    const btn = $('#camToggle');
    if (!btn) return;
    const lbl = btn.querySelector('span');
    if (lbl) lbl.textContent = cam.active ? T('scn.camera.stop') : T('scn.camera.start');
  }

  function startCamera() {
    scanError('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      camFail(T('scn.camera.unsupported'));
      return;
    }
    const status = $('#camStatus');
    if (status) { status.textContent = T('scn.camera.starting'); status.hidden = false; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(stream => {
      cam.stream = stream;
      cam.active = true;
      const v = $('#camVideo');
      v.srcObject = stream;
      v.hidden = false;
      const idle = $('#camIdle');
      if (idle) idle.hidden = true;
      const p = v.play();
      if (p && p.catch) p.catch(() => { /* autoplay diblokir — frame tetap berjalan */ });
      if (status) status.hidden = true;
      const frame = $('#camFrame');
      if (frame) frame.classList.remove('is-error');
      camNote('');
      updateCamToggle();
      scanLoop();
    }).catch(() => {
      camFail(T('scn.camera.denied'));
    });
  }

  function camFail(msg) {
    const frame = $('#camFrame');
    if (frame) frame.classList.add('is-error');
    camNote(msg);
    updateCamToggle();
  }

  function stopCamera() {
    cam.active = false;
    if (cam.raf) { cancelAnimationFrame(cam.raf); cam.raf = 0; }
    if (cam.stream) {
      try { cam.stream.getTracks().forEach(t => t.stop()); } catch (e) { /* noop */ }
      cam.stream = null;
    }
    const v = $('#camVideo');
    if (v) { try { v.pause(); } catch (e) { /* noop */ } v.srcObject = null; v.hidden = true; }
    const idle = $('#camIdle');
    if (idle) idle.hidden = false;
    const status = $('#camStatus');
    if (status) status.hidden = true;
    const frame = $('#camFrame');
    if (frame) frame.classList.remove('is-error');
    updateCamToggle();
  }

  /* Loop pemindaian: frame video → jsQR → validasi payload */
  function scanLoop() {
    if (!cam.active) return;
    const v = $('#camVideo'), c = $('#camCanvas');
    if (v && c && v.readyState === 4 && v.videoWidth) {
      if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }
      let res = null;
      try {
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const img = ctx.getImageData(0, 0, c.width, c.height);
        res = (window.jsQR) ? window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' }) : null;
      } catch (e) { res = null; }
      if (res && res.data) {
        const now = Date.now();
        if (res.data !== cam.lastPayload || now - cam.lastAt > 3000) {
          cam.lastPayload = res.data;
          cam.lastAt = now;
          stopCamera();
          processScanRef(res.data);
          return;
        }
      }
    }
    cam.raf = requestAnimationFrame(scanLoop);
  }

  /* Hasil pemindaian / kode manual → validasi → tampilkan penanganan */
  function processScanRef(ref) {
    const res = CFB.data.validateScanTarget(ref);
    if (res.ok) { openHandoverModal(res.booking); return; }
    const b = res.booking;
    const msg =
      res.error === 'empty'   ? T('scn.err.empty') :
      res.error === 'already' ? T('scn.err.already', { id: b ? b.id : '\u2014' }) :
      res.error === 'status'  ? T('scn.err.status', { status: (b && (STATUS_LABEL[b.status] || b.status)) || '\u2014' }) :
      res.error === 'date'    ? T('scn.err.date', { date: b ? (b.dateLabel || b.date) : '\u2014' }) :
                                T('scn.err.not-found');
    scanError(msg);
  }

  /* Modal serah terima kunci — terakhir sebelum status Checked-in */
  function openHandoverModal(b) {
    const keys = CFB.data.getKeysByFacility(b.facilityId);
    const borrowed = CFB.data.keyBorrowedMap();
    const keyRef = (k) => String(k._key || k.id || '');
    const free = keys.filter(k => !borrowed[keyRef(k)] && !borrowed[k.label]);
    const taken = keys.filter(k => !!borrowed[keyRef(k)] || !!borrowed[k.label]);
    const options =
      free.map(k => '<option value="' + esc(keyRef(k)) + '">' + esc(k.label) + ' \u00b7 ' + esc(T('scn.key.available')) + '</option>').join('') +
      taken.map(k => '<option disabled>' + esc(k.label) + ' \u00b7 ' + esc(T('scn.key.borrowed')) + '</option>').join('');
    const hasKeys = keys.length > 0;
    const m = openModal(
      '<div class="modal-head">' +
      '  <div><p class="modal-eyebrow">' + esc(T('scn.confirm.eyebrow')) + '</p><h3 class="modal-title">' + esc(b.id) + '</h3></div>' +
      '  ' + badge(b.status) +
      '</div>' +
      '<p class="modal-message"><strong>' + esc(b.facilityName) + '</strong> \u00b7 ' + esc(b.dateLabel || b.date) + ' \u00b7 ' + esc(b.slotLabel || '') + ' WIB (' + (b.durationHours || 2) + ' jam)</p>' +
      '<div class="detail-grid">' +
      '  <div class="dg-item"><span class="dg-label">Peminjam</span><span class="dg-value">' + esc(b.name) + '</span></div>' +
      '  <div class="dg-item"><span class="dg-label">NIM</span><span class="dg-value">' + esc(b.nim) + '</span></div>' +
      '  <div class="dg-item"><span class="dg-label">Organisasi / Prodi</span><span class="dg-value">' + esc(b.organization || '\u2014') + '</span></div>' +
      '  <div class="dg-item"><span class="dg-label">Jumlah peserta</span><span class="dg-value">' + b.participants + ' orang</span></div>' +
      '</div>' +
      '<p class="modal-message ck-verify">' + T('scn.confirm.hint') + '</p>' +
      (hasKeys
        ? '<div class="form-row key-select-row"><label for="handoverKey">' + esc(T('scn.confirm.key.label')) + '</label>' +
          '<select id="handoverKey">' + options +
          '<option value="__none__">' + esc(T('scn.key.none')) + '</option></select></div>'
        : '') +
      '<div class="modal-actions">' +
      '  <button type="button" class="btn-ghost" data-close>Batal</button>' +
      '  <button type="button" class="btn-primary" data-ok>' + CFB.icons.check + ' ' + esc(T('scn.confirm.btn')) + '</button>' +
      '</div>', { wide: true });
    m.ov.querySelector('[data-close]').addEventListener('click', m.close);
    m.ov.querySelector('[data-ok]').addEventListener('click', async () => {
      const btn = m.ov.querySelector('[data-ok]');
      btn.disabled = true;
      const sel = m.ov.querySelector('#handoverKey');
      const selVal = sel ? sel.value : '__none__';
      const keyObj = keys.find(k => keyRef(k) === selVal) || null;
      const res = await CFB.data.checkinByScan(b.id,
        keyObj ? { ref: keyRef(keyObj), label: keyObj.label } : null,
        currentEmail());
      m.close();
      if (!res.ok) {
        scanError(res.error === 'status'
          ? T('scn.err.status', { status: STATUS_LABEL[b.status] || b.status })
          : T('scn.err.save'));
        return;
      }
      CFB.notify.success(T('scn.toast.ok.title'), T('scn.toast.ok.msg', { id: b.id, name: b.name }));
      renderQueue();
      updatePendingBadge();
    });
  }

  /* Tandai pemakaian selesai — status akhir yang rapi untuk statistik */
  async function completeBooking(id) {
    const b = CFB.data.getBookingById(id);
    if (!b || b.status !== 'Checked-in') return;
    const ok = await CFB.confirm({
      title: T('admc.complete.title'),
      html: T('admc.complete.msg', { id: esc(b.id), fac: esc(b.facilityName), name: esc(b.name) }),
      confirmText: T('admc.complete.yes')
    });
    if (!ok) return;
    const updated = await CFB.data.updateBookingStatus(id, 'Selesai', { completedAt: new Date().toISOString() });
    if (!updated) return;
    CFB.notify.success(T('admc.complete.okT'), T('admc.complete.okM', { id: b.id }));
    renderBookings();
  }

  function rejectBooking(id) {
    const b = CFB.data.getBookingById(id);
    if (!b) return;
    const m = openModal(
      '<div class="modal-head">' +
      '  <div><p class="modal-eyebrow">Tolak Pengajuan</p><h3 class="modal-title">' + esc(b.id) + '</h3></div>' +
      '</div>' +
      '<p class="modal-message">' + esc(b.facilityName) + ' \u00b7 ' + esc(b.dateLabel || b.date) + ' \u00b7 ' + esc(b.name) + '</p>' +
      '<div class="form-row">' +
      '  <label for="rejectReason">Alasan penolakan <span class="opt">(opsional, terlihat oleh peminjam)</span></label>' +
      '  <textarea id="rejectReason" rows="3" maxlength="300" placeholder="Contoh: bentrok dengan kegiatan resmi kampus"></textarea>' +
      '</div>' +
      '<div class="modal-actions">' +
      '  <button type="button" class="btn-ghost" data-close>Batal</button>' +
      '  <button type="button" class="btn-primary btn-danger" data-ok>' + CFB.icons.x + ' Tolak pengajuan</button>' +
      '</div>', { wide: true });
    m.ov.querySelector('[data-close]').addEventListener('click', m.close);
    m.ov.querySelector('[data-ok]').addEventListener('click', async () => {
      const reason = m.ov.querySelector('#rejectReason').value.trim();
      const okBtn = m.ov.querySelector('[data-ok]');
      okBtn.disabled = true;
      const updated = await CFB.data.updateBookingStatus(id, 'Rejected', reason ? { rejectReason: reason } : null);
      m.close();
      if (!updated) return;
      CFB.notify.warning('Pengajuan ditolak', b.id + ' \u00b7 slot waktu dikembalikan menjadi tersedia.');
      renderBookings();
    });
  }

  // ============ Fasilitas: CRUD ============
  const CATEGORIES = ['Ruang Kelas', 'Laboratorium', 'Aula', 'Olahraga', 'Studio'];

  function renderFacilities() {
    const facilities = CFB.data.getFacilities();
    const st = CFB.data.getFacilityStats();
    $('#facCount').textContent = st.mode === 'firebase'
      ? facilities.length + ' fasilitas tercatat'
      : facilities.length + ' fasilitas · ' + st.created + ' ditambah · ' +
        st.updated + ' diubah · ' + st.deleted + ' dihapus';
    const noteEl = $('#facNote');
    if (noteEl) {
      noteEl.innerHTML = st.mode === 'firebase'
        ? 'Perubahan tersimpan secara permanen dan terlihat oleh semua pengguna setelah dimuat ulang. Tombol <em>Kembalikan data awal</em> mengembalikan data fasilitas ke isi <code>data/facilities.json</code>.'
        : 'Perubahan tersimpan di browser (LocalStorage) sebagai lapisan di atas data awal <code>data/facilities.json</code>. Tombol <em>Reset</em> mengembalikan ke isi JSON.';
    }

    const tbody = $('#facTable tbody');
    tbody.innerHTML = facilities.map(f => {
      const sm = f.status === 'Available' ? 'st-ok' : (f.status === 'Limited' ? 'st-ltd' : 'st-no');
      const label = f.status === 'Available' ? 'Tersedia' : (f.status === 'Limited' ? 'Terbatas' : 'Tidak Tersedia');
      return '<tr>' +
        '<td class="id">' + esc(f.id) + '</td>' +
        '<td class="name">' + esc(f.name) + '</td>' +
        '<td>' + esc(f.category || '—') + '</td>' +
        '<td>' + esc(f.location) + '</td>' +
        '<td class="num">' + f.capacity + '</td>' +
        '<td>' + f.openHours.start + '\u2013' + f.openHours.end + '</td>' +
        '<td><span class="st ' + sm + '">' + label + '</span></td>' +
        '<td class="actions">' +
        '  <button type="button" class="btn-icon" data-plan="' + esc(f.id) + '" title="Denah ruangan">' + CFB.icons.grid + '</button>' +
        '  <button type="button" class="btn-icon" data-keys="' + esc(f.id) + '" title="Kunci fasilitas">' + KEY_ICON + '</button>' +
        '  <button type="button" class="btn-icon" data-edit="' + esc(f.id) + '" title="Ubah">' + CFB.icons.edit + '</button>' +
        '  <button type="button" class="btn-icon danger" data-del="' + esc(f.id) + '" title="Hapus">' + CFB.icons.trash + '</button>' +
        '</td></tr>';
    }).join('');
    if (!facilities.length) tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Tidak ada fasilitas.</td></tr>';

    $$('#facTable [data-edit]').forEach(b => b.addEventListener('click', () => openFacilityModal(b.dataset.edit)));
    $$('#facTable [data-del]').forEach(b => b.addEventListener('click', () => deleteFacility(b.dataset.del)));
    $$('#facTable [data-plan]').forEach(b => b.addEventListener('click', () => openLayoutEditor(b.dataset.plan)));
    $$('#facTable [data-keys]').forEach(b => b.addEventListener('click', () => openKeysModal(b.dataset.keys)));
  }

  /* ===== Kunci Fasilitas (tab Fasilitas — admin) =====
     Daftar kunci fisik per fasilitas. Status "Dipinjam" otomatis dari
     pengajuan Checked-in yang mencatat kunci tersebut — tidak disimpan
     terpisah, sehingga tidak pernah tidak sinkron. Petugas memilih kunci
     dari daftar ini saat konfirmasi serah terima di Scanner. */
  const KEY_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2"/><path d="m15.5 7.5 3 3L22 7l-3-3"/><path d="m15.5 7.5-6.097 6.097a5.5 5.5 0 1 1-3-3L12.5 4.5"/></svg>';

  async function openKeysModal(facilityId) {
    if (CFB.data.getMode() === 'firebase') {
      try { await CFB.data.refreshKeys(); } catch (e) { /* offline */ }
    }
    const f = CFB.data.getFacilityById(facilityId);
    if (!f) return;
    let editingRef = null;   // ref kunci yang sedang diedit (null = tambah baru)
    const m = openModal('', { wide: false });

    function paint() {
      const borrowed = CFB.data.keyBorrowedMap();
      const keys = CFB.data.getKeysByFacility(facilityId);
      const keyRef = (k) => String(k._key || k.id || '');
      m.ov.querySelector('.modal-card').innerHTML =
        '<div class="modal-head">' +
        '  <div><p class="modal-eyebrow">Kunci Fasilitas</p><h3 class="modal-title">' + esc(f.name) + '</h3></div>' +
        '  <button type="button" class="tc-close" data-close aria-label="Tutup">' + CFB.icons.close + '</button>' +
        '</div>' +
        '<p class="adm-modal-sub">Daftar kunci fisik fasilitas ini. Status <strong>Dipinjam</strong> dihitung otomatis dari pengajuan yang sedang Checked-in.</p>' +
        '<div id="keyRows">' + (keys.length ? keys.map(k => {
          const ref = keyRef(k);
          const out = !!borrowed[ref] || !!borrowed[k.label];
          return '<div class="q-row">' +
            '  <span class="q-info">' +
            '    <span class="q-name">' + esc(k.label) + '</span>' +
            (k.note ? '<span class="q-meta">' + esc(k.note) + '</span>' : '') +
            '  </span>' +
            '  <span class="q-state ' + (out ? 'live' : 'wait') + '">' + (out ? 'Dipinjam' : 'Tersedia') + '</span>' +
            '  <button type="button" class="btn-icon" data-edit-key="' + esc(ref) + '" title="Ubah">' + CFB.icons.edit + '</button>' +
            '  <button type="button" class="btn-icon danger" data-del-key="' + esc(ref) + '" title="Hapus">' + CFB.icons.trash + '</button>' +
            '</div>';
        }).join('') : '<p class="q-empty">Belum ada kunci tercatat untuk fasilitas ini. Tambahkan agar petugas dapat memilih kunci saat serah terima di Scanner.</p>') + '</div>' +
        '<form id="addKeyForm" novalidate>' +
        '  <div class="form-row"><label for="keyLabel">Label kunci</label><input id="keyLabel" type="text" placeholder="Contoh: Kunci R-101 #1" maxlength="60" /></div>' +
        '  <div class="form-row"><label for="keyNote">Catatan <span class="opt">(opsional)</span></label><input id="keyNote" type="text" placeholder="Contoh: gantungan merah, lemari nomor 2" maxlength="120" /></div>' +
        '  <p class="field-error" id="keyError" hidden></p>' +
        '  <div class="modal-actions">' +
        '    <button type="button" class="btn-ghost" data-close>Tutup</button>' +
        '    <button type="submit" class="btn-primary" id="keySubmit">' + (editingRef ? 'Simpan Perubahan' : 'Tambah Kunci') + '</button>' +
        '  </div>' +
        '</form>';
      /* Bind ulang setelah innerHTML diganti */
      m.ov.querySelector('[data-close]').addEventListener('click', m.close);
      const form = m.ov.querySelector('#addKeyForm');
      form.addEventListener('submit', onSubmit);
      const labelInput = m.ov.querySelector('#keyLabel');
      labelInput.addEventListener('input', () => keyError(''));
      m.ov.querySelectorAll('[data-edit-key]').forEach(b => b.addEventListener('click', () => {
        const k = keys.find(x => keyRef(x) === b.dataset.editKey);
        if (!k) return;
        editingRef = keyRef(k);
        m.ov.querySelector('#keyLabel').value = k.label || '';
        m.ov.querySelector('#keyNote').value = k.note || '';
        m.ov.querySelector('#keySubmit').textContent = 'Simpan Perubahan';
        keyError('');
        labelInput.focus();
      }));
      m.ov.querySelectorAll('[data-del-key]').forEach(b => b.addEventListener('click', async () => {
        const k = keys.find(x => keyRef(x) === b.dataset.delKey);
        if (!k) return;
        const ok = await CFB.confirm({
          title: T('admc.keydel.t'),
          danger: true,
          html: T('admc.keydel.m', { label: esc(k.label), fac: esc(f.name) }),
          confirmText: T('c.del')
        });
        if (!ok) return;
        const res = await CFB.data.deleteKey(keyRef(k));
        if (!res.ok) { keyError(res.error || 'Gagal menghapus kunci.'); return; }
        if (editingRef === keyRef(k)) editingRef = null;
        paint();
      }));
    }

    function keyError(msg) {
      const el = m.ov.querySelector('#keyError');
      if (!el) return;
      el.textContent = msg || '';
      el.hidden = !msg;
    }

    async function onSubmit(e) {
      e.preventDefault();
      keyError('');
      const labelInput = m.ov.querySelector('#keyLabel');
      const noteInput = m.ov.querySelector('#keyNote');
      const label = String(labelInput.value || '').trim();
      if (!label) { keyError('Label kunci wajib diisi.'); return; }
      /* Duplikat label pada fasilitas yang sama */
      const keys = CFB.data.getKeysByFacility(facilityId);
      const dup = keys.find(k => String(k.label).toLowerCase() === label.toLowerCase() &&
        String(k._key || k.id || '') !== editingRef);
      if (dup) { keyError('Label kunci sudah dipakai pada fasilitas ini.'); return; }
      const obj = editingRef
        ? Object.assign({}, keys.find(k => String(k._key || k.id || '') === editingRef), { label: label, note: String(noteInput.value || '').trim(), facilityId: facilityId })
        : { facilityId: facilityId, label: label, note: String(noteInput.value || '').trim() };
      const res = await CFB.data.saveKey(obj);
      if (!res.ok) { keyError(res.error || 'Gagal menyimpan kunci.'); return; }
      editingRef = null;
      paint();
    }

    paint();
  }

  /* ============ Tab Admin & Tab Pengguna (akun TERPISAH) ============
     Tab "Admin"    — daftar admin: pengelola utama (rootAdminEmail) +
                      adminEmails (firebase-config.js) + node /admins,
                      tanpa duplikat. HANYA pengelola utama dapat
                      menambahkan admin baru — langsung aktif tanpa
                      persetujuan. Admin lain tetap melihat daftar + tombol
                      Tambah Admin, namun tombol tersebut menampilkan
                      Akses Ditolak.
     Tab "Pengguna" — email unik dari node /users (tercatat otomatis
                      setiap akun masuk; email sama pada uid berbeda
                      hanya tampil sekali). */

  function rootAdminEmail() {
    return String(CFG.rootAdminEmail || '').toLowerCase().trim();
  }
  function currentEmail() {
    const u = (CFB.auth && CFB.auth.getUser) ? CFB.auth.getUser() : null;
    return String((u && u.email) || '').toLowerCase().trim();
  }
  function isRootAdmin() {
    const root = rootAdminEmail();
    return !!root && currentEmail() === root;
  }

  async function renderAdminTab() {
    ui.isRoot = isRootAdmin();
    paintRootEmail();
    await loadAdmins();
    renderAdmins();
    await loadPetugas();
    renderPetugas();
  }

  /* Tab Pengguna — hanya akun pengguna, sepenuhnya terpisah dari admin */
  async function renderUsersTab() {
    await loadAccounts();
    renderAccounts();
  }

  /* Tampilkan email pengelola utama pada catatan daftar admin */
  function paintRootEmail() {
    const root = rootAdminEmail();
    const rootTxt = $('#rootEmailTxt');
    if (rootTxt) rootTxt.textContent = root || '(belum diatur)';
    const note = $('#admNote');
    if (note && !root) {
      note.innerHTML = 'Pengelola utama belum diatur — isi <code>rootAdminEmail</code> pada <code>assets/js/firebase-config.js</code>.';
    }
  }

  /* --- 1. Akun terdaftar (email unik, anti-duplikat) --- */
  async function loadAccounts() {
    ui.accounts = [];
    if (CFB.data.getMode() !== 'firebase' || !CFB.data.fbNodeGet) return;
    try {
      const raw = await CFB.data.fbNodeGet('users');
      const byEmail = new Map();
      Object.keys(raw || {}).forEach(uid => {
        const u = raw[uid] || {};
        const idn = (u.identitas && typeof u.identitas === 'object') ? u.identitas : {};
        const email = String(u.email || idn.emailUgm || '').toLowerCase().trim();
        if (!email || email.indexOf('@') < 1) return;
        const ts = Math.max(Date.parse(u.lastLogin) || 0, Date.parse(idn.updatedAt) || 0);
        const prev = byEmail.get(email);
        if (!prev || ts > prev.ts) byEmail.set(email, { email: email, ts: ts });
      });
      ui.accounts = Array.from(byEmail.values()).sort((a, b) => a.email.localeCompare(b.email));
    } catch (e) { /* node /users ditolak Rules → tampil kosong */ }
  }

  function renderAccounts() {
    const listEl = $('#accList'), emptyEl = $('#accEmpty'), countEl = $('#accCount');
    if (!listEl) return;
    const q = ui.accQuery.toLowerCase().trim();
    const rows = ui.accounts.filter(a => !q || a.email.includes(q));
    if (countEl) {
      countEl.textContent = ui.accounts.length
        ? ui.accounts.length + ' akun unik' + (q && rows.length !== ui.accounts.length ? ' · ' + rows.length + ' cocok' : '')
        : '';
    }
    listEl.innerHTML = rows.map(a => {
      const when = a.ts ? 'Aktivitas terakhir ' + fmtDT(new Date(a.ts).toISOString()) : 'Baru terdaftar';
      return '<div class="acc-row">' +
        '  <span class="acc-email" title="' + esc(a.email) + '">' + esc(a.email) + '</span>' +
        '  <span class="acc-when">' + esc(when) + '</span>' +
        '</div>';
    }).join('');
    const none = rows.length === 0;
    if (emptyEl) {
      emptyEl.hidden = !none;
      if (none) {
        const t = emptyEl.querySelector('.empty-title');
        if (t) t.textContent = ui.accounts.length ? 'Tidak ada email yang cocok' : 'Belum ada akun terdaftar';
      }
    }
  }

  /* --- 2. Daftar Admin (terpisah dari akun pengguna) --- */
  async function loadAdmins() {
    ui.adminEmailsDb = [];
    if (CFB.data.getMode() !== 'firebase' || !CFB.data.fbNodeGet) return;
    try { ui.adminEmailsDb = await fetchAdminEmails() || []; }
    catch (e) { /* offline / Rules */ }
  }

  /* Gabungan pengelola utama + adminEmails (config) + node /admins — tanpa duplikat */
  function adminListAll() {
    const root = rootAdminEmail();
    const all = [];
    if (root) all.push(root);
    cfgAdminEmails().concat(ui.adminEmailsDb).forEach(e => {
      if (e !== root && all.indexOf(e) < 0) all.push(e);
    });
    return all;
  }

  function renderAdmins() {
    const listEl = $('#admList'), emptyEl = $('#admEmpty'), countEl = $('#admCount');
    if (!listEl) return;
    const all = adminListAll();
    const root = rootAdminEmail();
    if (countEl) countEl.textContent = all.length ? all.length + ' admin' : '';
    listEl.innerHTML = all.map(email => {
      const isRootRow = email === root;
      /* Hanya admin yang dikelola lewat database (ditambahkan pengelola
         utama) yang dapat dihapus dari antarmuka. */
      const canRemove = ui.isRoot && !isRootRow &&
        ui.adminEmailsDb.includes(email) && !cfgAdminEmails().includes(email);
      return '<div class="adm-row' + (isRootRow ? ' is-root' : '') + '">' +
        '  <span class="acc-email" title="' + esc(email) + '">' + esc(email) + '</span>' +
        (isRootRow
          ? '<span class="adm-badge root">' +
            '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M12 2l2.9 6.26 6.6 1.04-4.75 4.37 1.22 6.7L12 17.1l-5.97 3.27 1.22-6.7L2.5 9.3l6.6-1.04L12 2z"/></svg>' +
            'Pengelola Utama</span>'
          : '<span class="adm-badge">Admin</span>') +
        (canRemove
          ? '<button type="button" class="btn-icon danger adm-del" data-del-admin="' + esc(email) + '" title="Hapus akses admin">' + CFB.icons.trash + '</button>'
          : '') +
        '</div>';
    }).join('');
    if (emptyEl) emptyEl.hidden = all.length > 0;
    $$('#admList [data-del-admin]').forEach(b => b.addEventListener('click', () => removeAdmin(b.dataset.delAdmin)));
  }

  /* --- 3. Tambah admin (HANYA pengelola utama — langsung aktif) --- */
  function onAddAdminClick() {
    if (!isRootAdmin()) { openAccessDeniedModal(); return; }
    openAddAdminModal();
  }

  /* Modal "Akses Ditolak" — admin non-utama menekan tombol Tambah Admin */
  function openAccessDeniedModal() {
    const root = rootAdminEmail();
    const m = openModal(
      '<div class="ad-head">' +
      '  <div class="ad-icon" aria-hidden="true">' +
      '    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' +
      '  </div>' +
      '  <h3>Akses Ditolak</h3>' +
      '</div>' +
      '<p class="ad-text">Hanya <strong>pengelola utama</strong> yang dapat menambahkan admin baru pada sistem Gamaspace. Akun Anda dapat melihat daftar admin, namun tidak memiliki izin untuk menambah atau mengubahnya.</p>' +
      (root
        ? '<div class="ad-contact"><span class="ad-contact-label">Pengelola utama</span><span class="ad-contact-email">' + esc(root) + '</span></div>'
        : '') +
      '<div class="modal-actions"><button type="button" class="btn-primary" data-close>Mengerti</button></div>'
    );
    const closeBtn = m.ov.querySelector('[data-close]');
    if (closeBtn) closeBtn.addEventListener('click', m.close);
  }

  /* Modal tambah admin — khusus pengelola utama */
  function openAddAdminModal() {
    const m = openModal(
      '<div class="modal-head">' +
      '  <div><p class="modal-eyebrow">Daftar Admin</p><h3 class="modal-title">Tambah Admin Baru</h3></div>' +
      '</div>' +
      '<p class="adm-modal-sub">Masukkan email yang akan diberi akses Admin Panel. Admin baru <strong>langsung aktif</strong> tanpa proses persetujuan.</p>' +
      '<form id="addAdminForm" novalidate>' +
      '  <div class="form-row">' +
      '    <label for="newAdminEmail">Email admin</label>' +
      '    <input id="newAdminEmail" type="email" placeholder="nama@mail.ugm.ac.id" autocomplete="off" />' +
      '    <p class="field-error" id="addAdminError" hidden></p>' +
      '  </div>' +
      '  <div class="modal-actions">' +
      '    <button type="button" class="btn-ghost" data-close>Batal</button>' +
      '    <button type="submit" class="btn-primary" id="addAdminConfirm">Tambah Admin</button>' +
      '  </div>' +
      '</form>' +
      '<p class="adm-modal-note">Admin baru dapat langsung masuk melalui halaman ini. Bila belum memiliki kata sandi, gunakan tombol <strong>Daftar</strong> pada layar masuk dengan email yang sama.</p>'
    );
    const closeBtn = m.ov.querySelector('[data-close]');
    if (closeBtn) closeBtn.addEventListener('click', m.close);
    const form = m.ov.querySelector('#addAdminForm');
    const input = m.ov.querySelector('#newAdminEmail');
    if (input) {
      input.addEventListener('input', () => addAdminError('', m.ov));
      setTimeout(() => input.focus(), 120);
    }
    if (form) form.addEventListener('submit', (e) => onAddAdminConfirm(e, m));
  }

  function addAdminError(msg, rootEl) {
    const el = (rootEl || document).querySelector('#addAdminError');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  async function onAddAdminConfirm(e, m) {
    e.preventDefault();
    addAdminError('', m.ov);
    const input = m.ov.querySelector('#newAdminEmail');
    const email = String((input && input.value) || '').toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { addAdminError('Masukkan alamat email yang valid.', m.ov); return; }
    if (!rootAdminEmail()) { addAdminError('Pengelola utama belum diatur — isi rootAdminEmail pada firebase-config.js.', m.ov); return; }
    if (email === rootAdminEmail()) { addAdminError('Email ini adalah pengelola utama sistem.', m.ov); return; }
    if (email === currentEmail()) { addAdminError('Email ini adalah akun Anda sendiri.', m.ov); return; }
    if (CFB.data.getMode() !== 'firebase') { addAdminError('Penambahan admin hanya aktif saat terhubung ke server.', m.ov); return; }

    /* Cek duplikat terhadap daftar admin terkini */
    await loadAdmins();
    if (cfgAdminEmails().includes(email) || ui.adminEmailsDb.includes(email)) {
      addAdminError('Email sudah terdaftar sebagai admin — tidak boleh duplikat.', m.ov);
      return;
    }

    const btn = m.ov.querySelector('#addAdminConfirm');
    btn.disabled = true; btn.classList.add('is-loading');
    try {
      const w = await CFB.data.fbNodePut('admins/' + adminKey(email), email);
      if (!w || !w.ok) throw new Error('rules');
      m.close();
      await loadAdmins();
      renderAdmins();
      CFB.notify.success('Admin ditambahkan', email + ' kini dapat masuk ke Admin Panel.');
    } catch (err) {
      addAdminError(err.message === 'rules'
        ? 'Penyimpanan ditolak Rules — buka akses node /admins (lihat README).'
        : 'Gagal menambahkan admin. Periksa koneksi lalu coba lagi.', m.ov);
    } finally {
      btn.disabled = false; btn.classList.remove('is-loading');
    }
  }

  /* Hapus akses admin (khusus pengelola utama — tidak berlaku untuk dirinya) */
  async function removeAdmin(email) {
    if (!isRootAdmin()) { openAccessDeniedModal(); return; }
    const ok = await CFB.confirm({
      title: T('admc.rmadmin.t'),
      danger: true,
      html: T('admc.rmadmin.m', { email: esc(email) }),
      confirmText: T('c.del')
    });
    if (!ok) return;
    /* Cari semua key /admins yang menampung email ini (bisa lebih dari satu
       bila node ditulis manual) agar penghapusan selalu tepat sasaran. */
    let keys = [];
    try {
      const raw = await CFB.data.fbNodeGet('admins');
      Object.keys(raw || {}).forEach(k => {
        const v = raw[k];
        if (typeof v === 'string' && v.toLowerCase() === email) keys.push(k);
      });
    } catch (e) { /* baca node gagal → fallback key standar */ }
    if (!keys.length) keys = [adminKey(email)];
    let allOk = true;
    for (const k of keys) {
      const w = await CFB.data.fbNodePut('admins/' + encodeURIComponent(k), null);
      if (!w || !w.ok) allOk = false;
    }
    if (!allOk) {
      CFB.notify.error('Gagal menghapus', 'Penulisan node /admins ditolak Rules — periksa pengaturan database.');
      return;
    }
    await loadAdmins();
    renderAdmins();
    CFB.notify.success('Akses admin dihapus', email + ' dihapus dari daftar admin.');
  }

  /* --- 4. Petugas Lapangan (dikelola pengelola utama, node /petugas) --- */
  async function loadPetugas() {
    ui.petugasEmailsDb = [];
    if (CFB.data.getMode() !== 'firebase' || !CFB.data.fbNodeGet) return;
    try { ui.petugasEmailsDb = await fetchPetugasEmails() || []; }
    catch (e) { /* offline / Rules */ }
  }

  function petugasListAll() {
    const all = [];
    cfgPetugasEmails().concat(ui.petugasEmailsDb).forEach(e => {
      if (all.indexOf(e) < 0) all.push(e);
    });
    return all;
  }

  function renderPetugas() {
    const listEl = $('#ptgList'), emptyEl = $('#ptgEmpty'), countEl = $('#ptgCount');
    if (!listEl) return;
    const all = petugasListAll();
    if (countEl) countEl.textContent = all.length ? T('adm.ptg.count', { n: all.length }) : '';
    listEl.innerHTML = all.map(email => {
      /* Hanya petugas yang dikelola lewat database (ditambahkan pengelola
         utama) yang dapat dihapus dari antarmuka. */
      const canRemove = ui.isRoot && ui.petugasEmailsDb.includes(email) &&
        !cfgPetugasEmails().includes(email);
      return '<div class="adm-row">' +
        '  <span class="acc-email" title="' + esc(email) + '">' + esc(email) + '</span>' +
        '  <span class="adm-badge ptg">' + esc(T('role.petugas')) + '</span>' +
        (canRemove
          ? '<button type="button" class="btn-icon danger adm-del" data-del-ptg="' + esc(email) + '" title="Hapus akses petugas">' + CFB.icons.trash + '</button>'
          : '') +
        '</div>';
    }).join('');
    if (emptyEl) emptyEl.hidden = all.length > 0;
    $$('#ptgList [data-del-ptg]').forEach(b => b.addEventListener('click', () => removePetugas(b.dataset.delPtg)));
  }

  function onAddPetugasClick() {
    if (!isRootAdmin()) { openAccessDeniedModal(); return; }
    openAddPetugasModal();
  }

  function openAddPetugasModal() {
    const m = openModal(
      '<div class="modal-head">' +
      '  <div><p class="modal-eyebrow">' + esc(T('ptg.modal.eyebrow')) + '</p><h3 class="modal-title">' + esc(T('ptg.modal.title')) + '</h3></div>' +
      '</div>' +
      '<p class="adm-modal-sub">' + T('ptg.modal.sub') + '</p>' +
      '<form id="addPtgForm" novalidate>' +
      '  <div class="form-row">' +
      '    <label for="newPtgEmail">' + esc(T('ptg.modal.label')) + '</label>' +
      '    <input id="newPtgEmail" type="email" placeholder="' + esc(T('ptg.modal.ph')) + '" autocomplete="off" />' +
      '    <p class="field-hint">' + esc(T('ptg.modal.hint')) + '</p>' +
      '    <p class="field-error" id="addPtgError" hidden></p>' +
      '  </div>' +
      '  <div class="modal-actions">' +
      '    <button type="button" class="btn-ghost" data-close>Batal</button>' +
      '    <button type="submit" class="btn-primary" id="addPtgConfirm">' + esc(T('adm.ptg.add')) + '</button>' +
      '  </div>' +
      '</form>' +
      '<p class="adm-modal-note">' + T('ptg.modal.note') + '</p>'
    );
    const closeBtn = m.ov.querySelector('[data-close]');
    if (closeBtn) closeBtn.addEventListener('click', m.close);
    const form = m.ov.querySelector('#addPtgForm');
    const input = m.ov.querySelector('#newPtgEmail');
    if (input) {
      input.addEventListener('input', () => ptgError('', m.ov));
      setTimeout(() => input.focus(), 120);
    }
    if (form) form.addEventListener('submit', (e) => onAddPtgConfirm(e, m));
  }

  function ptgError(msg, rootEl) {
    const el = (rootEl || document).querySelector('#addPtgError');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  async function onAddPtgConfirm(e, m) {
    e.preventDefault();
    ptgError('', m.ov);
    const input = m.ov.querySelector('#newPtgEmail');
    const email = String((input && input.value) || '').toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { ptgError(T('ptg.err.invalid'), m.ov); return; }
    if (rootAdminEmail() && email === rootAdminEmail()) { ptgError(T('ptg.err.root'), m.ov); return; }
    if (email === currentEmail()) { ptgError(T('ptg.err.self'), m.ov); return; }
    if (CFB.data.getMode() !== 'firebase') { ptgError(T('ptg.err.local'), m.ov); return; }

    /* Cek duplikat terhadap daftar petugas & admin terkini */
    await loadAdmins();
    await loadPetugas();
    if (petugasListAll().includes(email) || adminListAll().includes(email)) {
      ptgError(T('ptg.err.dup'), m.ov);
      return;
    }

    const btn = m.ov.querySelector('#addPtgConfirm');
    btn.disabled = true; btn.classList.add('is-loading');
    try {
      const w = await CFB.data.fbNodePut('petugas/' + adminKey(email), email);
      if (!w || !w.ok) throw new Error('rules');
      m.close();
      await loadPetugas();
      renderPetugas();
      CFB.notify.success(T('ptg.toast.added.title'), T('ptg.toast.added.msg', { email: email }));
    } catch (err) {
      ptgError(err.message === 'rules'
        ? T('ptg.err.rules')
        : 'Gagal menambahkan petugas. Periksa koneksi lalu coba lagi.', m.ov);
    } finally {
      btn.disabled = false; btn.classList.remove('is-loading');
    }
  }

  /* Hapus akses petugas (khusus pengelola utama) */
  async function removePetugas(email) {
    if (!isRootAdmin()) { openAccessDeniedModal(); return; }
    const ok = await CFB.confirm({
      title: T('admc.rmptg.t'),
      danger: true,
      html: T('admc.rmptg.m', { email: esc(email) }),
      confirmText: T('c.del')
    });
    if (!ok) return;
    let keys = [];
    try {
      const raw = await CFB.data.fbNodeGet('petugas');
      Object.keys(raw || {}).forEach(k => {
        const v = raw[k];
        if (typeof v === 'string' && v.toLowerCase() === email) keys.push(k);
      });
    } catch (e) { /* baca node gagal → fallback key standar */ }
    if (!keys.length) keys = [adminKey(email)];
    let allOk = true;
    for (const k of keys) {
      const w = await CFB.data.fbNodePut('petugas/' + encodeURIComponent(k), null);
      if (!w || !w.ok) allOk = false;
    }
    if (!allOk) {
      CFB.notify.error('Gagal menghapus', 'Penulisan node /petugas ditolak Rules — periksa pengaturan database.');
      return;
    }
    await loadPetugas();
    renderPetugas();
    CFB.notify.success(T('ptg.toast.removed.title'), T('ptg.toast.removed.msg', { email: email }));
  }

  /* ============ Editor Denah Ruangan (drag & drop) ============
     Admin dapat menata layar, panggung, proyektor, sound, papan tulis,
     podium, meja, meja bundar, dan pintu; memilih susunan bangku —
     baris (teater), lingkaran, meja bundar, bentuk U — atau menatanya
     manual: setiap bangku pada mode manual dapat digeser, ditambah,
     dan dihapus satu per satu.
     Tersimpan sebagai `layout` pada objek fasilitas (Firebase / lokal). */
  async function openLayoutEditor(id) {
    /* Ambil data fasilitas terkini dari server sebelum menyunting */
    if (CFB.data.getMode() === 'firebase') { try { await CFB.data.refreshFacilities(); } catch (e) { /* offline */ } }
    const f = CFB.data.getFacilityById(id);
    if (!f) return;
    const ed = { layout: CFB.floorplan.parseLayout(f.layout), sel: null, selSeat: null };
    const PALETTE = ['screen', 'stage', 'projector', 'sound', 'whiteboard', 'podium', 'table', 'table-round', 'door'];
    const SEAT_MODES = [
      ['rows', 'Baris (teater)'],
      ['circle', 'Lingkaran'],
      ['rounds', 'Meja bundar'],
      ['utable', 'Bentuk U'],
      ['custom', 'Manual (bebas)']
    ];

    const m = openModal(
      '<div class="modal-head">' +
      '  <div><p class="modal-eyebrow">Denah Ruangan</p><h3 class="modal-title">' + esc(f.name) + '</h3></div>' +
      '</div>' +
      '<div class="le-editor">' +
      '  <div class="le-side">' +
      '    <p class="le-label">Tambah perangkat</p>' +
      '    <div class="le-palette">' +
             PALETTE.map(ty =>
               '<button type="button" class="le-add" data-type="' + ty + '">' +
               '<span class="le-ico">' + CFB.floorplan.iconSVG(ty) + '</span>' + esc(facTypeLabel(ty)) + '</button>').join('') +
      '    </div>' +
      '    <p class="le-label">Susunan bangku</p>' +
      '    <div class="form-row"><select id="le-mode" aria-label="Susunan bangku">' +
             SEAT_MODES.map(md => '<option value="' + md[0] + '"' + (ed.layout.seatMode === md[0] ? ' selected' : '') + '>' + md[1] + '</option>').join('') +
      '    </select></div>' +
      '    <div class="le-props" id="leModeProps"></div>' +
      '    <p class="le-label">Properti ruangan</p>' +
      '    <div class="le-props">' +
      '      <div class="le-props-2">' +
      '        <div class="form-row"><label for="le-w">Lebar (m)</label><input id="le-w" type="number" min="6" max="30" step="1" value="' + ed.layout.w + '"></div>' +
      '        <div class="form-row"><label for="le-h">Kedalaman (m)</label><input id="le-h" type="number" min="5" max="24" step="1" value="' + ed.layout.h + '"></div>' +
      '      </div>' +
      '    </div>' +
      '    <p class="le-label">Item terpasang</p>' +
      '    <div class="le-items" id="leItems"></div>' +
      '  </div>' +
      '  <div class="le-canvas-wrap"><div id="leCanvas" class="le-canvas"></div></div>' +
      '</div>' +
      '<p class="le-hint" id="leHint"></p>' +
      '<div class="modal-actions">' +
      '  <button type="button" class="btn-ghost" id="leClear">Kosongkan</button>' +
      '  <button type="button" class="btn-ghost le-del-btn" id="leDel" disabled>' + CFB.icons.trash + ' <span id="leDelLabel">Hapus terpilih</span></button>' +
      '  <span class="toolbar-spacer"></span>' +
      '  <button type="button" class="btn-ghost" data-close>Batal</button>' +
      '  <button type="submit" class="btn-primary" id="leSave">Simpan denah</button>' +
      '</div>', { wide: true });
    m.ov.querySelector('.modal-card').classList.add('modal-editor');

    const canvas = m.ov.querySelector('#leCanvas');
    const delBtn = m.ov.querySelector('#leDel');
    const delLabel = m.ov.querySelector('#leDelLabel');
    const modeProps = m.ov.querySelector('#leModeProps');
    const hintEl = m.ov.querySelector('#leHint');

    function facTypeLabel(ty) {
      const map = { screen: 'Layar', stage: 'Panggung', projector: 'Proyektor', sound: 'Sound', whiteboard: 'Papan tulis', podium: 'Podium', table: 'Meja', 'table-round': 'Meja bundar', door: 'Pintu' };
      return map[ty] || ty;
    }

    function r2(n) { return Math.round(Number(n) * 2) / 2; }

    const HINTS = {
      rows: 'Bangku otomatis tersusun baris menghadap area depan — atur jumlahnya di samping.',
      circle: 'Bangku otomatis membentuk lingkaran menghadap pusat ruangan.',
      rounds: 'Meja bundar dengan kursi melingkar di sekeliling setiap meja — atur jumlah meja dan kursi per meja.',
      utable: 'Bangku tersusun membentuk huruf U yang terbuka ke area depan.',
      custom: 'Bangku manual: tarik untuk memindahkan, klik untuk memilih lalu hapus, atau gunakan tombol Tambah bangku.'
    };

    /* --- Properti sesuai mode susunan bangku (dirender ulang saat ganti mode) --- */
    function renderModeProps() {
      const mode = ed.layout.seatMode;
      let html = '';
      if (mode === 'rounds') {
        html =
          '<div class="le-props-2">' +
          '  <div class="form-row"><label for="le-rt">Jumlah meja</label><input id="le-rt" type="number" min="1" max="12" step="1" value="' + ed.layout.roundTables + '"></div>' +
          '  <div class="form-row"><label for="le-rpc">Kursi per meja</label><input id="le-rpc" type="number" min="3" max="12" step="1" value="' + ed.layout.roundChairs + '"></div>' +
          '</div>' +
          '<button type="button" class="le-mini" id="leToManual">Ubah ke susunan manual</button>';
      } else if (mode === 'custom') {
        html =
          '<p class="le-count-note" id="leSeatCount"></p>' +
          '<button type="button" class="le-mini" id="leAddSeat">+ Tambah bangku</button>';
      } else {
        html =
          '<div class="form-row"><label for="le-seats">Jumlah bangku</label><input id="le-seats" type="number" min="0" max="2000" step="1" value="' + ed.layout.seats + '"></div>' +
          '<button type="button" class="le-mini" id="leToManual">Ubah ke susunan manual</button>';
      }
      modeProps.innerHTML = html;
      hintEl.textContent = HINTS[mode] || '';

      const seatsIn = modeProps.querySelector('#le-seats');
      if (seatsIn) seatsIn.addEventListener('input', () => {
        ed.layout.seats = Math.min(2000, Math.max(0, parseInt(seatsIn.value, 10) || 0));
        repaint();
      });
      const rtIn = modeProps.querySelector('#le-rt');
      if (rtIn) rtIn.addEventListener('change', () => {
        ed.layout.roundTables = Math.min(12, Math.max(1, parseInt(rtIn.value, 10) || 4));
        rtIn.value = ed.layout.roundTables;
        repaint();
      });
      const rpcIn = modeProps.querySelector('#le-rpc');
      if (rpcIn) rpcIn.addEventListener('change', () => {
        ed.layout.roundChairs = Math.min(12, Math.max(3, parseInt(rpcIn.value, 10) || 8));
        rpcIn.value = ed.layout.roundChairs;
        repaint();
      });
      const toMan = modeProps.querySelector('#leToManual');
      if (toMan) toMan.addEventListener('click', () => convertToManual());
      const addSeat = modeProps.querySelector('#leAddSeat');
      if (addSeat) addSeat.addEventListener('click', () => {
        if (ed.layout.seatsCustom.length >= 300) { CFB.notify.warning('Bangku penuh', 'Maksimal 300 bangku manual per denah.'); return; }
        ed.layout.seatsCustom.push({ x: r2(ed.layout.w / 2), y: r2(ed.layout.h / 2), rot: 0 });
        ed.sel = null;
        ed.selSeat = ed.layout.seatsCustom.length - 1;
        repaint();
      });
      updateSeatCount();
    }

    function updateSeatCount() {
      const el = modeProps.querySelector('#leSeatCount');
      if (el) el.textContent = ed.layout.seatsCustom.length + ' bangku ditata manual';
    }

    /* Pindah ke mode manual: susunan berjalan dibekukan menjadi daftar bangku
       yang dapat digeser satu per satu; meja bundar otomatis (mode rounds)
       ikut menjadi item agar tetap terlihat dan bisa dipindah. */
    function convertToManual() {
      const pos = CFB.floorplan.seatPositions(ed.layout);
      ed.layout.seatsCustom = pos.seats.map(p => ({ x: r2(p.x), y: r2(p.y), rot: Math.round(p.rot) || 0 }));
      if (ed.layout.seatMode === 'rounds' && pos.tables.length) {
        pos.tables.forEach(t => {
          if (ed.layout.items.length < 40) ed.layout.items.push({ type: 'table-round', x: r2(t.x), y: r2(t.y), rot: 0 });
        });
      }
      ed.layout.seatMode = 'custom';
      ed.layout.seats = ed.layout.seatsCustom.length;
      ed.selSeat = null;
      const ms = m.ov.querySelector('#le-mode');
      if (ms) ms.value = 'custom';
      renderModeProps();
      repaint();
    }

    function repaint() {
      canvas.innerHTML = CFB.floorplan.render(ed.layout, { interactive: true, uid: 'fp-edit', selected: ed.sel, selSeat: ed.selSeat }).svg;
      const hasSel = (ed.sel != null || ed.selSeat != null);
      delBtn.disabled = !hasSel;
      delLabel.textContent = ed.selSeat != null ? 'Hapus bangku' : 'Hapus item';
      if (ed.layout.seatMode === 'custom') updateSeatCount();
      // daftar item
      const list = m.ov.querySelector('#leItems');
      list.innerHTML = ed.layout.items.length
        ? ed.layout.items.map((it, i) =>
          '<div class="le-item' + (ed.sel === i ? ' on' : '') + '" data-idx="' + i + '">' +
          '  <span>' + esc(facTypeLabel(it.type)) + ' <small>(' + it.x + ', ' + it.y + ')</small></span>' +
          '  <button type="button" class="btn-icon danger" data-rm="' + i + '" title="Hapus">' + CFB.icons.close + '</button>' +
          '</div>').join('')
        : '<p class="le-empty">Belum ada item — tambahkan dari palet.</p>';
      bindCanvas();
      list.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => {
        const idx = +b.dataset.rm;
        ed.layout.items.splice(idx, 1);
        if (ed.sel === idx) ed.sel = null;
        repaint();
      }));
      list.querySelectorAll('.le-item').forEach(el => el.addEventListener('click', (e) => {
        if (e.target.closest('[data-rm]')) return;
        ed.sel = +el.dataset.idx;
        ed.selSeat = null;
        repaint();
      }));
    }

    function bindCanvas() {
      canvas.querySelectorAll('.fp-item').forEach(g => {
        g.addEventListener('pointerdown', (ev) => startDrag(ev, +g.dataset.idx));
      });
      canvas.querySelectorAll('.fp-seat').forEach(g => {
        g.addEventListener('pointerdown', (ev) => startDragSeat(ev, +g.dataset.seat));
      });
    }

    function startDrag(ev, idx) {
      ev.preventDefault();
      ed.sel = idx;
      ed.selSeat = null;
      repaint();
      const g = canvas.querySelector('.fp-item[data-idx="' + idx + '"]');
      if (!g) return;
      g.setPointerCapture && g.setPointerCapture(ev.pointerId);
      const rect = canvas.getBoundingClientRect();
      const scale = rect.width / (ed.layout.w * CFB.floorplan.S);
      const it = ed.layout.items[idx];
      const offX = (ev.clientX - rect.left) / scale / CFB.floorplan.S - it.x;
      const offY = (ev.clientY - rect.top) / scale / CFB.floorplan.S - it.y;
      canvas.classList.add('dragging');

      const move = (e2) => {
        const nx = Math.min(ed.layout.w, Math.max(0, (e2.clientX - rect.left) / scale / CFB.floorplan.S - offX));
        const ny = Math.min(ed.layout.h, Math.max(0, (e2.clientY - rect.top) / scale / CFB.floorplan.S - offY));
        it.x = Math.round(nx * 2) / 2;
        it.y = Math.round(ny * 2) / 2;
        g.setAttribute('transform', 'translate(' + (it.x * CFB.floorplan.S) + ' ' + (it.y * CFB.floorplan.S) + ') rotate(' + it.rot + ')');
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        canvas.classList.remove('dragging');
        repaint();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }

    /* Geser bangku tunggal (mode manual) — posisi dibulatkan 0,5 m */
    function startDragSeat(ev, idx) {
      ev.preventDefault();
      ed.selSeat = idx;
      ed.sel = null;
      repaint();
      const g = canvas.querySelector('.fp-seat[data-seat="' + idx + '"]');
      if (!g) return;
      g.setPointerCapture && g.setPointerCapture(ev.pointerId);
      const rect = canvas.getBoundingClientRect();
      const scale = rect.width / (ed.layout.w * CFB.floorplan.S);
      const st = ed.layout.seatsCustom[idx];
      const offX = (ev.clientX - rect.left) / scale / CFB.floorplan.S - st.x;
      const offY = (ev.clientY - rect.top) / scale / CFB.floorplan.S - st.y;
      canvas.classList.add('dragging');

      const move = (e2) => {
        const nx = Math.min(ed.layout.w, Math.max(0, (e2.clientX - rect.left) / scale / CFB.floorplan.S - offX));
        const ny = Math.min(ed.layout.h, Math.max(0, (e2.clientY - rect.top) / scale / CFB.floorplan.S - offY));
        st.x = Math.round(nx * 2) / 2;
        st.y = Math.round(ny * 2) / 2;
        g.setAttribute('transform', 'translate(' + (st.x * CFB.floorplan.S) + ' ' + (st.y * CFB.floorplan.S) + ')' + (st.rot ? ' rotate(' + st.rot + ')' : ''));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        canvas.classList.remove('dragging');
        repaint();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }

    m.ov.querySelectorAll('.le-add').forEach(b => b.addEventListener('click', () => {
      const ty = b.dataset.type;
      if (ed.layout.items.length >= 40) { CFB.notify.warning('Item penuh', 'Maksimal 40 item per denah.'); return; }
      const n = ed.layout.items.length;
      ed.layout.items.push({ type: ty, x: (ed.layout.w / 2 + (n % 5) * 0.5) % ed.layout.w, y: ed.layout.h / 2 + Math.floor(n / 5) * 0.6, rot: 0 });
      ed.sel = ed.layout.items.length - 1;
      ed.selSeat = null;
      repaint();
    }));

    /* Ganti mode susunan bangku — ke manual mempertahankan susunan berjalan */
    const modeSel = m.ov.querySelector('#le-mode');
    modeSel.addEventListener('change', () => {
      ed.layout.seatMode = modeSel.value;
      ed.selSeat = null;
      if (ed.layout.seatMode === 'custom' && !ed.layout.seatsCustom.length) {
        convertToManual();
        return;
      }
      renderModeProps();
      repaint();
    });

    const wIn = m.ov.querySelector('#le-w');
    const hIn = m.ov.querySelector('#le-h');
    wIn.addEventListener('change', () => { ed.layout.w = Math.min(30, Math.max(6, parseInt(wIn.value, 10) || 12)); wIn.value = ed.layout.w; repaint(); });
    hIn.addEventListener('change', () => { ed.layout.h = Math.min(24, Math.max(5, parseInt(hIn.value, 10) || 8)); hIn.value = ed.layout.h; repaint(); });

    delBtn.addEventListener('click', () => {
      if (ed.selSeat != null) {
        ed.layout.seatsCustom.splice(ed.selSeat, 1);
        ed.selSeat = null;
      } else if (ed.sel != null) {
        ed.layout.items.splice(ed.sel, 1);
        ed.sel = null;
      } else return;
      repaint();
    });
    m.ov.querySelector('#leClear').addEventListener('click', () => {
      ed.layout.items = [];
      ed.layout.seats = 0;
      ed.layout.seatsCustom = [];
      ed.sel = null;
      ed.selSeat = null;
      renderModeProps();
      repaint();
    });
    const onKey = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if ((ed.sel != null || ed.selSeat != null) && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
          if (ed.selSeat != null) { ed.layout.seatsCustom.splice(ed.selSeat, 1); ed.selSeat = null; }
          else { ed.layout.items.splice(ed.sel, 1); ed.sel = null; }
          repaint();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const origClose = m.close;
    m.close = () => { document.removeEventListener('keydown', onKey); origClose(); };

    m.ov.querySelector('[data-close]').addEventListener('click', m.close);
    m.ov.querySelector('#leSave').addEventListener('click', async () => {
      const btn = m.ov.querySelector('#leSave');
      btn.disabled = true;
      btn.textContent = 'Menyimpan…';
      const obj = Object.assign({}, f, { layout: CFB.floorplan.parseLayout(ed.layout) });
      const res = await CFB.data.saveFacility(obj);
      btn.disabled = false;
      btn.textContent = 'Simpan denah';
      if (!res.ok) { CFB.notify.error('Gagal menyimpan denah', res.error); return; }
      m.close();
      CFB.notify.success('Denah tersimpan', obj.id + ' · denah ' + f.name + ' kini tampil di halaman detail fasilitas.');
      renderFacilities();
    });

    renderModeProps();
    repaint();
    setTimeout(() => { const s0 = m.ov.querySelector('#le-seats'); if (s0) s0.focus(); }, 80);
  }

  function openFacilityModal(id) {
    const f = id ? CFB.data.getFacilityById(id) : null;
    const m = openModal(
      '<div class="modal-head">' +
      '  <div><p class="modal-eyebrow">' + (f ? 'Ubah Fasilitas' : 'Fasilitas Baru') + '</p>' +
      '  <h3 class="modal-title">' + (f ? esc(f.name) : 'Tambah fasilitas baru') + '</h3></div>' +
      '</div>' +
      '<form id="facForm" novalidate>' +
      '  <div class="form-grid-2">' +
      '    <div class="form-row"><label for="af-name">Nama Fasilitas <span class="req">*</span></label>' +
      '      <input id="af-name" type="text" maxlength="60" value="' + esc(f ? f.name : '') + '">' +
      '      <p class="field-error" data-error-for="af-name"></p></div>' +
      '    <div class="form-row"><label for="af-category">Kategori <span class="req">*</span></label>' +
      '      <select id="af-category">' + CATEGORIES.map(c =>
            '<option value="' + esc(c) + '"' + (f && f.category === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
      '      </select></div>' +
      '  </div>' +
      '  <div class="form-grid-2">' +
      '    <div class="form-row"><label for="af-location">Lokasi <span class="req">*</span></label>' +
      '      <input id="af-location" type="text" maxlength="60" placeholder="contoh: Gedung Utama Lt. 2" value="' + esc(f ? f.location : '') + '">' +
      '      <p class="field-error" data-error-for="af-location"></p></div>' +
      '    <div class="form-row"><label for="af-capacity">Kapasitas (orang) <span class="req">*</span></label>' +
      '      <input id="af-capacity" type="number" min="1" max="2000" value="' + (f ? f.capacity : '') + '">' +
      '      <p class="field-error" data-error-for="af-capacity"></p></div>' +
      '  </div>' +
      '  <div class="form-grid-2">' +
      '    <div class="form-row"><label for="af-open-start">Jam buka <span class="req">*</span></label>' +
      '      <input id="af-open-start" type="time" value="' + (f ? f.openHours.start : '08:00') + '"></div>' +
      '    <div class="form-row"><label for="af-open-end">Jam tutup <span class="req">*</span></label>' +
      '      <input id="af-open-end" type="time" value="' + (f ? f.openHours.end : '16:00') + '">' +
      '      <p class="field-error" data-error-for="af-hours"></p></div>' +
      '  </div>' +
      '  <div class="form-row"><label for="af-status">Status</label>' +
      '    <select id="af-status">' +
      '      <option value="Available"' + (f && f.status === 'Available' ? ' selected' : '') + '>Tersedia</option>' +
      '      <option value="Limited"' + (f && f.status === 'Limited' ? ' selected' : '') + '>Terbatas</option>' +
      '      <option value="Unavailable"' + (f && f.status === 'Unavailable' ? ' selected' : '') + '>Tidak Tersedia</option>' +
      '    </select></div>' +
      '  <div class="form-row"><label for="af-facilities">Perangkat &amp; fasilitas pendukung <span class="opt">(pisahkan dengan koma)</span></label>' +
      '    <input id="af-facilities" type="text" maxlength="200" placeholder="contoh: Projector, AC, Wi-Fi" value="' + esc(f ? (f.facilities || []).join(', ') : '') + '"></div>' +
      '  <div class="form-row"><label for="af-desc">Deskripsi</label>' +
      '    <textarea id="af-desc" rows="2" maxlength="300">' + esc(f ? (f.description || '') : '') + '</textarea></div>' +
      '  <div class="modal-actions">' +
      '    <button type="button" class="btn-ghost" data-close>Batal</button>' +
      '    <button type="submit" class="btn-primary">Simpan fasilitas</button>' +
      '  </div>' +
      '</form>', { wide: true });

    m.ov.querySelector('[data-close]').addEventListener('click', m.close);
    const form = m.ov.querySelector('#facForm');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = (sel) => m.ov.querySelector(sel).value.trim();
      const num = (sel) => parseInt(m.ov.querySelector(sel).value, 10);
      const err = (name, msg) => {
        const p = m.ov.querySelector('[data-error-for="' + name + '"]');
        const input = m.ov.querySelector('#' + name);
        if (p) p.textContent = msg || '';
        if (input) input.classList.toggle('invalid', !!msg);
      };
      let ok = true;
      const name = val('#af-name'), location = val('#af-location');
      const capacity = num('#af-capacity');
      const start = m.ov.querySelector('#af-open-start').value || '08:00';
      const end = m.ov.querySelector('#af-open-end').value || '16:00';
      err('af-name', ''); err('af-location', ''); err('af-capacity', ''); err('af-hours', '');
      if (name.length < 3) { err('af-name', 'Nama minimal 3 karakter'); ok = false; }
      if (location.length < 3) { err('af-location', 'Lokasi minimal 3 karakter'); ok = false; }
      if (!capacity || capacity < 1 || capacity > 2000) { err('af-capacity', 'Kapasitas 1 - 2000'); ok = false; }
      if (parseInt(start.split(':')[0], 10) >= parseInt(end.split(':')[0], 10)) { err('af-hours', 'Jam tutup harus setelah jam buka'); ok = false; }
      if (!ok) {
        CFB.notify.error('Form belum lengkap', 'Periksa kembali isian yang ditandai merah.');
        return;
      }

      const obj = {
        id: f ? f.id : CFB.data.nextFacilityId(),
        name, location, capacity,
        category: m.ov.querySelector('#af-category').value,
        status: m.ov.querySelector('#af-status').value,
        facilities: val('#af-facilities').split(',').map(s => s.trim()).filter(Boolean),
        description: val('#af-desc'),
        openHours: { start, end }
      };
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Menyimpan\u2026';
      const res = await CFB.data.saveFacility(obj);
      if (!res.ok) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Simpan fasilitas';
        CFB.notify.error('Gagal menyimpan fasilitas', res.error);
        return;
      }
      m.close();
      CFB.notify.success(f ? 'Fasilitas diperbarui' : 'Fasilitas ditambahkan',
        obj.id + ' · ' + obj.name + (CFB.data.getMode() === 'firebase'
          ? ' — terlihat oleh semua pengguna.'
          : ' — langsung terlihat di sisi pengguna.'));
      renderFacilities();
    });
    setTimeout(() => m.ov.querySelector('#af-name').focus(), 80);
  }

  async function deleteFacility(id) {
    const f = CFB.data.getFacilityById(id);
    if (!f) return;
    const used = CFB.data.getBookings().filter(b => b.facilityId === id).length;
    const ok = await CFB.confirm({
      title: T('admc.delfac.t'),
      danger: true,
      html: T('admc.delfac.m', { name: esc(f.name), id: esc(id), target: CFB.data.getMode() === 'firebase' ? T('admc.delfac.server') : T('admc.delfac.local') }) +
        (used ? ' ' + T('admc.delfac.used', { n: used }) : ''),
      confirmText: T('c.del')
    });
    if (!ok) return;
    const res = await CFB.data.deleteFacility(id);
    if (!res.ok) { CFB.notify.error('Gagal menghapus fasilitas', res.error); return; }
    CFB.notify.info('Fasilitas dihapus', id + ' tidak lagi tampil di sisi pengguna.');
    renderFacilities();
  }

  async function resetToSeed() {
    const fb = CFB.data.getMode() === 'firebase';
    const ok = await CFB.confirm({
      title: T('admc.reset.t'),
      html: fb ? T('admc.reset.fb') : T('admc.reset.local'),
      confirmText: T('admc.reset.yes')
    });
    if (!ok) return;
    const res = await CFB.data.resetFacilities();
    if (!res.ok) { CFB.notify.error('Gagal reset', res.error); return; }
    CFB.notify.success('Data direset',
      res.target === 'firebase'
        ? 'Fasilitas di server dikembalikan ke data awal.'
        : 'Kembali ke data awal dari data/facilities.json.');
    renderFacilities();
  }

  /* ============ Ekspor Laporan Admin — CSV & PDF (Task 9) ============
     CSV  : JavaScript murni (Blob), pemisah ';' + BOM → ramah Excel ID.
     PDF  : jsPDF + autotable dimuat dari CDN; bila CDN tak terjangkau,
     jatuh ke jendela cetak (Simpan sebagai PDF dari dialog cetak). */
  function pad2(n) { return String(n).padStart(2, '0'); }

  function expStamp() {
    const d = CFB.util.nowWIB();          // penamaan berkas memakai WIB
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes());
  }

  function fmtDT(iso) {
    return CFB.util.fmtDateTime(iso);     // selalu WIB
  }

  /* Format ringkas khusus PDF — kolom sempit agar semua muat tanpa
     terpotong: tanggal "30 Okt 2026", waktu "29/10/26 18:00". */
  function expDateShort(iso) {
    try {
      const p = CFB.util.dateParts(iso);
      return p.date + ' ' + p.month + ' ' + iso.slice(0, 4);
    } catch (e) { return String(iso || ''); }
  }
  function expDTShort(iso) {
    const d = new Date(iso);
    if (!iso || isNaN(d)) return '';
    /* Geser ke WIB (UTC+7) — laporan tidak terpengaruh zona waktu perangkat */
    const w = new Date(d.getTime() + (420 + d.getTimezoneOffset()) * 60000);
    return pad2(w.getDate()) + '/' + pad2(w.getMonth() + 1) + '/' + String(w.getFullYear()).slice(2) +
      ' ' + pad2(w.getHours()) + ':' + pad2(w.getMinutes());
  }

  /* Putus token panjang tanpa spasi (email / NIM) bila melebihi batas kolom:
     sisipkan spasi setelah pembatas alami (email: “@”, NIM: “/”) sehingga
     jsPDF dapat memotong barisnya. Email panjang terpecah rapi menjadi
     bagian-awal@ dan domain pada baris kedua. */
  function pdfWrapToken(s, maxChars, seps) {
    s = String(s || '');
    if (s.length <= maxChars) return s;
    const re = new RegExp('([' + seps.replace(/[^\w@./-]/g, '') + '])', 'g');
    return s.replace(re, '$1 ').replace(/\s+/g, ' ').trim();
  }

  function expRows() {
    return CFB.data.getBookings()
      .slice()
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .map(b => ({
        id: b.id, facility: b.facilityName, category: b.category || '', location: b.location,
        date: b.dateLabel || b.date, slot: (b.slotLabel || '') + ' WIB', dur: b.durationHours || 2,
        status: STATUS_LABEL[b.status] || b.status, statusKey: b.status || 'Pending',
        statusShort: EXP_STATUS_SHORT[b.status] || b.status || '',
        checkinCode: b.checkinCode || '',
        dateShort: expDateShort(b.date),
        slotShort: String(b.slotLabel || '').replace(/\s/g, ''),
        createdShort: expDTShort(b.createdAt),
        name: b.name, nim: b.nim, email: b.email, phone: b.phone,
        participants: b.participants, organization: b.organization || '',
        purpose: b.purpose || '', notes: b.notes || '',
        created: fmtDT(b.createdAt), decided: b.decidedAt ? fmtDT(b.decidedAt) : '',
        rejectReason: b.rejectReason || '', cancelReason: b.cancelReason || '', account: b.accountEmail || (b.uid ? 'uid:' + b.uid : '')
      }));
  }

  function updateExportButtons(bookings) {
    const n = (bookings || CFB.data.getBookings()).length;
    const btn = $('#expBtn');
    if (btn) {
      btn.disabled = !n;
      btn.title = n ? 'Unduh laporan ' + n + ' pengajuan — PDF atau CSV' : 'Belum ada pengajuan untuk diekspor';
    }
  }

  /* Toggle menu ekspor (PDF / CSV dalam satu tombol) */
  function setExportMenu(open) {
    const menu = $('#exportMenu'), wrap = $('#exportWrap'), btn = $('#expBtn');
    if (!menu) return;
    menu.hidden = !open;
    if (wrap) wrap.classList.toggle('open', open);
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function downloadBlob(content, mime, filename) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function csvCell(v) {
    return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  }

  function exportCSV() {
    const rows = expRows();
    if (!rows.length) return;
    const head = ['No', 'Referensi', 'Fasilitas', 'Kategori', 'Lokasi', 'Tanggal', 'Jam', 'Durasi (jam)', 'Status',
      'Nama', 'NIM', 'Email', 'Telepon', 'Peserta', 'Organisasi', 'Tujuan', 'Catatan', 'Diajukan', 'Diputuskan',
      'Alasan penolakan', 'Alasan pembatalan', 'Kode check-in', 'Akun'];
    const lines = [head.map(csvCell).join(';')];
    rows.forEach((r, i) => {
      lines.push([
        i + 1, r.id, r.facility, r.category, r.location, r.date, r.slot, r.dur, r.status,
        r.name, r.nim, r.email, r.phone, r.participants, r.organization, r.purpose, r.notes,
        r.created, r.decided, r.rejectReason, r.cancelReason, r.checkinCode || '', r.account
      ].map(csvCell).join(';'));
    });
    const fname = 'laporan-pengajuan-' + expStamp() + '.csv';
    downloadBlob('\ufeff' + lines.join('\r\n'), 'text/csv;charset=utf-8', fname);
    CFB.notify.success('Laporan CSV terunduh', rows.length + ' pengajuan · ' + fname);
  }

  /* --- PDF: muat jsPDF + autotable dari CDN (sekali), fallback cetak --- */
  const PDF_CDN = [
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
  ];
  let pdfLibPromise = null;

  function loadScript(src, timeoutMs) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      const timer = setTimeout(() => { s.remove(); reject(new Error('timeout')); }, timeoutMs || 8000);
      s.onload = () => { clearTimeout(timer); resolve(); };
      s.onerror = () => { clearTimeout(timer); s.remove(); reject(new Error('load-error')); };
      document.head.appendChild(s);
    });
  }

  function ensurePdfLib() {
    if (pdfLibPromise) return pdfLibPromise;
    pdfLibPromise = (async () => {
      if (!(window.jspdf && window.jspdf.__cfb)) {
        await loadScript(PDF_CDN[0]);
        await loadScript(PDF_CDN[1]);
        window.jspdf.__cfb = true;
      }
    })().catch(e => { pdfLibPromise = null; throw e; });
    return pdfLibPromise;
  }

  function exportPDF() {
    const rows = expRows();
    if (!rows.length) return;
    const btn = $('#expBtn');
    if (btn) { btn.disabled = true; btn.classList.add('is-loading'); }
    ensurePdfLib().then(() => {
      buildPdf(rows);
      CFB.notify.success('Laporan PDF terunduh', rows.length + ' pengajuan · ' + 'laporan-pengajuan-' + expStamp() + '.pdf');
    }).catch(() => {
      printFallback(rows);   // CDN tak terjangkau → dialog cetak (Simpan sebagai PDF)
    }).finally(() => {
      if (btn) btn.classList.remove('is-loading');
      updateExportButtons();
    });
  }

  const STATUS_RGB = { Pending: [217, 119, 6], Approved: [22, 163, 74], Rejected: [220, 38, 38],
    'Checked-in': [29, 78, 216], 'Selesai': [13, 148, 136], 'Cancelled': [100, 116, 139] };
  /* Peta balik label ringkas → kunci status (deteksi warna sel PDF) */
  const REVERSE_STATUS = {};
  Object.keys(EXP_STATUS_SHORT).forEach(k => { REVERSE_STATUS[EXP_STATUS_SHORT[k]] = k; });

  /* Lebar kolom PDF (mm, landscape A4, margin kiri/kanan 9 → konten 279).
     SEMUA kolom diberi lebar eksplisit agar kolom Peminjam/NIM/Email tidak
     terjepit (bug lama: kolom 5-8 dibuat auto → Peminjam hanya 3,5 mm dan
     nama terpotong per huruf). Total lebar = 277 mm ≤ 279 mm. */
  function buildPdf(rows) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const generated = CFB.util.fmtDateTime(new Date().toISOString());   // WIB
    const nPend = rows.filter(r => r.statusKey === 'Pending').length;
    const nApp = rows.filter(r => r.statusKey === 'Approved').length;
    const nRej = rows.filter(r => r.statusKey === 'Rejected').length;
    const nCk = rows.filter(r => r.statusKey === 'Checked-in').length;
    const nDone = rows.filter(r => r.statusKey === 'Selesai').length;
    const nCancel = rows.filter(r => r.statusKey === 'Cancelled').length;

    // Header biru — tanpa menyebut sumber data (teks teknis disembunyikan)
    doc.setFillColor(30, 58, 138);
    doc.rect(0, 0, 297, 20, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text('Laporan Pengajuan Peminjaman', 12, 8.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text('Gamaspace  \u00b7  Dibuat: ' + generated, 12, 15);

    // KPI ringkas
    doc.setTextColor(51, 65, 85);
    doc.setFontSize(10);
    doc.text('Total ' + rows.length + ' pengajuan    |    Menunggu ' + nPend + '    |    Disetujui ' + nApp +
      '    |    Berlangsung ' + nCk + '    |    Selesai ' + nDone + '    |    Ditolak ' + nRej + '    |    Batal ' + nCancel, 12, 28);

    // Tabel utama (seluruh pengajuan) — nilai ringkas, lebar kolom eksplisit
    doc.autoTable({
      startY: 32,
      margin: { left: 9, right: 9, top: 24, bottom: 16 },
      head: [['Referensi', 'Fasilitas', 'Tanggal', 'Jam (WIB)', 'Status', 'Peminjam', 'NIM', 'Email', 'Pes.', 'Organisasi', 'Diajukan']],
      body: rows.map(r => [
        r.id, r.facility,
        r.dateShort, r.slotShort, r.statusShort,
        r.name, pdfWrapToken(r.nim, 20, '/'), pdfWrapToken(r.email, 33, '@'),
        r.participants, r.organization, r.createdShort
      ]),
      styles: { fontSize: 7, cellPadding: 1.7, lineColor: [226, 232, 240], lineWidth: 0.2, textColor: [51, 65, 85], overflow: 'linebreak' },
      headStyles: { fillColor: [30, 58, 138], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
      alternateRowStyles: { fillColor: [244, 247, 252] },
      columnStyles: {
        0: { cellWidth: 28 },   // Referensi (17 kar.)
        1: { cellWidth: 30 },   // Fasilitas (spasi → wrap 2 baris bila perlu)
        2: { cellWidth: 24 },   // Tanggal "30 Okt 2026"
        3: { cellWidth: 21 },   // Jam "09:00–11:00"
        4: { cellWidth: 19 },   // Status ringkas + warna
        5: { cellWidth: 28 },   // Peminjam (kata terpanjang ~8 kar.)
        6: { cellWidth: 28 },   // NIM 18-19 kar. UGM muat 1 baris; >20 wrap
        7: { cellWidth: 41, fontSize: 6, cellPadding: 1.5 }, // Email 6pt
        8: { cellWidth: 10, halign: 'center' },               // Peserta
        9: { cellWidth: 24 },   // Organisasi (wrap spasi)
        10: { cellWidth: 24 }   // "29/10/26 18:00"
      },
      didParseCell: d => {
        if (d.section === 'body' && d.column.index === 4) {
          const key = REVERSE_STATUS[String(d.cell.raw).trim()] || 'Pending';
          d.cell.styles.textColor = STATUS_RGB[key] || STATUS_RGB.Pending;
          d.cell.styles.fontStyle = 'bold';
        }
      },
      didDrawPage: d => {
        const page = doc.getNumberOfPages();
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139);
        doc.text('Halaman ' + page + ' \u00b7 Laporan pengajuan \u2014 dibuat ' + generated, 12, 205);
        doc.text('Gamaspace', 288, 205, { align: 'right' });
      }
    });

    // Ringkasan per fasilitas
    const byFac = {};
    const facOrder = [];
    rows.forEach(r => {
      if (!byFac[r.facility]) { byFac[r.facility] = { t: 0, p: 0, a: 0, ck: 0, dn: 0, rj: 0, cx: 0 }; facOrder.push(r.facility); }
      const o = byFac[r.facility];
      o.t++;
      if (r.statusKey === 'Pending') o.p++;
      else if (r.statusKey === 'Approved') o.a++;
      else if (r.statusKey === 'Checked-in') o.ck++;
      else if (r.statusKey === 'Selesai') o.dn++;
      else if (r.statusKey === 'Rejected') o.rj++;
      else if (r.statusKey === 'Cancelled') o.cx++;
    });
    let y = doc.lastAutoTable.finalY + 8;
    if (y > 165) { doc.addPage(); y = 24; }
    doc.setTextColor(30, 58, 138);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
    doc.text('Ringkasan per fasilitas', 12, y);
    doc.autoTable({
      startY: y + 4,
      margin: { left: 9, right: 9, top: 24, bottom: 16 },
      head: [['Fasilitas', 'Total', 'Menunggu', 'Disetujui', 'Berlangsung', 'Selesai', 'Ditolak', 'Batal']],
      body: facOrder.map(f => [f, byFac[f].t, byFac[f].p, byFac[f].a, byFac[f].ck, byFac[f].dn, byFac[f].rj, byFac[f].cx]),
      styles: { fontSize: 8, cellPadding: 1.8, lineColor: [226, 232, 240], lineWidth: 0.2, textColor: [51, 65, 85] },
      headStyles: { fillColor: [30, 58, 138], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [244, 247, 252] },
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center' }, 5: { halign: 'center' }, 6: { halign: 'center' }, 7: { halign: 'center' } }
    });

    doc.save('laporan-pengajuan-' + expStamp() + '.pdf');
  }

  /* Fallback: dialog cetak browser (pengguna memilih "Simpan sebagai PDF"). */
  function printFallback(rows) {
    const w = window.open('', '_blank', 'width=980,height=720');
    if (!w) {
      CFB.notify.warning('Popup diblokir', 'Izinkan popup untuk pratinjau cetak, atau gunakan tombol Ekspor CSV.');
      return;
    }
    const nPend = rows.filter(r => r.statusKey === 'Pending').length;
    const nApp = rows.filter(r => r.statusKey === 'Approved').length;
    const nRej = rows.filter(r => r.statusKey === 'Rejected').length;
    const nCk = rows.filter(r => r.statusKey === 'Checked-in').length;
    const nDone = rows.filter(r => r.statusKey === 'Selesai').length;
    const nCancel = rows.filter(r => r.statusKey === 'Cancelled').length;
    const generated = CFB.util.fmtDateTime(new Date().toISOString());   // WIB
    const trs = rows.map(r =>
      '<tr><td>' + esc(r.id) + '</td><td>' + esc(r.facility) + '</td><td>' + esc(r.dateShort) + '</td><td>' + esc(r.slotShort) +
      '</td><td class="st st-' + String(r.statusKey).toLowerCase() + '">' + esc(r.statusShort) + '</td><td>' + esc(r.name) +
      '</td><td>' + esc(r.nim) + '</td><td>' + esc(r.email) + '</td><td>' + r.participants + '</td><td>' + esc(r.organization) +
      '</td><td>' + esc(r.createdShort) + '</td></tr>').join('');
    w.document.write(
      '<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>Laporan Pengajuan Peminjaman — Gamaspace</title>' +
      '<style>' +
      'body{font-family:Arial,Helvetica,sans-serif;color:#334155;margin:24px;font-size:12px}' +
      'h1{color:#1E3A8A;font-size:18px;margin:0 0 4px}.meta{color:#64748B;font-size:11px;margin-bottom:14px}' +
      '.kpi{margin:0 0 14px;font-size:12px}' +
      'table{border-collapse:collapse;width:100%}' +
      'th{background:#1E3A8A;color:#fff;padding:5px 7px;text-align:left;font-size:10.5px}' +
      'td{border-bottom:1px solid #E2E8F0;padding:4px 7px;font-size:10.5px;vertical-align:top;overflow-wrap:anywhere}' +
      'tr:nth-child(even) td{background:#F4F7FC}' +
      '.st{font-weight:bold}.st-pending{color:#D97706}.st-approved{color:#16A34A}.st-rejected{color:#DC2626}' +
      '.st-checked-in{color:#1D4ED8}.st-selesai{color:#0D9488}.st-cancelled{color:#64748B}' +
      '@media print{body{margin:10mm}}' +
      '</style></head><body>' +
      '<h1>Laporan Pengajuan Peminjaman \u2014 Gamaspace</h1>' +
      '<p class="meta">Dibuat ' + esc(generated) + '</p>' +
      '<p class="kpi">Total ' + rows.length + ' \u00b7 Menunggu ' + nPend + ' \u00b7 Disetujui ' + nApp + ' \u00b7 Berlangsung ' + nCk + ' \u00b7 Selesai ' + nDone + ' \u00b7 Ditolak ' + nRej + ' \u00b7 Batal ' + nCancel + '</p>' +
      '<table><thead><tr><th>Referensi</th><th>Fasilitas</th><th>Tanggal</th><th>Jam (WIB)</th><th>Status</th><th>Peminjam</th><th>NIM</th><th>Email</th><th>Pes.</th><th>Organisasi</th><th>Diajukan</th></tr></thead>' +
      '<tbody>' + trs + '</tbody></table>' +
      '<script>window.onload=function(){setTimeout(function(){window.print();},350);}<\/script>' +
      '</body></html>');
    w.document.close();
    w.focus();
  }

  // ============ Bind & Init ============
  function bind() {
    /* Gate login (RBAC) — email + kata sandi (tanpa Google) */
    let gateMode = 'login'; // 'login' | 'register'
    const gateSwitch = $('#gateSwitch');
    const gateSubmit = $('#gateSubmit');
    gateSwitch.addEventListener('click', () => {
      gateMode = (gateMode === 'login') ? 'register' : 'login';
      $('#gatePass').setAttribute('autocomplete', gateMode === 'login' ? 'current-password' : 'new-password');
      gateSubmit.textContent = gateMode === 'login' ? 'Masuk' : 'Daftar';
      gateSwitch.innerHTML = gateMode === 'login'
        ? 'Belum punya akun admin? <strong>Daftar</strong>'
        : 'Sudah punya akun admin? <strong>Masuk</strong>';
      gateError('');
    });
    $('#gateForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const email = $('#gateEmail').value.trim();
      const pass = $('#gatePass').value;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { gateError('Masukkan alamat email yang valid.'); return; }
      if (!pass || pass.length < 6) { gateError('Kata sandi minimal 6 karakter.'); return; }
      doGateLogin(
        () => (gateMode === 'login'
          ? CFB.auth.signInEmail(email, pass)
          : CFB.auth.signUpEmail(email, pass, '')),
        gateSubmit
      );
    });
    $('#gateEmail').addEventListener('input', () => gateError(''));
    $('#gatePass').addEventListener('input', () => gateError(''));
    $('#gdRetry').addEventListener('click', () => location.reload());

    $('#logoutBtn').addEventListener('click', async () => {
      stopCamera();
      document.body.classList.remove('role-petugas');
      try { await (CFB.auth ? CFB.auth.signOut() : Promise.resolve()); } catch (e) { /* noop */ }
      CFB.notify.info('Anda telah keluar', 'Sesi admin ditutup.');
      // cfb:auth → handleAuthState menampilkan gate login kembali
    });

    /* Ekspor laporan — satu tombol dengan menu PDF / CSV */
    const expWrap = $('#exportWrap');
    if (expWrap) {
      $('#expBtn').addEventListener('click', () => {
        if ($('#expBtn').disabled) return;
        setExportMenu($('#exportMenu').hidden);
      });
      $('#expPdfItem').addEventListener('click', () => { setExportMenu(false); exportPDF(); });
      $('#expCsvItem').addEventListener('click', () => { setExportMenu(false); exportCSV(); });
      document.addEventListener('click', (e) => {
        if (!expWrap.contains(e.target)) setExportMenu(false);
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') setExportMenu(false);
      });
    }

    $$('.side-nav a').forEach(a => a.addEventListener('click', (e) => {
      e.preventDefault();
      location.hash = '#' + a.dataset.tab;
    }));

    $('#bkFilter').addEventListener('change', (e) => { ui.bkFilter = e.target.value; renderBookings(); });
    $('#bkSearch').addEventListener('input', (e) => { ui.bkQuery = e.target.value; renderBookings(); });

    /* Dashboard — muat data contoh untuk melihat tampilan analitik */
    $('#seedDemoBtn').addEventListener('click', seedDemoFlow);

    /* "Hapus semua pengajuan" — HANYA mode lokal (pembersih data contoh).
       Mode Firebase: disembunyikan agar data pengajuan bersama tidak
       terhapus sekaligus dari seluruh perangkat. */
    const bkClear = $('#bkClear');
    if (bkClear) {
      bkClear.addEventListener('click', async () => {
        const ok = await CFB.confirm({
          title: T('admc.clearall.t'),
          danger: true,
          html: T('admc.clearall.m', { n: CFB.data.getBookings().length }),
          confirmText: T('admc.clearall.yes')
        });
        if (!ok) return;
        const done = await CFB.data.clearBookings();
        if (!done) return;
        CFB.notify.success('Semua pengajuan dihapus', 'Data pengajuan pada perangkat ini telah dikosongkan.');
        await renderTab();
      });
    }

    $('#facAddBtn').addEventListener('click', () => openFacilityModal(null));
    $('#facResetBtn').addEventListener('click', resetToSeed);

    /* Tab Admin & Tab Pengguna */
    $('#accSearch').addEventListener('input', (e) => { ui.accQuery = e.target.value; renderAccounts(); });
    $('#addAdminBtn').addEventListener('click', onAddAdminClick);
    $('#addPetugasBtn').addEventListener('click', onAddPetugasClick);

    /* Scanner petugas lapangan (elemen statis — di-bind sekali) */
    const camToggle = $('#camToggle');
    if (camToggle) camToggle.addEventListener('click', () => {
      if (cam.active) stopCamera(); else startCamera();
    });
    const manualBtn = $('#manualCheck');
    if (manualBtn) manualBtn.addEventListener('click', () => {
      const v = $('#manualCode');
      const val = v ? v.value.trim() : '';
      if (!val) { scanError(T('scn.err.empty')); return; }
      processScanRef(val);
    });
    const manualInput = $('#manualCode');
    if (manualInput) {
      manualInput.addEventListener('input', () => scanError(''));
      manualInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); const b = $('#manualCheck'); if (b) b.click(); }
      });
    }

    window.addEventListener('hashchange', () => {
      if (!$('#adminShell').hidden) renderTab();
    });
  }

  async function init() {
    bind();
    try {
      await CFB.data.load();
    } catch (err) {
      console.error(err);
      CFB.notify.error('Data tidak termuat', 'Pastikan diakses lewat HTTP server (lihat README).');
    }
    updateExportButtons();

    /* Tombol hapus massal hanya tersedia pada mode lokal */
    const bkClear = $('#bkClear');
    if (bkClear) bkClear.hidden = CFB.data.getMode() === 'firebase';

    /* Auth: event cfb:auth dipancarkan setiap kali status login berubah
       (termasuk hasil restore sesi oleh SDK). */
    document.addEventListener('cfb:auth', handleAuthState);
    handleAuthState();                       // tampilkan gate login lebih dulu
    if (CFB.auth && CFB.auth.init) CFB.auth.init();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
