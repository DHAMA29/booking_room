# Setup Firebase — Gamaspace

Panduan singkat 3 langkah untuk mengaktifkan database online pada project **booking-room-ugm**.
Setelah selesai, data fasilitas + pengajuan peminjaman dari semua pengguna akan tersinkron otomatis.

> URL database sudah tertanam di `assets/js/firebase-config.js`:
> `https://booking-room-ugm-default-rtdb.asia-southeast1.firebasedatabase.app`
> Tidak perlu `apiKey`, tidak perlu SDK, tidak perlu build step — aplikasi mengakses RTDB lewat REST API.

---

## Langkah 1 — Aktifkan Realtime Database

1. Buka <https://console.firebase.google.com/project/booking-room-ugm>
2. Menu kiri → **Build → Realtime Database**
3. Klik **Create Database**
4. Lokasi: **asia-southeast1 (Singapore)** — sudah cocok, jangan diubah
5. Pilih **Start in test mode** (rules terbuka selama 30 hari; akan kita perpanjang di Langkah 2)
6. Klik **Enable**

> Pastikan URL yang muncul sama persis dengan yang ada di `firebase-config.js`. Jika berbeda (misal region lain), ganti nilai `databaseURL` di file tersebut.

---

## Langkah 2 — Atur Rules (Baca/Tulis Terbuka)

1. Di Realtime Database, klik tab **Rules**
2. Hapus isi default, tempel rules berikut:

```json
{
  "rules": {
    "facilities":   { ".read": true, ".write": true },
    "availability": { ".read": true, ".write": true },
    "bookings":     { ".read": true, ".write": true },
    "users":        { ".read": true, ".write": true },
    "admins":       { ".read": true, ".write": true }
  }
}
```

3. Klik **Publish**

> Node `users` (identitas peminjam — auto-isi formulir lintas perangkat) dan `admins`
> (daftar email admin) wajib masuk rules. Bila belum, aplikasi **tetap berjalan** —
> identitas & daftar admin otomatis memakai penyimpanan lokal peramban.
>
> Rules terbuka diperlukan karena aplikasi **tanpa login** (sesuai prototipe/tugas).
> Untuk produksi, gunakan Firebase Authentication dan batasi akses per-node — lihat catatan keamanan di `README.md`.

---

## Langkah 3 — Isi Data Awal (Seed)

Pilih **salah satu** cara berikut:

### Opsi A — Import lewat Firebase Console (paling cepat)

1. Di Realtime Database, klik ikon ⋮ (kanan atas) → **Import JSON**
2. Pilih file **`firebase-seed.json`** dari folder proyek ini
3. Klik **Import**
4. Pastikan struktur terlihat:
   ```
   booking-room-ugm-default-rtdb
   ├── facilities/   (10 entri FAC-001 s/d FAC-010)
   └── availability/
       ├── policy/   (bookingDaysAhead:14, maxDurationHours:2)
       ├── recurring/ (15 jadwal terisi mingguan)
       └── exceptions/ (4 tanggal istimewa)
   ```

### Opsi B — Tombol Seed dari Admin Panel

1. Buka `admin.html` di browser (lewat HTTP server, lihat `README.md` cara menjalankan lokal)
2. **Masuk dengan EMAIL + KATA SANDI admin** — pastikan email Anda terdaftar pada `adminEmails` di `assets/js/firebase-config.js` (atau node `/admins`, lihat README → *Admin Panel*). Belum punya akun? Klik **Daftar** pada gate admin lalu daftarkan email Anda.
3. Buka tab **Fasilitas**
4. Pada panel Firebase, klik **Unggah data awal (Seed)**
5. Tunggu sampai status berubah **Terhubung & aktif** dan tabel terisi 10 fasilitas

---

## Verifikasi

Setelah 3 langkah di atas selesai:

1. Buka `index.html` (atau lewat HTTP server `python3 -m http.server 8000`)
2. Pastikan daftar fasilitas tampil dari database (bukan error di console)
3. Coba ajukan peminjaman, lalu buka `admin.html` → tab Pengajuan → pengajuan Anda muncul dari semua perangkat
4. Cek Realtime Database → tab **Data** → node `bookings/` akan menampilkan pengajuan baru dengan push key

---

## Deploy ke GitHub Pages

Setelah Firebase aktif dan terisi, push proyek ke GitHub:

```bash
git init
git add .
git commit -m "Campus Facility Booking + Firebase"
git branch -M main
git remote add origin https://github.com/<username>/campus-facility-booking.git
git push -u origin main
```

Lalu **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)`**.
URL: `https://<username>.github.io/campus-facility-booking/`

Aplikasi dari GitHub Pages akan langsung tersambung ke Firebase (HTTPS → tidak ada masalah CORS seperti `file://`).

---

## Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| Badge tetap kuning "Mode Lokal" | Rules masih default / belum dipublish | Ulangi Langkah 2 |
| Toast "Firebase masih kosong" | Database aktif tapi belum di-seed | Lakukan Langkah 3 |
| Toast "akses ditolak Firebase" | Rules menolak write (`.write: false`) | Pastikan rules persis seperti Langkah 2 |
| Toast "Tidak dapat terhubung ke Firebase" | Internet mati / databaseURL salah | Cek koneksi; bandingkan URL di console vs `firebase-config.js` |
| Admin tab Fasilitas: panel abu-abu | Belum coba konek / tidak ada `databaseURL` | Pastikan `firebase-config.js` terisi URL |

---

## Catatan Keamanan

- **apiKey Firebase tidak dibutuhkan** pada mode REST ini — aplikasi mengakses langsung RTDB via `fetch()` (isi `apiKey`/`authDomain` hanya bila ingin mengaktifkan login).
- Rules terbuka (`".read": true, ".write": true`) berarti siapa saja dengan URL database dapat membaca & menulis. Cocok untuk prototipe/tugas; untuk produksi, terapkan Firebase Authentication.
- Login admin memakai **EMAIL + KATA SANDI (RBAC)** — daftar admin pada `adminEmails` (firebase-config.js) atau node `/admins`; akun admin bisa didaftarkan lewat tombol **Daftar** di gate. Ini gate sisi klien, **bukan** mekanisme keamanan sebenarnya; untuk produksi, pindahkan verifikasi admin ke server (Cloud Functions + Auth) dan rapatkan Rules.

---

## Bonus: Mengaktifkan Login Google / Email (opsional)

Login bersifat opsional — situs tetap berfungsi tanpa login. Untuk mengaktifkannya:

1. **Firebase Console → Authentication → Get started** → tab **Sign-in method**
   → aktifkan **Google** dan/atau **Email/Password**.
2. **Authentication → Settings → Authorized domains** → tambahkan
   `<username>.github.io` (dan `localhost` untuk pengujian).
3. **Project settings → General → Your apps → SDK setup** → salin dua nilai
   `apiKey` dan `authDomain`, lalu isi pada `assets/js/firebase-config.js`:
   ```js
   apiKey:     'AIzaSy…',
   authDomain: 'booking-room-ugm.firebaseapp.com',
   ```
4. Muat ulang situs → tombol **Masuk** aktif di header.

Setelah login: pengguna diarahkan mengisi **Data Identitas** (sekali isi — otomatis mengisi
formulir peminjaman berikutnya, tetap dapat diubah), riwayat "Peminjaman Saya" mengikuti
akun di semua perangkat, dan `idToken` otomatis dilampirkan ke permintaan database
(mendukung Rules dengan `auth != null`).
Panduan lengkap: README → **Firebase Auth** & **Identitas Peminjam**.

> **Admin:** gunakan tombol **Daftar/Masuk** email + kata sandi pada `admin.html` —
> tanpa Google. Pastikan Email/Password aktif pada Sign-in method.
