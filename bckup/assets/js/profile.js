/* ============================================
   Gamaspace — Profil Identitas Peminjam
   --------------------------------------------
   Setelah login, pengguna mengisi identitas SEKALI:
   nama lengkap, NIM, email UGM, no. WhatsApp, program studi.
   Data ini otomatis mengisi formulir peminjaman berikutnya
   (field tetap bisa diubah saat pengajuan).

   Penyimpanan (dua lapis):
   1. LocalStorage "cfb_ident_<email>" — instan, terikat pada
      EMAIL akun (satu identitas per email, sesuai alur "otomatis
      berdasarkan data setiap email").
   2. Realtime Database /users/<uid>/identitas — sinkron lintas
      perangkat (best-effort; bila Rules belum membuka node /users,
      penyimpanan lokal tetap berfungsi tanpa gangguan).

   Dipakai oleh app.js (halaman #/profile, modal identitas saat
   gerbang transaksi, dan prefill formulir peminjaman).
   ============================================ */
window.CFB = window.CFB || {};
(function () {
  'use strict';

  const LS_PREFIX = 'cfb_ident_';

  function T(k, p) { return (window.CFB.i18n ? CFB.i18n.t(k, p) : k); }

  function currentUser() {
    return (window.CFB.auth && CFB.auth.getUser) ? CFB.auth.getUser() : null;
  }

  function lsKey(email) {
    return LS_PREFIX + String(email || 'anon').toLowerCase().trim();
  }

  function empty() {
    return { nama: '', nim: '', emailUgm: '', wa: '', prodi: '' };
  }

  function normalize(p) {
    const o = Object.assign(empty(), (p && typeof p === 'object') ? p : {});
    o.nama = String(o.nama || '').trim().slice(0, 80);
    o.nim = String(o.nim || '').trim().toUpperCase().slice(0, 20);
    o.emailUgm = String(o.emailUgm || '').trim().toLowerCase().slice(0, 80);
    o.wa = (window.CFB.format && CFB.format.cleanPhoneLocal)
      ? CFB.format.cleanPhoneLocal(o.wa)
      : String(o.wa || '').replace(/\D/g, '').slice(0, 13);
    o.prodi = String(o.prodi || '').trim().slice(0, 100);
    return o;
  }

  /* Identitas dianggap lengkap bila kelima field terisi */
  function complete(p) {
    return !!(p && p.nama && p.nim && p.emailUgm && p.wa && p.prodi);
  }

  /* Baca dari LocalStorage (terikat email akun aktif) */
  function getLocal() {
    const u = currentUser();
    if (!u) return null;
    try {
      const raw = localStorage.getItem(lsKey(u.email));
      const p = raw ? JSON.parse(raw) : null;
      return p ? normalize(p) : null;
    } catch (e) { return null; }
  }

  /* Profil untuk pengisian formulir:
     - identitas tersimpan (bila ada), atau
     - turunan akun (nama tampilan + email UGM bila cocok) sebagai titik awal */
  function get() {
    const u = currentUser();
    if (!u) return null;
    const local = getLocal();
    if (local) return local;
    const d = empty();
    d.nama = u.name || '';
    if (/@mail\.ugm\.ac\.id$/i.test(u.email || '')) d.emailUgm = u.email;
    return d;
  }

  /* Simpan: LocalStorage selalu; RTDB best-effort (lintas perangkat) */
  async function save(p) {
    const u = currentUser();
    if (!u) return { local: false, server: false };
    const clean = normalize(p);
    clean.updatedAt = new Date().toISOString();
    let local = false;
    try {
      localStorage.setItem(lsKey(u.email), JSON.stringify(clean));
      local = true;
    } catch (e) { local = false; }
    let server = false;
    try {
      if (window.CFB.data && CFB.data.getMode() === 'firebase' && CFB.data.fbNodePut) {
        const r = await CFB.data.fbNodePut('users/' + encodeURIComponent(u.uid) + '/identitas', clean);
        server = !!(r && r.ok);
      }
    } catch (e) {
      /* Rules /users belum membuka akses → identitas tetap tersimpan lokal */
      server = false;
    }
    return { local: local, server: server };
  }

  /* Tarik identitas dari RTDB (lintas perangkat) — dipanggil setiap kali
     status auth berubah (sekali per email per sesi). Server lebih baru →
     timpa LocalStorage. */
  async function pull() {
    const u = currentUser();
    if (!u) return;
    if (pull._for === u.email) return;
    /* Mode belum firebase (masih memuat / lokal) → jangan tandai agar
       dicoba ulang pada event auth berikutnya setelah mode memutus. */
    if (!(window.CFB.data && CFB.data.getMode && CFB.data.getMode() === 'firebase')) return;
    if (!CFB.data.fbNodeGet) return;
    pull._for = u.email;
    try {
      const raw = await CFB.data.fbNodeGet('users/' + encodeURIComponent(u.uid) + '/identitas');
      if (raw && raw.nama) {
        const srv = normalize(raw);
        const loc = getLocal();
        const srvAt = String(srv.updatedAt || '');
        const locAt = String((loc && loc.updatedAt) || '');
        if (!locAt || srvAt >= locAt) {
          try { localStorage.setItem(lsKey(u.email), JSON.stringify(srv)); } catch (e) { /* noop */ }
        }
      }
    } catch (e) {
      /* Node /users ditolak Rules atau offline → abaikan, mode lokal tetap jalan */
    }
  }

  window.CFB.profile = { empty, normalize, complete, get, save, pull, _lsKey: lsKey };
})();
