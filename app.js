// CONFIG
const GAS_URL = "https://script.google.com/macros/s/AKfycbwYEFsmJm4hj0572k8GVpQi0cUOWDPgHwaRK9qeLQ50oyqcIWD4As8Wgp1p9EMazEZY-g/exec";
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
let isSubmitting = false;
let statusSyncPromise = null;
let livenessConfirmCount = 0;
let isFaceVerified = false;
const LIVENESS_REQUIRED_FRAMES = 3;
const FACE_MATCH_THRESHOLD = 0.5;

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
  if (!currentUserData?.sessionToken) return Promise.reject(new Error("Sesi tidak tersedia."));

  statusSyncPromise = (async () => {
    for (let i = 0; i < retries; i++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(GAS_URL, {
          method: 'POST',
          body: JSON.stringify({ action: "cek_status", sessionToken: currentUserData.sessionToken }),
          signal: controller.signal
        });
        if (response.ok) {
          const res = await response.json();
          if (res.status === "success") return res;
        }
      } catch (err) {
        console.warn(`Percobaan cek_status ke-${i + 1} gagal, mencoba lagi...`);
      } finally {
        clearTimeout(timeoutId);
      }

      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error("Gagal terhubung ke server setelah beberapa percobaan.");
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
  const rememberMe = document.getElementById('rememberMe')?.checked;
  const sessionStr = JSON.stringify(userData);

  if (rememberMe) {
    localStorage.setItem("session_user", sessionStr);
  } else {
    sessionStorage.setItem("session_user", sessionStr);
  }
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
    currentUserData = savedUser;
    showDashboard(currentUserData.nama);
  } else if (savedUser) {
    hapusSesi();
  }

  setTimeout(loadFaceAPIModels, 2000);
});

// LOGIN
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
    const response = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ action: "login", username: u, password: p })
    });
    const res = await response.json();

    hideLoading();

    if (res.status === "success") {
      currentUserData = { ...res.user, sessionToken: res.sessionToken };
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
    document.getElementById('loginMsg').innerText = "Gagal terhubung ke server.";
    Swal.fire({
      icon: 'error',
      title: 'Koneksi Terputus',
      text: 'Gagal terhubung ke server.',
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
    infoStatusHTML = `<span style="color: #ffc107; font-weight: bold;">${escapeHtml(statusIzin)} (Izin Aktif)</span><br>
      <button onclick="batalkanIzin()" style="margin-top:8px; padding:6px 12px; background-color:#dc3545; color:white; border:none; border-radius:6px; font-size:12px; cursor:pointer;">
        <i class="fa-solid fa-rotate-left"></i> Batalkan Izin/Sakit
      </button>`;

    if (btnMasuk) btnMasuk.classList.add("hidden");
    if (btnKeluar) btnKeluar.classList.add("hidden");
    if (btnIzin) btnIzin.classList.add("hidden");
  } else {
    let textMasukColor = statusMasuk === "Sudah" ? "#198754" : "#d9534f";
    let textKeluarColor = statusKeluar === "Sudah" ? "#198754" : "#d9534f";
    let labelMasuk = statusMasuk === "Sudah" ? `Sudah (${jamMasuk || 'Terekam'})` : "Belum";
    let labelKeluar = statusKeluar === "Sudah" ? `Sudah (${jamKeluar || 'Terekam'})` : "Belum";

    infoStatusHTML = `Masuk: <span style="color: ${textMasukColor}; font-weight: bold;">${escapeHtml(labelMasuk)}</span> | Keluar: <span style="color: ${textKeluarColor}; font-weight: bold;">${escapeHtml(labelKeluar)}</span>`;

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
        <span id="textStatusAbsen" aria-live="polite"><i class="fa-solid fa-spinner fa-spin"></i> Menyinkronkan...</span>
      </div>
    </div>
  `;

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
        statusSpan.innerHTML = `<span style="color:#d9534f;"><i class="fa-solid fa-wifi"></i> Koneksi lambat / Terputus</span>`;
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
}
setInterval(updateClock, 1000);

// FORM & KAMERA
async function bukaForm(jenis) {
  if (window.AndroidBridge && typeof window.AndroidBridge.requestBssidUpdate === 'function') {
    window.AndroidBridge.requestBssidUpdate();
  }

  if (jenis === 'Masuk' || jenis === 'Keluar') {
    if (!isBssidValid()) {
      Swal.fire({
        icon: 'error',
        title: 'Akses Ditolak!',
        text: `Anda harus terhubung ke WiFi resmi sekolah untuk melakukan Absen ${jenis}. (BSSID Terdeteksi: ${bssidPengguna || 'Tidak Terdeteksi'})`,
        confirmButtonColor: '#dc3545'
      });
      return;
    }
  }

  if (jenis === 'Izin') {
    modePilihan = "Izin";
    document.getElementById('mainButtons').classList.add('hidden');
    document.getElementById('izinArea').classList.remove('hidden');
    return;
  }

  modePilihan = jenis;
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
  stopCamera();
  document.getElementById('cameraArea').classList.add('hidden');
  document.getElementById('izinArea').classList.add('hidden');
  document.getElementById('mainButtons').classList.remove('hidden');
  document.getElementById('status').innerText = "";
  
  const faceOverlay = document.getElementById('faceOverlay');
  if (faceOverlay) faceOverlay.className = "face-overlay";
}

async function loadFaceAPIModels() {
  if (modelsLoaded) return;
  if (typeof faceapi === 'undefined') {
    throw new Error("Library deteksi wajah belum tersedia.");
  }
  const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
  ]);
  modelsLoaded = true;
}

async function startCamera() {
  try {
    isLivenessPassed = false;
    isFaceVerified = false;
    livenessConfirmCount = 0;
    const btnKirim = document.getElementById('btnKirimAbsen');
    if (btnKirim) btnKirim.classList.add('hidden');

    const statusEl = document.getElementById('livenessStatus');
    const faceOverlay = document.getElementById('faceOverlay');
    
    if (faceOverlay) faceOverlay.className = "face-overlay";

    if (statusEl) {
      statusEl.innerText = "Memuat model deteksi...";
      statusEl.style.color = "blue";
    }

    await loadFaceAPIModels();

    if (statusEl) {
      statusEl.innerText = "Kamera aktif. Posisikan wajah Anda...";
      statusEl.style.color = "red";
    }

    if (!Array.isArray(currentUserData?.faceDescriptor) || currentUserData.faceDescriptor.length !== 128) {
      throw new Error("Descriptor wajah akun belum tersedia.");
    }

    streamRef = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    const videoEl = document.getElementById('video');
    videoEl.srcObject = streamRef;
    videoEl.onplay = () => {
      if (statusEl && btnKirim) jalankanLivenessDetection(videoEl, statusEl, btnKirim);
    };
  } catch (e) {
    const isMissingDescriptor = e.message === "Descriptor wajah akun belum tersedia.";
    Swal.fire({
      icon: 'error',
      title: isMissingDescriptor ? 'Wajah Belum Terdaftar' : 'Kamera Gagal',
      text: isMissingDescriptor
        ? 'Descriptor wajah akun belum tersedia. Hubungi administrator untuk mendaftarkan wajah Anda.'
        : 'Gagal membuka kamera atau memuat model deteksi wajah.',
      confirmButtonColor: '#dc3545'
    });
    batal();
  }
}

// LIVENESS DETECTION (NON-OVERLAPPING RECURSIVE LOOP)
async function jalankanLivenessDetection(videoEl, statusEl, btnKirim) {
  isDetectingFace = true;
  const faceOverlay = document.getElementById('faceOverlay');

  const detectFrame = async () => {
    if (!isDetectingFace || isLivenessPassed) return;

    try {
      const detections = await faceapi.detectAllFaces(videoEl, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceExpressions()
        .withFaceDescriptors();
      if (detections.length === 1) {
        const detection = detections[0];
        const faceDistance = faceapi.euclideanDistance(currentUserData.faceDescriptor, detection.descriptor);
        const isFaceMatched = faceDistance <= FACE_MATCH_THRESHOLD;

        if (!isFaceMatched) {
          livenessConfirmCount = 0;
          isFaceVerified = false;
          statusEl.innerText = "Wajah tidak sesuai dengan akun yang login.";
          statusEl.style.color = "#c84545";
          if (faceOverlay) faceOverlay.className = "face-overlay warning";
        } else if (detection.expressions.happy > 0.7) {
          livenessConfirmCount += 1;
          if (livenessConfirmCount >= LIVENESS_REQUIRED_FRAMES) {
            isLivenessPassed = true;
            isFaceVerified = true;
            isDetectingFace = false;
            statusEl.innerText = "Wajah terverifikasi. Liveness sukses, silakan lanjutkan absen.";
            statusEl.style.color = "green";
            if (faceOverlay) faceOverlay.className = "face-overlay success";
            btnKirim.classList.remove('hidden');
            return;
          }
          statusEl.innerText = "Senyum terdeteksi. Pertahankan senyum...";
          statusEl.style.color = "#ff9800";
          if (faceOverlay) faceOverlay.className = "face-overlay warning";
        } else {
          livenessConfirmCount = 0;
          statusEl.innerText = "Wajah terdeteksi. Silakan SENYUM LEBAR untuk absen!";
          statusEl.style.color = "#ff9800";
          if (faceOverlay) faceOverlay.className = "face-overlay warning";
        }
      } else if (detections.length > 1) {
        livenessConfirmCount = 0;
        statusEl.innerText = "Lebih dari satu wajah terdeteksi. Pastikan hanya satu orang di kamera.";
        statusEl.style.color = "#c84545";
        if (faceOverlay) faceOverlay.className = "face-overlay warning";
      } else {
        livenessConfirmCount = 0;
        statusEl.innerText = "Wajah TIDAK terdeteksi. Posisikan wajah ke kamera.";
        statusEl.style.color = "red";
        if (faceOverlay) faceOverlay.className = "face-overlay";
      }
    } catch (err) {
      console.error("Deteksi error:", err);
      isDetectingFace = false;
      livenessConfirmCount = 0;
      statusEl.innerText = "Deteksi wajah gagal. Silakan tutup lalu buka kamera kembali.";
      statusEl.style.color = "#c84545";
      btnKirim.classList.add('hidden');
      return;
    }

    if (isDetectingFace && !isLivenessPassed) {
      setTimeout(detectFrame, 200);
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

  if (!isBssidValid()) {
    Swal.fire({
      icon: 'error',
      title: 'Akses Ditolak!',
      text: `Router WiFi tidak terdaftar sebagai milik sekolah atau koneksi terputus. (MAC Detected: ${bssidPengguna || 'Tidak Terdeteksi'})`,
      confirmButtonColor: '#dc3545'
    });
    batal();
    return;
  }

  isSubmitting = true;
  setSubmitButtonState(true);

  showLoading("Mendapatkan lokasi GPS...");
  setProcessStatus("Mendapatkan lokasi GPS...");
  document.getElementById('status').style.color = "blue";

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
    btn.style.opacity = disabled ? "0.5" : "1";
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
    const c = document.getElementById('canvas');

    const maxWidth = 640;
    const scale = maxWidth / v.videoWidth;
    c.width = maxWidth;
    c.height = v.videoHeight * scale;

    const ctx = c.getContext('2d');
    ctx.drawImage(v, 0, 0, c.width, c.height);
    fotoBase64 = c.toDataURL('image/jpeg', 0.6);
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
