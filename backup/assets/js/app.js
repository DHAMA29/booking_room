/* ============================================
   Campus Facility Booking — App Logic (Sisi Pengguna)
   Alur: Explore → Select → Schedule → Request → Summary
   Bergantung pada: core.js, data.js
   ============================================ */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = CFB.util.esc;

  const state = {
    facilityId: null,
    date: null,
    startHour: null,
    duration: null,
    lastBookingId: null,
    q: '', fCategory: 'all', fStatus: 'all', fCapacity: 'all', fSort: 'name-asc'
  };

  // ============ Halaman ============
  function showPage(name) {
    $$('.page').forEach(p => { p.hidden = true; });
    const el = $('#page-' + name);
    if (el) { el.hidden = false; CFB.util.animateIn(el); }
    $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  // ============ Status helper ============
  const STATUS_META = {
    Available: { label: 'Tersedia', cls: 'st-ok' },
    Limited: { label: 'Terbatas', cls: 'st-ltd' },
    Unavailable: { label: 'Tidak Tersedia', cls: 'st-no' }
  };
  function statusMeta(s) { return STATUS_META[s] || { label: s, cls: 'st-ok' }; }
  function statusBadge(s) {
    const map = { Pending: 'Menunggu Persetujuan', Approved: 'Disetujui', Rejected: 'Ditolak' };
    return '<span class="status-badge status-' + String(s).toLowerCase() + '">' + (map[s] || s) + '</span>';
  }

  function updateBookingBadge() {
    const n = CFB.data.getMyBookings().length;
    const badge = $('#bookingBadge');
    if (n > 0) { badge.textContent = n; badge.hidden = false; } else badge.hidden = true;
  }

  /* Badge sumber data di footer (Firebase / mode lokal) */
  function updateModeUI() {
    const el = $('#dataModeBadge');
    if (!el) return;
    const st = CFB.data.fbStatus();
    if (st.mode === 'firebase') {
      el.className = 'mode-pill mode-fb';
      el.innerHTML = '<span class="dot"></span>Firebase Realtime Database';
      el.title = 'Data fasilitas & pengajuan tersinkron lintas perangkat.';
    } else {
      el.className = 'mode-pill mode-local';
      el.innerHTML = '<span class="dot"></span>Mode Lokal (LocalStorage)';
      el.title = st.reason === 'empty'
        ? 'Firebase kosong — unggah data awal dari Admin Panel.'
        : (st.reason === 'denied'
          ? 'Firebase menolak akses — atur Rules (lihat README).'
          : 'Firebase tidak aktif — data tersimpan di browser ini saja.');
    }
  }

  function bookingRangeLabel(b) {
    return CFB.util.rangeLabel(b.startHour, b.endHour);
  }

  // ============ Explore ============
  function applyFilters() {
    let list = CFB.data.getFacilities().slice();
    const q = state.q.trim().toLowerCase();
    if (q) {
      list = list.filter(f =>
        f.name.toLowerCase().includes(q) ||
        String(f.category || '').toLowerCase().includes(q) ||
        f.location.toLowerCase().includes(q) ||
        (f.facilities || []).some(a => String(a).toLowerCase().includes(q))
      );
    }
    if (state.fCategory !== 'all') list = list.filter(f => f.category === state.fCategory);
    if (state.fStatus !== 'all') list = list.filter(f => f.status === state.fStatus);
    if (state.fCapacity !== 'all') {
      list = list.filter(f => {
        const c = f.capacity;
        if (state.fCapacity === 'small') return c <= 40;
        if (state.fCapacity === 'medium') return c >= 41 && c <= 100;
        if (state.fCapacity === 'large') return c >= 101 && c <= 250;
        if (state.fCapacity === 'xlarge') return c > 250;
        return true;
      });
    }
    list.sort((a, b) => {
      switch (state.fSort) {
        case 'name-asc': return a.name.localeCompare(b.name);
        case 'name-desc': return b.name.localeCompare(a.name);
        case 'capacity-asc': return a.capacity - b.capacity;
        case 'capacity-desc': return b.capacity - a.capacity;
        default: return 0;
      }
    });

    const ul = $('#facilityList');
    const empty = $('#emptyState');
    ul.innerHTML = '';
    $('#resultsCount').textContent = list.length + ' fasilitas ditemukan';
    if (!list.length) { empty.hidden = false; return; }
    empty.hidden = true;

    list.forEach(f => {
      const sm = statusMeta(f.status);
      const li = document.createElement('li');
      li.className = 'facility-item';
      li.setAttribute('role', 'button');
      li.setAttribute('tabindex', '0');
      li.innerHTML =
        '<div class="facility-info">' +
        '  <h3 class="facility-name">' + esc(f.name) + '</h3>' +
        '  <p class="facility-meta">' +
        '    <span class="st ' + sm.cls + '">' + sm.label + '</span>' +
        '    <span>' + esc(f.category || '—') + '</span>' +
        '    <span>' + esc(f.location) + '</span>' +
        '    <span>' + f.capacity + ' orang</span>' +
        '  </p>' +
        '  <p class="facility-amenities">' + ((f.facilities || []).map(esc).join(' \u00b7 ') || '—') + '</p>' +
        '</div>' +
        '<div class="facility-side">' +
        '  <p class="facility-capacity">' + f.capacity + ' <small>orang</small></p>' +
        '  <span class="facility-cta">Lihat detail ' +
        '    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M7 4 L13 10 L7 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '  </span>' +
        '</div>';
      li.addEventListener('click', () => navigateToDetail(f.id));
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateToDetail(f.id); }
      });
      ul.appendChild(li);
    });
    CFB.util.stagger(ul);
  }

  // ============ Detail ============
  function navigateToDetail(id) {
    state.facilityId = id;
    renderDetail();
    location.hash = '#/facility/' + id;
  }

  function renderDetail() {
    const f = CFB.data.getFacilityById(state.facilityId);
    if (!f) { goExplore(); return; }
    const sm = statusMeta(f.status);
    const maxDur = CFB.data.policy().maxDurationHours;
    const bookable = f.status !== 'Unavailable';
    const cta = bookable
      ? '<button class="btn-primary sidebar-cta" id="bookNowBtn">Ajukan peminjaman</button>'
      : '<button class="btn-primary sidebar-cta" disabled>Fasilitas tidak tersedia</button>';
    const note = f.status === 'Limited'
      ? '<div class="sidebar-note">Status <strong>Terbatas</strong>: pengajuan tetap dapat diajukan, namun akan ditinjau lebih ketat oleh pengelola fasilitas.</div>'
      : (f.status === 'Unavailable'
        ? '<div class="sidebar-note no">Fasilitas ini sedang <strong>tidak tersedia</strong> untuk peminjaman (perbaikan / tidak aktif).</div>'
        : '');

    $('#detailContent').innerHTML =
      '<div class="detail-head">' +
      '  <p class="detail-eyebrow"><span class="st ' + sm.cls + '">' + sm.label + '</span></p>' +
      '  <h1 class="detail-name" id="detail-title">' + esc(f.name) + '</h1>' +
      '  <div class="detail-meta">' +
      '    <span>' + esc(f.category || '—') + '</span>' +
      '    <span>' + esc(f.location) + '</span>' +
      '    <span>Kapasitas ' + f.capacity + ' orang</span>' +
      '    <span>' + f.openHours.start + ' - ' + f.openHours.end + ' WIB</span>' +
      '  </div>' +
      '</div>' +
      '<div class="detail-body">' +
      '  <div>' +
      '    <div class="detail-section"><h2>Tentang fasilitas</h2><p>' + esc(f.description || 'Belum ada deskripsi.') + '</p></div>' +
      '    <div class="detail-section"><h2>Perangkat &amp; fasilitas pendukung</h2>' +
      '      <ul class="detail-amenities-list">' + ((f.facilities || []).map(a => '<li>' + esc(a) + '</li>').join('') || '<li>—</li>') + '</ul>' +
      '    </div>' +
      '    <div class="detail-section"><h2>Jam &amp; durasi peminjaman</h2>' +
      '      <p>Setiap hari pukul <strong>' + f.openHours.start + ' - ' + f.openHours.end + ' WIB</strong>. ' +
      '      Anda bebas memilih jam mulai dan durasi peminjaman <strong>1 sampai ' + maxDur + ' jam</strong> per pengajuan, ' +
      '      untuk jadwal maksimal ' + CFB.data.policy().bookingDaysAhead + ' hari ke depan. ' +
      '      Jam yang sudah terisi otomatis tidak dapat dipilih.</p>' +
      '    </div>' +
      '  </div>' +
      '  <aside class="detail-sidebar">' +
      '    <div class="sidebar-row"><span class="label">Kategori</span><span class="value">' + esc(f.category || '—') + '</span></div>' +
      '    <div class="sidebar-row"><span class="label">Lokasi</span><span class="value">' + esc(f.location) + '</span></div>' +
      '    <div class="sidebar-row"><span class="label">Kapasitas</span><span class="value">' + f.capacity + ' orang</span></div>' +
      '    <div class="sidebar-row"><span class="label">Jam operasional</span><span class="value">' + f.openHours.start + ' - ' + f.openHours.end + '</span></div>' +
      '    <div class="sidebar-row"><span class="label">Durasi maksimal</span><span class="value">' + maxDur + ' jam</span></div>' +
      '    <div class="sidebar-row"><span class="label">Status</span><span class="value"><span class="st ' + sm.cls + '">' + sm.label + '</span></span></div>' +
      '    ' + note +
      '    ' + cta +
      '  </aside>' +
      '</div>';
    if (bookable) $('#bookNowBtn').addEventListener('click', goSchedule);
    showPage('detail');
  }

  // ============ Schedule ============
  function goSchedule() {
    if (!CFB.data.getFacilityById(state.facilityId)) { goExplore(); return; }
    state.date = null; state.startHour = null; state.duration = null;
    renderSchedule();
    location.hash = '#/schedule';
  }

  function renderSchedule() {
    const f = CFB.data.getFacilityById(state.facilityId);
    if (!f) { goExplore(); return; }
    const maxDur = CFB.data.policy().maxDurationHours;

    $('#scheduleFacilitySummary').innerHTML =
      '<div><p class="ss-name">' + esc(f.name) + '</p>' +
      '<p class="ss-meta">' + esc(f.location) + ' \u00b7 Kapasitas ' + f.capacity + ' orang \u00b7 ' + f.openHours.start + ' - ' + f.openHours.end + ' WIB</p></div>';

    const chips = $('#dateChips');
    chips.innerHTML = '';
    CFB.data.bookableDates().forEach(ds => {
      const p = CFB.util.dateParts(ds);
      const closure = CFB.data.dayClosure(f.id, ds);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'date-chip';
      chip.dataset.date = ds;
      chip.setAttribute('aria-checked', 'false');
      if (closure) { chip.disabled = true; chip.title = closure.note || 'Tidak tersedia'; }
      chip.innerHTML =
        '<span class="dc-day">' + p.day + '</span>' +
        '<span class="dc-date">' + p.date + '</span>' +
        '<span class="dc-month">' + p.month + '</span>';
      chip.addEventListener('click', () => selectDate(ds, chip));
      chips.appendChild(chip);
    });
    CFB.util.stagger(chips);

    $('#timeSlots').innerHTML = '<p class="muted">Pilih tanggal terlebih dahulu untuk melihat jam yang tersedia.</p>';
    $('#durationBlock').hidden = true;
    $('#timeSummary').hidden = true;
    $('#durationMaxLabel').textContent = maxDur;
    $('#durationMaxLabel2').textContent = maxDur;
    updateContinueBtn();
    showPage('schedule');
  }

  function selectDate(ds, chipEl) {
    state.date = ds;
    state.startHour = null;
    state.duration = null;
    $$('.date-chip').forEach(c => c.setAttribute('aria-checked', 'false'));
    chipEl.setAttribute('aria-checked', 'true');
    renderHours();
    $('#durationBlock').hidden = true;
    $('#timeSummary').hidden = true;
    updateContinueBtn();
  }

  function renderHours() {
    const f = CFB.data.getFacilityById(state.facilityId);
    const wrap = $('#timeSlots');
    if (!f || !state.date) return;
    const { start, end } = CFB.data.hoursOfDay(f);
    const today = CFB.util.todayStr();
    const nowH = CFB.util.nowHour();

    wrap.innerHTML = '';
    let anyFree = false;
    for (let h = start; h < end; h++) {
      const taken = CFB.data.isHourTaken(f.id, state.date, h);
      const past = (state.date === today && h <= nowH);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'time-slot' + (taken ? ' taken' : '') + (past ? ' past' : '');
      btn.dataset.hour = h;
      btn.setAttribute('aria-checked', 'false');
      btn.textContent = CFB.util.hourLabel(h);
      if (taken || past) {
        btn.disabled = true;
        btn.title = past ? 'Jam sudah terlewat' : 'Sudah terisi';
      } else {
        anyFree = true;
        btn.addEventListener('click', () => selectHour(h, btn));
      }
      wrap.appendChild(btn);
    }
    if (!anyFree) {
      wrap.innerHTML = '<p class="muted">Semua jam pada tanggal ini sudah terisi atau terlewat. Silakan pilih tanggal lain.</p>';
    }
    CFB.util.stagger(wrap);
  }

  function selectHour(h, btnEl) {
    state.startHour = h;
    state.duration = null;
    $$('.time-slot').forEach(b => b.setAttribute('aria-checked', 'false'));
    btnEl.setAttribute('aria-checked', 'true');
    renderDuration();
    $('#timeSummary').hidden = true;
    updateContinueBtn();
  }

  function renderDuration() {
    const f = CFB.data.getFacilityById(state.facilityId);
    const block = $('#durationBlock');
    const wrap = $('#durationOptions');
    if (!f || state.startHour == null) { block.hidden = true; return; }

    const opts = CFB.data.durationOptions(f, state.date, state.startHour);
    const { end } = CFB.data.hoursOfDay(f);
    const maxDur = CFB.data.policy().maxDurationHours;

    wrap.innerHTML = '';
    for (let d = 1; d <= maxDur; d++) {
      const available = opts.includes(d);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dp-opt';
      btn.dataset.dur = d;
      btn.setAttribute('aria-checked', 'false');
      btn.innerHTML =
        '<strong>' + d + ' jam</strong>' +
        '<span>' + CFB.util.rangeLabel(state.startHour, state.startHour + d) + ' WIB</span>';
      if (!available) {
        btn.disabled = true;
        btn.title = (state.startHour + d > end)
          ? 'Melebihi jam tutup fasilitas'
          : 'Jam berikutnya sudah terisi';
      } else {
        btn.addEventListener('click', () => chooseDuration(d, btn));
      }
      wrap.appendChild(btn);
    }

    // pilih otomatis durasi terpendek yang tersedia
    if (opts.length) {
      const first = wrap.querySelector('[data-dur="' + opts[0] + '"]');
      chooseDuration(opts[0], first);
    }
    block.hidden = false;
    CFB.util.animateIn(block);
  }

  function chooseDuration(d, btnEl) {
    state.duration = d;
    $$('.dp-opt').forEach(b => b.setAttribute('aria-checked', 'false'));
    if (btnEl) btnEl.setAttribute('aria-checked', 'true');
    updateTimeSummary();
    updateContinueBtn();
  }

  function updateTimeSummary() {
    const el = $('#timeSummary');
    if (!state.date || state.startHour == null || !state.duration) { el.hidden = true; return; }
    const p = CFB.util.dateParts(state.date);
    el.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>' +
      '<span><strong>' + p.full + '</strong></span>' +
      '<span class="ts-sep">\u00b7</span>' +
      '<span>' + CFB.util.rangeLabel(state.startHour, state.startHour + state.duration) + ' WIB</span>' +
      '<span class="ts-sep">\u00b7</span>' +
      '<span>' + state.duration + ' jam</span>';
    el.hidden = false;
    CFB.util.animateIn(el, 'pop-enter');
  }

  function updateContinueBtn() {
    $('#continueToRequest').disabled = !(state.date && state.startHour != null && state.duration);
  }

  // ============ Request ============
  function goRequest() {
    if (!state.facilityId || !state.date || state.startHour == null || !state.duration) {
      CFB.notify.error('Belum lengkap', 'Mohon pilih tanggal, jam mulai, dan durasi terlebih dahulu.');
      goSchedule();
      return;
    }
    renderRequest();
    location.hash = '#/request';
  }

  function renderRequest() {
    const f = CFB.data.getFacilityById(state.facilityId);
    const p = CFB.util.dateParts(state.date);
    $('#requestSummary').innerHTML =
      '<p class="rs-title">' + esc(f.name) + '</p>' +
      '<p>' + esc(f.location) + ' \u00b7 Kapasitas ' + f.capacity + ' orang</p>' +
      '<p>' + p.full + ' \u00b7 ' + CFB.util.rangeLabel(state.startHour, state.startHour + state.duration) +
      ' WIB \u00b7 ' + state.duration + ' jam</p>';

    const form = $('#bookingForm');
    form.reset();
    $$('.form-row', form).forEach(r => r.classList.remove('has-error', 'shake'));
    $$('.field-error', form).forEach(e => { e.textContent = ''; });
    $$('.invalid', form).forEach(el => el.classList.remove('invalid'));
    $('#suggestBox').hidden = true;
    updatePurposeCount();
    showPage('request');
  }

  function updatePurposeCount() {
    const c = $('#purposeCount');
    if (c) c.textContent = $('#f-purpose').value.length;
  }

  // ============ Validasi per field ============
  function validateField(name, value) {
    const V = CFB.validators;
    switch (name) {
      case 'name': return V.name(value);
      case 'nim': return V.nim(value);
      case 'email': return V.email(value);
      case 'phone': return V.phoneLocal(value);
      case 'participants': return V.participants(value, CFB.data.getFacilityById(state.facilityId)?.capacity);
      case 'organization': return V.organization(value);
      case 'purpose': return V.purpose(value);
      case 'agreement': return value ? '' : 'Anda harus menyetujui ketentuan peminjaman';
      default: return '';
    }
  }

  function setFieldError(name, msg) {
    const errEl = $('[data-error-for="' + name + '"]');
    const inputEl = (name === 'phone') ? $('#f-phone') : $('#f-' + name);
    const row = inputEl ? (inputEl.closest('.form-row') || inputEl.closest('.phone-row')) : null;
    if (errEl) errEl.textContent = msg || '';
    if (inputEl) inputEl.classList.toggle('invalid', !!msg);
    if (row) row.classList.toggle('has-error', !!msg);
  }

  /* Saran ruang lain bila jumlah peserta jauh di bawah kapasitas */
  function updateSuggestion() {
    const box = $('#suggestBox');
    const f = CFB.data.getFacilityById(state.facilityId);
    const raw = $('#f-participants').value;
    const n = parseInt(raw, 10);
    if (!f || !raw || isNaN(n) || n < 1 || n > f.capacity || n > f.capacity * 0.4) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    const alts = CFB.data.suggestAlternatives(f, n);
    if (!alts.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.innerHTML =
      '<p class="sg-title">' + CFB.icons.warningSmall + ' Ruang ini mungkin terlalu besar</p>' +
      '<p class="sg-text">Kapasitas <strong>' + esc(f.name) + '</strong> adalah ' + f.capacity +
      ' orang, sementara kebutuhan Anda ' + n + ' orang. Ruang berikut lebih sesuai:</p>' +
      '<div class="sg-list">' + alts.map(a =>
        '<div class="sg-item">' +
        '  <div><span class="sg-name">' + esc(a.name) + '</span>' +
        '  <span class="sg-meta">' + esc(a.category || '—') + ' \u00b7 ' + a.capacity + ' orang \u00b7 ' + esc(a.location) + '</span></div>' +
        '  <a href="index.html#/facility/' + encodeURIComponent(a.id) + '" target="_blank" rel="noopener">Lihat</a>' +
        '</div>').join('') +
      '</div>';
    box.hidden = false;
    CFB.util.animateIn(box);
  }

  // ============ Submit ============
  async function handleSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    let valid = true;
    const firstInvalid = [];

    ['name', 'nim', 'email', 'phone', 'participants', 'organization', 'purpose', 'agreement'].forEach(name => {
      const val = name === 'agreement'
        ? formData.get('agreement') === 'on'
        : String(formData.get(name) || '');
      const msg = validateField(name, val);
      setFieldError(name, msg);
      if (msg) { valid = false; firstInvalid.push(name); }
    });

    if (!valid) {
      CFB.notify.error('Pengajuan belum dapat dikirim', 'Periksa kembali ' + firstInvalid.length + ' isian yang ditandai merah.');
      const firstRow = $('.form-row.has-error') || $('.phone-row.has-error');
      if (firstRow) {
        firstRow.classList.add('shake');
        setTimeout(() => firstRow.classList.remove('shake'), 450);
        firstRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    // Cegah double-booking: pastikan rentang jam masih bebas saat submit
    const f = CFB.data.getFacilityById(state.facilityId);
    if (!f) { CFB.notify.error('Fasilitas tidak ditemukan', ''); return; }
    if (f.status === 'Unavailable') {
      CFB.notify.error('Tidak dapat diajukan', 'Fasilitas ini tidak tersedia untuk peminjaman.');
      goExplore();
      return;
    }
    if (!CFB.data.isRangeFree(f.id, state.date, state.startHour, state.duration)) {
      CFB.notify.error('Slot sudah terisi', 'Maaf, jam pilihan Anda baru saja diambil pengguna lain. Silakan pilih jam lain.');
      goSchedule();
      return;
    }

    const local = CFB.format.cleanPhoneLocal(formData.get('phone'));
    const booking = {
      id: CFB.data.generateBookingId(),
      facilityId: f.id,
      facilityName: f.name,
      category: f.category || '',
      location: f.location,
      capacity: f.capacity,
      date: state.date,
      dateLabel: CFB.util.dateParts(state.date).full,
      startHour: state.startHour,
      endHour: state.startHour + state.duration,
      durationHours: state.duration,
      slotLabel: CFB.util.rangeLabel(state.startHour, state.startHour + state.duration),
      name: String(formData.get('name')).trim(),
      nim: String(formData.get('nim')).trim().toUpperCase(),
      email: String(formData.get('email')).trim().toLowerCase(),
      phone: '+62 ' + CFB.format.phoneLocal(local),
      participants: parseInt(formData.get('participants'), 10),
      organization: String(formData.get('organization')).trim(),
      purpose: String(formData.get('purpose')).trim(),
      notes: String(formData.get('notes') || '').trim(),
      status: 'Pending',
      createdAt: new Date().toISOString()
    };
    const saved = await CFB.data.addBooking(booking);
    if (!saved) return; // toast error sudah ditampilkan data layer
    state.lastBookingId = saved.id;
    updateBookingBadge();
    renderSummary(saved);
    location.hash = '#/summary';
    CFB.notify.success('Pengajuan berhasil dikirim', 'Nomor referensi: ' + saved.id);
  }

  // ============ Summary ============
  function renderSummary(b) {
    const rejectNote = (b.status === 'Rejected' && b.rejectReason)
      ? '<div><p class="sg-label">Alasan penolakan</p><p class="sg-value">' + esc(b.rejectReason) + '</p></div>'
      : '';
    $('#summaryContent').innerHTML =
      '<div class="success-hero">' +
      '  <div class="success-icon">' + CFB.icons.bigCheck + '</div>' +
      '  <div class="success-body">' +
      '    <p class="sh-title">Pengajuan berhasil dikirim</p>' +
      '    <p class="sh-sub">Nomor referensi <strong class="sh-ref">' + esc(b.id) + '</strong> ' + statusBadge(b.status) + '</p>' +
      '    <p class="sh-note">Simpan nomor referensi untuk memantau status. Pengelola akan meninjau pengajuan Anda dan status dapat dilihat kapan saja di halaman <a href="#/bookings">Peminjaman Saya</a>.</p>' +
      '  </div>' +
      '</div>' +
      '<div class="summary-card">' +
      '  <div class="summary-grid">' +
      '    <div><p class="sg-label">Fasilitas</p><p class="sg-value">' + esc(b.facilityName) + '</p></div>' +
      '    <div><p class="sg-label">Kategori</p><p class="sg-value">' + esc(b.category || '—') + '</p></div>' +
      '    <div><p class="sg-label">Lokasi</p><p class="sg-value">' + esc(b.location) + '</p></div>' +
      '    <div><p class="sg-label">Tanggal</p><p class="sg-value">' + esc(b.dateLabel || b.date) + '</p></div>' +
      '    <div><p class="sg-label">Waktu</p><p class="sg-value">' + esc(b.slotLabel) + ' WIB \u00b7 ' + (b.durationHours || 2) + ' jam</p></div>' +
      '    <div><p class="sg-label">Jumlah peserta</p><p class="sg-value">' + b.participants + ' orang (kapasitas ' + b.capacity + ')</p></div>' +
      '    <div><p class="sg-label">Peminjam</p><p class="sg-value">' + esc(b.name) + '</p></div>' +
      '    <div><p class="sg-label">NIM</p><p class="sg-value">' + esc(b.nim) + '</p></div>' +
      '    <div><p class="sg-label">Email</p><p class="sg-value">' + esc(b.email) + '</p></div>' +
      '    <div><p class="sg-label">Telepon</p><p class="sg-value">' + esc(b.phone) + '</p></div>' +
      '    <div><p class="sg-label">Organisasi / Prodi</p><p class="sg-value">' + esc(b.organization) + '</p></div>' +
      '    <div><p class="sg-label">Diajukan pada</p><p class="sg-value">' + new Date(b.createdAt).toLocaleString('id-ID') + '</p></div>' +
      '    <div class="sg-wide"><p class="sg-label">Tujuan peminjaman</p><p class="sg-value">' + esc(b.purpose) + '</p></div>' +
      (b.notes ? '<div class="sg-wide"><p class="sg-label">Catatan</p><p class="sg-value">' + esc(b.notes) + '</p></div>' : '') +
      '    ' + rejectNote +
      '  </div>' +
      '</div>';
    showPage('summary');
  }

  // ============ Peminjaman Saya ============
  function renderBookings() {
    const list = CFB.data.getMyBookings();
    const wrap = $('#bookingsList');
    wrap.innerHTML = '';
    $('#bookingsEmpty').hidden = !!list.length;
    list.forEach(b => {
      const div = document.createElement('div');
      div.className = 'booking-item';
      div.innerHTML =
        '<div class="bi-info">' +
        '  <p class="bi-name">' + esc(b.facilityName) + '</p>' +
        '  <p class="bi-meta">' +
        '    <span>' + esc(b.dateLabel || b.date) + '</span>' +
        '    <span>' + esc(bookingRangeLabel(b)) + ' WIB \u00b7 ' + (b.durationHours || 2) + ' jam</span>' +
        '    <span>' + b.participants + ' peserta</span>' +
        '    <span>' + esc(b.name) + '</span>' +
        '  </p>' +
        '</div>' +
        '<div class="bi-side">' +
        '  ' + statusBadge(b.status) +
        '  <span class="bi-ref">' + esc(b.id) + '</span>' +
        '</div>';
      wrap.appendChild(div);
    });
    CFB.util.stagger(wrap);
    showPage('bookings');
  }

  // ============ Router ============
  function goExplore() {
    state.facilityId = null; state.date = null; state.startHour = null; state.duration = null;
    location.hash = '#/';
    applyFilters();
    showPage('explore');
  }

  function handleHashChange() {
    const hash = location.hash.slice(1) || '/';
    if (hash === '/' || hash === '') {
      applyFilters();
      showPage('explore');
    } else if (hash === '/bookings') {
      refreshThenRender(() => { renderBookings(); });
    } else if (hash === '/schedule') {
      refreshThenRender(() => { state.facilityId ? renderSchedule() : goExplore(); });
    } else if (hash === '/request') {
      (state.facilityId && state.date && state.startHour != null && state.duration)
        ? renderRequest()
        : (state.facilityId ? renderSchedule() : goExplore());
    } else if (hash === '/summary') {
      const b = CFB.data.getBookingById(state.lastBookingId);
      b ? renderSummary(b) : goExplore();
    } else if (hash.startsWith('/facility/')) {
      const id = decodeURIComponent(hash.split('/')[2] || '');
      if (id && CFB.data.getFacilityById(id)) { state.facilityId = id; renderDetail(); }
      else goExplore();
    } else {
      goExplore();
    }
  }

  /* Segarkan pengajuan dari Firebase (mode firebase) lalu render ulang */
  function refreshThenRender(renderFn) {
    if (CFB.data.getMode() === 'firebase') {
      CFB.data.refreshBookings().catch(() => {}).then(() => {
        updateBookingBadge();
        renderFn();
      });
    } else {
      renderFn();
    }
  }

  // ============ Events ============
  function bindEvents() {
    $('#searchInput').addEventListener('input', (e) => { state.q = e.target.value; applyFilters(); });
    $('#categoryFilter').addEventListener('change', (e) => { state.fCategory = e.target.value; applyFilters(); });
    $('#statusFilter').addEventListener('change', (e) => { state.fStatus = e.target.value; applyFilters(); });
    $('#capacityFilter').addEventListener('change', (e) => { state.fCapacity = e.target.value; applyFilters(); });
    $('#sortFilter').addEventListener('change', (e) => { state.fSort = e.target.value; applyFilters(); });

    $('#resetSearch').addEventListener('click', () => {
      state.q = ''; state.fCategory = 'all'; state.fStatus = 'all'; state.fCapacity = 'all'; state.fSort = 'name-asc';
      $('#searchInput').value = '';
      $('#categoryFilter').value = 'all';
      $('#statusFilter').value = 'all';
      $('#capacityFilter').value = 'all';
      $('#sortFilter').value = 'name-asc';
      applyFilters();
    });

    $$('[data-action="back-explore"]').forEach(b => b.addEventListener('click', goExplore));
    $$('[data-action="back-detail"]').forEach(b => b.addEventListener('click', () => {
      if (state.facilityId) { renderDetail(); location.hash = '#/facility/' + state.facilityId; }
      else goExplore();
    }));
    $$('[data-action="back-schedule"]').forEach(b => b.addEventListener('click', () => { renderSchedule(); location.hash = '#/schedule'; }));

    $('#continueToRequest').addEventListener('click', goRequest);
    $('#bookingForm').addEventListener('submit', handleSubmit);
    $('#f-purpose').addEventListener('input', updatePurposeCount);

    // Validasi saat blur; hapus error saat diketik ulang
    ['name', 'nim', 'email', 'phone', 'participants', 'organization', 'purpose'].forEach(name => {
      const el = $('#f-' + name);
      if (!el) return;
      el.addEventListener('blur', () => {
        if (name === 'nim') el.value = CFB.format.nim(el.value);
        if (name === 'phone') el.value = CFB.format.phoneLocal(el.value);
        setFieldError(name, validateField(name, el.value));
        if (name === 'participants') updateSuggestion();
      });
      el.addEventListener('input', () => {
        if (name === 'nim') el.value = CFB.format.nim(el.value);
        if (name === 'phone') el.value = CFB.format.phoneLocal(el.value);
        const row = el.closest('.form-row');
        if (row && row.classList.contains('has-error') && !validateField(name, el.value)) setFieldError(name, '');
      });
    });

    // NIM & email: rapikan saat keluar field
    $('#f-email').addEventListener('blur', (e) => { e.target.value = e.target.value.trim().toLowerCase(); });

    // Peserta: cek saran ruang setiap perubahan
    $('#f-participants').addEventListener('input', updateSuggestion);

    const ag = $('#f-agreement');
    ag.addEventListener('change', () => setFieldError('agreement', validateField('agreement', ag.checked)));

    window.addEventListener('hashchange', handleHashChange);
  }

  // ============ Init ============
  async function init() {
    bindEvents();
    try {
      await CFB.data.load();
      updateModeUI();
      CFB.data.noticeModeOnce();
      updateBookingBadge();
      handleHashChange();
    } catch (err) {
      console.error(err);
      $('#resultsCount').textContent = 'Gagal memuat data.';
      $('#emptyState').hidden = false;
      $('#emptyState').querySelector('.empty-title').textContent = 'Data tidak termuat';
      $('#emptyState').querySelector('.empty-hint').innerHTML =
        'Aplikasi memuat data dari <code>data/*.json</code> sehingga harus diakses lewat HTTP server ' +
        '(mis. <code>python3 -m http.server</code>), bukan membuka file langsung.';
      showPage('explore');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
