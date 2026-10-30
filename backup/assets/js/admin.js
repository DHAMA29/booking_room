/* ============================================
   Campus Facility Booking — Admin Panel (admin.html)
   Gate + Dashboard Analitik + CRUD Fasilitas + Kelola Pengajuan
   Bergantung pada: core.js, data.js
   ============================================ */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = CFB.util.esc;

  const GATE_KEY = 'cfb_admin_session';
  const ADMIN_CODE = 'admin123'; // kode demo — ubah untuk produksi

  const ui = { tab: 'dashboard', bkFilter: 'all', bkQuery: '' };

  const STATUS_LABEL = { Pending: 'Menunggu Persetujuan', Approved: 'Disetujui', Rejected: 'Ditolak' };
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

  // ============ Gate ============
  function showGate() {
    $('#adminGate').hidden = false;
    $('#adminShell').hidden = true;
    $('#gateCode').value = '';
    $('#gateError').hidden = true;
    $('#gateCode').classList.remove('invalid');
    setTimeout(() => $('#gateCode').focus(), 80);
  }

  function showShell() {
    $('#adminGate').hidden = true;
    $('#adminShell').hidden = false;
    renderTab();
  }

  function tryLogin(e) {
    e.preventDefault();
    if ($('#gateCode').value === ADMIN_CODE) {
      sessionStorage.setItem(GATE_KEY, '1');
      showShell();
      CFB.notify.success('Selamat datang, Admin', 'Anda masuk sebagai pengelola fasilitas.');
    } else {
      $('#gateError').hidden = false;
      $('#gateCode').classList.add('invalid');
      const row = $('#gateCode').closest('.form-row');
      if (row) row.classList.add('has-error');
      const card = $('.gate-card');
      card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    }
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

    // Catatan jumlah data + tombol muat data contoh
    const fbMode = CFB.data.getMode() === 'firebase';
    const note = $('#dashNote');
    if (note) {
      note.textContent = bookings.length
        ? (fbMode
          ? bookings.length + ' pengajuan tersinkron dari Firebase (semua pengguna).'
          : bookings.length + ' pengajuan tersimpan pada perangkat ini.')
        : (fbMode ? 'Belum ada pengajuan pada Firebase.' : 'Belum ada pengajuan pada perangkat ini.');
    }
    const footNote = $('#dashFootNote');
    if (footNote) {
      footNote.innerHTML = fbMode
        ? 'Analitik dihitung dari seluruh pengajuan pada <strong>Firebase Realtime Database</strong>.'
        : 'Analitik dihitung dari data pengajuan (LocalStorage) di atas data awal <code>data/*.json</code>. Klik <em>Muat data contoh</em> pada kartu kosong untuk melihat tampilan analitik.';
    }

    if (!bookings.length) {
      $('#chartStatus').innerHTML = $('#chartFacility').innerHTML = $('#chartDate').innerHTML =
        '<div class="chart-empty-card">' +
        '  <p class="ce-title">Belum ada data pengajuan</p>' +
        '  <p class="ce-hint">Grafik analitik akan terisi setelah ada pengajuan dari mahasiswa, atau gunakan tombol <strong>Muat data contoh</strong> di atas untuk melihat tampilannya.</p>' +
        '</div>';
      $('#recentList').innerHTML = '<p class="chart-empty">Belum ada pengajuan.</p>';
      return;
    }

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
        '  <p class="bk-title">' + esc(b.facilityName) + ' <small>' + esc(b.organization || '') + '</small></p>' +
        '  <p class="bk-sub">' +
        '    <span>' + esc(b.dateLabel || b.date) + '</span>' +
        '    <span>' + esc(b.slotLabel || '') + ' WIB \u00b7 ' + (b.durationHours || 2) + ' jam</span>' +
        '    <span>' + b.participants + ' peserta</span>' +
        '    <span>' + esc(b.name) + ' (' + esc(b.nim) + ')</span>' +
        '  </p>' +
        '  <p class="bk-refline">' + esc(b.id) + ' \u00b7 diajukan ' + new Date(b.createdAt).toLocaleString('id-ID') + '</p>' +
        '</div>' +
        '<div class="bk-side">' +
        '  ' + badge(b.status) +
        '  <div class="bk-actions">' +
        '    <button type="button" class="btn-icon" data-detail="' + esc(b.id) + '" title="Lihat detail">' + CFB.icons.eye + '</button>' +
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

  /* Panel status & sinkronisasi Firebase (tab Fasilitas) */
  function updateFirebasePanel() {
    const meta = $('#fbMeta');
    if (!meta) return;
    const st = CFB.data.fbStatus();
    const dot = $('#fbDot');
    const seedBtn = $('#fbSeedBtn');
    const resetBtn = $('#facResetBtn');
    if (st.mode === 'firebase') {
      dot.className = 'fb-dot ok';
      meta.innerHTML = '<strong>Terhubung &amp; aktif</strong> \u2014 fasilitas & pengajuan tersinkron lintas perangkat.<br><code>' + esc(st.base || '') + '</code>';
      seedBtn.disabled = true;
      seedBtn.textContent = 'Data awal terunggah';
      if (resetBtn) resetBtn.textContent = 'Reset server ke data awal (JSON)';
    } else if (st.reason === 'empty') {
      dot.className = 'fb-dot warn';
      meta.innerHTML = 'Terhubung, namun database masih <strong>kosong</strong>. Klik <strong>Unggah data awal</strong>, atau import <code>firebase-seed.json</code> lewat Firebase Console.';
      seedBtn.disabled = false;
      seedBtn.textContent = 'Unggah data awal (Seed)';
      if (resetBtn) resetBtn.textContent = 'Reset ke data awal (JSON)';
    } else if (st.reason === 'denied') {
      dot.className = 'fb-dot bad';
      meta.innerHTML = '<strong>Akses ditolak.</strong> Buka Firebase Console \u2192 Realtime Database \u2192 tab <strong>Rules</strong>, lalu izinkan baca/tulis (contoh rules ada di README).';
      seedBtn.disabled = true;
    } else if (st.reason === 'no-config') {
      dot.className = 'fb-dot warn';
      meta.innerHTML = 'Belum dikonfigurasi \u2014 isi <code>databaseURL</code> pada <code>assets/js/firebase-config.js</code>.';
      seedBtn.disabled = true;
    } else {
      dot.className = 'fb-dot bad';
      meta.innerHTML = '<strong>Tidak dapat terhubung.</strong> Periksa koneksi internet / URL database. Aplikasi sementara berjalan pada mode lokal.';
      seedBtn.disabled = true;
    }
  }

  async function seedFirebaseFlow() {
    const st = CFB.data.fbStatus();
    if (!st.reachable) {
      CFB.notify.warning('Firebase tidak terjangkau', 'Periksa koneksi / Rules database lalu coba lagi.');
      return;
    }
    const n = CFB.data.getFacilities().length;
    const ok = await CFB.confirm({
      title: 'Unggah data awal ke Firebase?',
      html: 'Data <strong>' + n + ' fasilitas</strong> beserta kebijakan ketersediaan dari <code>data/*.json</code> akan ditulis ke Realtime Database dan dipakai oleh semua pengunjung situs. Pengajuan yang sudah ada tidak terhapus.',
      confirmText: 'Ya, unggah'
    });
    if (!ok) return;
    const btn = $('#fbSeedBtn');
    btn.disabled = true;
    btn.textContent = 'Mengunggah\u2026';
    const res = await CFB.data.seedFirebase();
    if (res.ok) {
      CFB.notify.success('Data awal terunggah', res.facilities + ' fasilitas + kebijakan ketersediaan tersimpan di Firebase. Mode tersinkon kini aktif.');
      renderTab();
    } else {
      CFB.notify.error('Gagal mengunggah', res.error);
      updateFirebasePanel();
    }
  }

  function renderFacilities() {
    updateFirebasePanel();
    const facilities = CFB.data.getFacilities();
    const st = CFB.data.getFacilityStats();
    $('#facCount').textContent = st.mode === 'firebase'
      ? facilities.length + ' fasilitas \u00b7 tersinkon Firebase'
      : facilities.length + ' fasilitas \u00b7 ' + st.created + ' ditambah \u00b7 ' +
        st.updated + ' diubah \u00b7 ' + st.deleted + ' dihapus';
    const noteEl = $('#facNote');
    if (noteEl) {
      noteEl.innerHTML = st.mode === 'firebase'
        ? 'Perubahan langsung ditulis ke <strong>Firebase Realtime Database</strong> sehingga langsung terlihat oleh semua pengguna setelah dimuat ulang. Tombol <em>Reset</em> menimpa data fasilitas di server dengan isi <code>data/facilities.json</code>.'
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
        '  <button type="button" class="btn-icon" data-edit="' + esc(f.id) + '" title="Ubah">' + CFB.icons.edit + '</button>' +
        '  <button type="button" class="btn-icon danger" data-del="' + esc(f.id) + '" title="Hapus">' + CFB.icons.trash + '</button>' +
        '</td></tr>';
    }).join('');
    if (!facilities.length) tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Tidak ada fasilitas.</td></tr>';

    $$('#facTable [data-edit]').forEach(b => b.addEventListener('click', () => openFacilityModal(b.dataset.edit)));
    $$('#facTable [data-del]').forEach(b => b.addEventListener('click', () => deleteFacility(b.dataset.del)));
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
        obj.id + ' \u00b7 ' + obj.name + (CFB.data.getMode() === 'firebase'
          ? ' \u2014 tersimpan di Firebase, terlihat oleh semua pengguna.'
          : ' \u2014 langsung terlihat di sisi pengguna.'));
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
        (CFB.data.getMode() === 'firebase' ? ' dari <strong>Firebase (untuk semua pengguna)</strong>' : ' dari daftar pada perangkat ini') + '.' +
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
        ? 'Data fasilitas di <strong>Firebase</strong> akan ditimpa dengan isi <code>data/facilities.json</code>. Perubahan (tambahan/ubahan/hapusan) di server hilang. Pengajuan tidak terpengaruh.'
        : 'Semua perubahan admin (tambahan, ubahan, hapusan) akan dibatalkan dan kembali ke isi <code>data/facilities.json</code>. Pengajuan tidak terpengaruh.',
      confirmText: 'Ya, reset'
    });
    if (!ok) return;
    const res = await CFB.data.resetFacilities();
    if (!res.ok) { CFB.notify.error('Gagal reset', res.error); return; }
    CFB.notify.success('Data direset',
      res.target === 'firebase'
        ? 'Fasilitas di Firebase dikembalikan ke data awal.'
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

  async function seedDemoFlow() {
    if (CFB.data.getBookings().length) {
      const ok = await CFB.confirm({
        title: 'Muat data contoh?',
        html: '14 pengajuan contoh akan <strong>ditambahkan</strong> ke data yang ada (data lama tidak terhapus)' +
          (CFB.data.getMode() === 'firebase' ? ' dan tersimpan di <strong>Firebase</strong> (terlihat semua pengguna)' : '') +
          '. Digunakan untuk melihat tampilan analitik.',
        confirmText: 'Ya, muat data contoh'
      });
      if (!ok) return;
    }
    await seedDemoBookings();
  }

  // ============ Bind & Init ============
  function bind() {
    $('#gateForm').addEventListener('submit', tryLogin);
    $('#gateCode').addEventListener('input', () => {
      $('#gateError').hidden = true;
      $('#gateCode').classList.remove('invalid');
      const row = $('#gateCode').closest('.form-row');
      if (row) row.classList.remove('has-error');
    });
    $('#logoutBtn').addEventListener('click', async () => {
      sessionStorage.removeItem(GATE_KEY);
      CFB.notify.info('Anda telah keluar', 'Sesi admin ditutup.');
      showGate();
    });

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
          ? 'Seluruh <strong>' + CFB.data.getBookings().length + ' pengajuan</strong> akan dihapus dari <strong>Firebase (untuk semua pengguna)</strong>. Tindakan ini tidak dapat dibatalkan.'
          : 'Seluruh <strong>' + CFB.data.getBookings().length + ' pengajuan</strong> akan dihapus permanen dari perangkat ini. Tindakan ini tidak dapat dibatalkan.',
        confirmText: 'Ya, hapus semua'
      });
      if (!ok) return;
      const done = await CFB.data.clearBookings();
      if (!done) return;
      CFB.notify.success('Semua pengajuan dihapus', fb ? 'Data pengajuan pada Firebase telah dikosongkan.' : 'Data pengajuan pada perangkat ini telah dikosongkan.');
      renderBookings();
    });

    $('#facAddBtn').addEventListener('click', () => openFacilityModal(null));
    $('#facResetBtn').addEventListener('click', resetToSeed);
    $('#fbSeedBtn').addEventListener('click', seedFirebaseFlow);
    $('#fbReloadBtn').addEventListener('click', () => location.reload());

    window.addEventListener('hashchange', () => {
      if (!$('#adminShell').hidden) renderTab();
    });
  }

  async function init() {
    bind();
    try {
      await CFB.data.load();
      CFB.data.noticeModeOnce();
    } catch (err) {
      console.error(err);
      CFB.notify.error('Data tidak termuat', 'Pastikan diakses lewat HTTP server (lihat README).');
    }
    updateFirebasePanel();
    if (sessionStorage.getItem(GATE_KEY) === '1') showShell();
    else showGate();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
