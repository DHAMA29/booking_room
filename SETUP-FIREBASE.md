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
    "facilities":     { ".read": true, ".write": true },
    "availability":   { ".read": true, ".write": true },
    "bookings":       { ".read": true, ".write": true },
    "users":          { ".read": true, ".write": true },
    "admins":         { ".read": true, ".write": true },
    "petugas":        { ".read": true, ".write": true },
    "keys":           { ".read": true, ".write": true }
  }
}
```

3. Klik **Publish**

> Node `users` (identitas peminjam — auto-isi formulir lintas perangkat), `admins`
> (daftar email admin), `petugas` (daftar Petugas Lapangan — alur QR Scanner) dan
> `keys` (kunci fasilitas — serah terima di Scanner) wajib masuk rules. Bila belum,
> aplikasi **tetap berjalan** — fitur terkait otomatis memakai penyimpanan lokal peramban.
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

---

## Menambah Admin Baru (langsung aktif)

Hanya **pengelola utama** (`rootAdminEmail` di `assets/js/firebase-config.js`, bawaan:
`dhamashidqiputra2007@mail.ugm.ac.id`) yang dapat menambahkan admin baru —
**langsung aktif tanpa proses persetujuan**.

1. **Tambahkan** — pengelola utama membuka `admin.html` → tab **Admin & Akun** →
   *Daftar Admin* → **+ Tambah Admin** → masukkan email → **Tambah Admin**.
   Email yang sudah terdaftar **ditolak otomatis** (tidak ada duplikat).
2. **Masuk** — admin baru membuka `admin.html`; bila belum punya kata sandi,
   gunakan tombol **Daftar** pada gate dengan email yang sama, lalu masuk.
3. **Admin lain** — tetap dapat melihat *Daftar Admin*, namun menekan tombol
   **Tambah Admin** menampilkan modal **Akses Ditolak** (hanya pengelola utama
   yang boleh menambah).
4. **Hapus akses** — pengelola utama dapat menghapus admin (tombol tempat sampah
   pada baris admin) kapan saja; admin dari `adminEmails` dikelola lewat file
   `firebase-config.js`.

> Catatan: pengajuan peminjaman yang masuk dapat dilihat di Realtime Database →
> tab **Data** → node `bookings/` (push key otomatis).

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

### Checklist setelah hosting (login & data)

Setelah situs online, jalankan urutan ini agar **login Google/email** dan **data pengajuan** berfungsi:

1. **Login masih mati / pesan "belum dikonfigurasi"?** → Isi `apiKey` + `authDomain` pada `assets/js/firebase-config.js` (lihat bagian **Bonus** di bawah).
2. **Login email gagal?** → Aktifkan **Email/Password** pada Authentication → Sign-in method.
3. **Login Google gagal / `auth/unauthorized-domain`?** → Tambahkan **domain hosting** Anda ke Authentication → Settings → **Authorized domains** (mis. `<username>.github.io`). Tanpa langkah ini tombol Google SELALU gagal — domain `localhost` saja tidak cukup.
4. **Dashboard/Pengajuan admin kosong?** → Lihat **banner status** di bagian atas Admin Panel:
   - banner kuning *"Unggah data awal"* → database aktif tapi belum di-seed → klik tombolnya (satu klik), atau import `firebase-seed.json` lewat Console (Langkah 3).
   - banner abu *"Mode lokal"* → Firebase tidak terjangkau/ditolak Rules → perbaiki Rules (Langkah 2) lalu muat ulang.
5. **Admin lain tidak bisa masuk?** → Pastikan menambahkan emailnya lewat tab **Admin & Akun** saat panel tersambung (banner abu = tidak tersambung; penambahan admin hanya tersimpan permanen saat database aktif).

---

## Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| Badge tetap kuning "Mode Lokal" | Rules masih default / belum dipublish | Ulangi Langkah 2 |
| Banner abu "Mode lokal — data tidak tersinkron" | Rules menolak akses / database tidak terjangkau | Pastikan rules persis Langkah 2; cek `databaseURL` |
| Banner kuning "Unggah data awal" | Database aktif tapi belum di-seed | Klik tombolnya, atau Lakukan Langkah 3 |
| Dashboard & daftar pengajuan kosong | Situs berjalan mode lokal (lihat banner) / memang belum ada pengajuan | Selesaikan banner status; coba ajukan satu peminjaman dari perangkat lain |
| Login Google: `auth/unauthorized-domain` | Domain hosting belum masuk Authorized domains | Authentication → Settings → Authorized domains → tambahkan domain |
| Login email: `auth/operation-not-allowed` / `auth/configuration-not-found` | Email/Password belum aktif / Authentication belum disiapkan | Authentication → Get started → aktifkan Email/Password |
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

> **Admin:** gate `admin.html` menyediakan **Masuk dengan Google** dan **email + kata sandi**.
> Email akun Google harus sama dengan email yang terdaftar sebagai admin/petugas.
> Pastikan **Google** dan **Email/Password** aktif pada Sign-in method, dan domain hosting
> sudah masuk **Authorized domains**.
