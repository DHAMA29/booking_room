/* ============================================
   Campus Facility Booking — Konfigurasi Firebase
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
  databaseURL: 'https://booking-room-ugm-default-rtdb.asia-southeast1.firebasedatabase.app'
};

/* Struktur data di Realtime Database:
   {
     "facilities":   { "FAC-001": { ...objek fasilitas... }, ... },
     "availability": { "policy": {...}, "recurring": [...], "exceptions": [...] },
     "bookings":     { "<pushKey>": { ...objek pengajuan... }, ... }
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
       "bookings":     { ".read": true, ".write": true }
     }
   }

   Bila URL dikosongkan (''), aplikasi otomatis berjalan pada
   mode lokal (data/*.json + LocalStorage) tanpa Firebase. */
