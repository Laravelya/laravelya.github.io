# Eranga

Aplikasi absensi digital SD Islam Iqra Petobo dengan login pengguna, pendaftaran wajah, verifikasi liveness, validasi lokasi, pengajuan izin/sakit, dan pencatatan terpusat melalui Google Apps Script.

## Struktur Proyek

- `index.html`: halaman utama aplikasi.
- `assets/css/style.css`: tampilan aplikasi.
- `assets/js/app.js`: logika frontend dan komunikasi dengan backend.
- `Code.gs`: backend Google Apps Script.
- `sw.js`: service worker untuk cache aplikasi.
- `CNAME`: domain publik GitHub Pages.

## Persyaratan

- Akun Google untuk Google Apps Script, Google Sheets, dan Google Drive.
- Browser modern dengan dukungan kamera, lokasi, dan JavaScript.
- Hosting statis, misalnya GitHub Pages.
- Koneksi internet pada perangkat pengguna.

> Validasi Wi-Fi resmi sekolah/BSSID sedang dinonaktifkan sementara. Pengguna dapat memakai Wi-Fi atau paket data selama perangkat terhubung ke internet.

## Instalasi Backend

### 1. Siapkan Spreadsheet

Buat atau gunakan Google Spreadsheet untuk data aplikasi. Siapkan sheet berikut:

- `Users`: data akun pengguna. Kolom yang digunakan oleh backend meliputi username, nama, NUPTK, jenis kelamin, jabatan, hash password, salt, dan `faceDescriptor`.
- `Log Absensi`: catatan absensi masuk, keluar, izin, sakit, dan pembatalan izin.
- `Log Sesi`: log login pengguna, jika pencatatan sesi diperlukan.

Jangan membagikan spreadsheet atau data password kepada pengguna umum.

### 2. Siapkan Folder Google Drive

Buat folder Drive untuk menyimpan foto absensi. Salin ID folder dari URL Drive.

Contoh URL:

```text
https://drive.google.com/drive/folders/ID_FOLDER
```

Gunakan bagian `ID_FOLDER` sebagai nilai `FOLDER_ID`.

### 3. Buat Google Apps Script

1. Buka [script.google.com](https://script.google.com/).
2. Buat proyek baru.
3. Salin isi `Code.gs` ke editor Apps Script.
4. Ubah konfigurasi berikut di bagian atas file:

```javascript
const FOLDER_ID = "ID_FOLDER_DRIVE";
const SPREADSHEET_ID = "ID_SPREADSHEET";
const SCHOOL_LAT = -0.9397412623;
const SCHOOL_LNG = 119.924829;
const MAX_RADIUS = 50;
```

5. Simpan proyek.
6. Jalankan fungsi yang diperlukan untuk pertama kali dan berikan izin akses Google saat diminta.

### 4. Deploy sebagai Web App

1. Pilih **Deploy > New deployment**.
2. Pilih tipe **Web app**.
3. Atur **Execute as** menjadi akun pemilik proyek.
4. Atur akses agar dapat digunakan oleh pengguna aplikasi sesuai kebijakan sekolah.
5. Klik **Deploy** dan salin URL Web App yang berakhiran `/exec`.

## Instalasi Frontend

1. Buka `assets/js/app.js`.
2. Ubah nilai `GAS_URL` dengan URL Web App dari Google Apps Script:

```javascript
const GAS_URL = "https://script.google.com/macros/s/ID_DEPLOYMENT/exec";
```

3. Pastikan file `index.html`, folder `assets`, `sw.js`, dan `CNAME` berada pada root repository.
4. Commit dan push perubahan ke repository GitHub.

Tidak diperlukan proses build atau instalasi dependency Node.js. Frontend merupakan aplikasi statis dan memuat library kamera/wajah dari CDN.

## Publikasi GitHub Pages

1. Buka **Settings > Pages** pada repository GitHub.
2. Pilih branch publikasi, biasanya `main`, dan folder `/ (root)`.
3. Simpan pengaturan publikasi.
4. Jika menggunakan domain pada `CNAME`, atur DNS domain agar mengarah ke GitHub Pages.
5. Buka alamat domain setelah proses publikasi selesai.

Domain aplikasi yang dikonfigurasi saat ini berada pada file `CNAME`.

## Alur Penggunaan

1. Pengguna login menggunakan username dan password.
2. Pengguna mendaftarkan wajah satu kali.
3. Pengguna memilih absen masuk atau absen keluar.
4. Aplikasi memeriksa satu wajah, kecocokan wajah, dan liveness melalui kamera.
5. Aplikasi meminta lokasi perangkat.
6. Server memvalidasi akun, wajah/liveness, hari kerja, jam absensi, dan radius lokasi sekolah.
7. Data absensi dan foto disimpan ke Spreadsheet/Drive.

Pengajuan izin atau sakit dapat dilakukan melalui menu **Izin / Sakit** dan dapat dibatalkan selama statusnya masih aktif.

## Validasi yang Aktif

- Login dengan username dan password.
- Penguncian sementara setelah lima kali login gagal.
- Pendaftaran dan pencocokan wajah.
- Verifikasi liveness dengan instruksi tersenyum.
- Satu wajah di depan kamera.
- Lokasi dalam radius maksimal 50 meter dari titik sekolah.
- Absensi pada Senin sampai Jumat, pukul 05.30 sampai 23.59 WITA.
- Pencegahan absensi masuk/keluar ganda pada hari yang sama.
- Sinkronisasi status harian dan cache lokal.

## Validasi Wi-Fi

Deteksi jaringan Wi-Fi dan BSSID masih tersedia di beberapa bagian kode untuk kompatibilitas dan pengembangan lanjutan, tetapi pemeriksaan tersebut tidak dipakai sebagai syarat absensi pada konfigurasi saat ini. Jangan mendokumentasikan koneksi ke Wi-Fi sekolah sebagai persyaratan wajib sampai fitur tersebut diaktifkan kembali.

## Pemeliharaan

- Setelah mengubah `Code.gs`, buat deployment baru atau perbarui deployment Web App.
- Setelah mengubah file frontend, naikkan query versi asset pada `index.html` jika cache service worker masih menampilkan versi lama.
- Periksa izin kamera dan lokasi pada perangkat saat pengujian.
- Uji login, pendaftaran wajah, absensi masuk, absensi keluar, izin/sakit, dan logout setelah setiap rilis.
- Jangan memasukkan password asli atau data pribadi pengguna ke dalam repository.

## Dokumentasi Tambahan

- [Panduan Pengguna Eranga](LAPORAN_ERANGA_UNTUK_PENGGUNA.md)
- [Laporan Rilis Eranga](LAPORAN_RILIS_ERANGA.md)
