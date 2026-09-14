// CONFIG
const GAS_URL = "https://script.google.com/macros/s/AKfycbx0K3cWfijKJX0t2JbN-EBAI-6LQeT3W9ss7kntG4Wt5Ua8OY8g4HCGlPMl4fNov5vITw/exec";
const DAFTAR_BSSID_SEKOLAH = [
  "06:20:84:9a:42:1b",
  "06:20:84:aa:42:1b",
  "74:f8:db:6a:a7:f0"
];

// STATES
let bssidPengguna = "";
let streamRef = null;
let modePilihan = "";
let currentUserData = null;
let isLivenessPassed = false;
let isDetectingFace = false;
let modelsLoaded = false;
let modelsLoadPromise = null;
let isSubmitting = false;
let statusSyncPromise = null;
let livenessConfirmCount = 0;
let blinkState = "WAITING_OPEN";
let isFaceVerified = false;
let currentFaceDescriptor = null;
let lastDashboardDateKey = null;
let lastCapturedPhotoDataUrl = "";
const LIVENESS_REQUIRED_FRAMES = 3;
const FACE_MATCH_THRESHOLD = 0.48;
const FACE_DETECTION_INTERVAL_MS = 220;
const FACE_DETECTOR_INPUT_SIZE = 320;
const FACE_DETECTOR_SCORE_THRESHOLD = 0.5;
const EYE_OPEN_THRESHOLD = 0.24;
const EYE_CLOSED_THRESHOLD = 0.20;

// HELPER LOADING OVERLAY BLUR
function showLoading(pesan = "Memproses data...") {
  // Loading overlay dinonaktifkan agar proses tidak menghalangi tampilan aplikasi.
}

function hideLoading() {
  // Loading overlay dinonaktifkan agar proses tidak menghalangi tampilan aplikasi.
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeFaceDescriptor(value) {
  if (Array.isArray(value)) return value.length === 128 ? value : null;
  if (typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length === 128 ? parsed : null;
  } catch (e) {
    return null;
  }
}

function hasRegisteredFace() {
  return normalizeFaceDescriptor(currentUserData?.faceDescriptor) !== null;
}

function updateFaceRegistrationVisibility() {
  const faceNotice = document.getElementById('faceRegistrationNotice');
  const mainButtons = document.getElementById('mainButtons');
  if (!faceNotice || !mainButtons) return;

  const registered = hasRegisteredFace();
  faceNotice.classList.toggle('hidden', registered);
  mainButtons.classList.toggle('hidden', !registered);
}

// HELPER LOCAL CACHE STATUS
function simpanStatusLokal(data) {
  if (!currentUserData) return;
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const wita = new Date(utc + (3600000 * 8));
  const tanggalHariIni = wita.toISOString().split('T')[0];

  const payloadCache = {
    tanggal: tanggalHariIni,
    statusData: data
  };
  localStorage.setItem("cache_status_" + currentUserData.username, JSON.stringify(payloadCache));
}

function ambilStatusLokal() {
  if (!currentUserData) return null;
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const wita = new Date(utc + (3600000 * 8));
  const tanggalHariIni = wita.toISOString().split('T')[0];

  const raw = localStorage.getItem("cache_status_" + currentUserData.username);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (parsed.tanggal === tanggalHariIni) {
      return parsed.statusData;
    }
  } catch (e) {
    return null;
  }
  return null;
}

// HELPER FETCH WITH AUTO-RETRY
async function fetchCekStatusWithRetry(retries = 3, delay = 1200) {
  if (statusSyncPromise) return statusSyncPromise;
  if (!currentUserData?.sessionToken) {
    const error = new Error("Sesi login tidak tersedia.");
    error.code = "SESSION_MISSING";
    return Promise.reject(error);
  }

  statusSyncPromise = (async () => {
    let lastError = null;

    for (let i = 0; i < retries; i++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(GAS_URL, {
          method: 'POST',
          body: JSON.stringify({ action: "cek_status", sessionToken: currentUserData.sessionToken }),
          signal: controller.signal
        });

        if (!response.ok) {
          lastError = new Error(`Server mengembalikan HTTP ${response.status}.`);
          lastError.code = "HTTP_ERROR";
        } else {
          const res = await response.json();
          if (res.status === "success") return res;

          const serverMessage = res.message || "Server menolak permintaan status.";
          const error = new Error(serverMessage);
          error.code = /sesi tidak valid|sudah berakhir/i.test(serverMessage)
            ? "SESSION_EXPIRED"
            : "SERVER_REJECTED";
          lastError = error;

          if (error.code === "SESSION_EXPIRED") throw error;
        }
      } catch (err) {
        if (err.code === "SESSION_EXPIRED") throw err;

        if (err.name === "AbortError") {
          lastError = new Error("Server tidak merespons dalam 8 detik.");
          lastError.code = "TIMEOUT";
        } else if (err.code !== "SERVER_REJECTED") {
          lastError = new Error("Tidak dapat terhubung ke server.");
          lastError.code = "NETWORK";
        }
        console.warn(`Percobaan cek_status ke-${i + 1} gagal, mencoba lagi...`);
      } finally {
        clearTimeout(timeoutId);
      }

      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error("Gagal memuat status hari ini.");
  })();

  statusSyncPromise.then(
    () => { statusSyncPromise = null; },
    () => { statusSyncPromise = null; }
  );
  return statusSyncPromise;
}

// WIFI VALIDATION
function isBssidValid() {
  if (!bssidPengguna) return false;
  const cleanBssid = bssidPengguna.replace(/"/g, "").replace(/-/g, ":").trim().toLowerCase();
  if (cleanBssid === "02:00:00:00:00:00" || cleanBssid === "<unknown bssid>" || cleanBssid === "") return false;

  return DAFTAR_BSSID_SEKOLAH.some(bssid => {
    const targetBssid = bssid.replace(/"/g, "").replace(/-/g, ":").trim().toLowerCase();
    const prefix = targetBssid.substring(0, 14);
    return cleanBssid === targetBssid || cleanBssid.startsWith(prefix);
  });
}

function terimaDataWiFiFromAndroid(ssid, bssid) {
  if (!bssid) return;
  let cleanBssid = bssid.replace(/"/g, "").replace(/-/g, ":").trim().toLowerCase();
  if (cleanBssid === "02:00:00:00:00:00" || cleanBssid === "<unknown bssid>" || cleanBssid === "") return;

  let lastBssid = bssidPengguna;
  bssidPengguna = cleanBssid;

  if (lastBssid && lastBssid !== bssidPengguna) {
    const camArea = document.getElementById('cameraArea');
    if (camArea && !camArea.classList.contains('hidden')) {
      Swal.fire({
        icon: 'warning',
        title: 'Peringatan Jaringan',
        text: `Jaringan WiFi Anda berubah! (Dari: ${lastBssid} ke: ${bssidPengguna}). Pastikan tetap terhubung ke WiFi resmi sekolah.`,
        confirmButtonColor: '#ffc107'
      });
    }
  }
}

// SESSION MANAGEMENT
function simpanSesi(userData) {
  const sessionStr = JSON.stringify(userData);

  // Untuk WebView Android, session harus tetap ada meski webview ditutup.
  // Jangan hanya memakai sessionStorage karena itu akan hilang saat tab atau webview ditutup.
  localStorage.setItem("session_user", sessionStr);
  sessionStorage.setItem("session_user", sessionStr);
}

function ambilSesi() {
  let sessionStr = localStorage.getItem("session_user") || sessionStorage.getItem("session_user");
  if (sessionStr) {
    try { return JSON.parse(sessionStr); } catch (e) { return null; }
  }
  return null;
}

function hapusSesi() {
  localStorage.removeItem("session_user");
  sessionStorage.removeItem("session_user");
  document.cookie = "user_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
}

// NETWORK CHECK
function cekKoneksiInternet() {
  const offlineSec = document.getElementById("offlineSection");
  const loginSec = document.getElementById("loginSection");
  const dashSec = document.getElementById("dashboardSection");

  if (!navigator.onLine) {
    if (loginSec) loginSec.classList.add("hidden");
    if (dashSec) dashSec.classList.add("hidden");
    if (offlineSec) offlineSec.classList.remove("hidden");
  } else {
    if (offlineSec) offlineSec.classList.add("hidden");
  }
}

window.addEventListener("online", () => location.reload());
window.addEventListener("offline", cekKoneksiInternet);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js?v=20260926', { scope: './', updateViaCache: 'none' })
      .then(() => console.log('Service Worker Terpasang!'))
      .catch(err => console.error('SW Gagal:', err));
  });
}

// INIT POINT
window.addEventListener('DOMContentLoaded', () => {
  cekKoneksiInternet();
  if (!navigator.onLine) return;

  const passwordInput = document.getElementById('password');
  if (passwordInput) {
    passwordInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') login();
    });
  }

  const toggleBtn = document.getElementById('togglePassword');
  if (toggleBtn) {
    toggleBtn.onclick = function() {
      let p = document.getElementById('password');
      p.type = p.type === 'password' ? 'text' : 'password';
      this.querySelector('i').className = p.type === 'password' ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
    };
  }

  const savedUser = ambilSesi();
  if (savedUser?.sessionToken) {
    savedUser.faceDescriptor = normalizeFaceDescriptor(savedUser.faceDescriptor);
    currentUserData = savedUser;
    showDashboard(currentUserData.nama);
  } else if (savedUser) {
    hapusSesi();
  }

});

// Percobaan login kembali
async function fetchLoginWithRetry(username, password) {
  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ action: "login", username, password }),
        signal: controller.signal
      });

      if (!response.ok) {
        const error = new Error(`Server mengembalikan HTTP ${response.status}.`);
        error.retryable = response.status >= 500;
        throw error;
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      const retryable = error.name === "AbortError" || error.retryable === true || !('retryable' in error);
      if (!retryable || attempt === maxAttempts) break;
      await new Promise(resolve => setTimeout(resolve, attempt * 2000));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError || new Error("Gagal terhubung ke server.");
}

async function login() {
  if (isSubmitting) return;

  let u = document.getElementById('username').value.trim();
  let p = document.getElementById('password').value.trim();
  if (!u || !p) {
    document.getElementById('loginMsg').innerText = "Isi username & password!";
    return;
  }

  isSubmitting = true;
  const btnLogin = document.getElementById('btnLogin');
  if (btnLogin) btnLogin.disabled = true;

  document.getElementById('loginMsg').innerText = "Memverifikasi login...";
  showLoading("Memverifikasi login...");

  try {
    const res = await fetchLoginWithRetry(u, p);

    hideLoading();

    if (res.status === "success") {
      currentUserData = {
        ...res.user,
        sessionToken: res.sessionToken,
        faceDescriptor: normalizeFaceDescriptor(res.user?.faceDescriptor)
      };
      simpanSesi(currentUserData);
      showDashboard(currentUserData.nama);
    } else {
      document.getElementById('loginMsg').innerText = res.message;
      Swal.fire({
        icon: 'error',
        title: 'Login Gagal',
        text: res.message,
        confirmButtonColor: '#dc3545'
      });
    }
  } catch (e) {
    hideLoading();
    const errorMessage = e.name === "AbortError"
      ? "Server tidak merespons dalam 10 detik."
      : e.message || "Gagal terhubung ke server.";
    document.getElementById('loginMsg').innerText = errorMessage;
    Swal.fire({
      icon: 'error',
      title: 'Server Tidak Dapat Dihubungi',
      text: errorMessage,
      confirmButtonColor: '#dc3545'
    });
  } finally {
    isSubmitting = false;
    if (btnLogin) btnLogin.disabled = false;
    hideLoading();
  }
}

async function logout() {
  const confirmResult = await Swal.fire({
    icon: 'question',
    title: 'Konfirmasi Logout',
    text: 'Apakah Anda yakin ingin keluar dari aplikasi?',
    showCancelButton: true,
    confirmButtonText: 'Ya, Logout',
    cancelButtonText: 'Batal',
    confirmButtonColor: '#c84545',
    cancelButtonColor: '#647586',
    reverseButtons: true
  });

  if (!confirmResult.isConfirmed) return;

  try {
    await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ action: "logout", sessionToken: currentUserData?.sessionToken })
    });
  } catch (e) {
    console.warn("Sesi server tidak dapat dihapus:", e);
  } finally {
    hapusSesi();
    location.reload();
  }
}

// DASHBOARD
function getHariIndonesia(date) {
  const hariArray = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  return hariArray[date.getDay()];
}

function updateUIStatus(res) {
  const statusMasuk = res.statusMasuk || "Belum";
  const jamMasuk = res.jamMasuk || "";
  const statusKeluar = res.statusKeluar || "Belum";
  const jamKeluar = res.jamKeluar || "";
  const statusIzin = res.statusIzin || null;

  let infoStatusHTML = "";
  const btnMasuk = document.querySelector("button[onclick*=\"bukaForm('Masuk')\"]");
  const btnKeluar = document.querySelector("button[onclick*=\"bukaForm('Keluar')\"]");
  const btnIzin = document.querySelector("button[onclick*=\"bukaForm('Izin')\"]");

  if (statusIzin) {
    infoStatusHTML = `<div class="attendance-status-grid">
      <div class="attendance-status-card attendance-status-leave">
        <span class="attendance-status-label"><i class="fa-solid fa-file-pen" aria-hidden="true"></i> Izin / Sakit</span>
        <strong class="status-izin">${escapeHtml(statusIzin)} (Izin Aktif)</strong>
        <button onclick="batalkanIzin()" class="cancel-leave-button">
          <i class="fa-solid fa-rotate-left"></i> Batalkan Izin/Sakit
        </button>
      </div>
    </div>`;

    if (btnMasuk) btnMasuk.classList.add("hidden");
    if (btnKeluar) btnKeluar.classList.add("hidden");
    if (btnIzin) btnIzin.classList.add("hidden");
  } else {
    let textMasukClass = statusMasuk === "Sudah" ? "status-success" : "status-offline";
    let textKeluarClass = statusKeluar === "Sudah" ? "status-success" : "status-offline";
    let labelMasuk = statusMasuk === "Sudah" ? `Sudah (${jamMasuk || 'Terekam'})` : "Belum";
    let labelKeluar = statusKeluar === "Sudah" ? `Sudah (${jamKeluar || 'Terekam'})` : "Belum";

    infoStatusHTML = `<div class="attendance-status-grid">
      <div class="attendance-status-card attendance-status-entry">
        <span class="attendance-status-label"><i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i> Absen Masuk</span>
        <strong class="${textMasukClass} status-value">${escapeHtml(labelMasuk)}</strong>
      </div>
      <div class="attendance-status-card attendance-status-exit">
        <span class="attendance-status-label"><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Absen Keluar</span>
        <strong class="${textKeluarClass} status-value">${escapeHtml(labelKeluar)}</strong>
      </div>
    </div>`;

    if (statusMasuk === "Belum") {
      if (btnMasuk) btnMasuk.classList.remove("hidden");
      if (btnKeluar) btnKeluar.classList.add("hidden");
      if (btnIzin) btnIzin.classList.remove("hidden");
    } else if (statusMasuk === "Sudah" && statusKeluar === "Belum") {
      if (btnMasuk) btnMasuk.classList.add("hidden");
      if (btnKeluar) btnKeluar.classList.remove("hidden");
      if (btnIzin) btnIzin.classList.add("hidden");
    } else {
      if (btnMasuk) btnMasuk.classList.add("hidden");
      if (btnKeluar) btnKeluar.classList.add("hidden");
      if (btnIzin) btnIzin.classList.add("hidden");
    }
  }

  const statusSpan = document.getElementById('textStatusAbsen');
  if (statusSpan) statusSpan.innerHTML = infoStatusHTML;

  updateFaceRegistrationVisibility();
}

function showDashboard(nama) {
  document.getElementById('loginSection').classList.add('hidden');
  document.getElementById('dashboardSection').classList.remove('hidden');
  document.getElementById('displayUser').innerText = nama;

  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const wita = new Date(utc + (3600000 * 8));
  const namaHari = getHariIndonesia(wita);
  const tanggalHariIni = wita.toISOString().split('T')[0];
  lastDashboardDateKey = tanggalHariIni;

  const userInfoEl = document.getElementById('userInfo');
  userInfoEl.innerHTML = `
    <div class="profile-heading">
      <span class="profile-icon" aria-hidden="true"><i class="fa-solid fa-id-card"></i></span>
      <div>
        <span class="profile-kicker">Profil pengguna</span>
        <strong class="profile-name">${escapeHtml(currentUserData.nama)}</strong>
      </div>
    </div>
    <div class="profile-grid">
      <div class="profile-item">
        <span class="profile-label">Hari / Tanggal</span>
        <strong class="profile-value">${escapeHtml(namaHari)}, ${escapeHtml(tanggalHariIni)}<em>WITA</em></strong>
      </div>
      <div class="profile-item">
        <span class="profile-label">NUPTK</span>
        <strong class="profile-value">${escapeHtml(currentUserData.nuptk || '-')}</strong>
      </div>
      <div class="profile-item">
        <span class="profile-label">Jabatan</span>
        <strong class="profile-value">${escapeHtml(currentUserData.jabatan || '-')}</strong>
      </div>
      <div class="today-status">
        <span class="today-status-label"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i> Status Hari Ini</span>
      </div>
      <div id="textStatusAbsen" aria-live="polite">
        <i class="fa-solid fa-spinner fa-spin"></i> Menyinkronkan...
      </div>
    </div>
  `;

  updateFaceRegistrationVisibility();

  // 1. Tampilkan data dari cache lokal jika ada (0 ms delay)
  const statusLokal = ambilStatusLokal();
  if (statusLokal) {
    updateUIStatus(statusLokal);
  }

  // 2. Sinkronkan dengan server di background + Auto Retry 3x
  fetchCekStatusWithRetry(3, 1200)
    .then(res => {
      simpanStatusLokal(res);
      updateUIStatus(res);
    })
    .catch(e => {
      console.error("Gagal sinkronisasi status dari server:", e);
      const statusSpan = document.getElementById('textStatusAbsen');
      if (!statusLokal && statusSpan) {
        const errorMessages = {
          SESSION_MISSING: "Sesi login tidak tersedia. Silakan login ulang.",
          SESSION_EXPIRED: "Sesi login telah berakhir. Silakan login ulang.",
          TIMEOUT: "Server tidak merespons. Coba lagi dalam beberapa saat.",
          SERVER_REJECTED: `Server menolak permintaan: ${e.message}`,
          HTTP_ERROR: e.message,
          NETWORK: "Tidak dapat terhubung ke server. Periksa koneksi internet."
        };
        const message = errorMessages[e.code] || "Status hari ini gagal dimuat. Coba lagi nanti.";
        const icon = e.code === "SESSION_MISSING" || e.code === "SESSION_EXPIRED"
          ? "fa-lock"
          : e.code === "SERVER_REJECTED" || e.code === "HTTP_ERROR"
            ? "fa-server"
            : "fa-wifi";
        const statusClass = e.code === "SERVER_REJECTED" || e.code === "HTTP_ERROR"
          ? "status-danger"
          : "status-offline";
        statusSpan.innerHTML = `<span class="${statusClass}"><i class="fa-solid ${icon}"></i> ${escapeHtml(message)}</span>`;
      }
    });
}

async function batalkanIzin() {
  if (isSubmitting) return;

  const confirmResult = await Swal.fire({
    title: 'Konfirmasi Pembatalan',
    text: 'Apakah Anda yakin ingin membatalkan permohonan Izin / Sakit ini?',
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    cancelButtonColor: '#6c757d',
    confirmButtonText: 'Ya, Batalkan',
    cancelButtonText: 'Batal'
  });

  if (!confirmResult.isConfirmed) return;

  isSubmitting = true;
  showLoading("Mencatat pembatalan izin...");

  try {
    const r = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ action: "batal_izin", sessionToken: currentUserData.sessionToken })
    });
    const res = await r.json();

    hideLoading();

    if (res.status === "success") {
      await Swal.fire({
        icon: 'success',
        title: 'Berhasil',
        text: 'Permohonan Izin / Sakit berhasil dibatalkan.',
        confirmButtonColor: '#43ba92'
      });
      showDashboard(currentUserData.nama);
    } else {
      Swal.fire({
        icon: 'error',
        title: 'Gagal Pembatalan',
        text: res.message,
        confirmButtonColor: '#dc3545'
      });
    }
  } catch (e) {
    hideLoading();
    Swal.fire({
      icon: 'error',
      title: 'Koneksi Terputus',
      text: 'Gagal terhubung ke server.',
      confirmButtonColor: '#dc3545'
    });
  } finally {
    isSubmitting = false;
    hideLoading();
  }
}

function updateClock() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const wita = new Date(utc + (3600000 * 8));
  document.getElementById('clock').innerText = `${String(wita.getHours()).padStart(2,'0')}:${String(wita.getMinutes()).padStart(2,'0')}:${String(wita.getSeconds()).padStart(2,'0')} WITA`;

  if (!currentUserData?.nama || !document.getElementById('dashboardSection')) return;

  const currentDateKey = wita.toISOString().split('T')[0];
  if (lastDashboardDateKey && lastDashboardDateKey !== currentDateKey) {
    lastDashboardDateKey = currentDateKey;
    if (!document.getElementById('dashboardSection').classList.contains('hidden')) {
      showDashboard(currentUserData.nama);
    }
  }
}
setInterval(updateClock, 1000);

// FORM & KAMERA
async function bukaForm(jenis) {
  // Deteksi WiFi dinonaktifkan sementara.
  // if (window.AndroidBridge && typeof window.AndroidBridge.requestBssidUpdate === 'function') {
  //   window.AndroidBridge.requestBssidUpdate();
  // }

  // if (jenis === 'Masuk' || jenis === 'Keluar') {
  //   if (!isBssidValid()) {
  //     Swal.fire({
  //       icon: 'error',
  //       title: 'Akses Ditolak!',
  //       text: `Anda harus terhubung ke WiFi resmi sekolah untuk melakukan Absen ${jenis}. (BSSID Terdeteksi: ${bssidPengguna || 'Tidak Terdeteksi'})`,
  //       confirmButtonColor: '#dc3545'
  //     });
  //     return;
  //   }
  // }

  if (jenis === 'Izin') {
    modePilihan = "Izin";
    document.getElementById('dashboardSection').classList.add('form-active');
    document.getElementById('mainButtons').classList.add('hidden');
    document.getElementById('izinArea').classList.remove('hidden');
    return;
  }

  modePilihan = jenis;
  document.getElementById('dashboardSection').classList.add('form-active');
  document.getElementById('mainButtons').classList.add('hidden');
  document.getElementById('menuTitle').innerText = "Foto Absen " + jenis;
  document.getElementById('cameraArea').classList.remove('hidden');
  
  await startCamera();
}

function batal() {
  isDetectingFace = false;
  isLivenessPassed = false;
  isFaceVerified = false;
  livenessConfirmCount = 0;
  blinkState = "WAITING_OPEN";
  currentFaceDescriptor = null;
  lastCapturedPhotoDataUrl = "";
  stopCamera();
  document.getElementById('dashboardSection').classList.remove('form-active');
  document.getElementById('cameraArea').classList.add('hidden');
  document.getElementById('izinArea').classList.add('hidden');
  updateFaceRegistrationVisibility();
  document.getElementById('status').innerText = "";
  
  const faceOverlay = document.getElementById('faceOverlay');
  if (faceOverlay) faceOverlay.className = "face-overlay";
}

function bukaPendaftaranWajah() {
  modePilihan = "DaftarWajah";
  document.getElementById('dashboardSection').classList.add('form-active');
  document.getElementById('faceRegistrationNotice').classList.add('hidden');
  document.getElementById('mainButtons').classList.add('hidden');
  document.getElementById('menuTitle').innerText = "Daftarkan Wajah";
  document.getElementById('cameraArea').classList.remove('hidden');
  startCamera();
}

async function loadFaceAPIModels() {
  if (modelsLoaded) return;
  if (modelsLoadPromise) return modelsLoadPromise;
  if (typeof faceapi === 'undefined') {
    throw new Error("Library deteksi wajah belum tersedia.");
  }

  modelsLoadPromise = (async () => {
    const modelSources = [
      'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/',
      'https://unpkg.com/@vladmandic/face-api/model/'
    ];
    let lastError = null;

    for (const modelUrl of modelSources) {
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
          faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
          faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl)
        ]);
        modelsLoaded = true;
        return;
      } catch (error) {
        lastError = error;
        console.warn(`Gagal memuat model dari ${modelUrl}`, error);
      }
    }

    throw lastError || new Error("Model deteksi wajah tidak tersedia.");
  })().finally(() => {
    if (!modelsLoaded) modelsLoadPromise = null;
  });

  return modelsLoadPromise;
}

async function startCamera() {
  let pendingStream = null;

  try {
    isLivenessPassed = false;
    isFaceVerified = false;
    livenessConfirmCount = 0;
    blinkState = "WAITING_OPEN";
    currentFaceDescriptor = null;
    lastCapturedPhotoDataUrl = "";
    const btnKirim = document.getElementById('btnKirimAbsen');
    if (btnKirim) btnKirim.classList.add('hidden');

    const statusEl = document.getElementById('livenessStatus');
    const faceOverlay = document.getElementById('faceOverlay');
    
    if (faceOverlay) faceOverlay.className = "face-overlay";

    if (statusEl) {
      statusEl.innerText = "Memuat model deteksi...";
      statusEl.className = "liveness-badge status-blue";
    }

    if (modePilihan !== "DaftarWajah" && (!Array.isArray(currentUserData?.faceDescriptor) || currentUserData.faceDescriptor.length !== 128)) {
      throw new Error("Descriptor wajah akun belum tersedia.");
    }

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      throw new Error("Kamera tidak didukung atau halaman tidak dibuka melalui HTTPS.");
    }

    const modelPromise = loadFaceAPIModels().catch(error => {
      error.code = "MODEL_LOAD";
      throw error;
    });
    const cameraPromise = navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30, max: 30 }
      }
    });
    try {
      [modelPromise, pendingStream] = await Promise.all([modelPromise, cameraPromise]);
    } catch (error) {
      cameraPromise.then(stream => stream.getTracks().forEach(track => track.stop())).catch(() => {});
      throw error;
    }
    streamRef = pendingStream;
    if (statusEl) {
      statusEl.innerText = "Kamera aktif. Posisikan wajah Anda...";
      statusEl.className = "liveness-badge status-red";
    }
    const videoEl = document.getElementById('video');
    videoEl.srcObject = streamRef;
    videoEl.onplay = () => {
      if (statusEl && btnKirim) jalankanLivenessDetection(videoEl, statusEl, btnKirim);
    };
  } catch (e) {
    if (pendingStream) {
      pendingStream.getTracks().forEach(track => track.stop());
    }
    const isMissingDescriptor = e.message === "Descriptor wajah akun belum tersedia.";
    const isModelError = e.code === "MODEL_LOAD" || e.message === "Library deteksi wajah belum tersedia.";
    const isCameraUnavailable = e.name === "NotAllowedError" || e.name === "NotFoundError" || e.name === "NotReadableError" || e.message.includes("Kamera tidak didukung");
    Swal.fire({
      icon: 'error',
      title: isMissingDescriptor ? 'Wajah Belum Terdaftar' : isCameraUnavailable ? 'Izin Kamera Diperlukan' : isModelError ? 'Model Wajah Gagal Dimuat' : 'Kamera Gagal',
      text: isMissingDescriptor
        ? 'Descriptor wajah akun belum tersedia. Hubungi administrator untuk mendaftarkan wajah Anda.'
        : isCameraUnavailable
          ? 'Izinkan akses kamera untuk aplikasi ini, lalu coba lagi.'
          : isModelError
            ? 'Model deteksi wajah gagal dimuat dari CDN. Periksa koneksi internet lalu coba lagi.'
            : 'Kamera tidak dapat dibuka. Periksa izin kamera dan coba lagi.',
      confirmButtonColor: '#dc3545'
    });
    batal();
  }
}

// LIVENESS DETECTION (NON-OVERLAPPING RECURSIVE LOOP)
function ambilFrameKameraUntukFoto(videoEl) {
  const canvas = document.getElementById('canvas');
  if (!videoEl || !canvas || !videoEl.videoWidth || !videoEl.videoHeight) return "";

  const maxWidth = 480;
  const scale = maxWidth / videoEl.videoWidth;
  canvas.width = maxWidth;
  canvas.height = videoEl.videoHeight * scale;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.55);
}

function hitungRasioMata(eyePoints) {
  if (!eyePoints || eyePoints.length !== 6) return 1;

  const jarak = (pointA, pointB) => Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
  const lebarMata = jarak(eyePoints[0], eyePoints[3]);
  if (!lebarMata) return 1;

  const tinggiMata = jarak(eyePoints[1], eyePoints[5]) + jarak(eyePoints[2], eyePoints[4]);
  return tinggiMata / (2 * lebarMata);
}

function mataSedangTerbuka(landmarks) {
  const rasioKiri = hitungRasioMata(landmarks.getLeftEye());
  const rasioKanan = hitungRasioMata(landmarks.getRightEye());
  return (rasioKiri + rasioKanan) / 2 >= EYE_OPEN_THRESHOLD;
}

function mataSedangTertutup(landmarks) {
  const rasioKiri = hitungRasioMata(landmarks.getLeftEye());
  const rasioKanan = hitungRasioMata(landmarks.getRightEye());
  return (rasioKiri + rasioKanan) / 2 <= EYE_CLOSED_THRESHOLD;
}

async function jalankanLivenessDetection(videoEl, statusEl, btnKirim) {
  isDetectingFace = true;
  const faceOverlay = document.getElementById('faceOverlay');
  const detectorOptions = new faceapi.TinyFaceDetectorOptions({
    inputSize: FACE_DETECTOR_INPUT_SIZE,
    scoreThreshold: FACE_DETECTOR_SCORE_THRESHOLD
  });

  const detectFrame = async () => {
    if (!isDetectingFace || isLivenessPassed) return;

    try {
      const detections = await faceapi.detectAllFaces(videoEl, detectorOptions)
        .withFaceLandmarks()
        .withFaceDescriptors();
      if (detections.length === 1) {
        const detection = detections[0];
        const isFaceMatched = modePilihan === "DaftarWajah" || faceapi.euclideanDistance(currentUserData.faceDescriptor, detection.descriptor) <= FACE_MATCH_THRESHOLD;

        if (!isFaceMatched) {
          livenessConfirmCount = 0;
          blinkState = "WAITING_OPEN";
          isFaceVerified = false;
          statusEl.innerText = "Wajah tidak sesuai dengan akun yang login.";
          statusEl.className = "liveness-badge status-danger";
          if (faceOverlay) faceOverlay.className = "face-overlay warning";
        } else if (blinkState === "WAITING_OPEN" && mataSedangTerbuka(detection.landmarks)) {
          blinkState = "OPEN";
          statusEl.innerText = "Wajah terdeteksi. Kedipkan mata sekali...";
          statusEl.className = "liveness-badge status-warning";
          if (faceOverlay) faceOverlay.className = "face-overlay warning";
        } else if (blinkState === "OPEN" && mataSedangTertutup(detection.landmarks)) {
          blinkState = "CLOSED";
          statusEl.innerText = "Kedipan terdeteksi. Buka mata kembali...";
          statusEl.className = "liveness-badge status-warning";
          if (faceOverlay) faceOverlay.className = "face-overlay warning";
        } else if (blinkState === "CLOSED" && mataSedangTerbuka(detection.landmarks)) {
          blinkState = "COMPLETED";
          livenessConfirmCount = 1;
          statusEl.innerText = "Kedipan terdeteksi. Memastikan wajah...";
          statusEl.className = "liveness-badge status-warning";
          if (faceOverlay) faceOverlay.className = "face-overlay warning";
        } else if (blinkState === "COMPLETED" && mataSedangTerbuka(detection.landmarks)) {
          livenessConfirmCount += 1;
          if (livenessConfirmCount >= LIVENESS_REQUIRED_FRAMES) {
            isLivenessPassed = true;
            isFaceVerified = true;
            currentFaceDescriptor = Array.from(detection.descriptor);
            lastCapturedPhotoDataUrl = ambilFrameKameraUntukFoto(videoEl);
            isDetectingFace = false;
            statusEl.innerText = modePilihan === "DaftarWajah"
              ? "Wajah siap didaftarkan. Silakan tekan tombol di bawah."
              : "Wajah terverifikasi. Liveness sukses, silakan lanjutkan absen.";
            statusEl.className = "liveness-badge status-success";
            if (faceOverlay) faceOverlay.className = "face-overlay success";
            btnKirim.innerHTML = modePilihan === "DaftarWajah"
              ? '<i class="fa-solid fa-user-plus" aria-hidden="true"></i> SIMPAN WAJAH'
              : '<i class="fa-solid fa-paper-plane" aria-hidden="true"></i> KIRIM ABSEN';
            btnKirim.classList.remove('hidden');
            const cameraActions = document.getElementById('cameraActions');
            if (cameraActions) {
              requestAnimationFrame(() => {
                cameraActions.scrollIntoView({ behavior: 'smooth', block: 'center' });
              });
            }
            return;
          }
          statusEl.innerText = "Kedipan terdeteksi. Memastikan wajah...";
          statusEl.className = "liveness-badge status-warning";
          if (faceOverlay) faceOverlay.className = "face-overlay warning";
        } else {
          statusEl.innerText = blinkState === "OPEN"
            ? "Wajah terdeteksi. Kedipkan mata sekali..."
            : "Wajah terdeteksi. Buka mata untuk memulai...";
          statusEl.className = "liveness-badge status-warning";
          if (faceOverlay) faceOverlay.className = "face-overlay warning";
        }
      } else if (detections.length > 1) {
        livenessConfirmCount = 0;
        statusEl.innerText = "Lebih dari satu wajah terdeteksi. Pastikan hanya satu orang di kamera.";
        statusEl.className = "liveness-badge status-danger";
        if (faceOverlay) faceOverlay.className = "face-overlay warning";
      } else {
        livenessConfirmCount = 0;
        blinkState = "WAITING_OPEN";
        statusEl.innerText = "Wajah TIDAK terdeteksi. Posisikan wajah ke kamera.";
        statusEl.className = "liveness-badge status-red";
        if (faceOverlay) faceOverlay.className = "face-overlay";
      }
    } catch (err) {
      console.error("Deteksi error:", err);
      isDetectingFace = false;
      livenessConfirmCount = 0;
      statusEl.innerText = "Deteksi wajah gagal. Silakan tutup lalu buka kamera kembali.";
      statusEl.className = "liveness-badge status-danger";
      btnKirim.classList.add('hidden');
      return;
    }

    if (isDetectingFace && !isLivenessPassed) {
      setTimeout(detectFrame, FACE_DETECTION_INTERVAL_MS);
    }
  };

  detectFrame();
}

function stopCamera() {
  if (streamRef) {
    streamRef.getTracks().forEach(t => t.stop());
    streamRef = null;
  }
}

// EKSEKUSI & SUBMIT
function eksekusiAbsen() {
  if (isSubmitting) return;

  if (modePilihan === "DaftarWajah") {
    daftarWajah();
    return;
  }

  // Deteksi WiFi dinonaktifkan sementara.
  // if (!isBssidValid()) {
  //   Swal.fire({
  //     icon: 'error',
  //     title: 'Akses Ditolak!',
  //     text: `Router WiFi tidak terdaftar sebagai milik sekolah atau koneksi terputus. (MAC Detected: ${bssidPengguna || 'Tidak Terdeteksi'})`,
  //     confirmButtonColor: '#dc3545'
  //   });
  //   batal();
  //   return;
  // }

  isSubmitting = true;
  setSubmitButtonState(true);

  showLoading("Mendapatkan lokasi GPS...");
  setProcessStatus("Mendapatkan lokasi GPS...");
  document.getElementById('status').classList.add("status-blue");

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => kirim(pos, true),
      (err) => {
        hideLoading();
        Swal.fire({
          icon: 'warning',
          title: 'GPS Gagal',
          text: 'Gagal mengambil lokasi GPS. Pastikan GPS HP Aktif!',
          confirmButtonColor: '#ffc107'
        });
        resetSubmitState();
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  } else {
    hideLoading();
    Swal.fire({
      icon: 'error',
      title: 'Perangkat Tidak Mendukung',
      text: 'Geolocation tidak didukung pada browser ini.',
      confirmButtonColor: '#dc3545'
    });
    resetSubmitState();
  }
}

async function daftarWajah() {
  if (isSubmitting || !isLivenessPassed || !isFaceVerified || !currentFaceDescriptor) return;

  isSubmitting = true;
  const btnKirim = document.getElementById('btnKirimAbsen');
  if (btnKirim) {
    btnKirim.disabled = true;
    btnKirim.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin process-spinner" aria-hidden="true"></i> MENYIMPAN...';
  }
  setProcessStatus("Menyimpan descriptor wajah...");

  try {
    const response = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: "daftar_wajah",
        sessionToken: currentUserData.sessionToken,
        faceDescriptor: currentFaceDescriptor
      })
    });
    const res = await response.json();

    if (res.status !== "success") {
      throw new Error(res.message || "Gagal mendaftarkan wajah.");
    }

    const registeredDescriptor = normalizeFaceDescriptor(res.faceDescriptor);
    if (!registeredDescriptor) {
      throw new Error("Server tidak mengembalikan descriptor wajah yang valid.");
    }

    currentUserData.faceDescriptor = registeredDescriptor;
    currentFaceDescriptor = null;
    modePilihan = "";
    simpanSesi(currentUserData);
    await Swal.fire({
      icon: 'success',
      title: 'Wajah Berhasil Didaftarkan',
      text: 'Sekarang Anda dapat melakukan absensi.',
      confirmButtonColor: '#087f68'
    });
    batal();
    showDashboard(currentUserData.nama);
  } catch (error) {
    Swal.fire({
      icon: 'error',
      title: 'Pendaftaran Gagal',
      text: error.message || 'Gagal menyimpan descriptor wajah.',
      confirmButtonColor: '#c84545'
    });
  } finally {
    isSubmitting = false;
    if (btnKirim) {
      btnKirim.disabled = false;
      btnKirim.innerHTML = '<i class="fa-solid fa-user-plus" aria-hidden="true"></i> SIMPAN WAJAH';
    }
    document.getElementById('status').innerText = "";
  }
}

function eksekusiIzin() {
  if (isSubmitting) return;

  let ket = document.getElementById('keteranganIzin').value.trim();
  if (!ket) {
    Swal.fire({
      icon: 'warning',
      title: 'Data Belum Lengkap',
      text: 'Silakan isi alasan/keterangan izin!',
      confirmButtonColor: '#ffc107'
    });
    return;
  }

  isSubmitting = true;
  setSubmitButtonState(true, true);

  showLoading("Mendapatkan lokasi GPS...");
  setProcessStatus("Mengirim izin...");

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => kirim(pos, false),
      () => {
        hideLoading();
        Swal.fire({
          icon: 'warning',
          title: 'GPS Gagal',
          text: 'Gagal mengambil lokasi GPS.',
          confirmButtonColor: '#ffc107'
        });
        resetSubmitState();
      }
    );
  } else {
    hideLoading();
    resetSubmitState();
  }
}

function setSubmitButtonState(disabled, isIzin = false) {
  const btn = isIzin ? document.getElementById('btnKirimIzin') : document.getElementById('btnKirimAbsen');
  if (btn) {
    btn.disabled = disabled;
    if (disabled) {
      btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin process-spinner" aria-hidden="true"></i> MEMPROSES...';
    } else if (isIzin) {
      btn.innerHTML = '<i class="fa-solid fa-file-pen" aria-hidden="true"></i> KIRIM PERMOHONAN';
    } else {
      const icon = modePilihan === 'Keluar' ? 'fa-right-from-bracket' : 'fa-right-to-bracket';
      btn.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i> KIRIM ABSEN`;
    }
    btn.classList.toggle("is-processing", disabled);
  }
}

function resetSubmitState() {
  isSubmitting = false;
  setSubmitButtonState(false, false);
  setSubmitButtonState(false, true);
  document.getElementById('status').innerText = "";
}

function setProcessStatus(message) {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.innerHTML = `<span class="status-processing"><i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>${message}</span>`;
  }
}

async function kirim(pos, adaFoto) {
  if (!currentUserData || !currentUserData.username) {
    hideLoading();
    Swal.fire({
      icon: 'error',
      title: 'Sesi Berakhir',
      text: 'Sesi Anda tidak valid. Silakan login ulang!',
      confirmButtonColor: '#dc3545'
    });
    resetSubmitState();
    logout();
    return;
  }

  showLoading("Mengunggah foto & memvalidasi data...");
  setProcessStatus("Mengunggah foto & memvalidasi data ke server...");

  let fotoBase64 = "";
  if (adaFoto) {
    const v = document.getElementById('video');
    if (lastCapturedPhotoDataUrl) {
      fotoBase64 = lastCapturedPhotoDataUrl;
    } else if (v) {
      fotoBase64 = ambilFrameKameraUntukFoto(v);
    }

    if (!fotoBase64) {
      hideLoading();
      resetSubmitState();
      Swal.fire({
        icon: 'warning',
        title: 'Foto Belum Siap',
        text: 'Foto wajah belum berhasil diambil. Silakan ulangi proses absen.',
        confirmButtonColor: '#ffc107'
      });
      return;
    }
  }

  const payload = {
    action: "absen",
    sessionToken: currentUserData.sessionToken,
    bssid: bssidPengguna,
    livenessPassed: isLivenessPassed,
    faceVerified: isFaceVerified,
    jenis: adaFoto ? modePilihan : document.getElementById('jenisIzin').value,
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    keterangan: adaFoto ? "" : document.getElementById('keteranganIzin').value,
    photo: fotoBase64
  };

  try {
    const response = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify(payload) });
    const res = await response.json();

    // Tutup overlay sebelum menampilkan notifikasi hasil pengiriman.
    hideLoading();
    resetSubmitState();

    if (res.status === "success") {
      await Swal.fire({
        icon: 'success',
        title: 'Absen Berhasil',
        text: res.message,
        confirmButtonColor: '#43ba92'
      });
      showDashboard(currentUserData.nama);
      batal();
    } else {
      await Swal.fire({
        icon: 'error',
        title: 'Ditolak Server',
        text: res.message,
        confirmButtonColor: '#dc3545'
      });
    }
  } catch (e) {
    hideLoading();
    resetSubmitState();
    await Swal.fire({
      icon: 'error',
      title: 'Gagal Koneksi',
      text: 'Gagal terhubung ke server.',
      confirmButtonColor: '#dc3545'
    });
  } finally {
    hideLoading();
    resetSubmitState();
  }
}
