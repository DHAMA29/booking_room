/* ============================================
   Gamaspace — App Logic (Sisi Pengguna)
   Alur: Explore → Detail → Schedule → Request → Summary → Bookings
   Bergantung pada: i18n.js, core.js, firebase-config.js, auth.js,
                    data.js, floorplan.js, proof.js
   Fitur:
   - Transisi antar halaman halus (View Transitions API + fallback CSS)
   - Multi-bahasa ID/EN (CFB.i18n)
   - Denah ruangan interaktif (CFB.floorplan)
   - Kartu bukti pengajuan + QR (CFB.proof)
   - Login Firebase Auth (Google / email) + riwayat terikat akun
   - Gerbang login muncul saat "Ajukan Peminjaman" ditekan pada
     halaman ruangan (bukan lagi menunggu submit di langkah akhir)
   ============================================ */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = CFB.util.esc;
  const T = (k, p) => CFB.i18n.t(k, p);

  const state = {
    facilityId: null,
    date: null,
    startHour: null,
    duration: null,
    lastBookingId: null,
    q: '', fCategory: 'all', fStatus: 'all', fCapacity: 'all', fSort: 'name-asc'
  };

  /* Identitas peminjam:
     - profileReturn   → tujuan kembali setelah menyimpan halaman #/profile
     - wantIdentRedirect → true saat login lewat tombol Masuk nav; memicu
       pengalihan ke halaman identitas bila identitas belum lengkap
       (sesuai alur: login → isi identitas → pemesanan ter-isi otomatis).
     - guestProceeded → pengguna memilih "Lanjut tanpa akun" pada gerbang
       ruangan; gerbang di submit tidak mengganggu lagi (sesi ini). */
  let profileReturn = '/';
  let wantIdentRedirect = false;
  let guestProceeded = false;

  const reducedMotion = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ============ Halaman (dengan transisi halus) ============
  function showPage(name) {
    if (name !== 'request') hideSuggestion();
    const pages = $$('.page');
    const current = pages.find(p => !p.hidden);
    const next = $('#page-' + name);
    if (!next) return;

    const swap = () => {
      pages.forEach(p => { p.hidden = true; });
      next.hidden = false;
      $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
      window.scrollTo(0, 0);
    };

    /* Revisi: perpindahan antar halaman memakai cross-fade + geser halus
       (View Transitions API bila tersedia; fallback animasi CSS lama). */
    if (current !== next && document.startViewTransition && !reducedMotion()) {
      document.startViewTransition(swap);
    } else {
      swap();
      if (current !== next) CFB.util.animateIn(next);
    }
  }

  // ============ Status helper ============
  function statusMeta(s) {
    const map = { Available: 'st-ok', Limited: 'st-ltd', Unavailable: 'st-no' };
    return { cls: map[s] || 'st-ok', label: T('status.' + (s || 'Available')) };
  }
  function statusBadge(s) {
    const key = { Pending: 'book.Pending', Approved: 'book.Approved', Rejected: 'book.Rejected' }[s];
    return '<span class="status-badge status-' + String(s).toLowerCase() + '">' + esc(key ? T(key) : s) + '</span>';
  }

  function updateBookingBadge() {
    const n = CFB.data.getMyBookings().length;
    const badge = $('#bookingBadge');
    if (n > 0) { badge.textContent = n; badge.hidden = false; } else badge.hidden = true;
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
    $('#resultsCount').textContent = T('results.found', { n: list.length });
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
        '    <span class="st ' + sm.cls + '">' + esc(sm.label) + '</span>' +
        '    <span>' + esc(f.category || '—') + '</span>' +
        '    <span>' + esc(f.location) + '</span>' +
        '    <span>' + f.capacity + ' ' + esc(T('unit.people')) + '</span>' +
        '  </p>' +
        '  <p class="facility-amenities">' + ((f.facilities || []).map(esc).join(' \u00b7 ') || '—') + '</p>' +
        '</div>' +
        '<div class="facility-side">' +
        '  <p class="facility-capacity">' + f.capacity + ' <small>' + esc(T('unit.people')) + '</small></p>' +
        '  <span class="facility-cta">' + esc(T('cta.viewDetail')) +
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

  /* Gerbang login kini muncul di halaman ruangan: saat tombol
     "Ajukan Peminjaman" ditekan. Setelah login (dan identitas
     lengkap), pengguna langsung dibawa ke halaman jadwal. */
  async function onBookNow() {
    if (!(CFB.auth && CFB.auth.getUser && CFB.auth.getUser())) {
      const r = await openAuthModal('gate');
      if (r === 'cancel') return;                 // tetap di halaman ruangan
      if (r === 'guest') {
        guestProceeded = true;
        CFB.notify.warning(T('auth.gate.guestTitle'), T('auth.gate.guestNote'));
      } else {
        await ensureIdentity();                   // pasca-login: lengkapi identitas (bisa dilewati)
      }
    }
    goSchedule();
  }

  function renderDetail() {
    const f = CFB.data.getFacilityById(state.facilityId);
    if (!f) { goExplore(); return; }
    const sm = statusMeta(f.status);
    const maxDur = CFB.data.policy().maxDurationHours;
    const bookable = f.status !== 'Unavailable';
    const cta = bookable
      ? '<button class="btn-primary sidebar-cta" id="bookNowBtn">' + esc(T('detail.book')) + '</button>'
      : '<button class="btn-primary sidebar-cta" disabled>' + esc(T('detail.bookDisabled')) + '</button>';
    const note = f.status === 'Limited'
      ? '<div class="sidebar-note">' + T('detail.note.limited') + '</div>'
      : (f.status === 'Unavailable'
        ? '<div class="sidebar-note no">' + T('detail.note.unavailable') + '</div>'
        : '');

    /* Denah ruangan (bila admin telah mengaturnya) */
    let planHTML = '';
    if (CFB.floorplan.hasLayout(f)) {
      const fp = CFB.floorplan.render(f.layout, { uid: 'fp-user-' + f.id, aria: T('detail.plan.aria', { name: f.name }) });
      planHTML =
        '<div class="detail-section plan-section"><h2>' + esc(T('detail.plan')) + '</h2>' +
        '  <div class="plan-box">' + fp.svg + '</div>' +
        CFB.floorplan.legendHTML(f.layout) +
        '</div>';
    }

    $('#detailContent').innerHTML =
      '<div class="detail-head">' +
      '  <p class="detail-eyebrow"><span class="st ' + sm.cls + '">' + esc(sm.label) + '</span></p>' +
      '  <h1 class="detail-name" id="detail-title">' + esc(f.name) + '</h1>' +
      '  <div class="detail-meta">' +
      '    <span>' + esc(f.category || '—') + '</span>' +
      '    <span>' + esc(f.location) + '</span>' +
      '    <span>' + esc(T('detail.side.capacity')) + ' ' + f.capacity + ' ' + esc(T('unit.people')) + '</span>' +
      '    <span>' + f.openHours.start + ' - ' + f.openHours.end + ' WIB</span>' +
      '  </div>' +
      '</div>' +
      '<div class="detail-body">' +
      '  <div>' +
      '    <div class="detail-section"><h2>' + esc(T('detail.about')) + '</h2><p>' + esc(f.description || T('detail.noDesc')) + '</p></div>' +
      '    <div class="detail-section"><h2>' + esc(T('detail.amenities')) + '</h2>' +
      '      <ul class="detail-amenities-list">' + ((f.facilities || []).map(a => '<li>' + esc(a) + '</li>').join('') || '<li>—</li>') + '</ul>' +
      '    </div>' +
      planHTML +
      '    <div class="detail-section"><h2>' + esc(T('detail.hours')) + '</h2>' +
      '      <p>' + T('detail.hours.text', { open: f.openHours.start, close: f.openHours.end, max: maxDur, days: CFB.data.policy().bookingDaysAhead }) + '</p>' +
      '    </div>' +
      '  </div>' +
      '  <aside class="detail-sidebar">' +
      '    <div class="sidebar-row"><span class="label">' + esc(T('detail.side.category')) + '</span><span class="value">' + esc(f.category || '—') + '</span></div>' +
      '    <div class="sidebar-row"><span class="label">' + esc(T('detail.side.location')) + '</span><span class="value">' + esc(f.location) + '</span></div>' +
      '    <div class="sidebar-row"><span class="label">' + esc(T('detail.side.capacity')) + '</span><span class="value">' + esc(T('detail.side.capacityVal', { n: f.capacity })) + '</span></div>' +
      '    <div class="sidebar-row"><span class="label">' + esc(T('detail.side.hours')) + '</span><span class="value">' + f.openHours.start + ' - ' + f.openHours.end + '</span></div>' +
      '    <div class="sidebar-row"><span class="label">' + esc(T('detail.side.maxDur')) + '</span><span class="value">' + esc(T('detail.side.maxDurVal', { n: maxDur })) + '</span></div>' +
      '    <div class="sidebar-row"><span class="label">' + esc(T('detail.side.status')) + '</span><span class="value"><span class="st ' + sm.cls + '">' + esc(sm.label) + '</span></span></div>' +
      '    ' + note +
      '    ' + cta +
      '  </aside>' +
      '</div>';
    if (bookable) $('#bookNowBtn').addEventListener('click', onBookNow);
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
      '<p class="ss-meta">' + esc(f.location) + ' \u00b7 ' + esc(T('detail.side.capacity')) + ' ' + f.capacity + ' ' + esc(T('unit.people')) + ' \u00b7 ' + f.openHours.start + ' - ' + f.openHours.end + ' WIB</p></div>';

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
      if (closure) { chip.disabled = true; chip.title = closure.note || T('status.Unavailable'); }
      chip.innerHTML =
        '<span class="dc-day">' + esc(p.day) + '</span>' +
        '<span class="dc-date">' + p.date + '</span>' +
        '<span class="dc-month">' + esc(p.month) + '</span>';
      chip.addEventListener('click', () => selectDate(ds, chip));
      chips.appendChild(chip);
    });
    CFB.util.stagger(chips);

    $('#timeSlots').innerHTML = '<p class="muted">' + esc(T('sched.step2.empty')) + '</p>';
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
        btn.title = past ? T('sched.hint.past') : T('sched.hint.taken');
      } else {
        anyFree = true;
        btn.addEventListener('click', () => selectHour(h, btn));
      }
      wrap.appendChild(btn);
    }
    if (!anyFree) {
      wrap.innerHTML = '<p class="muted">' + esc(T('sched.allTaken')) + '</p>';
    }
    updateSlotStates();
    CFB.util.stagger(wrap);
  }

  /* Jam yang termasuk rentang durasi terpilih ikut terkunci.
     Contoh: pilih 10:00 lalu durasi 2 jam → slot 11:00 ikut terkunci
     (bergaya putus-putus, tidak dapat diklik) sampai durasi diubah. */
  function updateSlotStates() {
    const f = CFB.data.getFacilityById(state.facilityId);
    if (!f || !state.date) return;
    const today = CFB.util.todayStr();
    const nowH = CFB.util.nowHour();
    const s = state.startHour;
    const dur = state.duration || 0;
    $$('#timeSlots .time-slot').forEach(btn => {
      const h = parseInt(btn.dataset.hour, 10);
      const taken = CFB.data.isHourTaken(f.id, state.date, h);
      const past = (state.date === today && h <= nowH);
      const consumed = (s != null && dur > 0 && h > s && h < s + dur);
      btn.classList.toggle('taken', taken && !consumed);
      btn.classList.toggle('past', past && !consumed);
      btn.classList.toggle('consumed', consumed);
      btn.disabled = taken || past || consumed;
      btn.title = consumed
        ? T('sched.hint.consumed', { range: CFB.util.rangeLabel(s, s + dur) })
        : (past ? T('sched.hint.past') : (taken ? T('sched.hint.taken') : ''));
    });
  }

  function selectHour(h, btnEl) {
    state.startHour = h;
    state.duration = null;
    // hapus animasi stagger agar popIn (slot terpilih) tidak menimpa fill-mode
    // fadeUp yang menyebabkan slot terpilih menghilang setelah animasinya selesai
    if (btnEl) btnEl.classList.remove('st-in');
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
        '<strong>' + esc(T('sched.durUnit', { n: d })) + '</strong>' +
        '<span>' + CFB.util.rangeLabel(state.startHour, state.startHour + d) + ' WIB</span>';
      if (!available) {
        btn.disabled = true;
        btn.title = (state.startHour + d > end)
          ? T('sched.hint.overClose')
          : T('sched.hint.nextBusy');
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
    updateSlotStates();
  }

  function updateTimeSummary() {
    const el = $('#timeSummary');
    if (!state.date || state.startHour == null || !state.duration) { el.hidden = true; return; }
    const p = CFB.util.dateParts(state.date);
    el.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>' +
      '<span><strong>' + esc(p.full) + '</strong></span>' +
      '<span class="ts-sep">\u00b7</span>' +
      '<span>' + CFB.util.rangeLabel(state.startHour, state.startHour + state.duration) + ' WIB</span>' +
      '<span class="ts-sep">\u00b7</span>' +
      '<span>' + esc(T('sched.durUnit', { n: state.duration })) + '</span>';
    el.hidden = false;
    CFB.util.animateIn(el, 'pop-enter');
  }

  function updateContinueBtn() {
    $('#continueToRequest').disabled = !(state.date && state.startHour != null && state.duration);
  }

  // ============ Request ============
  function goRequest() {
    if (!state.facilityId || !state.date || state.startHour == null || !state.duration) {
      CFB.notify.error(T('toast.needSchedule.title'), T('toast.needSchedule.msg'));
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
      '<p>' + esc(f.location) + ' \u00b7 ' + esc(T('detail.side.capacity')) + ' ' + f.capacity + ' ' + esc(T('unit.people')) + '</p>' +
      '<p>' + esc(p.full) + ' \u00b7 ' + CFB.util.rangeLabel(state.startHour, state.startHour + state.duration) +
      ' WIB \u00b7 ' + esc(T('sched.durUnit', { n: state.duration })) + '</p>';

    const form = $('#bookingForm');
    form.reset();
    $$('.form-row', form).forEach(r => r.classList.remove('has-error', 'shake'));
    $$('.field-error', form).forEach(e => { e.textContent = ''; });
    $$('.invalid', form).forEach(el => el.classList.remove('invalid'));
    hideSuggestion();
    updatePurposeCount();

    /* Bila login, isi nama & email otomatis (bila kolom masih kosong) */
    prefillFromAccount();

    showPage('request');
  }

  /* Prefill formulir peminjaman dari identitas tersimpan (per email akun)
     — dipakai saat halaman request dibuka DAN setelah login lewat gerbang
     transaksi final. Hanya mengisi kolom yang MASIH KOSONG sehingga isian
     pengguna tidak pernah ditimpa; semua field tetap bisa diubah. */
  function prefillFromAccount() {
    const u = (CFB.auth && CFB.auth.getUser) ? CFB.auth.getUser() : null;
    if (!u) return;
    const p = (CFB.profile && CFB.profile.get) ? CFB.profile.get() : null;
    const setIfEmpty = (el, v) => { if (el && !el.value && v) el.value = v; };
    setIfEmpty($('#f-name'), (p && p.nama) || u.name);
    setIfEmpty($('#f-nim'), p && p.nim);
    setIfEmpty($('#f-email'), (p && p.emailUgm) ||
      (/@mail\.ugm\.ac\.id$/i.test(u.email || '') ? u.email : ''));
    if ($('#f-phone') && !$('#f-phone').value && p && p.wa) {
      $('#f-phone').value = CFB.format.phoneLocal(p.wa);
    }
    setIfEmpty($('#f-organization'), p && p.prodi);
  }

  function updatePurposeCount() {
    const c = $('#purposeCount');
    if (c) c.textContent = $('#f-purpose').value.length;
  }

  // ============ Identitas Peminjam (halaman #/profile + modal) ============
  /* Satu formulir identitas dipakai dua kali: halaman penuh #/profile dan
     modal yang muncul tepat setelah login pada gerbang transaksi final.
     Data disimpan per email akun (CFB.profile) lalu mengisi otomatis
     formulir peminjaman — field tetap bisa diubah saat pengajuan. */

  const IDENT_FIELDS = [
    { k: 'nama',   el: 'nama',   type: 'text',  val: 'name',         max: 80 },
    { k: 'nim',    el: 'nim',    type: 'text',  val: 'nim',          max: 20 },
    { k: 'emailUgm', el: 'email', type: 'email', val: 'email',        max: 80 },
    { k: 'wa',     el: 'wa',     type: 'tel',   val: 'phoneLocal',   max: 16, phone: true },
    { k: 'prodi',  el: 'prodi',  type: 'text',  val: 'organization', max: 100 }
  ];

  function identityFieldsHTML(vals, idp) {
    const row = (f) => {
      const id = idp + f.el;
      let input = '<input id="' + id + '" name="' + f.k + '" type="' + f.type + '"' +
        ' maxlength="' + f.max + '" autocomplete="off" />';
      if (f.phone) {
        input =
          '<div class="phone-input"><span class="phone-prefix">+62</span>' +
          '<input id="' + id + '" name="' + f.k + '" type="tel" inputmode="numeric" maxlength="16" autocomplete="off" /></div>';
      }
      /* Hint hanya bila terjemahan tersedia (hindari nama kunci tampil
         mentah untuk field tanpa hint, mis. Nama Lengkap). */
      const hintKey = 'prof.hint.' + f.k;
      const hintVal = T(hintKey);
      const hint = (hintVal && hintVal !== hintKey) ? hintVal : '';
      return (
        '<div class="form-row" data-ident="' + f.k + '">' +
        '  <label for="' + id + '"><span>' + esc(T('prof.f.' + f.k)) + '</span> <span class="req">*</span></label>' +
        input +
        '  <p class="field-error" data-ident-error="' + f.k + '"></p>' +
        (hint ? '  <p class="field-hint">' + esc(hint) + '</p>' : '') +
        '</div>');
    };
    return IDENT_FIELDS.map(row).join('');
  }

  function identValueFor(k, el) {
    return String((el.value == null ? '' : el.value)).trim();
  }

  /* Pasang perilaku pada formulir identitas: validasi blur/input,
     auto-format NIM & WA. Mengembalikan {ok, data|firstErrorEl}. */
  function bindIdentityForm(root, idp) {
    const getEl = (f) => $('#' + idp + f.el, root);
    const setErr = (f, msg) => {
      const errEl = $('[data-ident-error="' + f.k + '"]', root);
      const input = getEl(f);
      const row = input ? input.closest('.form-row') : null;
      if (errEl) errEl.textContent = msg || '';
      if (input) input.classList.toggle('invalid', !!msg);
      if (row) row.classList.toggle('has-error', !!msg);
    };
    IDENT_FIELDS.forEach((f) => {
      const el = getEl(f);
      if (!el) return;
      el.addEventListener('blur', () => {
        if (f.k === 'nim') el.value = CFB.format.nim(el.value);
        if (f.k === 'wa') el.value = CFB.format.phoneLocal(el.value);
        if (f.k === 'emailUgm') el.value = el.value.trim().toLowerCase();
        setErr(f, CFB.validators[f.val](el.value));
      });
      el.addEventListener('input', () => {
        if (f.k === 'nim') el.value = CFB.format.nim(el.value);
        if (f.k === 'wa') el.value = CFB.format.phoneLocal(el.value);
        const row = el.closest('.form-row');
        if (row && row.classList.contains('has-error') && !CFB.validators[f.val](el.value)) setErr(f, '');
      });
    });
    return {
      collect() {
        let ok = true;
        let firstEl = null;
        const data = CFB.profile.empty();
        IDENT_FIELDS.forEach((f) => {
          const el = getEl(f);
          const v = el ? identValueFor(f.k, el) : '';
          const msg = CFB.validators[f.val](v);
          setErr(f, msg);
          if (msg) { ok = false; if (!firstEl) firstEl = el; }
          data[f.k] = v;
        });
        return { ok: ok, data: data, firstEl: firstEl };
      },
      fill(data) {
        IDENT_FIELDS.forEach((f) => {
          const el = getEl(f);
          if (!el) return;
          el.value = (f.k === 'wa' && data[f.k]) ? CFB.format.phoneLocal(data[f.k]) : String(data[f.k] || '');
        });
      }
    };
  }

  /* ===== Halaman penuh #/profile =====
     Listener submit dipasang SEKALI di bindEvents (#profileForm statis);
     renderProfile hanya mengganti isi + menyimpan api terbaru di profileApi
     (render bisa terjadi lebih dari sekali per sesi — auth event, dsb.). */
  let profileApi = null;
  let profileSaving = false;

  async function onProfileSubmit(e) {
    e.preventDefault();
    if (profileSaving || !profileApi) return;
    const res = profileApi.collect();
    if (!res.ok) {
      CFB.notify.error(T('prof.err.title'), T('prof.err.msg'));
      if (res.firstEl) res.firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const form = $('#profileForm');
    const btn = form.querySelector('button[type="submit"]');
    profileSaving = true;
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span><span>' + esc(T('prof.saving')) + '</span>';
    const saved = await CFB.profile.save(res.data);
    profileSaving = false;
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.textContent = T('prof.save');
    if (!saved.local) {
      CFB.notify.error(T('prof.err.title'), T('prof.err.storage'));
      return;
    }
    CFB.notify.success(T('prof.ok.title'),
      saved.server ? T('prof.ok.msgSync') : T('prof.ok.msg'));
    const dest = profileReturn || '/';
    profileReturn = '/';
    const target = dest.startsWith('#') ? dest : '#' + dest;
    if (location.hash === target) handleHashChange();
    else location.hash = target;
  }

  function renderProfile() {
    const u = (CFB.auth && CFB.auth.getUser) ? CFB.auth.getUser() : null;
    const gate = $('#profileLoginGate');
    const wrap = $('#profileFormWrap');
    if (!u) {
      gate.hidden = false;
      wrap.hidden = true;
      profileApi = null;
      showPage('profile');
      return;
    }
    gate.hidden = true;
    wrap.hidden = false;
    const p = (CFB.profile && CFB.profile.get) ? CFB.profile.get() : CFB.profile.empty();
    const form = $('#profileForm');
    form.innerHTML =
      '<div class="ident-note">' + CFB.icons.info + '<p>' + esc(T('prof.note')) + '</p></div>' +
      '<div class="form-grid-2">' + identityFieldsHTML(p, 'pf-') + '</div>' +
      '<div class="form-actions">' +
      '  <button type="button" class="btn-ghost" id="pfCancel">' + esc(T('c.cancel')) + '</button>' +
      '  <button type="submit" class="btn-primary">' + esc(T('prof.save')) + '</button>' +
      '</div>';
    profileApi = bindIdentityForm(form, 'pf-');
    profileApi.fill(p);
    $('#pfCancel').addEventListener('click', () => {
      const dest = profileReturn || '/';
      profileReturn = '/';
      location.hash = dest.startsWith('#') ? dest : '#' + dest;
      if (location.hash === '#/profile') handleHashChange();
    });
    showPage('profile');
  }

  /* ===== Modal identitas (gerbang transaksi final) ===== */
  function openIdentityModal() {
    return new Promise((resolve) => {
      if ($('#identModalOverlay')) { resolve('cancel'); return; }
      const p = (CFB.profile && CFB.profile.get) ? CFB.profile.get() : CFB.profile.empty();
      const ov = document.createElement('div');
      ov.id = 'identModalOverlay';
      ov.className = 'modal-overlay';
      ov.innerHTML =
        '<div class="modal-card auth-modal" role="dialog" aria-modal="true">' +
        '  <button type="button" class="tc-close am-close" aria-label="' + esc(T('proof.close')) + '">' + CFB.icons.close + '</button>' +
        '  <p class="modal-eyebrow">' + esc(T('prof.m.eyebrow')) + '</p>' +
        '  <h3 class="modal-title">' + esc(T('prof.m.title')) + '</h3>' +
        '  <p class="am-sub">' + esc(T('prof.m.sub')) + '</p>' +
        '  <form id="identModalForm" novalidate>' +
        identityFieldsHTML(p, 'im-') +
        '    <div class="modal-actions am-actions">' +
        '      <button type="button" class="btn-ghost" data-skip>' + esc(T('prof.m.skip')) + '</button>' +
        '      <button type="submit" class="btn-primary">' + esc(T('prof.save')) + '</button>' +
        '    </div>' +
        '  </form>' +
        '</div>';
      document.body.appendChild(ov);
      requestAnimationFrame(() => ov.classList.add('show'));

      const done = (val) => {
        ov.classList.remove('show');
        setTimeout(() => ov.remove(), 200);
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const onKey = (e) => { if (e.key === 'Escape') done('cancel'); };
      document.addEventListener('keydown', onKey);
      ov.addEventListener('mousedown', (e) => { if (e.target === ov) done('cancel'); });
      ov.querySelector('.am-close').addEventListener('click', () => done('cancel'));
      ov.querySelector('[data-skip]').addEventListener('click', () => done('cancel'));

      const form = $('#identModalForm', ov);
      const api = bindIdentityForm(form, 'im-');
      api.fill(p);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const res = api.collect();
        if (!res.ok) return; // pesan error per field sudah tampil
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.classList.add('is-loading');
        btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span><span>' + esc(T('prof.saving')) + '</span>';
        await CFB.profile.save(res.data);
        CFB.notify.success(T('prof.ok.title'), T('prof.ok.msg'));
        done('saved');
      });
      setTimeout(() => { const el = $('#im-nama', ov); if (el) el.focus(); }, 80);
    });
  }

  /* Pastikan identitas terisi pada alur transaksi final:
     bila belum lengkap → modal identitas (bisa dilewati). */
  async function ensureIdentity() {
    if (!(CFB.profile && CFB.profile.get && CFB.profile.complete && CFB.profile.empty)) return;
    const p = CFB.profile.get();
    if (CFB.profile.complete(p)) return;
    await openIdentityModal();
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
      case 'agreement': return value ? '' : T('val.agree');
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

  /* Saran ruang muncul dengan jeda setelah input selesai (debounce),
     tampilan flat tanpa kotak bersarang, dan tautan membuka detail ruang
     di tab yang sama (navigasi SPA via hash). */
  const SUGGEST_DELAY = 1200; // jeda setelah pengguna berhenti mengetik (ms)
  let sugTimer = null;

  function hideSuggestion() {
    clearTimeout(sugTimer);
    const box = $('#suggestBox');
    box.hidden = true;
    box.innerHTML = '';
  }

  function scheduleSuggestion(delay) {
    clearTimeout(sugTimer);
    sugTimer = setTimeout(updateSuggestion, delay == null ? SUGGEST_DELAY : delay);
  }

  function updateSuggestion() {
    const box = $('#suggestBox');
    const f = CFB.data.getFacilityById(state.facilityId);
    const raw = $('#f-participants').value;
    const n = parseInt(raw, 10);
    if (!f || !raw || isNaN(n) || n < 1 || n > f.capacity || n > f.capacity * 0.4) {
      hideSuggestion();
      return;
    }
    const alts = CFB.data.suggestAlternatives(f, n);
    if (!alts.length) { hideSuggestion(); return; }
    box.innerHTML =
      '<p class="sg-eyebrow">' + esc(T('sug.eyebrow')) + '</p>' +
      '<p class="sg-title">' + CFB.icons.info + ' ' + esc(T('sug.title')) + '</p>' +
      '<p class="sg-text">' + T('sug.text', { name: esc(f.name), cap: f.capacity, n: n }) + '</p>' +
      '<ul class="sg-list">' + alts.map(a =>
        '<li class="sg-item">' +
        '  <div class="sg-info">' +
        '    <span class="sg-name">' + esc(a.name) + '</span>' +
        '    <span class="sg-meta">' + esc(a.category || '—') + ' \u00b7 ' + a.capacity + ' ' + esc(T('unit.people')) + ' \u00b7 ' + esc(a.location) + '</span>' +
        '  </div>' +
        '  <a class="sg-link" href="#/facility/' + encodeURIComponent(a.id) + '">' + esc(T('sug.link')) +
        '    <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true"><path d="M7 4 L13 10 L7 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '  </a>' +
        '</li>').join('') +
      '</ul>';
    box.hidden = false;
    CFB.util.animateIn(box);
  }

  // ============ Submit ============
  let submitting = false; // kunci ganda saat tombol sedang memproses
  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    /* ==== GERBANG LOGIN — fallback. Gerbang UTAMA kini berada di
       halaman ruangan (tombol "Ajukan Peminjaman" → onBookNow).
       Blok ini hanya menyala bila pengguna masih tamu, mis. memilih
       "Lanjut tanpa akun" atau membuka #/request secara langsung.
       Bila login belum dikonfigurasi (mode lokal murni), tersedia
       pilihan "Lanjut tanpa akun" agar prototipe tetap berfungsi. ==== */
    if (!guestProceeded && !(CFB.auth && CFB.auth.getUser && CFB.auth.getUser())) {
      const r = await openAuthModal('gate');
      if (r === 'cancel') return;                    // tutup modal → tetap di formulir
      if (r === 'guest') {
        guestProceeded = true;
        CFB.notify.warning(T('auth.gate.guestTitle'), T('auth.gate.guestNote'));
      } else {
        await ensureIdentity();                     // pasca-login: identitas (bila belum ada)
        prefillFromAccount();                       // pasca-login: prefill isian kosong
      }
    }

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
      CFB.notify.error(T('toast.invalid.title'), T('toast.invalid.msg', { n: firstInvalid.length }));
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
    if (!f) { CFB.notify.error(T('toast.nofac.title'), T('toast.nofac.msg')); return; }
    if (f.status === 'Unavailable') {
      CFB.notify.error(T('toast.unavail.title'), T('toast.unavail.msg'));
      goExplore();
      return;
    }
    if (!CFB.data.isRangeFree(f.id, state.date, state.startHour, state.duration)) {
      CFB.notify.error(T('toast.taken.title'), T('toast.taken.msg'));
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
    /* Tombol kirim menampilkan animasi loading yang bersih.
       Durasi minimum 1,2 detik agar proses terasa konsisten — sekaligus
       menutup latensi jaringan saat menulis pengajuan ke Firebase. */
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const setLoading = (on) => {
      submitting = on;
      if (!submitBtn) return;
      submitBtn.disabled = on;
      submitBtn.classList.toggle('is-loading', on);
      submitBtn.innerHTML = on
        ? '<span class="btn-spinner" aria-hidden="true"></span><span>' + esc(T('toast.sending')) + '</span>'
        : esc(T('req.submit'));
    };

    setLoading(true);
    try {
      const [saved] = await Promise.all([
        CFB.data.addBooking(booking),
        new Promise(r => setTimeout(r, 1200))
      ]);
      if (!saved) return; // toast error sudah ditampilkan data layer
      state.lastBookingId = saved.id;
      updateBookingBadge();
      renderSummary(saved);
      location.hash = '#/summary';
      CFB.notify.success(T('toast.sent.title'), T('toast.sent.msg', { id: saved.id }));
    } finally {
      setLoading(false);
    }
  }

  // ============ Summary ============
  function renderSummary(b) {
    const rejectNote = (b.status === 'Rejected' && b.rejectReason)
      ? '<div><p class="sg-label">' + esc(T('sum.f.reason')) + '</p><p class="sg-value">' + esc(b.rejectReason) + '</p></div>'
      : '';
    $('#summaryContent').innerHTML =
      '<div class="success-hero">' +
      '  <div class="success-icon">' + CFB.icons.bigCheck + '</div>' +
      '  <div class="success-body">' +
      '    <p class="sh-title">' + esc(T('sum.sent.title')) + '</p>' +
      '    <p class="sh-sub">' + esc(T('sum.sent.ref')) + ' <strong class="sh-ref">' + esc(b.id) + '</strong> ' + statusBadge(b.status) + '</p>' +
      '    <p class="sh-note">' + T('sum.sent.note') + '</p>' +
      '  </div>' +
      '</div>' +
      '<div class="summary-card">' +
      '  <div class="summary-grid">' +
      '    <div><p class="sg-label">' + esc(T('sum.f.facility')) + '</p><p class="sg-value">' + esc(b.facilityName) + '</p></div>' +
      '    <div><p class="sg-label">' + esc(T('sum.f.category')) + '</p><p class="sg-value">' + esc(b.category || '—') + '</p></div>' +
      '    <div><p class="sg-label">' + esc(T('sum.f.location')) + '</p><p class="sg-value">' + esc(b.location) + '</p></div>' +
      '    <div><p class="sg-label">' + esc(T('sum.f.date')) + '</p><p class="sg-value">' + esc(b.dateLabel || b.date) + '</p></div>' +
      '    <div><p class="sg-label">' + esc(T('sum.f.time')) + '</p><p class="sg-value">' + esc(b.slotLabel) + ' WIB \u00b7 ' + esc(T('sched.durUnit', { n: b.durationHours || 2 })) + '</p></div>' +
      '    <div><p class="sg-label">' + esc(T('sum.f.participants')) + '</p><p class="sg-value">' + esc(T('sum.f.participantsVal', { n: b.participants, cap: b.capacity })) + '</p></div>' +
      '    <div><p class="sg-label">' + esc(T('sum.f.borrower')) + '</p><p class="sg-value">' + esc(b.name) + '</p></div>' +
      '    <div><p class="sg-label">' + esc(T('sum.f.nim')) + '</p><p class="sg-value">' + esc(b.nim) + '</p></div>' +
      '    <div><p class="sg-label">' + esc(T('sum.f.email')) + '</p><p class="sg-value">' + esc(b.email) + '</p></div>' +
      '    <div><p class="sg-label">' + esc(T('sum.f.phone')) + '</p><p class="sg-value">' + esc(b.phone) + '</p></div>' +
      '    <div><p class="sg-label">' + esc(T('sum.f.org')) + '</p><p class="sg-value">' + esc(b.organization) + '</p></div>' +
      '    <div><p class="sg-label">' + esc(T('sum.f.created')) + '</p><p class="sg-value">' + esc(CFB.util.fmtDateTime(b.createdAt)) + '</p></div>' +
      '    <div class="sg-wide"><p class="sg-label">' + esc(T('sum.f.purpose')) + '</p><p class="sg-value">' + esc(b.purpose) + '</p></div>' +
      (b.notes ? '<div class="sg-wide"><p class="sg-label">' + esc(T('sum.f.notes')) + '</p><p class="sg-value">' + esc(b.notes) + '</p></div>' : '') +
      '    ' + rejectNote +
      '  </div>' +
      '</div>' +
      '<div class="proof-row">' +
      '  <button type="button" class="btn-ghost" id="sumProofBtn">' +
      '    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>' +
           esc(T('sum.proof')) + '</button>' +
      '</div>';
    $('#sumProofBtn').addEventListener('click', () => CFB.proof.show(b));
    showPage('summary');
  }

  // ============ Peminjaman Saya ============
  /* Keterangan status dalam kalimat lengkap per kondisi */
  function bookingStatusNote(b) {
    if (b.status === 'Approved') {
      return { cls: 'ok', icon: CFB.icons.success, text: T('bk.note.ok') };
    }
    if (b.status === 'Rejected') {
      const reason = b.rejectReason
        ? T('bk.note.reason', { reason: esc(b.rejectReason) })
        : '';
      return { cls: 'no', icon: CFB.icons.error, text: T('bk.note.no', { reason: reason }) };
    }
    return {
      cls: 'wait',
      icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
      text: T('bk.note.wait')
    };
  }

  function renderBookings() {
    const list = CFB.data.getMyBookings();
    const wrap = $('#bookingsList');
    wrap.innerHTML = '';
    $('#bookingsEmpty').hidden = !!list.length;
    list.forEach(b => {
      const note = bookingStatusNote(b);
      const div = document.createElement('div');
      div.className = 'booking-item';
      div.setAttribute('role', 'button');
      div.setAttribute('tabindex', '0');
      div.setAttribute('aria-expanded', 'false');
      div.innerHTML =
        '<div class="bi-info">' +
        '  <p class="bi-name">' + esc(b.facilityName) + '</p>' +
        '  <p class="bi-meta">' +
        '    <span>' + esc(b.dateLabel || b.date) + '</span>' +
        '    <span>' + esc(bookingRangeLabel(b)) + ' WIB \u00b7 ' + esc(T('sched.durUnit', { n: b.durationHours || 2 })) + '</span>' +
        '    <span>' + esc(T('bk.participants', { n: b.participants })) + '</span>' +
        '    <span>' + esc(b.name) + '</span>' +
        '  </p>' +
        '</div>' +
        '<div class="bi-side">' +
        '  <span class="bi-badge-row">' + statusBadge(b.status) +
        '    <span class="bi-chevron" aria-hidden="true"><svg viewBox="0 0 20 20" width="15" height="15"><path d="M5 8 L10 13 L15 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
        '  </span>' +
        '  <span class="bi-ref">' + esc(b.id) + '</span>' +
        '</div>' +
        /* Panel detail singkat yang terbuka saat item ditekan + unduh bukti */
        '<div class="bi-detail-wrap"><div class="bi-detail"><div class="bi-detail-inner">' +
        '  <div class="bi-note bi-note-' + note.cls + '">' + note.icon + '<p>' + note.text + '</p></div>' +
        '  <div class="bi-grid">' +
        '    <div><p class="bi-label">' + esc(T('bk.g.ref')) + '</p><p class="bi-value mono">' + esc(b.id) + '</p></div>' +
        '    <div><p class="bi-label">' + esc(T('bk.g.date')) + '</p><p class="bi-value">' + esc(b.dateLabel || b.date) + '</p></div>' +
        '    <div><p class="bi-label">' + esc(T('bk.g.time')) + '</p><p class="bi-value">' + esc(bookingRangeLabel(b)) + ' WIB \u00b7 ' + esc(T('sched.durUnit', { n: b.durationHours || 2 })) + '</p></div>' +
        '    <div><p class="bi-label">' + esc(T('bk.g.location')) + '</p><p class="bi-value">' + esc(b.location) + '</p></div>' +
        '    <div><p class="bi-label">' + esc(T('bk.g.participants')) + '</p><p class="bi-value">' + esc(T('detail.side.capacityVal', { n: b.participants })) + '</p></div>' +
        '    <div><p class="bi-label">' + esc(T('bk.g.org')) + '</p><p class="bi-value">' + esc(b.organization) + '</p></div>' +
        '  </div>' +
        '  <div class="bi-proof-row">' +
        '    <button type="button" class="btn-proof" data-proof="' + esc(b.id) + '">' +
        '      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>' +
        esc(T('bk.proof')) + '</button>' +
        '  </div>' +
        '</div></div></div>';

      const toggle = () => {
        const open = div.classList.toggle('open');
        div.setAttribute('aria-expanded', String(open));
      };
      div.addEventListener('click', (e) => {
        if (e.target.closest('[data-proof]')) return; // tombol bukti tidak membuka/menutup panel
        toggle();
      });
      div.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
      wrap.appendChild(div);
    });
    $$('[data-proof]', wrap).forEach(btn => {
      btn.addEventListener('click', () => {
        const b = CFB.data.getBookingById(btn.dataset.proof);
        if (b) CFB.proof.show(b);
      });
    });
    CFB.util.stagger(wrap);
    showPage('bookings');
  }

  // ============ Autentikasi (Firebase Auth) ============
  const AVATAR_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>';
  const GOOGLE_G = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"/></svg>';

  /* URL foto yang pernah gagal dimuat (mis. foto Google diblokir/hilang)
     → langsung pakai avatar inisial tanpa mencoba ulang tiap render. */
  const failedPhotos = new Set();

  function avatarHTML(u) {
    const initial = (u.name || u.email || '?').trim().charAt(0).toUpperCase();
    const fallback = '<span class="auth-ava auth-ava-txt">' + esc(initial) + '</span>';
    if (!u.photo || failedPhotos.has(u.photo)) return fallback;
    /* onerror inline dipakai agar fallback langsung bekerja meskipun
       render berulang; set failedPhotos mencegah mencoba URL yang sama. */
    return '<img src="' + esc(u.photo) + '" alt="" class="auth-ava" ' +
      'onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),' +
      '{className:\'auth-ava auth-ava-txt\',textContent:\'' + esc(initial) + '\'}));' +
      'window.CFB && window.CFB._photoFailed && window.CFB._photoFailed(\'' + esc(u.photo) + '\')" />';
  }

  /* Didaftarkan agar handler onerror pada avatar dapat menandai URL gagal */
  window.CFB._photoFailed = (url) => { failedPhotos.add(url); };

  function renderAuthArea() {
    const area = $('#authArea');
    if (!area) return;
    const u = (CFB.auth && CFB.auth.getUser) ? CFB.auth.getUser() : null;
    if (!u) {
      area.innerHTML =
        '<button type="button" id="loginBtn" class="btn-login">' + AVATAR_SVG +
        '<span>' + esc(T('auth.login')) + '</span></button>';
      $('#loginBtn').addEventListener('click', openAuthModal);
      return;
    }
    const avatar = avatarHTML(u);
    area.innerHTML =
      '<span class="auth-wrap">' +
      '  <button type="button" id="authChip" class="auth-chip" aria-haspopup="menu" aria-expanded="false" title="' + esc(T('auth.loggedAs')) + ' ' + esc(u.email) + '">' +
      avatar + '<span class="auth-name">' + esc(u.name) + '</span>' +
      '    <svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true"><path d="M5 8 L10 13 L15 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '  </button>' +
      '  <div id="authMenu" class="auth-menu" role="menu" hidden>' +
      '    <p class="am-name">' + esc(u.name) + '</p>' +
      '    <p class="am-mail">' + esc(u.email) + '</p>' +
      '    <button type="button" id="profileBtnU" role="menuitem" class="am-item">' +
      '      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
            esc(T('prof.menu')) + '</button>' +
      '    <button type="button" id="logoutBtnU" role="menuitem" class="am-item am-item-danger">' +
      '      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>' +
            esc(T('auth.logout')) + '</button>' +
      '  </div>' +
      '</span>';

    const chip = $('#authChip'), menu = $('#authMenu');
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !menu.hidden;
      menu.hidden = open;
      chip.setAttribute('aria-expanded', String(!open));
    });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !e.target.closest('.auth-wrap')) { menu.hidden = true; chip.setAttribute('aria-expanded', 'false'); }
    });
    $('#profileBtnU').addEventListener('click', () => {
      menu.hidden = true;
      profileReturn = location.hash.slice(1) || '/';
      location.hash = '#/profile';
    });
    $('#logoutBtnU').addEventListener('click', async () => {
      menu.hidden = true;
      await CFB.auth.signOut();
      CFB.notify.info(T('auth.bye.title'), T('auth.bye.msg'));
    });
  }

  /* Modal login. mode 'nav' = tombol Masuk di header (perilaku lama);
     mode 'gate' = gerbang transaksi final (dipanggil handleSubmit).
     Mengembalikan Promise: 'ok' (berhasil login), 'guest' (lanjut tanpa
     akun — hanya tersedia bila login belum dikonfigurasi), 'cancel'. */
  function openAuthModal(mode) {
    return new Promise((resolve) => {
    if (mode !== 'gate' && !CFB.auth.available()) {
      CFB.notify.warning(T('auth.unconfigured.title'), T('auth.unconfigured.msg'));
      resolve('cancel');
      return;
    }
    if ($('#authModalOverlay')) { resolve('cancel'); return; }
    let inner = 'login'; // login | register (form email)

    /* Gerbang transaksi + login belum dikonfigurasi → tawarkan kirim
       tanpa akun agar alur tetap berjalan pada mode lokal murni. */
    const unavail = mode === 'gate' && !CFB.auth.available();
    const title = mode === 'gate' ? T('auth.gate.title') : T('auth.modal.title');
    const sub = mode === 'gate' ? T('auth.gate.sub') : T('auth.modal.sub');

    const ov = document.createElement('div');
    ov.id = 'authModalOverlay';
    ov.className = 'modal-overlay';
    ov.innerHTML =
      '<div class="modal-card auth-modal" role="dialog" aria-modal="true">' +
      '  <button type="button" class="tc-close am-close" aria-label="' + esc(T('proof.close')) + '">' + CFB.icons.close + '</button>' +
      '  <p class="modal-eyebrow">' + esc(mode === 'gate' ? T('auth.gate.eyebrow') : T('auth.login')) + '</p>' +
      '  <h3 class="modal-title" id="amTitle">' + esc(title) + '</h3>' +
      '  <p class="am-sub">' + esc(sub) + '</p>' +
      (unavail
        ? '<div class="am-warn">' + CFB.icons.warningSmall + '<p>' + esc(T('auth.gate.guestNote')) + '</p></div>' +
          '<div class="modal-actions am-actions">' +
          '  <button type="button" class="btn-ghost" data-close>' + esc(T('c.cancel')) + '</button>' +
          '  <button type="button" class="btn-primary" data-guest>' + esc(T('auth.gate.guestBtn')) + '</button>' +
          '</div>'
        : '<button type="button" id="googleBtn" class="btn-google">' + GOOGLE_G + '<span>' + esc(T('auth.google')) + '</span></button>' +
          '<div class="am-divider"><span>' + esc(T('auth.or')) + '</span></div>' +
          '<form id="authFormEl" novalidate>' +
          '    <div class="form-row" id="amNameRow" hidden>' +
          '      <label for="am-name">' + esc(T('auth.f.name')) + '</label>' +
          '      <input id="am-name" type="text" maxlength="60" autocomplete="name" />' +
          '    </div>' +
          '    <div class="form-row">' +
          '      <label for="am-email">' + esc(T('auth.f.email')) + '</label>' +
          '      <input id="am-email" type="email" autocomplete="email" />' +
          '    </div>' +
          '    <div class="form-row">' +
          '      <label for="am-pass">' + esc(T('auth.f.pass')) + '</label>' +
          '      <input id="am-pass" type="password" autocomplete="current-password" />' +
          '    </div>' +
          '    <p class="am-error" id="amError" hidden></p>' +
          '    <button type="submit" class="btn-primary am-submit" id="amSubmit">' + esc(T('auth.signin')) + '</button>' +
          '  </form>' +
          '  <button type="button" class="am-switch" id="amSwitch" data-i18n-html="auth.toRegister">Belum punya akun? <strong>Daftar</strong></button>') +
      '</div>';
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('show'));

    const close = (val) => {
      ov.classList.remove('show');
      setTimeout(() => ov.remove(), 200);
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape') close('cancel'); };
    document.addEventListener('keydown', onKey);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close('cancel'); });
    ov.querySelector('.am-close').addEventListener('click', () => close('cancel'));
    const closeBtn = ov.querySelector('[data-close]');
    if (closeBtn) closeBtn.addEventListener('click', () => close('cancel'));
    const guestBtn = ov.querySelector('[data-guest]');
    if (guestBtn) guestBtn.addEventListener('click', () => close('guest'));

    /* Bentuk login belum dikonfigurasi → tidak ada elemen form. */
    if (unavail) { setTimeout(() => guestBtn && guestBtn.focus(), 80); return; }

    const errEl = $('#amError', ov);
    const showErr = (msg) => { errEl.textContent = msg || ''; errEl.hidden = !msg; };
    const setBusy = (btn, on) => {
      btn.disabled = on;
      btn.classList.toggle('is-loading', on);
      if (btn.id === 'amSubmit') {
        btn.innerHTML = on
          ? '<span class="btn-spinner" aria-hidden="true"></span><span>' + esc(T('auth.working')) + '</span>'
          : esc(inner === 'login' ? T('auth.signin') : T('auth.register'));
      }
    };

    const switchBtn = $('#amSwitch', ov);
    switchBtn.addEventListener('click', () => {
      inner = (inner === 'login') ? 'register' : 'login';
      $('#amNameRow', ov).hidden = inner !== 'register';
      $('#amTitle', ov).textContent = inner === 'login' ? title : T('auth.register');
      $('#am-pass', ov).setAttribute('autocomplete', inner === 'login' ? 'current-password' : 'new-password');
      $('#amSubmit', ov).textContent = inner === 'login' ? T('auth.signin') : T('auth.register');
      switchBtn.setAttribute('data-i18n-html', inner === 'login' ? 'auth.toRegister' : 'auth.toLogin');
      switchBtn.innerHTML = inner === 'login' ? T('auth.toRegister') : T('auth.toLogin');
      showErr('');
    });

    async function doAuth(fn, btn) {
      /* Login lewat nav (bukan gerbang transaksi) → setelah berhasil,
         pengguna diarahkan ke halaman identitas bila belum lengkap. */
      if (mode !== 'gate') wantIdentRedirect = true;
      showErr('');
      setBusy(btn, true);
      try {
        const u = await fn();
        close('ok');
        CFB.notify.success(T('auth.welcome.title'), T('auth.welcome.msg', { name: u.name }));
      } catch (e) {
        if (mode !== 'gate') wantIdentRedirect = false;
        const msg = (e && e.message === 'auth-unconfigured')
          ? T('auth.unconfigured.msg')
          : CFB.auth.errText(e);
        showErr(msg);
        setBusy(btn, false);
      }
    }

    $('#googleBtn', ov).addEventListener('click', (e) => doAuth(() => CFB.auth.signInGoogle(), e.currentTarget));
    $('#authFormEl', ov).addEventListener('submit', (e) => {
      e.preventDefault();
      const email = $('#am-email', ov).value.trim();
      const pass = $('#am-pass', ov).value;
      const name = $('#am-name', ov).value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showErr(T('auth.err.email')); return; }
      if (!pass || pass.length < 6) { showErr(T('auth.err.pass')); return; }
      doAuth(() => (inner === 'login' ? CFB.auth.signInEmail(email, pass) : CFB.auth.signUpEmail(email, pass, name)), $('#amSubmit', ov));
    });

    setTimeout(() => $('#am-email', ov).focus(), 80);
    });
  }

  /* Reaksi perubahan status auth: perbarui header, badge, riwayat, dan
     alur identitas (login lewat nav → halaman identitas bila belum ada). */
  function onAuthChanged() {
    renderAuthArea();
    updateBookingBadge();
    const u = (CFB.auth && CFB.auth.getUser) ? CFB.auth.getUser() : null;
    const hash = location.hash.slice(1) || '/';
    if (u && CFB.profile && CFB.profile.pull) CFB.profile.pull(); // sinkron lintas perangkat (best-effort)
    if (u && wantIdentRedirect) {
      wantIdentRedirect = false;                                  // hanya pada login yang BARU dilakukan
      if (!(CFB.profile && CFB.profile.complete && CFB.profile.complete(CFB.profile.get()))) {
        profileReturn = '/';
        if (hash === '/profile') renderProfile();                 // sudah di halaman → tampilkan formnya
        else location.hash = '#/profile';
        return;
      }
    }
    if (hash === '/bookings') renderBookings();
    else if (hash === '/profile') renderProfile();
    /* Login lewat nav saat pengguna sedang di formulir pengajuan:
       isi kolom yang masih kosong dari identitas tanpa menimpa isian. */
    else if (hash === '/request' && u) prefillFromAccount();
  }

  /* Reaksi perubahan bahasa: muat ulang tampilan halaman aktif */
  function onLangChanged() {
    renderAuthArea();
    handleHashChange();
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
    } else if (hash === '/profile') {
      renderProfile();
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
    $('#profileLoginBtn').addEventListener('click', openAuthModal);
    $('#profileForm').addEventListener('submit', onProfileSubmit);

    // Validasi saat blur; hapus error saat diketik ulang
    ['name', 'nim', 'email', 'phone', 'participants', 'organization', 'purpose'].forEach(name => {
      const el = $('#f-' + name);
      if (!el) return;
      el.addEventListener('blur', () => {
        if (name === 'nim') el.value = CFB.format.nim(el.value);
        if (name === 'phone') el.value = CFB.format.phoneLocal(el.value);
        setFieldError(name, validateField(name, el.value));
        if (name === 'participants') scheduleSuggestion(450);
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

    // Peserta: saran ruang muncul dengan jeda setelah input selesai
    $('#f-participants').addEventListener('input', () => { hideSuggestion(); scheduleSuggestion(SUGGEST_DELAY); });

    const ag = $('#f-agreement');
    ag.addEventListener('change', () => setFieldError('agreement', validateField('agreement', ag.checked)));

    window.addEventListener('hashchange', handleHashChange);
    document.addEventListener('cfb:auth', onAuthChanged);
    document.addEventListener('cfb:lang', onLangChanged);
  }

  // ============ Init ============
  async function init() {
    bindEvents();
    renderAuthArea();
    if (CFB.auth && CFB.auth.init) CFB.auth.init(); // async — status datang via event
    try {
      await CFB.data.load();
      updateBookingBadge();
      handleHashChange();
    } catch (err) {
      console.error(err);
      $('#resultsCount').textContent = T('results.error');
      $('#emptyState').hidden = false;
      $('#emptyState').querySelector('.empty-title').textContent = T('empty.load.title');
      $('#emptyState').querySelector('.empty-hint').innerHTML = T('empty.load.hint');
      showPage('explore');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
