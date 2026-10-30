# Gamaspace

Sistem peminjaman fasilitas kampus — situs statis (HTML, CSS, JavaScript murni) yang dapat dihosting di **GitHub Pages** atau hosting statis apa pun, dengan data tersimpan di database online sehingga pengajuan peminjaman **tersinkron antar pengguna**.

Bila Firebase tidak tersedia (belum diatur Rules, offline, atau URL dikosongkan), aplikasi otomatis berjalan pada **mode lokal**: data awal dari `data/*.json` + LocalStorage browser.

**Fitur utama:** multi-bahasa **ID/EN**, transisi antar halaman halus (View Transitions API), **denah ruangan SVG** yang dapat dikustomisasi admin (proyektor, layar, sound, bangku, dll. — drag & drop), **kartu bukti peminjaman + QR code** (unduh PNG), **login** (Google / email — opsional) yang membuat riwayat mengikuti akun lintas perangkat, serta **identitas peminjam sekali isi** yang otomatis mengisi formulir peminjaman (tetap dapat diubah). Gerbang login muncul saat tombol **Ajukan Peminjaman** ditekan pada halaman ruangan.

## Arsitektur Data

```
GitHub Pages (statis)  ──fetch REST──▶  Firebase Realtime Database
                                          ├── facilities    (CRUD admin + denah ruangan, dibaca semua pengguna)
                                          ├── availability  (policy + jadwal mingguan + pengecualian)
                                          ├── bookings      (pengajuan semua pengguna + status + uid)
                                          └── users         (profil dasar akun yang login — opsional)

Fallback (otomatis bila Firebase tidak aktif):
data/*.json (seed) + LocalStorage (cfb_bookings, cfb_facility_overrides)
```

Akses ke Firebase memakai **REST API Realtime Database** (`GET/PUT/PATCH/POST/DELETE <databaseURL>/<path>.json`) — cukup `databaseURL` pada `assets/js/firebase-config.js`, **tanpa apiKey & tanpa SDK**. Mode aktif terlihat pada badge di footer (hijau = Firebase, kuning = mode lokal) dan panel Firebase di Admin Panel.

## Struktur Proyek

```
campus-facility-booking/
├── index.html                 # Halaman pengguna (SPA: Explore → Summary + Peminjaman Saya)
├── admin.html                 # Admin panel terpisah (gate, analitik, CRUD, persetujuan, editor denah, panel Firebase)
├── ketentuan.html             # Halaman Ketentuan Peminjaman (dua bahasa)
├── firebase-seed.json         # Data awal untuk import ke Realtime Database (opsional)
├── README.md
├── SETUP-FIREBASE.md          # Panduan cepat 3 langkah
├── data/                      # ===== DATA AWAL (seed / fallback) =====
│   ├── facilities.json        # 10 fasilitas + kategori + jam operasional + denah (layout)
│   └── availability.json      # Policy peminjaman + jadwal terisi mingguan + pengecualian
└── assets/
    ├── css/
    │   ├── base.css           # Design token, tombol, form, toast, modal, auth UI, lang toggle, denah (shared)
    │   ├── app.css            # Halaman pengguna + ketentuan + kartu bukti
    │   └── admin.css          # Admin panel (sidebar, KPI, chart, tabel, editor denah)
    ├── js/
    │   ├── i18n.js            # Kamus ID/EN + penerjemah atribut HTML + toggle
    │   ├── core.js            # Util, notifikasi card, modal konfirmasi, validator UGM
    │   ├── firebase-config.js # KONFIGURASI FIREBASE (databaseURL + apiKey/authDomain opsional)
    │   ├── auth.js            # Firebase Auth: Google + email/kata sandi (SDK dimuat dinamis)
    │   ├── data.js            # Data layer: Firebase RTDB (REST, + token auth) + fallback lokal + slot engine
    │   ├── floorplan.js       # Renderer denah ruangan SVG (ikon perangkat + bangku)
    │   ├── proof.js           # Kartu bukti peminjaman (canvas → PNG + QR)
    │   ├── app.js             # Logic SPA sisi pengguna
    │   ├── admin.js           # Logic admin panel + editor denah
    │   └── vendor/
    │       └── qrcode.min.js  # qrcode-generator (MIT, Kazuhiko Arase) — lokal, tanpa CDN
    └── images/
        ├── logo.png             # logo Gamaspace (navbar, gate & sidebar admin)
        ├── favicon.png          # 512×512
        ├── favicon-32.png / favicon-16.png
        ├── favicon.ico          # 16/32/48 (fallback lama)
        └── apple-touch-icon.png # 180×180 (iOS)
```

## Database (data/*.json)

### `data/facilities.json`
```json
{
  "id": "FAC-001",
  "name": "Ruang Multimedia",
  "category": "Ruang Kelas",
  "location": "Gedung Utama Lt. 2",
  "capacity": 40,
  "facilities": ["Projector", "AC", "Wi-Fi"],
  "status": "Available",
  "description": "…",
  "openHours": { "start": "08:00", "end": "16:00" },
  "layout": {
    "w": 10, "h": 7,          // ukuran ruangan (satuan grid ≈ meter)
    "seats": 40,               // jumlah bangku
    "items": [
      { "type": "whiteboard", "x": 3.5, "y": 0.5, "rot": 0 },
      { "type": "projector",  "x": 5,   "y": 3.5, "rot": 0 },
      { "type": "door",       "x": 8.5, "y": 6,   "rot": 0 }
    ]
  }
}
```
- `category`: `Ruang Kelas` | `Laboratorium` | `Aula` | `Olahraga` | `Studio` — dipakai filter & saran ruang.
- `status`: `Available` / `Limited` (ditinjau ketat) / `Unavailable` (tidak dapat diajukan).
- `layout` (denah): tipe item yang tersedia — `screen` (layar), `projector`, `sound`, `whiteboard`, `podium`, `table`, `door`. Karena data di server mungkin belum memiliki `layout`, aplikasi memakai **denah default dari `data/facilities.json` sebagai fallback tampilan**; admin dapat mengubahnya lewat editor denah (tersimpan ke server).

### `data/availability.json`
Ketersediaan berbasis **pola mingguan** sehingga tidak kedaluwarsa:

```json
{
  "policy": {
    "bookingDaysAhead": 14,      // jadwal hanya 14 hari ke depan
    "minDurationHours": 1,       // durasi minimum
    "maxDurationHours": 2        // BATAS MAKSIMAL 2 JAM per peminjaman
  },
  "recurring": [
    { "facilityId": "FAC-001", "weekday": 1, "hours": [12, 13], "note": "Jadwal kuliah tetap" }
  ],
  "exceptions": [
    { "facilityId": "*",      "date": "2026-12-25", "hours": "all", "note": "Libur Nasional" },
    { "facilityId": "FAC-002", "date": "2026-11-05", "hours": [8, 9, 10, 11], "note": "Dies Natalis" }
  ]
}
```
- `weekday`: 0 = Minggu … 6 = Sabtu. `hours`: daftar **jam mulai** yang sudah terisi.
- `exceptions` dengan `hours: "all"` menutup fasilitas seharian penuh (tombol tanggal dinonaktifkan).
- Slot per jam dibangkitkan otomatis dari `openHours` tiap fasilitas; jam terisi (seed / pengajuan Pending-Approved) otomatis dinonaktifkan.

### Lapisan penyimpanan

**Mode Firebase** (aktif bila `facilities` terisi di Realtime Database):
```
Firebase RTDB
├── facilities/{FAC-001: {...}}     ← CRUD admin langsung menulis ke sini
├── availability/{policy, recurring, exceptions}
└── bookings/{pushKey: {...}}       ← pengajuan semua pengguna + status + alasan
```
- "Peminjaman Saya" menampilkan pengajuan milik pengguna: **terikat uid akun bila login Firebase** (lintas perangkat), atau penanda `clientId` peramban bila tamu. Admin melihat seluruh pengajuan dari semua pengguna; slot terisi diperhitungkan lintas perangkat.
- Pengajuan yang dibuat saat login menyimpan `uid` + `accountEmail` (terlihat admin pada detail pengajuan sebagai baris **Akun**).

**Mode lokal** (fallback otomatis):
```
data/*.json  (seed, read-only)                    ← sumber data awal
cfb_facility_overrides  (LocalStorage, admin)     ← created / updated / deleted
cfb_bookings            (LocalStorage, pengguna)  ← pengajuan + status + alasan penolakan
```
Tombol **Reset ke data awal** di tab Fasilitas: mode Firebase = menimpa node `facilities` di server dengan isi `data/facilities.json`; mode lokal = menghapus lapisan overrides. Pengajuan lama (format slot 2 jam) otomatis dimigrasi ke format jam-per-jam.

## Setup Firebase (sekali saja)

1. **Atur Rules** — Firebase Console → Realtime Database → tab **Rules** → tempel berikut → **Publish**:
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
   > Node `users` menyimpan identitas peminjam (auto-isi formulir, lintas perangkat) dan node `admins` menyimpan daftar email admin. Bila Rules untuk kedua node ini belum dipublish, aplikasi **tetap berjalan** — identitas & daftar admin otomatis jatuh ke penyimpanan lokal peramban.
2. **Isi data awal** — lewat Console Firebase: menu ⋮ (kanan atas) → **Import JSON** → pilih file `firebase-seed.json` dari folder proyek.
3. **Konfigurasi** — `assets/js/firebase-config.js` sudah berisi URL database ini:
   `https://booking-room-ugm-default-rtdb.asia-southeast1.firebasedatabase.app` (project *booking-room-ugm*). Ganti bila memakai database lain.
4. Muat ulang situs — data fasilitas & pengajuan kini tersaji dari database.

> Catatan: rules terbuka (`.read/.write: true`) diperlukan karena aplikasi tanpa login — cocok untuk prototipe/tugas. Untuk produksi, gunakan Firebase Authentication dan batasi akses per-node. apiKey pada Firebase memang bukan rahasia dan tidak diperlukan pada mode REST ini.

## Firebase Auth — Login Google / Email (opsional)

Login bersifat **opsional** — tanpa konfigurasi pun seluruh situs tetap berfungsi (tombol *Masuk* memberi tahu bahwa login belum diaktifkan).

1. **Isi konfigurasi** — `assets/js/firebase-config.js`:
   ```js
   apiKey: 'AIzaSy…',                              // Project settings → Your apps
   authDomain: 'booking-room-ugm.firebaseapp.com',
   ```
2. **Aktifkan metode login** — Firebase Console → **Authentication → Get started → Sign-in method** → aktifkan **Google** dan/atau **Email/Password**.
3. **Izinkan domain situs** — Authentication → **Settings → Authorized domains** → tambahkan `<username>.github.io` (dan `localhost` untuk pengujian).
4. Muat ulang situs → tombol **Masuk** muncul di header. Setelah login:
   - pengguna diarahkan ke halaman **Data Identitas** (bila belum pernah mengisi) — lihat bagian berikut,
   - riwayat **Peminjaman Saya** mengikuti akun (terbuka juga di perangkat lain),
   - profil dasar tersimpan di node `users/{uid}` (nama, email, login terakhir).

>Catatan teknis: aplikasi tetap memakai REST untuk RTDB; SDK Auth hanya dimuat **dinamis dari CDN saat apiKey tersedia**, dan `idToken` otomatis dilampirkan ke setiap permintaan tulis (`?auth=<token>`) sehingga Rules yang membatasi `auth != null` tetap didukung.

## Identitas Peminjam — Auto-isi Formulir (per email akun)

Setelah login, pengguna mengisi identitas **sekali saja** pada halaman *Data Identitas* (menu avatar → *Data Identitas*, atau otomatis dibuka setelah login):

- **Field**: Nama Lengkap, NIM, Email UGM, No. WhatsApp, Program Studi — tervalidasi dengan aturan yang sama seperti formulir pengajuan (NIM UGM, `@mail.ugm.ac.id`, nomor WA Indonesia).
- **Penyimpanan per email akun**: LocalStorage (`cfb_ident_<email>`) selalu ditulis; bila mode Firebase aktif dan node `users` dibuka Rules, identitas juga disimpan ke `users/{uid}/identitas` sehingga **tersinkron lintas perangkat**.
- **Auto-isi saat pemesanan**: setiap kali formulir pengajuan dibuka (atau setelah login di gerbang transaksi), kelima field terisi otomatis dari identitas — **hanya kolom yang masih kosong, dan tetap bisa diubah** per pengajuan.
- **Gerbang transaksi final**: bila pengguna baru login saat *Kirim Pengajuan* dan identitasnya belum ada, muncul modal *Lengkapi identitas Anda* (bisa dilewati dengan *Nanti saja*) — isian formulir tidak hilang.
- **Avatar tanpa foto** — bila foto profil (mis. Google) gagal dimuat, avatar otomatis diganti **inisial nama** sehingga tidak ada ikon gambar rusak.

### Menguji login tanpa server Firebase
Set `mockAuth: true` pada `firebase-config.js` — login memakai akun palsu di peramban (khusus pengujian lokal; **jangan aktifkan di produksi**).

## Fitur Sisi Pengguna (index.html)

Alur: **Explore → Select → Schedule → Request → Summary**

- **Transisi antar halaman halus** — perpindahan SPA memakai **View Transitions API** (cross-fade + geser ±0,2 dtk) dengan fallback animasi CSS; otomatis dimatikan untuk `prefers-reduced-motion`.
- **Multi-bahasa ID/EN** — toggle **ID/EN** di header (juga di halaman ketentuan). Bahasa tersimpan di LocalStorage, default mengikuti bahasa peramban. Seluruh teks statis & dinamis (termasuk pesan validasi, toast, nama hari/bulan) diterjemahkan.
- **Explore** — 10 fasilitas; cari (nama/kategori/lokasi/perangkat); filter kategori, status, kapasitas; urutkan.
- **Detail** — deskripsi, perangkat, **denah ruangan (floor plan) interaktif**, jam operasional, durasi maksimal.
- **Denah ruangan (SVG)** — visual bersih: grid ruangan, ikon **layar, proyektor, sound system, papan tulis, podium, meja, pintu**, deretan bangku menghadap area depan, serta legenda + badge jumlah bangku.
- **Schedule (custom jam + maks 2 jam)** — pilih tanggal (14 hari) → **jam mulai per jam** → **durasi 1 / 2 jam** (opsi 2 jam otomatis nonaktif bila jam berikutnya terisi / melewati jam tutup); jam terisi & jam yang sudah lewat hari ini dinonaktifkan. **Jam yang termasuk rentang durasi terpilih ikut terkunci** (contoh: pilih 10:00 + durasi 2 jam → 11:00 ikut terkunci, bergaya garis putus-putus).
- **Request** dengan validasi ketat:
  - **NIM UGM** — regex `^\d{2}/\d{6}/[A-Z]{2,3}/\d{5}$` (contoh `21/456789/PA/20123`), auto-format sambil mengetik.
  - **Email** — wajib berakhiran `@mail.ugm.ac.id`.
  - **No. HP** — template prefix **+62**, auto-format `812-3456-7890`, validasi nomor Indonesia.
  - **Jumlah peserta** — maksimal kapasitas ruang; bila peserta ≤ 40% kapasitas muncul **kartu saran ruang lain yang lebih sesuai** — muncul dengan **jeda ±1,2 detik setelah input selesai**, tampilan flat (baris dengan pemisah tipis, tanpa kotak bersarang), tombol *Lihat ruang* membuka detail fasilitas **di tab yang sama** (navigasi SPA).
  - **Ketentuan peminjaman** — ringkasan + tautan ke `ketentuan.html` + checkbox persetujuan.
- **Notifikasi card** — toast sukses/gagal (ikon, judul, pesan, progress bar, tombol tutup), getar halus + scroll ke isian salah, dan kartu sukses besar di halaman Summary.
- **Tombol kirim dengan loading** — saat pengajuan dikirim, tombol menampilkan **spinner + "Mengirim pengajuan…"** (terkunci ±1,2 detik agar proses terasa konsisten sekaligus menutup latensi jaringan ke Firebase), lalu otomatis pindah ke halaman Summary.
- **Kartu bukti peminjaman + QR** — tombol **Unduh bukti pengajuan** di halaman Summary dan tombol **Unduh bukti** pada setiap item riwayat membuka pratinjau kartu profesional (nomor referensi besar, badge status, ringkasan data) dengan **QR code verifikasi** — dapat diunduh sebagai **PNG resolusi 2×** (`bukti-GMS-…​.png`) untuk ditunjukkan kepada petugas saat check-in. Nomor referensi pengajuan baru berformat **GMS-YYYYMMDD-XXXX**.
- **Login Firebase Auth** — tombol **Masuk** (Google / email-kata sandi, daftar akun baru) di header; setelah login pengguna diarahkan mengisi **Data Identitas** (bila belum ada) dan riwayat mengikuti akun. Lihat bagian *Firebase Auth* & *Identitas Peminjam*.
- **Gerbang login di halaman ruangan** — pengguna tamu bebas menjelajah dan melihat jadwal; saat menekan **Ajukan Peminjaman** pada halaman ruangan, muncul gerbang *Login diperlukan* (Google/email). Setelah masuk (lalu melengkapi identitas bila belum ada), pengguna langsung dibawa ke halaman jadwal; pengajuan terikat `uid` (riwayat lintas perangkat). Bila login belum dikonfigurasi, tersedia pilihan *Lanjut tanpa akun* agar mode lokal tetap berfungsi (gerbang di tombol kirim tidak mengganggu lagi pada sesi tersebut).
- **Navbar ramping** — tautan *Admin* dan *Ketentuan* dihapus dari navbar (Ketentuan tetap tersedia di footer); halaman admin diakses langsung lewat URL `admin.html` dan diamankan login RBAC.
- **Anti double-booking** — cek ulang ketersediaan rentang jam saat submit.
- **Peminjaman Saya** — riwayat yang dapat **diklik untuk membuka detail singkat** (referensi, tanggal, waktu, lokasi, peserta, organisasi) + **keterangan status dalam kalimat lengkap**: ditinjau petugas (kuning) / disetujui (hijau) / ditolak beserta alasannya (merah). Status terkini + alasan penolakan (jika ada).

## Admin Panel (admin.html)

**Login admin memakai EMAIL + KATA SANDI (Firebase Auth — tanpa Google, tanpa kode akses).** Akun admin dapat didaftarkan langsung pada gate (`Daftar`) atau dari halaman login sisi pengguna. Akses diberikan bila email terdaftar pada salah satu sumber berikut (dicek berurutan):

1. `adminEmails` di `assets/js/firebase-config.js` — cara tercepat; isi dengan email akun admin Anda.
2. Node `/admins` di Realtime Database (format: `"/admins/<key>": "email@contoh.com"`) — memungkinkan menambah admin lain tanpa deploy ulang; tambahkan `"admins": { ".read": true, ".write": true }` pada Rules.

Bila kedua sumber masih kosong, **login pertama** pada `admin.html` otomatis mendaftarkan dirinya ke `/admins` (*first-claim*) — bila Rules belum mengizinkan node `/admins`, akses ditolak dan petunjuk pemberian akses ditampilkan. Nonaktifkan dengan `allowFirstAdminClaim: false`. Tombol **Keluar** mengakhiri sesi admin.

| Menu | Fitur |
|---|---|
| **Dashboard** | KPI animasi count-up (total/menunggu/disetujui/ditolak/fasilitas aktif), donut status (conic-gradient), bar pengajuan per fasilitas, bar per tanggal (14 hari), pengajuan terbaru, tombol *Muat data contoh*, **Ekspor CSV & PDF** |
| **Ekspor laporan** | **Ekspor CSV** (Excel: pemisah `;` + BOM, 21 kolom termasuk alasan penolakan & akun) dan **Ekspor PDF** (jsPDF + autotable dari CDN: header, KPI, tabel seluruh pengajuan berwarna per status — **lebar semua kolom eksplisit** sehingga kolom Peminjam/NIM/Email tidak pernah terjepit, nilai ringkas (tanggal & jam pendek), token panjang (email/NIM) dipotong otomatis pada pembatas alami; ringkasan per fasilitas, nomor halaman; bila CDN tak terjangkau otomatis jatuh ke dialog cetak *Simpan sebagai PDF*) |
| **Pengajuan** | Filter status + **pencarian** (nama/NIM/ref/fasilitas — kolom bergaya dengan ikon di dalam input). Setiap baris langsung menampilkan **informasi peminjaman** (fasilitas, jadwal, durasi, peserta, **nama·NIM·organisasi peminjam**, referensi) tanpa perlu diklik; tombol mata membuka **rincian lengkap** (modal, termasuk **akun** pengaju bila login), **Setujui** (modal konfirmasi), **Tolak** (modal + alasan yang terlihat peminjam), hapus semua |
| **Fasilitas** | **CRUD lengkap** lewat modal: tambah/ubah (nama, kategori, lokasi, kapasitas, jam, status, perangkat, deskripsi), hapus (peringatan bila ada pengajuan terkait), **Kembalikan data awal** |
| **Editor denah** (ikon grid pada tiap baris fasilitas) | **Kustomisasi denah ruangan**: palet tambah item (layar, panggung, proyektor, sound, papan tulis, podium, meja, pintu), **drag & drop** dengan snap 0,5 m, pilih & hapus item (tombol/Del), atur **jumlah bangku** dan **ukuran ruangan**, kosongkan, simpan (tersimpan sebagai `layout` pada fasilitas — langsung tampil di sisi pengguna). Ikon digambar dengan **jejak kaki skala 1 m** (layar 2,6 m; panggung 5 m; podium 0,7 m; pintu 1 m dengan lengkung ayunan; papan tulis 2 m) |

Mode Firebase: semua perubahan langsung ditulis ke Realtime Database dan terlihat oleh seluruh pengguna setelah halaman dimuat ulang. Mode lokal: perubahan tersimpan di LocalStorage peramban.

## Branding — Logo & Favicon

Logo dan favicon Gamaspace **sudah terpasang** di `assets/images/` (bersumber dari emblem "G" biru dengan buku terbuka, latar telah dibuat transparan):

| Berkas | Dipakai di | Keterangan |
|---|---|---|
| `logo.png` (221×240) | Navbar (index, ketentuan), gate & sidebar admin | Ditampilkan setinggi 28 px |
| `favicon.png` (512×512) | Tab browser (modern) | Emblem terpusat, latar transparan |
| `favicon-32.png` / `favicon-16.png` | Tab browser | Ukuran kecil |
| `favicon.ico` (16/32/48) | Fallback browser lama | |
| `apple-touch-icon.png` (180×180) | Ikon saat disimpan ke layar utama iOS | Latar putih |

Untuk mengganti logo di kemudian hari: timpa `logo.png` (rasio bebas, disarankan tinggi ≥ 240 px) dan `favicon.png`/`favicon-32.png`/`favicon-16.png` (persegi) — tanpa perlu mengubah kode.

## Menjalankan Lokal

Aplikasi memuat data via `fetch()`, sehingga wajib diakses lewat HTTP server:

```bash
cd campus-facility-booking
python3 -m http.server 8000
# Pengguna: http://localhost:8000/
# Admin:    http://localhost:8000/admin.html
```

## Deploy ke GitHub Pages

```bash
git init
git add .
git commit -m "Gamaspace"
git branch -M main
git remote add origin https://github.com/<username>/campus-facility-booking.git
git push -u origin main
```

Lalu: **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
URL: `https://<username>.github.io/campus-facility-booking/` — halaman ketentuan juga dapat diakses via `/ketentuan`.

## Reset Data (DevTools Console)

```js
localStorage.removeItem('cfb_bookings');             // hapus pengajuan mode lokal
localStorage.removeItem('cfb_facility_overrides');   // reset CRUD admin mode lokal
localStorage.removeItem('cfb_client_id');            // reset identitas "Peminjaman Saya"
location.reload();
```
Untuk data di Firebase: gunakan Admin Panel (hapus semua pengajuan / reset fasilitas), atau hapus node langsung di Firebase Console.

## Catatan

- Aplikasi statis murni — tidak butuh build step; GitHub Pages + Firebase keduanya gratis (tier Spark).
- `data/*.json` tetap dibawa sebagai **sumber seed** dan **fallback** saat Firebase tidak aktif (diuji: rules terkunci → mode lokal + peringatan, offline → mode lokal).
- "Peminjaman Saya" mengikuti akun Firebase bila login (uid), atau penanda `clientId` di LocalStorage untuk tamu (peramban) — pengguna lain tidak melihat riwayat Anda, namun slot yang Anda ajukan tetap terblokir untuk semua orang.
- Bahasa admin panel adalah Indonesia (alat internal); halaman publik mendukung ID/EN penuh.
- Penulisan bersamaan pada slot yang sama memiliki celah kecil (cek ketersediaan bersifat client-side); untuk prototipe ini dapat diterima.
- `availability` berbasis pola mingguan sehingga tetap relevan seiring waktu; tambahkan `exceptions` untuk tanggal istimewa.
- Fasilitas yang dihapus admin tetap tampil pada riwayat pengajuan lama (pengajuan menyimpan snapshot).
- Prototipe: daftar admin (`adminEmails` / `/admins`) dan Rules terbuka bersifat sisi-klien — cukup untuk prototipe/tugas; untuk produksi, verifikasi admin di server (Cloud Functions + App Check) dan rapatkan Rules.

## Lisensi

Bebas digunakan untuk tujuan edukasi.
