/* ============================================
   Campus Facility Booking — Data Layer
   - Seed: data/facilities.json + data/availability.json (fetch)
   - Perubahan admin: LocalStorage cfb_facility_overrides
   - Pengajuan: LocalStorage cfb_bookings
   - Slot engine per jam, durasi 1..maxDurationHours (policy JSON)
   ============================================ */
window.CFB = window.CFB || {};
(function () {
  'use strict';

  const KEY_BOOKINGS = 'cfb_bookings';
  const KEY_OVERRIDES = 'cfb_facility_overrides';

  const DEFAULT_POLICY = { bookingDaysAhead: 14, minDurationHours: 1, maxDurationHours: 2 };

  let SEED = [];                                          // fasilitas dari JSON
  let AVAIL = { policy: DEFAULT_POLICY, recurring: [], exceptions: [] };
  let OVERRIDES = emptyOverrides();

  function emptyOverrides() { return { created: [], updated: {}, deleted: [] }; }
  function sanitizeOverrides(o) {
    if (!o || typeof o !== 'object') return emptyOverrides();
    return {
      created: Array.isArray(o.created) ? o.created : [],
      updated: (o.updated && typeof o.updated === 'object') ? o.updated : {},
      deleted: Array.isArray(o.deleted) ? o.deleted : []
    };
  }

  // ============ Pemuatan data ============
  async function load() {
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
    AVAIL = {
      policy: Object.assign({}, DEFAULT_POLICY, availability.policy || {}),
      recurring: Array.isArray(availability.recurring) ? availability.recurring : [],
      exceptions: Array.isArray(availability.exceptions) ? availability.exceptions : []
    };
    OVERRIDES = sanitizeOverrides(CFB.store.get(KEY_OVERRIDES, null));
    migrateBookings();
  }

  // ============ Fasilitas (merge seed + overrides) ============
  function getFacilities() {
    let list = SEED
      .filter(f => !OVERRIDES.deleted.includes(f.id))
      .map(f => Object.assign({}, f, OVERRIDES.updated[f.id] || {}));
    list = list.concat(OVERRIDES.created.map(f => Object.assign({}, f)));
    return list;
  }
  function getFacilityById(id) {
    return getFacilities().find(f => f.id === id) || null;
  }
  function setOverrides(o) {
    OVERRIDES = sanitizeOverrides(o);
    CFB.store.set(KEY_OVERRIDES, OVERRIDES);
  }
  function resetOverrides() {
    CFB.store.remove(KEY_OVERRIDES);
    OVERRIDES = emptyOverrides();
  }
  function getOverrides() { return OVERRIDES; }

  /* ID baru: FAC-XXX berikutnya */
  function nextFacilityId() {
    const nums = [];
    getFacilities().forEach(f => {
      const m = /^FAC-(\d+)$/.exec(f.id);
      if (m) nums.push(parseInt(m[1], 10));
    });
    const next = (nums.length ? Math.max.apply(null, nums) : 0) + 1;
    return 'FAC-' + String(next).padStart(3, '0');
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

  /* Pengecualian tertutup sehari penuh untuk fasilitas + tanggal (facilityId atau '*') */
  function dayClosure(facilityId, date) {
    return AVAIL.exceptions.find(e =>
      e.date === date && e.hours === 'all' && (e.facilityId === '*' || e.facilityId === facilityId)
    ) || null;
  }

  /* Kumpulan jam terisi dari seed (recurring mingguan + exceptions tanggal) */
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
    return getBookings().some(b =>
      b.facilityId === facilityId && b.date === date &&
      String(b.status).toLowerCase() !== 'rejected' &&
      b.startHour <= hour && hour < b.startHour + (b.durationHours || 2)
    );
  }

  /* Opsi durasi yang tersedia untuk jam mulai tertentu (menghormati policy max) */
  function durationOptions(f, date, startHour) {
    const { end } = hoursOfDay(f);
    const max = Math.max(1, AVAIL.policy.maxDurationHours | 0);
    const opts = [1];
    if (max >= 2 && startHour + 2 <= end && !isHourTaken(f.id, date, startHour + 1)) opts.push(2);
    return opts;
  }

  /* Apakah rentang [startHour, startHour+dur) bebas sepenuhnya */
  function isRangeFree(facilityId, date, startHour, dur) {
    for (let h = startHour; h < startHour + dur; h++) {
      if (isHourTaken(facilityId, date, h)) return false;
    }
    return true;
  }

  // ============ Saran ruang alternatif (kapasitas jauh lebih besar) ============
  function suggestAlternatives(current, participants) {
    if (!current || !participants || participants < 1) return [];
    return getFacilities()
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
  function readBookings() {
    const list = CFB.store.get(KEY_BOOKINGS, []);
    return Array.isArray(list) ? list : [];
  }
  function writeBookings(list) {
    if (!CFB.store.set(KEY_BOOKINGS, list)) {
      CFB.notify.error('Gagal menyimpan', 'Penyimpanan lokal browser tidak dapat diakses.');
    }
  }

  /* Migrasi data lama: slotTime "08:00-10:00" -> startHour/endHour/durationHours */
  function migrateBookings() {
    let list = readBookings();
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
    if (changed) writeBookings(list);
    return list;
  }

  function getBookings() { return migrateBookings(); }
  function getBookingById(id) { return getBookings().find(b => b.id === id) || null; }
  function addBooking(b) {
    const list = getBookings();
    list.unshift(b);
    writeBookings(list);
  }
  function updateBookingStatus(id, status, extra) {
    const list = getBookings();
    const b = list.find(x => x.id === id);
    if (!b) return null;
    b.status = status;
    b.decidedAt = new Date().toISOString();
    if (extra && typeof extra === 'object') Object.assign(b, extra);
    writeBookings(list);
    return b;
  }
  function clearBookings() { CFB.store.remove(KEY_BOOKINGS); }

  function generateBookingId() {
    const d = new Date();
    const ymd = '' + d.getFullYear() + CFB.util.pad2(d.getMonth() + 1) + CFB.util.pad2(d.getDate());
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return 'CFB-' + ymd + '-' + rand;
  }

  // ============ Publikasi ============
  CFB.data = {
    load,
    policy,
    getFacilities, getFacilityById, nextFacilityId,
    setOverrides, resetOverrides, getOverrides,
    bookableDates, hoursOfDay, dayClosure,
    isHourTaken, durationOptions, isRangeFree,
    suggestAlternatives,
    getBookings, getBookingById, addBooking, updateBookingStatus, clearBookings,
    generateBookingId
  };
})();
