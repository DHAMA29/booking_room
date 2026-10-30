/* ============================================
   Gamaspace — Konfigurasi Firebase
   --------------------------------------------
   Data fasilitas, ketersediaan, dan pengajuan peminjaman
   disimpan di Firebase Realtime Database (RTDB).

   Aplikasi mengakses RTDB lewat REST API
   (GET/PUT/PATCH/POST/DELETE pada <databaseURL>/<path>.json),
   sehingga yang dibutuhkan HANYA `databaseURL` —
   tanpa apiKey, tanpa SDK, tanpa build step.
   (apiKey pada Firebase memang bukan rahasia, tapi tidak
   diperlukan selama Rules mengizinkan akses klien.)

   Cara mengganti database:
   Firebase Console → Realtime Database → URL terlihat di
   bagian atas (contoh: https://<project>-default-rtdb.<region>.firebasedatabase.app)
   ============================================ */
window.CFB_FIREBASE = {
  // Project  : booking-room-ugm
  // Region   : asia-southeast1
  databaseURL: 'https://booking-room-ugm-default-rtdb.asia-southeast1.firebasedatabase.app',

  /* ===== Firebase Auth (login Google / email) — OPSIONAL =====
     Isi dua baris di bawah untuk mengaktifkan tombol "Masuk".
     Nilainya ada di Firebase Console → Project settings →
     Your apps → SDK setup and configuration (bukan rahasia).
     Contoh:
       apiKey:    'AIzaSy...',
       authDomain: 'booking-room-ugm.firebaseapp.com',
     Sebelum dipakai, aktifkan Authentication → Sign-in method:
     Google & Email/Password, dan tambahkan domain situs
     (mis. <user>.github.io) ke Authentication → Settings →
     Authorized domains. Panduan lengkap: README → Firebase Auth. */
  apiKey: 'AIzaSyAbH7LTLqfW1LVSNSCYVWkCsJChigkh33g',
  authDomain: 'booking-room-ugm.firebaseapp.com',

  /* mockAuth: true  → mode login PALSU khusus pengujian lokal
     (tanpa server Firebase). Biarkan false untuk produksi. */
  mockAuth: false,

  /* ===== RBAC Admin (Task 9/10) — daftar email yang boleh masuk Admin
     Panel (admin.html). Login admin memakai EMAIL + KATA SANDI
     (Firebase Auth → Sign-in method → Email/Password harus aktif).
     Akun admin dapat didaftarkan langsung pada gate admin.html
     (tombol "Daftar") atau melalui sisi pengguna.

     Sumber daftar admin (dicek berurutan):
     1. adminEmails di bawah ini — cara tercepat: isi dengan email
        akun admin Anda (huruf besar/kecil diabaikan).
     2. Node /admins di Realtime Database — memungkinkan menambah admin
        tanpa deploy ulang; memerlukan Rules tambahan:
          "admins": { ".read": true, ".write": true }

     Bila KEDUA sumber kosong, login PERTAMA pada admin.html akan
     mencoba mendaftarkan dirinya ke /admins (first-claim) —
     set "allowFirstAdminClaim": false untuk menonaktifkannya. */
  adminEmails: [
    'joshesastrawinata@mail.ugm.ac.id',
     'dhamashidqiputra2007@mail.ugm.ac.id'
  ],
  allowFirstAdminClaim: true
};

/* Struktur data di Realtime Database:
   {
     "facilities":   { "FAC-001": { ...objek fasilitas... }, ... },
     "availability": { "policy": {...}, "recurring": [...], "exceptions": [...] },
     "bookings":     { "<pushKey>": { ...objek pengajuan... }, ... },
     "users":        { "<uid>": { "identitas": { nama, nim, emailUgm, wa, prodi } } },
     "admins":       { "<key-email>": "email@contoh.com" }
   }

   Isi awal dapat diunggah dengan:
   1. Import file `firebase-seed.json` lewat Firebase Console
      (Realtime Database → menu ⋮ → Import JSON), ATAU
   2. Tombol "Unggah data awal (Seed)" di Admin Panel → tab Fasilitas.

   Rules yang direkomendasikan (Realtime Database → tab Rules):
   {
     "rules": {
       "facilities":   { ".read": true, ".write": true },
       "availability": { ".read": true, ".write": true },
       "bookings":     { ".read": true, ".write": true },
       "users":        { ".read": true, ".write": true },
       "admins":       { ".read": true, ".write": true }
     }
   }

   Bila URL dikosongkan (''), aplikasi otomatis berjalan pada
   mode lokal (data/*.json + LocalStorage) tanpa Firebase. */
