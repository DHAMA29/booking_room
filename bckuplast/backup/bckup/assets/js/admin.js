/* ============================================
   Gamaspace — Admin Panel (admin.html)
   Gate + Dashboard Analitik + CRUD Fasilitas + Kelola Pengajuan
   Bergantung pada: core.js, data.js
   ============================================ */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = CFB.util.esc;

  const ui = { tab: 'dashboard', bkFilter: 'all', bkQuery: '' };

  const STATUS_LABEL = { Pending: 'Menunggu Persetujuan', Approved: 'Disetujui', Rejected: 'Ditolak' };
  /* Status ringkas untuk kolom sempit pada laporan PDF */
  const EXP_STATUS_SHORT = { Pending: 'Menunggu', Approved: 'Disetujui', Rejected: 'Ditolak' };
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
     dari gate). Akses diberikan bila email terdaftar pada:
       1. adminEmails (assets/js/firebase-config.js), atau
       2. node /admins di Realtime Database (nilai = alamat email).
     Bila kedua sumber kosong, login PERTAMA mencoba mendaftarkan dirinya
     ke /admins (first-claim) — bila Rules belum mengizinkan node tersebut,
     akses ditolak + petunjuk ditampilkan. */
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

  function enterShell(user, source) {
    lastAdminUid = user.uid;
    $('#adminGate').hidden = true;
    $('#adminShell').hidden = false;
    const who = $('#adminWho');
    if (who) {
      who.innerHTML = 'Masuk sebagai <strong>' + esc(user.email || user.name || 'admin') + '</strong>' +
        (source === 'claim' ? ' <span class="aw-tag">terdaftar otomatis</span>' : '');
      who.hidden = false;
    }
    renderTab();
  }

  function showDenied(email) {
    $('#gdEmail').textContent = email || '—';
    gateState('denied');
  }

  async function checkAdmin(user) {
    const email = String((user && user.email) || '').toLowerCase();
    if (!email) { showDenied(email); return; }
    const cfgList = cfgAdminEmails();
    const dbList = await fetchAdminEmails();
    const inCfg = cfgList.includes(email);
    const inDb = dbList.includes(email);
    if (inCfg || inDb) { enterShell(user, inCfg ? 'config' : 'admins'); return; }

    const empty = !cfgList.length && !dbList.length;
    if (empty && CFG.allowFirstAdminClaim !== false) {
      const res = await CFB.data.fbNodePut('admins/' + adminKey(email), email);
      if (res.ok) {
        CFB.notify.success('Terdaftar sebagai admin', email + ' tersimpan pada node /admins — akses permanen untuk akun ini.');
        enterShell(user, 'claim');
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

  // ============ Tab (via hash) ============
  const TABS = ['dashboard', 'pengajuan', 'fasilitas'];
  function currentTabFromHash() {
    const h = location.hash.replace(/^#\/?/, '');
    return TABS.includes(h) ? h : 'dashboard';
  }

  async function renderTab() {
    ui.tab = currentTabFromHash();
    TABS.forEach(t => {
      const sec = $('#tab-' + t);
      if (sec) sec.hidden = t !== ui.tab;
    });
    $$('.side-nav a').forEach(a => a.classList.toggle('active', a.dataset.tab === ui.tab));
    // Segarkan pengajuan dari Firebase sebelum menampilkan tab data
    if (ui.tab === 'dashboard' || ui.tab === 'pengajuan') {
      if (CFB.data.getMode() === 'firebase') {
        try { await CFB.data.refreshBookings(); } catch (e) { /* offline */ }
      }
    }
    if (ui.tab === 'dashboard') renderDashboard();
    if (ui.tab === 'pengajuan') renderBookings();
    if (ui.tab === 'fasilitas') renderFacilities();
  }

  function updatePendingBadge() {
    const n = CFB.data.getBookings().filter(b => b.status === 'Pending').length;
    const el = $('#pendingBadge');
    if (n > 0) { el.textContent = n; el.hidden = false; } else el.hidden = true;
  }

  // ============ Dashboard / Analitik ============
  function renderDashboard() {
    const facilities = CFB.data.getFacilities();
    const bookings = CFB.data.getBookings();
    const dates = CFB.data.bookableDates();

    const nPend = bookings.filter(b => b.status === 'Pending').length;
    const nApp = bookings.filter(b => b.status === 'Approved').length;
    const nRej = bookings.filter(b => b.status === 'Rejected').length;

    // KPI dengan animasi angka
    $('#kpiRow').innerHTML =
      kpi('Total Pengajuan', bookings.length, '') +
      kpi('Menunggu', nPend, 'pending') +
      kpi('Disetujui', nApp, 'approved') +
      kpi('Ditolak', nRej, 'rejected') +
      kpi('Fasilitas Aktif', facilities.filter(f => f.status !== 'Unavailable').length, '');
    $$('#kpiRow [data-target]').forEach(el => CFB.util.countUp(el, +el.dataset.target));
    CFB.util.stagger($('#kpiRow'));

    // Catatan jumlah data (netral — tanpa menyebut teknis database)
    const fbMode = CFB.data.getMode() === 'firebase';
    const note = $('#dashNote');
    if (note) {
      note.textContent = bookings.length
        ? (fbMode
          ? bookings.length + ' pengajuan tercatat (semua pengguna).'
          : bookings.length + ' pengajuan tersimpan pada perangkat ini.')
        : (fbMode ? 'Belum ada pengajuan tercatat.' : 'Belum ada pengajuan pada perangkat ini.');
    }
    const footNote = $('#dashFootNote');
    if (footNote) {
      footNote.innerHTML = fbMode
        ? 'Analitik dihitung dari seluruh pengajuan tercatat.'
        : 'Analitik dihitung dari data pengajuan (LocalStorage) di atas data awal <code>data/*.json</code>. Klik <em>Muat data contoh</em> pada kartu kosong untuk melihat tampilan analitik.';
    }

    if (!bookings.length) {
      $('#chartStatus').innerHTML = $('#chartFacility').innerHTML = $('#chartDate').innerHTML =
        '<div class="chart-empty-card">' +
        '  <p class="ce-title">Belum ada data pengajuan</p>' +
        '  <p class="ce-hint">Grafik analitik akan terisi setelah ada pengajuan dari mahasiswa, atau gunakan tombol <strong>Muat data contoh</strong> di atas untuk melihat tampilannya.</p>' +
        '</div>';
      $('#recentList').innerHTML = '<p class="chart-empty">Belum ada pengajuan.</p>';
      updateExportButtons(bookings);
      return;
    }
    updateExportButtons(bookings);

    // Donut status (conic-gradient)
    const total = bookings.length;
    const pPend = Math.round((nPend / total) * 100);
    const pApp = Math.round((nApp / total) * 100);
    const pRej = 100 - pPend - pApp;
    $('#chartStatus').innerHTML =
      '<div class="donut-wrap">' +
      '  <div class="donut" style="background:conic-gradient(#D97706 0 ' + pPend + '%, #16A34A ' + pPend + ' ' + (pPend + pApp) + '%, #DC2626 ' + (pPend + pApp) + ' 100%)">' +
      '    <div class="donut-hole"><strong>' + total + '</strong><span>pengajuan</span></div>' +
      '  </div>' +
      '  <div class="donut-legend">' +
      '    <span class="lg pending">Menunggu ' + nPend + ' (' + pPend + '%)</span>' +
      '    <span class="lg approved">Disetujui ' + nApp + ' (' + pApp + '%)</span>' +
      '    <span class="lg rejected">Ditolak ' + nRej + ' (' + pRej + '%)</span>' +
      '  </div>' +
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
        '  <p class="bk-refline">' + esc(b.id) + ' \u00b7 diajukan ' + new Date(b.createdAt).toLocaleString('id-ID') + '</p>' +
        '</div>' +
        '<div class="bk-side">' +
        '  ' + badge(b.status) +
        '  <div class="bk-actions">' +
        '    <button type="button" class="btn-icon" data-detail="' + esc(b.id) + '" title="Lihat rincian lengkap">' + CFB.icons.eye + '</button>' +
        (isPending
          ? '<button type="button" class="btn-mini ok" data-approve="' + esc(b.id) + '">' + CFB.icons.check + ' Setujui</button>' +
            '<button type="button" class="btn-mini no" data-reject="' + esc(b.id) + '">' + CFB.icons.x + ' Tolak</button>'
          : '') +
        '  </div>' +
        '</div>';
      wrap.appendChild(div);
    });
    CFB.util.stagger(wrap);
    $$('#bkList [data-detail]').forEach(b => b.addEventListener('click', () => openDetailModal(b.dataset.detail)));
    $$('#bkList [data-approve]').forEach(b => b.addEventListener('click', () => approveBooking(b.dataset.approve)));
    $$('#bkList [data-reject]').forEach(b => b.addEventListener('click', () => rejectBooking(b.dataset.reject)));
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
      ['Organisasi / Prodi', b.organization], ['Diajukan', new Date(b.createdAt).toLocaleString('id-ID')],
      ['Diputuskan', b.decidedAt ? new Date(b.decidedAt).toLocaleString('id-ID') : '—']
    ];
    if (b.accountEmail) rows.push(['Akun', b.accountEmail + (b.uid ? ' (uid ' + String(b.uid).slice(0, 8) + '\u2026)' : '')]);
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
      (b.status === 'Pending'
        ? '<button type="button" class="btn-primary" data-ok>' + CFB.icons.check + ' Setujui</button>'
        : '') +
      '</div>', { wide: true });
    m.ov.querySelector('[data-close]').addEventListener('click', m.close);
    const okBtn = m.ov.querySelector('[data-ok]');
    if (okBtn) okBtn.addEventListener('click', () => { m.close(); approveBooking(id); });
  }

  async function approveBooking(id) {
    const b = CFB.data.getBookingById(id);
    if (!b) return;
    const ok = await CFB.confirm({
      title: 'Setujui pengajuan ini?',
      html: 'Pengajuan <strong>' + esc(b.id) + '</strong> untuk <strong>' + esc(b.facilityName) + '</strong> oleh ' + esc(b.name) +
        ' pada ' + esc(b.dateLabel || b.date) + ' pukul ' + esc(b.slotLabel || '') + ' WIB akan disetujui dan slot menjadi terisi.',
      confirmText: 'Ya, setujui'
    });
    if (!ok) return;
    const updated = await CFB.data.updateBookingStatus(id, 'Approved');
    if (!updated) return; // toast error sudah ditampilkan data layer
    CFB.notify.success('Pengajuan disetujui', b.id + ' \u00b7 ' + b.facilityName);
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
        '  <button type="button" class="btn-icon" data-edit="' + esc(f.id) + '" title="Ubah">' + CFB.icons.edit + '</button>' +
        '  <button type="button" class="btn-icon danger" data-del="' + esc(f.id) + '" title="Hapus">' + CFB.icons.trash + '</button>' +
        '</td></tr>';
    }).join('');
    if (!facilities.length) tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Tidak ada fasilitas.</td></tr>';

    $$('#facTable [data-edit]').forEach(b => b.addEventListener('click', () => openFacilityModal(b.dataset.edit)));
    $$('#facTable [data-del]').forEach(b => b.addEventListener('click', () => deleteFacility(b.dataset.del)));
    $$('#facTable [data-plan]').forEach(b => b.addEventListener('click', () => openLayoutEditor(b.dataset.plan)));
  }

  /* ============ Editor Denah Ruangan (drag & drop) ============
     Admin dapat menata layar, panggung, proyektor, sound, papan tulis,
     podium, meja, dan pintu; mengatur jumlah bangku serta ukuran ruangan.
     Tersimpan sebagai `layout` pada objek fasilitas (Firebase / lokal). */
  async function openLayoutEditor(id) {
    /* Ambil data fasilitas terkini dari server sebelum menyunting */
    if (CFB.data.getMode() === 'firebase') { try { await CFB.data.refreshFacilities(); } catch (e) { /* offline */ } }
    const f = CFB.data.getFacilityById(id);
    if (!f) return;
    const ed = { layout: CFB.floorplan.parseLayout(f.layout), sel: null, drag: null };
    const PALETTE = ['screen', 'stage', 'projector', 'sound', 'whiteboard', 'podium', 'table', 'door'];

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
      '    <p class="le-label">Properti ruangan</p>' +
      '    <div class="le-props">' +
      '      <div class="form-row"><label for="le-seats">Jumlah bangku</label><input id="le-seats" type="number" min="0" max="2000" step="1" value="' + ed.layout.seats + '"></div>' +
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
      '<p class="le-hint">Tarik (drag) item untuk memindahkannya. Klik item untuk memilih, lalu tekan Hapus item atau tombol Del.</p>' +
      '<div class="modal-actions">' +
      '  <button type="button" class="btn-ghost" id="leClear">Kosongkan</button>' +
      '  <button type="button" class="btn-ghost le-del-btn" id="leDel" disabled>' + CFB.icons.trash + ' Hapus item</button>' +
      '  <span class="toolbar-spacer"></span>' +
      '  <button type="button" class="btn-ghost" data-close>Batal</button>' +
      '  <button type="submit" class="btn-primary" id="leSave">Simpan denah</button>' +
      '</div>', { wide: true });
    m.ov.querySelector('.modal-card').classList.add('modal-editor');

    const canvas = m.ov.querySelector('#leCanvas');
    const delBtn = m.ov.querySelector('#leDel');

    function facTypeLabel(ty) {
      const map = { screen: 'Layar', stage: 'Panggung', projector: 'Proyektor', sound: 'Sound', whiteboard: 'Papan tulis', podium: 'Podium', table: 'Meja', door: 'Pintu' };
      return map[ty] || ty;
    }

    function repaint() {
      canvas.innerHTML = CFB.floorplan.render(ed.layout, { interactive: true, uid: 'fp-edit', selected: ed.sel }).svg;
      delBtn.disabled = ed.sel == null;
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
        ed.layout.items.splice(+b.dataset.rm, 1);
        ed.sel = null;
        repaint();
      }));
      list.querySelectorAll('.le-item').forEach(el => el.addEventListener('click', (e) => {
        if (e.target.closest('[data-rm]')) return;
        ed.sel = +el.dataset.idx;
        repaint();
      }));
    }

    function bindCanvas() {
      canvas.querySelectorAll('.fp-item').forEach(g => {
        g.addEventListener('pointerdown', (ev) => startDrag(ev, +g.dataset.idx));
      });
    }

    function startDrag(ev, idx) {
      ev.preventDefault();
      ed.sel = idx;
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

    m.ov.querySelectorAll('.le-add').forEach(b => b.addEventListener('click', () => {
      const ty = b.dataset.type;
      if (ed.layout.items.length >= 40) { CFB.notify.warning('Item penuh', 'Maksimal 40 item per denah.'); return; }
      const n = ed.layout.items.length;
      ed.layout.items.push({ type: ty, x: (ed.layout.w / 2 + (n % 5) * 0.5) % ed.layout.w, y: ed.layout.h / 2 + Math.floor(n / 5) * 0.6, rot: 0 });
      ed.sel = ed.layout.items.length - 1;
      repaint();
    }));

    const seatsIn = m.ov.querySelector('#le-seats');
    const wIn = m.ov.querySelector('#le-w');
    const hIn = m.ov.querySelector('#le-h');
    seatsIn.addEventListener('input', () => { ed.layout.seats = Math.min(2000, Math.max(0, parseInt(seatsIn.value, 10) || 0)); repaint(); });
    wIn.addEventListener('change', () => { ed.layout.w = Math.min(30, Math.max(6, parseInt(wIn.value, 10) || 12)); wIn.value = ed.layout.w; repaint(); });
    hIn.addEventListener('change', () => { ed.layout.h = Math.min(24, Math.max(5, parseInt(hIn.value, 10) || 8)); hIn.value = ed.layout.h; repaint(); });

    delBtn.addEventListener('click', () => {
      if (ed.sel == null) return;
      ed.layout.items.splice(ed.sel, 1);
      ed.sel = null;
      repaint();
    });
    m.ov.querySelector('#leClear').addEventListener('click', () => {
      ed.layout.items = [];
      ed.layout.seats = 0;
      seatsIn.value = 0;
      ed.sel = null;
      repaint();
    });
    const onKey = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (ed.sel != null && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
          ed.layout.items.splice(ed.sel, 1);
          ed.sel = null;
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

    repaint();
    setTimeout(() => m.ov.querySelector('#le-seats').focus(), 80);
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
      title: 'Hapus fasilitas ini?',
      danger: true,
      html: 'Fasilitas <strong>' + esc(f.name) + '</strong> (' + esc(id) + ') akan dihapus' +
        (CFB.data.getMode() === 'firebase' ? ' dari <strong>server (untuk semua pengguna)</strong>' : ' dari daftar pada perangkat ini') + '.' +
        (used ? '<br><br>Terdapat <strong>' + used + ' pengajuan</strong> terkait fasilitas ini \u2014 riwayat tetap tersimpan dengan nama fasilitas.' : ''),
      confirmText: 'Ya, hapus'
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
      title: 'Reset ke data awal?',
      html: fb
        ? 'Data fasilitas di <strong>server</strong> akan ditimpa dengan isi <code>data/facilities.json</code>. Perubahan (tambahan/ubahan/hapusan) di server hilang. Pengajuan tidak terpengaruh.'
        : 'Semua perubahan admin (tambahan, ubahan, hapusan) akan dibatalkan dan kembali ke isi <code>data/facilities.json</code>. Pengajuan tidak terpengaruh.',
      confirmText: 'Ya, reset'
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

  // ============ Data contoh (untuk demo analitik) ============
  async function seedDemoBookings() {
    const demo = [
      { f: 'FAC-001', day: 1, h: 10, dur: 2, name: 'Dimas Prasetyo', nim: '23/456781/PA/20014', org: 'Ilmu Komunikasi 2023', part: 32, purpose: 'Latihan presentasi tugas besar mata kuliah Komunikasi Publik.', status: 'Pending' },
      { f: 'FAC-002', day: 2, h: 13, dur: 2, name: 'Siti Rahmawati', nim: '22/415672/PA/19880', org: 'BEM Fakultas', part: 100, purpose: 'Rapat koordinasi kerja cabinet BEM periode 2026.', status: 'Pending' },
      { f: 'FAC-004', day: 2, h: 8, dur: 1, name: 'Bagas Nugroho', nim: '24/478912/PA/21045', org: 'Informatika 2024', part: 28, purpose: 'Praktikum mandiri struktur data dan algoritma.', status: 'Approved' },
      { f: 'FAC-006', day: 3, h: 15, dur: 2, name: 'Ahmad Fauzi', nim: '21/438221/PA/19320', org: 'UKM Basket', part: 24, purpose: 'Latihan rutin tim basket menjelang lomba antar fakultas.', status: 'Approved' },
      { f: 'FAC-009', day: 4, h: 9, dur: 2, name: 'Dewi Lestari', nim: '22/423390/PA/19912', org: 'Sekretariat Seminar', part: 350, purpose: 'Seminar nasional teknologi berkelanjutan dengan pembicara praktisi.', status: 'Pending' },
      { f: 'FAC-010', day: 4, h: 13, dur: 1, name: 'Rina Kurniawati', nim: '23/451230/PA/20077', org: 'Manajemen 2023', part: 45, purpose: 'Diskusi kelompok tugas analisis kasus manajemen operasional.', status: 'Pending' },
      { f: 'FAC-003', day: 5, h: 11, dur: 2, name: 'Fajar Ramadhan', nim: '24/469001/PA/20988', org: 'Sastra Inggris 2024', part: 20, purpose: 'Praktik speaking persiapan tes TOEFL ITP.', status: 'Rejected' },
      { f: 'FAC-005', day: 5, h: 16, dur: 2, name: 'Nur Aisyah', nim: '21/440118/PA/19450', org: 'KMK Fortissimo', part: 90, purpose: 'Gladi resik paduan suara sebelum konser tahunan.', status: 'Pending' },
      { f: 'FAC-008', day: 6, h: 8, dur: 2, name: 'Yoga Pratama', nim: '23/457789/PA/20032', org: 'HMPS Biologi', part: 60, purpose: 'Kegiatan outbound dan games bonding mahasiswa baru.', status: 'Approved' },
      { f: 'FAC-001', day: 8, h: 9, dur: 1, name: 'Maya Anggraini', nim: '24/470231/PA/21001', org: 'Akuntansi 2024', part: 35, purpose: 'Belajar bersama persiapan ujian tengah semester.', status: 'Pending' },
      { f: 'FAC-002', day: 9, h: 10, dur: 2, name: 'Rizky Maulana', nim: '22/416785/PA/19826', org: 'Dewan Mahasiswa', part: 140, purpose: 'Musyawarah besar evaluasi program kerja tahunan.', status: 'Approved' },
      { f: 'FAC-004', day: 10, h: 14, dur: 2, name: 'Putri Wulandari', nim: '23/452340/PA/20058', org: 'Sistem Informasi 2023', part: 30, purpose: 'Pelatihan penggunaan library data analisis untuk angkatan.', status: 'Rejected' },
      { f: 'FAC-006', day: 11, h: 7, dur: 1, name: 'Arif Hidayat', nim: '21/436675/PA/19301', org: 'Ilmu Keolahragaan', part: 40, purpose: 'Praktikum tes kebugaran fisik dasar.', status: 'Pending' },
      { f: 'FAC-010', day: 12, h: 9, dur: 2, name: 'Laila Fitriani', nim: '22/428901/PA/19945', org: 'Psikologi 2022', part: 55, purpose: 'Workshop public speaking untuk mahasiswa semester awal.', status: 'Approved' }
    ];

    const dates = CFB.data.bookableDates();
    let added = 0, failed = 0;
    for (let i = 0; i < demo.length; i++) {
      const d = demo[i];
      const f = CFB.data.getFacilityById(d.f);
      if (!f) continue;
      const date = dates[Math.min(d.day, dates.length - 1)];
      if (!CFB.data.isRangeFree(f.id, date, d.h, d.dur)) continue; // hindari bentrok dengan seed
      const created = new Date(Date.now() - (demo.length - i) * 7 * 3600 * 1000).toISOString();
      const email = d.name.toLowerCase().replace(/[^a-z]+/g, '.') .replace(/^\.|\.$/g, '') + '@mail.ugm.ac.id';
      const saved = await CFB.data.addBooking({
        id: CFB.data.generateBookingId(),
        facilityId: f.id, facilityName: f.name, category: f.category || '', location: f.location, capacity: f.capacity,
        date, dateLabel: CFB.util.dateParts(date).full,
        startHour: d.h, endHour: d.h + d.dur, durationHours: d.dur,
        slotLabel: CFB.util.rangeLabel(d.h, d.h + d.dur),
        name: d.name, nim: d.nim, email, phone: '+62 812-3456-78' + (10 + i),
        participants: d.part, organization: d.org, purpose: d.purpose, notes: '',
        status: d.status, createdAt: created,
        clientId: 'demo-' + i   // data contoh bukan milik pengguna ini
      });
      if (saved) added++; else failed++;
    }
    if (failed) {
      CFB.notify.warning('Data contoh dimuat sebagian', added + ' ditambahkan, ' + failed + ' gagal (lihat notifikasi error).');
    } else {
      CFB.notify.success('Data contoh dimuat', added + ' pengajuan contoh ditambahkan untuk mengisi analitik.');
    }
    renderDashboard();
  }

  /* ============ Ekspor Laporan Admin — CSV & PDF (Task 9) ============
     CSV  : JavaScript murni (Blob), pemisah ';' + BOM → ramah Excel ID.
     PDF  : jsPDF + autotable dimuat dari CDN; bila CDN tak terjangkau,
     jatuh ke jendela cetak (Simpan sebagai PDF dari dialog cetak). */
  function pad2(n) { return String(n).padStart(2, '0'); }

  function expStamp() {
    const d = new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes());
  }

  function fmtDT(iso) {
    try { return new Date(iso).toLocaleString('id-ID'); } catch (e) { return String(iso || ''); }
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
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
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
        dateShort: expDateShort(b.date),
        slotShort: String(b.slotLabel || '').replace(/\s/g, ''),
        createdShort: expDTShort(b.createdAt),
        name: b.name, nim: b.nim, email: b.email, phone: b.phone,
        participants: b.participants, organization: b.organization || '',
        purpose: b.purpose || '', notes: b.notes || '',
        created: fmtDT(b.createdAt), decided: b.decidedAt ? fmtDT(b.decidedAt) : '',
        rejectReason: b.rejectReason || '', account: b.accountEmail || (b.uid ? 'uid:' + b.uid : '')
      }));
  }

  function updateExportButtons(bookings) {
    const n = (bookings || CFB.data.getBookings()).length;
    const csv = $('#expCsvBtn'), pdf = $('#expPdfBtn');
    if (csv) { csv.disabled = !n; csv.title = n ? 'Ekspor ' + n + ' pengajuan ke CSV (Excel)' : 'Belum ada pengajuan untuk diekspor'; }
    if (pdf) { pdf.disabled = !n; pdf.title = n ? 'Unduh laporan PDF (' + n + ' pengajuan)' : 'Belum ada pengajuan untuk diekspor'; }
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
      'Alasan penolakan', 'Akun'];
    const lines = [head.map(csvCell).join(';')];
    rows.forEach((r, i) => {
      lines.push([
        i + 1, r.id, r.facility, r.category, r.location, r.date, r.slot, r.dur, r.status,
        r.name, r.nim, r.email, r.phone, r.participants, r.organization, r.purpose, r.notes,
        r.created, r.decided, r.rejectReason, r.account
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
    const btn = $('#expPdfBtn');
    btn.disabled = true;
    btn.classList.add('is-loading');
    ensurePdfLib().then(() => {
      buildPdf(rows);
      CFB.notify.success('Laporan PDF terunduh', rows.length + ' pengajuan · ' + 'laporan-pengajuan-' + expStamp() + '.pdf');
    }).catch(() => {
      printFallback(rows);   // CDN tak terjangkau → dialog cetak (Simpan sebagai PDF)
    }).finally(() => {
      btn.classList.remove('is-loading');
      updateExportButtons();
    });
  }

  const STATUS_RGB = { Pending: [217, 119, 6], Approved: [22, 163, 74], Rejected: [220, 38, 38] };

  /* Lebar kolom PDF (mm, landscape A4, margin kiri/kanan 9 → konten 279).
     SEMUA kolom diberi lebar eksplisit agar kolom Peminjam/NIM/Email tidak
     terjepit (bug lama: kolom 5-8 dibuat auto → Peminjam hanya 3,5 mm dan
     nama terpotong per huruf). Total lebar = 277 mm ≤ 279 mm. */
  function buildPdf(rows) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const generated = new Date().toLocaleString('id-ID');
    const nPend = rows.filter(r => r.statusKey === 'Pending').length;
    const nApp = rows.filter(r => r.statusKey === 'Approved').length;
    const nRej = rows.filter(r => r.statusKey === 'Rejected').length;

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
    doc.text('Total ' + rows.length + ' pengajuan    |    Menunggu ' + nPend + '    |    Disetujui ' + nApp + '    |    Ditolak ' + nRej, 12, 28);

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
          const key = /Disetujui/i.test(d.cell.raw) ? 'Approved' : (/Ditolak/i.test(d.cell.raw) ? 'Rejected' : 'Pending');
          d.cell.styles.textColor = STATUS_RGB[key];
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
      if (!byFac[r.facility]) { byFac[r.facility] = { t: 0, p: 0, a: 0, rj: 0 }; facOrder.push(r.facility); }
      const o = byFac[r.facility];
      o.t++;
      if (r.statusKey === 'Pending') o.p++;
      else if (r.statusKey === 'Approved') o.a++;
      else if (r.statusKey === 'Rejected') o.rj++;
    });
    let y = doc.lastAutoTable.finalY + 8;
    if (y > 165) { doc.addPage(); y = 24; }
    doc.setTextColor(30, 58, 138);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
    doc.text('Ringkasan per fasilitas', 12, y);
    doc.autoTable({
      startY: y + 4,
      margin: { left: 9, right: 9, top: 24, bottom: 16 },
      head: [['Fasilitas', 'Total', 'Menunggu', 'Disetujui', 'Ditolak']],
      body: facOrder.map(f => [f, byFac[f].t, byFac[f].p, byFac[f].a, byFac[f].rj]),
      styles: { fontSize: 8, cellPadding: 1.8, lineColor: [226, 232, 240], lineWidth: 0.2, textColor: [51, 65, 85] },
      headStyles: { fillColor: [30, 58, 138], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [244, 247, 252] },
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center' } }
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
    const generated = new Date().toLocaleString('id-ID');
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
      '@media print{body{margin:10mm}}' +
      '</style></head><body>' +
      '<h1>Laporan Pengajuan Peminjaman \u2014 Gamaspace</h1>' +
      '<p class="meta">Dibuat ' + esc(generated) + '</p>' +
      '<p class="kpi">Total ' + rows.length + ' \u00b7 Menunggu ' + nPend + ' \u00b7 Disetujui ' + nApp + ' \u00b7 Ditolak ' + nRej + '</p>' +
      '<table><thead><tr><th>Referensi</th><th>Fasilitas</th><th>Tanggal</th><th>Jam (WIB)</th><th>Status</th><th>Peminjam</th><th>NIM</th><th>Email</th><th>Pes.</th><th>Organisasi</th><th>Diajukan</th></tr></thead>' +
      '<tbody>' + trs + '</tbody></table>' +
      '<script>window.onload=function(){setTimeout(function(){window.print();},350);}<\/script>' +
      '</body></html>');
    w.document.close();
    w.focus();
  }

  async function seedDemoFlow() {
    if (CFB.data.getBookings().length) {
      const ok = await CFB.confirm({
        title: 'Muat data contoh?',
        html: '14 pengajuan contoh akan <strong>ditambahkan</strong> ke data yang ada (data lama tidak terhapus)' +
          (CFB.data.getMode() === 'firebase' ? ' dan terlihat oleh semua pengguna' : '') +
          '. Digunakan untuk melihat tampilan analitik.',
        confirmText: 'Ya, muat data contoh'
      });
      if (!ok) return;
    }
    await seedDemoBookings();
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
      try { await (CFB.auth ? CFB.auth.signOut() : Promise.resolve()); } catch (e) { /* noop */ }
      CFB.notify.info('Anda telah keluar', 'Sesi admin ditutup.');
      // cfb:auth → handleAuthState menampilkan gate login kembali
    });

    /* Ekspor laporan */
    $('#expCsvBtn').addEventListener('click', exportCSV);
    $('#expPdfBtn').addEventListener('click', exportPDF);

    $$('.side-nav a').forEach(a => a.addEventListener('click', (e) => {
      e.preventDefault();
      location.hash = '#' + a.dataset.tab;
    }));

    $('#bkFilter').addEventListener('change', (e) => { ui.bkFilter = e.target.value; renderBookings(); });
    $('#bkSearch').addEventListener('input', (e) => { ui.bkQuery = e.target.value; renderBookings(); });
    $('#seedDemoBtn').addEventListener('click', seedDemoFlow);
    $('#bkClear').addEventListener('click', async () => {
      const fb = CFB.data.getMode() === 'firebase';
      const ok = await CFB.confirm({
        title: 'Hapus semua pengajuan?',
        danger: true,
        html: fb
          ? 'Seluruh <strong>' + CFB.data.getBookings().length + ' pengajuan</strong> akan dihapus dari <strong>server (untuk semua pengguna)</strong>. Tindakan ini tidak dapat dibatalkan.'
          : 'Seluruh <strong>' + CFB.data.getBookings().length + ' pengajuan</strong> akan dihapus permanen dari perangkat ini. Tindakan ini tidak dapat dibatalkan.',
        confirmText: 'Ya, hapus semua'
      });
      if (!ok) return;
      const done = await CFB.data.clearBookings();
      if (!done) return;
      CFB.notify.success('Semua pengajuan dihapus', fb ? 'Data pengajuan di server telah dikosongkan.' : 'Data pengajuan pada perangkat ini telah dikosongkan.');
      renderBookings();
    });

    $('#facAddBtn').addEventListener('click', () => openFacilityModal(null));
    $('#facResetBtn').addEventListener('click', resetToSeed);

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

    /* Auth: event cfb:auth dipancarkan setiap kali status login berubah
       (termasuk hasil restore sesi oleh SDK). */
    document.addEventListener('cfb:auth', handleAuthState);
    handleAuthState();                       // tampilkan gate login lebih dulu
    if (CFB.auth && CFB.auth.init) CFB.auth.init();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
