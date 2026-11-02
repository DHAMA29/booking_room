/* ============================================
   Gamaspace — Data Layer
   --------------------------------------------
   Dua mode (otomatis dipilih saat load()):
   1. MODE FIREBASE — Realtime Database via REST API
      (facilities, availability, bookings tersinkron
       antar pengguna; admin melihat semua pengajuan)
   2. MODE LOCAL (fallback) — seed data/*.json
      + LocalStorage (perubahan admin & pengajuan)

   Bergantung pada: core.js, firebase-config.js (window.CFB_FIREBASE)
   ============================================ */
window.CFB = window.CFB || {};
(function () {
  'use strict';

  const KEY_BOOKINGS = 'cfb_bookings';
  const KEY_OVERRIDES = 'cfb_facility_overrides';
  const KEY_CLIENT = 'cfb_client_id';

  const DEFAULT_POLICY = { bookingDaysAhead: 14, minDurationHours: 1, maxDurationHours: 2 };
  const FB_TIMEOUT_MS = 7000;

  // ============ State ============
  let SEED = [];                       // fasilitas dari data/facilities.json
  let SEED_AVAIL = normalizeAvail(null);
  let FACILITIES = [];                 // daftar aktif (firebase / lokal+overrides)
  let AVAIL = SEED_AVAIL;              // ketersediaan aktif
  let BOOKINGS = [];                   // pengajuan aktif (firebase / lokal)
  let OVERRIDES = emptyOverrides();    // khusus mode lokal
  let MODE = 'local';                  // 'firebase' | 'local'
  let FBSTAT = { reachable: false, reason: 'no-config', message: '' };

  function emptyOverrides() { return { created: [], updated: {}, deleted: [] }; }
  function sanitizeOverrides(o) {
    if (!o || typeof o !== 'object') return emptyOverrides();
    return {
      created: Array.isArray(o.created) ? o.created : [],
      updated: (o.updated && typeof o.updated === 'object') ? o.updated : {},
      deleted: Array.isArray(o.deleted) ? o.deleted : []
    };
  }

  function normalizeAvail(a) {
    a = (a && typeof a === 'object') ? a : {};
    return {
      policy: Object.assign({}, DEFAULT_POLICY, a.policy || {}),
      recurring: Array.isArray(a.recurring) ? a.recurring : [],
      exceptions: Array.isArray(a.exceptions) ? a.exceptions : []
    };
  }

  // ============ Firebase REST client ============
  function fbBase() {
    const cfg = window.CFB_FIREBASE || {};
    return String(cfg.databaseURL || '').trim().replace(/\/+$/, '') || null;
  }

  async function fbRequest(method, path, body) {
    const base = fbBase();
    if (!base) { const e = new Error('Konfigurasi Firebase belum diisi'); e.code = 'no-config'; throw e; }
    /* Sertakan idToken Firebase Auth (bila pengguna login) —
       dipakai bila Rules membatasi tulisan pada auth != null */
    let token = null;
    try {
      if (window.CFB.auth && CFB.auth.getToken) token = await CFB.auth.getToken();
    } catch (e) { token = null; }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FB_TIMEOUT_MS);
    try {
      let url = base + '/' + path + '.json';
      if (token) url += '?auth=' + encodeURIComponent(token);
      const res = await fetch(url, {
        method: method,
        signal: ctrl.signal,
        headers: (body !== undefined) ? { 'Content-Type': 'application/json' } : undefined,
        body: (body !== undefined) ? JSON.stringify(body) : undefined
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = (data && data.error) ? data.error : ('HTTP ' + res.status);
        const err = new Error(msg);
        err.code = (res.status === 401 || res.status === 403) ? 'denied' : 'http';
        err.status = res.status;
        throw err;
      }
      return data; // bisa null (node kosong)
    } catch (e) {
      if (e && (e.code === 'no-config' || e.code === 'denied' || e.code === 'http')) throw e;
      const err = new Error('Tidak dapat terhubung ke Firebase');
      err.code = (e && e.name === 'AbortError') ? 'timeout' : 'network';
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  const fbGet = (p) => fbRequest('GET', p);
  const fbPut = (p, v) => fbRequest('PUT', p, v);
  const fbPatch = (p, v) => fbRequest('PATCH', p, v);
  const fbDelete = (p) => fbRequest('DELETE', p);

  async function fbPush(path, value) {
    const r = await fbRequest('POST', path, value);
    return (r && r.name) ? r.name : null;
  }

  function fbErrMsg(e) {
    const T = (k) => (window.CFB.i18n ? CFB.i18n.t(k) : k);
    const c = e && e.code;
    if (c === 'denied') return T('dl.err.denied');
    if (c === 'timeout') return T('dl.err.timeout');
    if (c === 'network') return T('dl.err.network');
    if (c === 'no-config') return T('dl.err.noconfig');
    return (e && e.message) || T('dl.err.generic');
  }

  /* Gangguan penyimpanan tidak lagi ditampilkan sebagai toast kepada
     pengguna — cukup dicatat di console untuk keperluan pengembang. */
  function fbErrorToast(e) {
    console.warn('[Gamaspace] Penyimpanan data gagal:', fbErrMsg(e));
  }

  // ============ Konversi bentuk data ============
  function facilitiesToMap(list) {
    const map = {};
    (list || []).forEach(f => { if (f && f.id) map[f.id] = f; });
    return map;
  }
  function mapToFacilities(map) {
    if (!map || typeof map !== 'object') return [];
    return Object.keys(map)
      .map(k => Object.assign({ id: k }, map[k]))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  function bookingMapToList(map) {
    if (!map || typeof map !== 'object') return [];
    return Object.keys(map)
      .map(k => { const b = Object.assign({}, map[k]); b._key = k; return b; })
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }
  function stripInternal(b) {
    const o = Object.assign({}, b);
    delete o._key;
    return o;
  }

  // ============ Identitas peramban (untuk "Peminjaman Saya") ============
  function getClientId() {
    let id = CFB.store.get(KEY_CLIENT, null);
    if (!id) {
      id = 'c' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      CFB.store.set(KEY_CLIENT, id);
    }
    return id;
  }

  // ============ Pemuatan data ============
  async function loadLocalSeeds() {
    const [facRes, availRes] = await Promise.all([
      fetch('data/facilities.json'),
      fetch('data/availability.json')
    ]);
    if (!facRes.ok) throw new Error('Gagal memuat data/facilities.json');
    if (!availRes.ok) throw new Error('Gagal memuat data/availability.json');
    const facilities = await facRes.json();
    const availability = await availRes.json();
    if (!Array.isArray(facilities)) throw new Error('facilities.json harus berupa array');
    SEED = facilities;
    SEED_AVAIL = normalizeAvail(availability);
  }

  /* Coba ambil data dari Firebase. true = mode firebase aktif. */
  async function tryFirebase() {
    if (!fbBase()) {
      FBSTAT = { reachable: false, reason: 'no-config', message: '' };
      return false;
    }
    let facMap;
    try {
      facMap = await fbGet('facilities');
      FBSTAT.reachable = true;
    } catch (e) {
      FBSTAT = {
        reachable: false,
        reason: (e.code === 'denied') ? 'denied' : 'unreachable',
        message: e.message || ''
      };
      return false;
    }
    if (!facMap || typeof facMap !== 'object') {
      // Terhubung tapi belum ada isinya → pakai mode lokal sampai di-seed
      FBSTAT = { reachable: true, reason: 'empty', message: '' };
      return false;
    }
    let avail = null, bkMap = null;
    try {
      const pair = await Promise.all([fbGet('availability'), fbGet('bookings')]);
      avail = pair[0]; bkMap = pair[1];
    } catch (e) {
      FBSTAT = { reachable: false, reason: 'unreachable', message: e.message || '' };
      return false;
    }
    FACILITIES = mapToFacilities(facMap);
    AVAIL = normalizeAvail(avail);
    BOOKINGS = bookingMapToList(bkMap);
    MODE = 'firebase';
    FBSTAT = { reachable: true, reason: 'ok', message: '' };
    return true;
  }

  function applyLocalMode() {
    MODE = 'local';
    AVAIL = SEED_AVAIL;
    OVERRIDES = sanitizeOverrides(CFB.store.get(KEY_OVERRIDES, null));
    BOOKINGS = migrateBookings();
    rebuildLocalFacilities();
  }

  /* Bila fasilitas dari server belum memiliki denah (layout), pakai denah
     default dari data/facilities.json sebagai fallback tampilan —
     tanpa menulis ke server. Admin tetap dapat kustomisasi lewat editor. */
  function applySeedLayoutFallback() {
    const seedMap = {};
    SEED.forEach(s => { if (s && s.layout) seedMap[s.id] = s.layout; });
    FACILITIES.forEach(f => { if (!f.layout && seedMap[f.id]) f.layout = seedMap[f.id]; });
  }

  async function load() {
    await loadLocalSeeds();
    const ok = await tryFirebase();
    if (ok) applySeedLayoutFallback();
    else applyLocalMode();
  }

  /* Ambil ulang pengajuan dari Firebase (mode firebase saja) */
  async function refreshBookings() {
    if (MODE !== 'firebase') return false;
    try {
      BOOKINGS = bookingMapToList(await fbGet('bookings'));
      return true;
    } catch (e) { return false; }
  }

  /* Muat ulang fasilitas dari server (mode firebase) — dipakai admin editor */
  async function refreshFacilities() {
    if (MODE !== 'firebase') return false;
    try {
      FACILITIES = mapToFacilities(await fbGet('facilities'));
      applySeedLayoutFallback();
      return true;
    } catch (e) { return false; }
  }

  // ============ Fasilitas ============
  function getFacilities() { return FACILITIES.slice(); }
  function getFacilityById(id) { return FACILITIES.find(f => f.id === id) || null; }

  function setOverrides(o) {
    OVERRIDES = sanitizeOverrides(o);
    CFB.store.set(KEY_OVERRIDES, OVERRIDES);
  }
  function resetOverrides() {
    CFB.store.remove(KEY_OVERRIDES);
    OVERRIDES = emptyOverrides();
  }
  function getOverrides() { return OVERRIDES; }

  function rebuildLocalFacilities() {
    let list = SEED
      .filter(f => !OVERRIDES.deleted.includes(f.id))
      .map(f => Object.assign({}, f, OVERRIDES.updated[f.id] || {}));
    list = list.concat(OVERRIDES.created.map(f => Object.assign({}, f)));
    FACILITIES = list;
  }

  /* ID baru: FAC-XXX berikutnya */
  function nextFacilityId() {
    const nums = [];
    FACILITIES.forEach(f => {
      const m = /^FAC-(\d+)$/.exec(f.id);
      if (m) nums.push(parseInt(m[1], 10));
    });
    const next = (nums.length ? Math.max.apply(null, nums) : 0) + 1;
    return 'FAC-' + String(next).padStart(3, '0');
  }

  /* Simpan (tambah/ubah). Mengembalikan { ok, error? }. */
  async function saveFacility(obj) {
    if (!obj || !obj.id) return { ok: false, error: 'ID fasilitas tidak valid' };
    if (MODE === 'firebase') {
      try {
        await fbPut('facilities/' + encodeURIComponent(obj.id), obj);
        const i = FACILITIES.findIndex(f => f.id === obj.id);
        if (i >= 0) FACILITIES[i] = Object.assign({}, obj);
        else FACILITIES.push(Object.assign({}, obj));
        return { ok: true };
      } catch (e) { return { ok: false, error: fbErrMsg(e) }; }
    }
    const o = sanitizeOverrides(CFB.store.get(KEY_OVERRIDES, null));
    const existing = FACILITIES.find(f => f.id === obj.id);
    if (existing) {
      const idx = o.created.findIndex(x => x.id === obj.id);
      if (idx >= 0) o.created[idx] = obj;
      else o.updated[obj.id] = obj;
    } else {
      o.created.push(obj);
    }
    setOverrides(o);
    rebuildLocalFacilities();
    return { ok: true };
  }

  /* Hapus fasilitas. Mengembalikan { ok, error? }. */
  async function deleteFacility(id) {
    if (!id) return { ok: false, error: 'ID fasilitas tidak valid' };
    if (MODE === 'firebase') {
      try {
        await fbDelete('facilities/' + encodeURIComponent(id));
        FACILITIES = FACILITIES.filter(f => f.id !== id);
        return { ok: true };
      } catch (e) { return { ok: false, error: fbErrMsg(e) }; }
    }
    const o = sanitizeOverrides(CFB.store.get(KEY_OVERRIDES, null));
    const idx = o.created.findIndex(x => x.id === id);
    if (idx >= 0) o.created.splice(idx, 1);
    else { if (!o.deleted.includes(id)) o.deleted.push(id); delete o.updated[id]; }
    setOverrides(o);
    rebuildLocalFacilities();
    return { ok: true };
  }

  /* Reset fasilitas ke isi data/facilities.json.
     Mode firebase: menimpa node facilities di server.
     Mode lokal: menghapus lapisan overrides. */
  async function resetFacilities() {
    if (MODE === 'firebase') {
      try {
        await fbPut('facilities', facilitiesToMap(SEED));
        FACILITIES = SEED.map(f => Object.assign({}, f));
        return { ok: true, target: 'firebase' };
      } catch (e) { return { ok: false, error: fbErrMsg(e), target: 'firebase' }; }
    }
    resetOverrides();
    rebuildLocalFacilities();
    return { ok: true, target: 'local' };
  }

  /* Info untuk teks status admin */
  function getFacilityStats() {
    if (MODE === 'firebase') {
      return { mode: 'firebase', total: FACILITIES.length };
    }
    return {
      mode: 'local', total: FACILITIES.length,
      created: OVERRIDES.created.length,
      updated: Object.keys(OVERRIDES.updated).length,
      deleted: OVERRIDES.deleted.length
    };
  }

  /* Unggah data awal (facilities + availability) ke Firebase */
  async function seedFirebase() {
    if (!fbBase()) return { ok: false, error: 'Konfigurasi Firebase belum diisi (assets/js/firebase-config.js)' };
    try {
      try { await fbGet('facilities'); } catch (e) { return { ok: false, error: fbErrMsg(e) }; }
      await fbPut('facilities', facilitiesToMap(SEED));
      await fbPut('availability', SEED_AVAIL);
      const ok = await tryFirebase();     // aktifkan mode firebase langsung
      if (!ok) applyLocalMode();
      return { ok: true, facilities: SEED.length };
    } catch (e) {
      return { ok: false, error: fbErrMsg(e) };
    }
  }

  // ============ Policy & tanggal ============
  function policy() { return AVAIL.policy; }

  function toISO(d) {
    return d.getFullYear() + '-' + CFB.util.pad2(d.getMonth() + 1) + '-' + CFB.util.pad2(d.getDate());
  }
  /* Daftar tanggal yang bisa dipinjam: hari ini .. N hari ke depan */
  function bookableDates() {
    const n = Math.max(1, AVAIL.policy.bookingDaysAhead | 0);
    const out = [];
    const d = new Date();
    for (let i = 0; i < n; i++) { out.push(toISO(d)); d.setDate(d.getDate() + 1); }
    return out;
  }

  // ============ Jam operasional & ketersediaan seed ============
  function hoursOfDay(f) {
    if (!f || !f.openHours) return { start: 8, end: 16 };
    const s = parseInt(String(f.openHours.start).split(':')[0], 10) || 8;
    const e = parseInt(String(f.openHours.end).split(':')[0], 10) || 16;
    return { start: s, end: e };
  }

  function dayClosure(facilityId, date) {
    return AVAIL.exceptions.find(e =>
      e.date === date && e.hours === 'all' && (e.facilityId === '*' || e.facilityId === facilityId)
    ) || null;
  }

  function seedTakenHours(facilityId, date) {
    const set = new Set();
    const wd = new Date(date + 'T00:00:00').getDay();
    AVAIL.exceptions.forEach(e => {
      if (e.date !== date) return;
      if (e.facilityId !== '*' && e.facilityId !== facilityId) return;
      if (Array.isArray(e.hours)) e.hours.forEach(h => set.add(h));
    });
    AVAIL.recurring.forEach(r => {
      if (r.facilityId === facilityId && r.weekday === wd && Array.isArray(r.hours)) {
        r.hours.forEach(h => set.add(h));
      }
    });
    return set;
  }

  /* Apakah suatu jam terisi: seed Booked ATAU ada pengajuan Pending/Approved */
  function isHourTaken(facilityId, date, hour) {
    if (dayClosure(facilityId, date)) return true;
    if (seedTakenHours(facilityId, date).has(hour)) return true;
    return BOOKINGS.some(b =>
      b.facilityId === facilityId && b.date === date &&
      String(b.status).toLowerCase() !== 'rejected' &&
      b.startHour <= hour && hour < b.startHour + (b.durationHours || 2)
    );
  }

  function durationOptions(f, date, startHour) {
    const { end } = hoursOfDay(f);
    const max = Math.max(1, AVAIL.policy.maxDurationHours | 0);
    const opts = [1];
    if (max >= 2 && startHour + 2 <= end && !isHourTaken(f.id, date, startHour + 1)) opts.push(2);
    return opts;
  }

  function isRangeFree(facilityId, date, startHour, dur) {
    for (let h = startHour; h < startHour + dur; h++) {
      if (isHourTaken(facilityId, date, h)) return false;
    }
    return true;
  }

  // ============ Saran ruang alternatif ============
  function suggestAlternatives(current, participants) {
    if (!current || !participants || participants < 1) return [];
    return FACILITIES
      .filter(x =>
        x.id !== current.id &&
        x.status !== 'Unavailable' &&
        x.capacity >= participants &&
        x.capacity < current.capacity
      )
      .sort((a, b) => {
        const ca = a.category === current.category ? 0 : 1;
        const cb = b.category === current.category ? 0 : 1;
        return (ca - cb) || (a.capacity - b.capacity);
      })
      .slice(0, 3);
  }

  // ============ Pengajuan (bookings) ============
  /* Migrasi data lama (LocalStorage): slotTime "08:00-10:00" → startHour/endHour/durationHours */
  function migrateBookings() {
    let list = CFB.store.get(KEY_BOOKINGS, []);
    if (!Array.isArray(list)) list = [];
    let changed = false;
    list.forEach(b => {
      const s = String(b.status || 'Pending').toLowerCase();
      const cap = s.charAt(0).toUpperCase() + s.slice(1);
      if (b.status !== cap) { b.status = cap; changed = true; }
      if (b.startHour == null) {
        const src = b.slotTime || ((b.slotStart && b.slotEnd) ? (b.slotStart + '-' + b.slotEnd) : null);
        if (src) {
          const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(String(src).replace(/\s/g, ''));
          if (m) {
            b.startHour = parseInt(m[1], 10);
            b.endHour = parseInt(m[3], 10);
            b.durationHours = Math.max(1, b.endHour - b.startHour);
            changed = true;
          }
        }
      }
      if (b.durationHours == null && b.startHour != null && b.endHour != null) {
        b.durationHours = Math.max(1, b.endHour - b.startHour);
        changed = true;
      }
    });
    if (changed) CFB.store.set(KEY_BOOKINGS, list);
    return list;
  }

  /* Semua pengajuan (untuk admin & cek slot) */
  function getBookings() { return BOOKINGS.slice(); }

  /* Pengajuan milik pengguna ini (untuk "Peminjaman Saya").
     Bila login Firebase: HANYA pengajuan yang terikat uid akun ini
     (lintas perangkat). Pengajuan tamu milik browser ini (sebelum login)
     tetap tampil; pengajuan milik akun/pengguna lain tidak pernah tampil.
     Bila tamu: hanya pengajuan yang terikat clientId peramban ini.
     Pengajuan tanpa uid maupun clientId (data lama/uji) tidak ditampilkan
     ke siapa pun — hanya terlihat pada panel admin. */
  function getMyBookings() {
    const cid = getClientId();
    const u = (window.CFB.auth && CFB.auth.getUser) ? CFB.auth.getUser() : null;
    if (u && u.uid) {
      return BOOKINGS.filter(b =>
        b.uid === u.uid || (!b.uid && b.clientId && b.clientId === cid)
      ).slice();
    }
    return BOOKINGS.filter(b => !b.uid && b.clientId === cid).slice();
  }

  function getBookingById(id) { return BOOKINGS.find(b => b.id === id) || null; }

  /* Tambah pengajuan. Mengembalikan objek tersimpan, atau null bila gagal. */
  async function addBooking(b) {
    const rec = Object.assign({}, b);
    if (!rec.clientId) rec.clientId = getClientId();
    /* Ikat pengajuan ke akun Firebase (bila login) → riwayat lintas perangkat */
    const u = (window.CFB.auth && CFB.auth.getUser) ? CFB.auth.getUser() : null;
    if (u && u.uid) {
      rec.uid = u.uid;
      if (u.email) rec.accountEmail = u.email;
      if (u.name && !rec.name) rec.name = u.name;
    }
    if (MODE === 'firebase') {
      try {
        const key = await fbPush('bookings', stripInternal(rec));
        rec._key = key;
        BOOKINGS.unshift(rec);
        return rec;
      } catch (e) { fbErrorToast(e); return null; }
    }
    const list = migrateBookings();
    list.unshift(rec);
    if (!CFB.store.set(KEY_BOOKINGS, list)) {
      CFB.notify.error((window.CFB.i18n ? CFB.i18n.t('dl.err.localTitle') : 'Gagal menyimpan'),
        (window.CFB.i18n ? CFB.i18n.t('dl.err.localMsg') : 'Penyimpanan lokal browser tidak dapat diakses.'));
      return null;
    }
    BOOKINGS = list;
    return rec;
  }

  /* Ubah status (Approved/Rejected). Mengembalikan objek, atau null bila gagal. */
  async function updateBookingStatus(id, status, extra) {
    const b = BOOKINGS.find(x => x.id === id);
    if (!b) return null;
    const patch = { status: status, decidedAt: new Date().toISOString() };
    if (extra && typeof extra === 'object') Object.assign(patch, extra);
    if (MODE === 'firebase') {
      try {
        if (b._key) await fbPatch('bookings/' + b._key, patch);
        else b._key = await fbPush('bookings', stripInternal(Object.assign({}, b, patch)));
        Object.assign(b, patch);
        return b;
      } catch (e) { fbErrorToast(e); return null; }
    }
    const list = migrateBookings();
    const t = list.find(x => x.id === id);
    if (!t) return null;
    Object.assign(t, patch);
    if (!CFB.store.set(KEY_BOOKINGS, list)) return null;
    BOOKINGS = list;
    return t;
  }

  /* Hapus semua pengajuan */
  async function clearBookings() {
    if (MODE === 'firebase') {
      try {
        await fbDelete('bookings');
        BOOKINGS = [];
        return true;
      } catch (e) { fbErrorToast(e); return false; }
    }
    CFB.store.remove(KEY_BOOKINGS);
    BOOKINGS = [];
    return true;
  }

  function generateBookingId() {
    const d = new Date();
    const ymd = '' + d.getFullYear() + CFB.util.pad2(d.getMonth() + 1) + CFB.util.pad2(d.getDate());
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return 'GMS-' + ymd + '-' + rand;
  }

  // ============ Status & publikasi ============
  function getMode() { return MODE; }
  function fbStatus() {
    return {
      mode: MODE,
      base: fbBase(),
      reachable: FBSTAT.reachable,
      reason: FBSTAT.reason,
      message: FBSTAT.message
    };
  }
  /* ===== Baca/tulis node arbitrer (Task 9 — dipakai RBAC admin:
     daftar admin pada node /admins). null bila ditolak/tidak terjangkau. */
  async function fbNodeGet(path) {
    try { return await fbGet(path); }
    catch (e) { return null; }
  }
  async function fbNodePut(path, value) {
    try { await fbPut(path, value); return { ok: true }; }
    catch (e) { return { ok: false, error: fbErrMsg(e) }; }
  }

  CFB.data = {
    load, policy,
    getFacilities, getFacilityById, nextFacilityId,
    saveFacility, deleteFacility, resetFacilities, getFacilityStats,
    setOverrides, resetOverrides, getOverrides,   // legacy (mode lokal)
    bookableDates, hoursOfDay, dayClosure,
    isHourTaken, durationOptions, isRangeFree,
    suggestAlternatives,
    getBookings, getMyBookings, getBookingById,
    addBooking, updateBookingStatus, clearBookings, refreshBookings, refreshFacilities,
    generateBookingId, getClientId,
    getMode, fbStatus, seedFirebase,
    fbNodeGet, fbNodePut
  };
})();
