# Campus Facility Booking

Sistem peminjaman fasilitas kampus — dibangun dengan HTML, CSS, dan JavaScript murni (vanilla), sehingga dapat langsung dihosting di **GitHub Pages** tanpa backend.

Database berupa **file JSON** (`data/`), sedangkan perubahan (CRUD admin) dan pengajuan peminjaman disimpan di **LocalStorage browser** — menjadikannya aplikasi statis yang berjalan penuh di sisi klien.

## Struktur Proyek

```
campus-facility-booking/
├── index.html                 # Halaman pengguna (SPA: Explore → Summary + Peminjaman Saya)
├── admin.html                 # Admin panel terpisah (gate, analitik, CRUD, persetujuan)
├── ketentuan.html             # Halaman Ketentuan Peminjaman (tersedia juga di /ketentuan)
├── README.md
├── data/                      # ===== DATABASE (JSON) =====
│   ├── facilities.json        # 10 fasilitas + kategori + jam operasional
│   └── availability.json      # Policy peminjaman + jadwal terisi mingguan + pengecualian
└── assets/
    ├── css/
    │   ├── base.css           # Design token, tombol, form, toast card, modal, animasi
    │   ├── app.css            # Halaman pengguna + ketentuan
    │   └── admin.css          # Admin panel (sidebar, KPI, chart, tabel)
    ├── js/
    │   ├── core.js            # Util, notifikasi card, modal konfirmasi, validator UGM
    │   ├── data.js            # Data layer: fetch JSON + LocalStorage + slot engine per jam
    │   ├── app.js             # Logic SPA sisi pengguna
    │   └── admin.js           # Logic admin panel
    └── images/
        └── favicon.svg
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
  "openHours": { "start": "08:00", "end": "16:00" }
}
```
- `category`: `Ruang Kelas` | `Laboratorium` | `Aula` | `Olahraga` | `Studio` — dipakai filter & saran ruang.
- `status`: `Available` / `Limited` (ditinjau ketat) / `Unavailable` (tidak dapat diajukan).

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
```
data/*.json  (seed, read-only)                    ← sumber data awal
        │
        ▼
cfb_facility_overrides  (LocalStorage, admin)     ← created / updated / deleted
cfb_bookings            (LocalStorage, pengguna)  ← pengajuan + status + alasan penolakan
```
Tombol **Reset ke data awal** di tab Fasilitas menghapus lapisan overrides. Pengajuan lama (format slot 2 jam) otomatis dimigrasi ke format jam-per-jam.

## Fitur Sisi Pengguna (index.html)

Alur: **Explore → Select → Schedule → Request → Summary**

- **Explore** — 10 fasilitas; cari (nama/kategori/lokasi/perangkat); filter kategori, status, kapasitas; urutkan.
- **Detail** — deskripsi, perangkat, jam operasional, durasi maksimal.
- **Schedule (custom jam + maks 2 jam)** — pilih tanggal (14 hari) → **jam mulai per jam** → **durasi 1 / 2 jam** (opsi 2 jam otomatis nonaktif bila jam berikutnya terisi / melewati jam tutup); jam terisi & jam yang sudah lewat hari ini dinonaktifkan.
- **Request** dengan validasi ketat:
  - **NIM UGM** — regex `^\d{2}/\d{6}/[A-Z]{2,3}/\d{5}$` (contoh `21/456789/PA/20123`), auto-format sambil mengetik.
  - **Email** — wajib berakhiran `@mail.ugm.ac.id`.
  - **No. HP** — template prefix **+62**, auto-format `812-3456-7890`, validasi nomor Indonesia.
  - **Jumlah peserta** — maksimal kapasitas ruang; bila peserta ≤ 40% kapasitas muncul **kartu saran ruang lain yang lebih sesuai** (diurutkan: kategori sama dulu, lalu kapasitas terkecil).
  - **Ketentuan peminjaman** — ringkasan + tautan ke `ketentuan.html` + checkbox persetujuan.
- **Notifikasi card** — toast sukses/gagal (ikon, judul, pesan, progress bar, tombol tutup), getar halus + scroll ke isian salah, dan kartu sukses besar di halaman Summary.
- **Anti double-booking** — cek ulang ketersediaan rentang jam saat submit.
- **Peminjaman Saya** — riwayat + status terkini + alasan penolakan (jika ada).

## Admin Panel (admin.html)

Kode akses default: **`admin123`** (konstanta `ADMIN_CODE` di `assets/js/admin.js`; sesi tersimpan di sessionStorage).

| Menu | Fitur |
|---|---|
| **Dashboard** | KPI animasi count-up (total/menunggu/disetujui/ditolak/fasilitas aktif), donut status (conic-gradient), bar pengajuan per fasilitas, bar per tanggal (14 hari), pengajuan terbaru, tombol *Muat data contoh* |
| **Pengajuan** | Filter status + pencarian (nama/NIM/ref/fasilitas), detail lengkap (modal), **Setujui** (modal konfirmasi), **Tolak** (modal + alasan yang terlihat peminjam), hapus semua |
| **Fasilitas** | **CRUD lengkap** lewat modal: tambah/ubah (nama, kategori, lokasi, kapasitas, jam, status, perangkat, deskripsi), hapus (peringatan bila ada pengajuan terkait), reset ke JSON |

Perubahan admin tersimpan di LocalStorage dan langsung terlihat di sisi pengguna setelah halaman dimuat ulang.

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
git commit -m "Campus Facility Booking"
git branch -M main
git remote add origin https://github.com/<username>/campus-facility-booking.git
git push -u origin main
```

Lalu: **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
URL: `https://<username>.github.io/campus-facility-booking/` — halaman ketentuan juga dapat diakses via `/ketentuan`.

## Reset Data (DevTools Console)

```js
localStorage.removeItem('cfb_bookings');             // hapus semua pengajuan
localStorage.removeItem('cfb_facility_overrides');   // reset CRUD admin ke JSON awal
location.reload();
```

## Catatan

- LocalStorage bersifat per-browser: data pengajuan **tidak dibagi** antar perangkat — sesuai target hosting statis.
- `availability.json` berbasis pola mingguan sehingga tetap relevan seiring waktu; tambahkan `exceptions` untuk tanggal istimewa.
- Fasilitas yang dihapus admin tetap tampil pada riwayat pengajuan lama (pengajuan menyimpan snapshot).
- Prototipe: kode akses admin bersifat demo (client-side), bukan mekanisme keamanan sesungguhnya.

## Lisensi

Bebas digunakan untuk tujuan edukasi.
