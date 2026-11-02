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

  /* ===== RBAC Admin — daftar email yang boleh masuk Admin Panel
     (admin.html). Login admin memakai EMAIL + KATA SANDI
     (Firebase Auth → Sign-in method → Email/Password harus aktif).
     Akun admin dapat didaftarkan langsung pada gate admin.html
     (tombol "Daftar") atau melalui sisi pengguna.

     Sumber daftar admin (dicek berurutan):
     0. rootAdminEmail di bawah — pengelola utama, SELALU diizinkan.
     1. adminEmails di bawah ini — cara tercepat: isi dengan email
        akun admin Anda (huruf besar/kecil diabaikan).
     2. Node /admins di Realtime Database — diisi ketika pengelola
        utama MENAMBAHKAN admin baru pada tab "Admin & Akun"
        (langsung aktif, tanpa proses persetujuan).

     Bila rootAdminEmail belum diatur DAN kedua sumber lain kosong,
     login PERTAMA pada admin.html akan mencoba mendaftarkan dirinya
     ke /admins (first-claim) — set "allowFirstAdminClaim": false
     untuk menonaktifkannya. */
  adminEmails: [
    // 'email.anda@gmail.com'
  ],
  allowFirstAdminClaim: true,

  /* ===== RBAC Petugas Lapangan — daftar email petugas pemegang kunci
     Petugas login pada admin.html yang sama, namun menu dibatasi:
       • Scanner (pindai QR bukti peminjam saat pengambilan kunci)
       • Pengajuan (HANYA LIHAT — perubahan status terjadi otomatis
         oleh sistem melalui pemindaian, bukan tombol manual)
     Petugas TIDAK dapat menyetujui/menolak pengajuan, mengelola admin,
     pengguna, fasilitas, maupun melihat dashboard analitik.

     EMAIL BEBAS — petugas TIDAK harus memakai alamat @ugm.ac.id
     (berlaku sementara; dapat diperketat kembali bila dibutuhkan).

     Sumber daftar petugas (dicek berurutan):
     1. petugasEmails di bawah ini — cara tercepat.
     2. Node /petugas di Realtime Database — diisi ketika pengelola
        utama menambahkan petugas baru pada tab "Admin" (bagian
        Petugas Lapangan). */
  petugasEmails: [
    // 'petugas@gamadata.id'
  ],

  /* ===== Pengelola utama (root admin) =====
     Satu-satunya akun yang dapat MENAMBAHKAN admin baru pada tab
     "Admin & Akun" — langsung aktif tanpa proses persetujuan.
     Admin lain tetap dapat melihat daftar admin dan tombol
     Tambah Admin, namun akan menerima notifikasi "Akses Ditolak"
     bila menekannya. */
  rootAdminEmail: 'dhamashidqiputra2007@mail.ugm.ac.id'
};

/* Struktur data di Realtime Database:
   {
     "facilities":     { "FAC-001": { ...objek fasilitas... }, ... },
     "availability":   { "policy": {...}, "recurring": [...], "exceptions": [...] },
     "bookings":       { "<pushKey>": { ...objek pengajuan... }, ... },
     "users":          { "<uid>": { "email": "...", "lastLogin": "...",
                          "identitas": { nama, nim, emailUgm, wa, prodi } } },
     "admins":         { "<key-email>": "email@contoh.com" },
     "petugas":        { "<key-email>": "email@contoh.com" },
     "keys":           { "<pushKey>": { "facilityId": "FAC-001",
                          "label": "Kunci R-101 #1", "note": "" }, ... }
   }

   Status kunci TIDAK disimpan di node keys — status "Dipinjam"
   diturunkan otomatis dari pengajuan berstatus Checked-in yang
   mencatat keyId, sehingga tidak pernah tidak sinkron.

   Isi awal dapat diunggah dengan:
   1. Import file `firebase-seed.json` lewat Firebase Console
      (Realtime Database → menu ⋮ → Import JSON), ATAU
   2. Tombol "Unggah data awal (Seed)" di Admin Panel → tab Fasilitas.

   Rules yang direkomendasikan (Realtime Database → tab Rules):
   {
     "rules": {
       "facilities":     { ".read": true, ".write": true },
       "availability":   { ".read": true, ".write": true },
       "bookings":       { ".read": true, ".write": true },
       "users":          { ".read": true, ".write": true },
       "admins":         { ".read": true, ".write": true },
       "petugas":        { ".read": true, ".write": true },
       "keys":           { ".read": true, ".write": true }
     }
   }

   Bila URL dikosongkan (''), aplikasi otomatis berjalan pada
   mode lokal (data/*.json + LocalStorage) tanpa Firebase. */
