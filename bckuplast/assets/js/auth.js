/* ============================================
   Gamaspace — Firebase Auth
   --------------------------------------------
   Login Google (popup) + email/kata sandi melalui Firebase Auth SDK
   (dimuat dinamis dari CDN hanya bila apiKey & authDomain tersedia).

   Setelah login:
   - idToken dipakai data.js untuk query RTDB (?auth=<token>)
   - riwayat "Peminjaman Saya" terikat uid (lintas perangkat)
   - profil dasar disimpan pada node /users/{uid}

   Konfigurasi (assets/js/firebase-config.js):
   apiKey, authDomain  → wajib untuk mengaktifkan login
   mockAuth: true      → khusus pengujian lokal (login palsu tanpa server)

   Tanpa konfigurasi, tombol Masuk tetap tampil namun memberi tahu
   bahwa login belum dikonfigurasi (aplikasi tetap berfungsi normal).
   ============================================ */
window.CFB = window.CFB || {};
(function () {
  'use strict';

  const cfg = window.CFB_FIREBASE || {};
  const HAS_CFG = !!(String(cfg.apiKey || '').trim() && String(cfg.authDomain || '').trim());
  const MOCK = cfg.mockAuth === true;
  const SDK_VER = '10.14.1';

  let sdk = null;          // { app, auth, mods }
  let user = null;         // { uid, email, name, photo, provider }
  let ready = false;
  const readyCbs = [];
  let initErr = null;

  const LS_MOCK = 'cfb_mock_user';

  function onReady(cb) {
    if (ready) cb(user, initErr);
    else readyCbs.push(cb);
  }
  function emit() {
    ready = true;
    readyCbs.splice(0).forEach(cb => { try { cb(user, initErr); } catch (e) { /* noop */ } });
    document.dispatchEvent(new CustomEvent('cfb:auth', { detail: { user: user } }));
  }

  function available() { return HAS_CFG || MOCK; }

  function getToken() {
    if (MOCK) return Promise.resolve(user ? 'mock-id-token' : null);
    if (sdk && sdk.auth.currentUser) return sdk.auth.currentUser.getIdToken().catch(() => null);
    return Promise.resolve(null);
  }

  function getUser() { return user; }

  /* Profil dasar → /users/{uid} (best-effort, tanpa menahan UI) */
  function syncProfile(u) {
    if (!u || !u.uid || MOCK) return;
    const base = String(cfg.databaseURL || '').replace(/\/+$/, '');
    if (!base) return;
    getToken().then(tok => {
      if (!tok) return;
      return fetch(base + '/users/' + encodeURIComponent(u.uid) + '.json?auth=' + encodeURIComponent(tok), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: u.name || '', email: u.email || '', photo: u.photo || '',
          lastLogin: new Date().toISOString()
        })
      });
    }).catch(() => { /* best effort */ });
  }

  function mapUser(u, provider) {
    if (!u) return null;
    return {
      uid: u.uid,
      email: u.email || '',
      name: u.displayName || (u.email ? u.email.split('@')[0] : 'Pengguna'),
      photo: u.photoURL || '',
      provider: provider
    };
  }

  /* ============ Mock (khusus pengujian lokal) ============ */
  function mockSignIn(kind, email, name) {
    const u = {
      uid: 'mock-' + (email || 'user').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 16),
      email: email || 'mahasiswa@mail.ugm.ac.id',
      name: name || (email ? email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Mahasiswa UGM'),
      photo: '', provider: kind
    };
    user = u;
    try { localStorage.setItem(LS_MOCK, JSON.stringify(u)); } catch (e) { /* noop */ }
    emit();
    return Promise.resolve(u);
  }
  function mockSignOut() {
    user = null;
    try { localStorage.removeItem(LS_MOCK); } catch (e) { /* noop */ }
    emit();
    return Promise.resolve();
  }

  /* ============ Inisialisasi SDK ============ */
  async function init() {
    if (MOCK) {
      try {
        const saved = JSON.parse(localStorage.getItem(LS_MOCK) || 'null');
        if (saved && saved.uid) user = saved;
      } catch (e) { /* noop */ }
      emit();
      return;
    }
    if (!HAS_CFG) { emit(); return; }
    try {
      const appMod = await import('https://www.gstatic.com/firebasejs/' + SDK_VER + '/firebase-app.js');
      const authMod = await import('https://www.gstatic.com/firebasejs/' + SDK_VER + '/firebase-auth.js');
      const app = appMod.initializeApp({
        apiKey: cfg.apiKey,
        authDomain: cfg.authDomain,
        databaseURL: cfg.databaseURL || '',
        projectId: cfg.projectId || ''
      });
      const auth = authMod.getAuth(app);
      sdk = { app, auth, mods: authMod };
      authMod.onAuthStateChanged(auth, (u) => {
        user = u ? mapUser(u, u.providerData && u.providerData[0] ? u.providerData[0].providerId : 'password') : null;
        if (user) syncProfile(user);
        emit();
      });
    } catch (e) {
      initErr = e;
      emit();
    }
  }

  /* ============ Aksi login ============ */
  function signInGoogle() {
    if (MOCK) return mockSignIn('google', 'mahasiswa@mail.ugm.ac.id', null);
    if (!sdk) return Promise.reject(new Error('auth-unconfigured'));
    const { signInWithPopup, GoogleAuthProvider } = sdk.mods;
    return signInWithPopup(sdk.auth, new GoogleAuthProvider())
      .then(cred => mapUser(cred.user, 'google'));
  }

  function signInEmail(email, pass) {
    if (MOCK) return mockSignIn('password', email, null);
    if (!sdk) return Promise.reject(new Error('auth-unconfigured'));
    const { signInWithEmailAndPassword } = sdk.mods;
    return signInWithEmailAndPassword(sdk.auth, email, pass)
      .then(cred => mapUser(cred.user, 'password'));
  }

  function signUpEmail(email, pass, name) {
    if (MOCK) return mockSignIn('password', email, name);
    if (!sdk) return Promise.reject(new Error('auth-unconfigured'));
    const { createUserWithEmailAndPassword, updateProfile } = sdk.mods;
    return createUserWithEmailAndPassword(sdk.auth, email, pass)
      .then(cred => (name ? updateProfile(cred.user, { displayName: name }).then(() => cred.user) : cred.user))
      .then(u => mapUser(u, 'password'));
  }

  function signOut() {
    if (MOCK) return mockSignOut();
    if (!sdk) return Promise.resolve();
    return sdk.mods.signOut(sdk.auth);
  }

  /* Pesan error SDK → teks ramah (ID saja; admin/internal) */
  function errText(e) {
    const code = String((e && e.code) || '');
    const map = {
      'auth/invalid-email': 'Alamat email tidak valid.',
      'auth/user-not-found': 'Akun tidak ditemukan. Daftar terlebih dahulu.',
      'auth/wrong-password': 'Kata sandi salah.',
      'auth/invalid-credential': 'Email atau kata sandi salah.',
      'auth/email-already-in-use': 'Email sudah terdaftar — silakan masuk.',
      'auth/weak-password': 'Kata sandi terlalu lemah (minimal 6 karakter).',
      'auth/popup-closed-by-user': 'Jendela Google ditutup sebelum selesai.',
      'auth/popup-blocked': 'Popup diblokir browser — izinkan popup untuk situs ini.',
      'auth/unauthorized-domain': 'Domain ini belum diizinkan di Firebase Console → Authentication → Settings → Authorized domains.',
      'auth/operation-not-allowed': 'Metode login ini belum diaktifkan di Firebase Console → Authentication → Sign-in method.',
      'auth/network-request-failed': 'Koneksi jaringan gagal. Periksa internet Anda.'
    };
    return map[code] || ((e && e.message) ? String(e.message).replace('Firebase: ', '').replace(/\(auth.*\)\.?/, '').trim() : 'Terjadi kesalahan saat masuk.');
  }

  CFB.auth = {
    init, onReady, available, getUser, getToken,
    signInGoogle, signInEmail, signUpEmail, signOut, errText,
    _mock: MOCK, _hasCfg: HAS_CFG
  };
})();
