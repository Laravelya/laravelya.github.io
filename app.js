// CONFIG
const GAS_URL = "https://script.google.com/macros/s/AKfycbwYEFsmJm4hj0572k8GVpQi0cUOWDPgHwaRK9qeLQ50oyqcIWD4As8Wgp1p9EMazEZY-g/exec";
const SECRET_TOKEN = "ErangaT0ken_2026";
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
let faceDetectInterval = null;
let isSubmitting = false; // Penjaga Double Submit

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
      alert(`Peringatan: Jaringan WiFi Anda berubah!\n(Dari: ${lastBssid} ke: ${bssidPengguna})\nPastikan tetap terhubung ke WiFi resmi sekolah.`);
    }
  }
}

// SESSION MANAGEMENT
function simpanSesi(userData) {
  localStorage.setItem("session_user", JSON.stringify(userData));
  document.cookie = "user_session=" + encodeURIComponent(JSON.stringify(userData)) + "; max-age=" + (365*24*60*60) + "; path=/; Secure; SameSite=Strict";
}

function ambilSesi() {
  let sessionLocal = localStorage.getItem("session_user");
  if (sessionLocal) {
    try { return JSON.parse(sessionLocal); } catch (e) { return null; }
  }

  let cookies = decodeURIComponent(document.cookie).split(';');
  for (let i = 0; i < cookies.length; i++) {
    let c = cookies[i].trim();
    if (c.indexOf("user_session=") === 0) {
      try { return JSON.parse(c.substring("user_session=".length)); } catch (e) { return null; }
    }
  }
  return null;
}

function hapusSesi() {
  localStorage.removeItem("session_user");
  document.cookie = "user_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
}

// CEK KONEKSI INTERNET & SW
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

// SINGLE INIT POINT
window.onload = async function() {
  cekKoneksiInternet();
  if (!navigator.onLine) return;

  await loadFaceAPIModels();
  const savedUser = ambilSesi();
  if (savedUser) {
    currentUserData = savedUser;
    showDashboard(currentUserData.nama);
  }
};

document.getElementById('togglePassword').onclick = function() {
  let p = document.getElementById('password');
  p.type = p.type === 'password' ? 'text' : 'password';
  this.querySelector('i').className = p.type === 'password' ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
};

// LOGIN
function login() {
  let u = document.getElementById('username').value.trim();
  let p = document.getElementById('password').value.trim();
  if (!u || !p) {
    document.getElementById('loginMsg').innerText = "Isi username & password!";
    return;
  }

  document.getElementById('loginMsg').innerText = "Memverifikasi login...";

  fetch(GAS_URL, {
    method: 'POST',
    body: JSON.stringify({ token: SECRET_TOKEN, action: "login", username: u, password: p })
  })
  .then(r => r.json())
  .then(res => {
    if (res.status === "success") {
      currentUserData = res.user;
      simpanSesi(currentUserData);
      showDashboard(currentUserData.nama);
    } else {
      document.getElementById('loginMsg').innerText = res.message;
    }
  })
  .catch(() => {
    document.getElementById('loginMsg').innerText = "Gagal terhubung ke server.";
  });
}

function logout() {
  hapusSesi();
  location.reload();
}

// DASHBOARD & DINAMIS TOMBOL
function getHariIndonesia(date) {
  const hariArray = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  return hariArray[date.getDay()];
}

async function showDashboard(nama) {
  document.getElementById('loginSection').classList.add('hidden');
  document.getElementById('dashboardSection').classList.remove('hidden');
  document.getElementById('displayUser').innerText = nama;

  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const wita = new Date(utc + (3600000 * 8));
  const namaHari = getHariIndonesia(wita);
  const tanggalHariIni = wita.toISOString().split('T')[0];

  document.getElementById('userInfo').innerHTML = `
    <b>Hari / Tanggal:</b> ${namaHari}, ${tanggalHariIni} WITA<br>
    <b>Nama:</b> ${currentUserData.nama}<br>
    <b>NUPTK:</b> ${currentUserData.nuptk}<br>
    <b>Jabatan:</b> ${currentUserData.jabatan}<br>
    <b>Status Hari Ini:</b> <span style="color: #6c757d;">Memeriksa status server...</span>
  `;

  let statusMasuk = "Belum", jamMasuk = "";
  let statusKeluar = "Belum", jamKeluar = "";
  let statusIzin = null;

  try {
    const response = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ token: SECRET_TOKEN, action: "cek_status", username: currentUserData.username })
    });
    const res = await response.json();
    if (res.status === "success") {
      statusMasuk = res.statusMasuk;
      jamMasuk = res.jamMasuk || "";
      statusKeluar = res.statusKeluar;
      jamKeluar = res.jamKeluar || "";
      statusIzin = res.statusIzin;
    }
  } catch (e) {
    console.error("Gagal sinkronisasi status dari server:", e);
  }

  let infoStatusHTML = "";
  const btnMasuk = document.querySelector("button[onclick*=\"bukaForm('Masuk')\"]");
  const btnKeluar = document.querySelector("button[onclick*=\"bukaForm('Keluar')\"]");
  const btnIzin = document.querySelector("button[onclick*=\"bukaForm('Izin')\"]");

  if (statusIzin) {
    infoStatusHTML = `<span style="color: #ffc107; font-weight: bold;">${statusIzin} (Izin Aktif)</span><br>
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

    infoStatusHTML = `Masuk: <span style="color: ${textMasukColor}; font-weight: bold;">${labelMasuk}</span> | Keluar: <span style="color: ${textKeluarColor}; font-weight: bold;">${labelKeluar}</span>`;

    // ALUR TAMPILAN HIDDEN/SHOW TOMBOL
    if (statusMasuk === "Belum") {
      if (btnMasuk) btnMasuk.classList.remove("hidden");
      if (btnKeluar) btnKeluar.classList.add("hidden"); // Sembunyikan Keluar sebelum Masuk
      if (btnIzin) btnIzin.classList.remove("hidden");
    } else if (statusMasuk === "Sudah" && statusKeluar === "Belum") {
      if (btnMasuk) btnMasuk.classList.add("hidden");
      if (btnKeluar) btnKeluar.classList.remove("hidden"); // Tampilkan Keluar setelah Masuk
      if (btnIzin) btnIzin.classList.add("hidden");
    } else {
      if (btnMasuk) btnMasuk.classList.add("hidden");
      if (btnKeluar) btnKeluar.classList.add("hidden");
      if (btnIzin) btnIzin.classList.add("hidden");
    }
  }

  document.getElementById('userInfo').innerHTML = `
    <b>Hari / Tanggal:</b> ${namaHari}, ${tanggalHariIni} WITA<br>
    <b>Nama:</b> ${currentUserData.nama}<br>
    <b>NUPTK:</b> ${currentUserData.nuptk}<br>
    <b>Jabatan:</b> ${currentUserData.jabatan}<br>
    <b>Status Hari Ini:</b> <span id="textStatusAbsen">${infoStatusHTML}</span>
  `;
}

function batalkanIzin() {
  if (confirm("Apakah Anda yakin ingin membatalkan permohonan Izin / Sakit ini?")) {
    fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({
        token: SECRET_TOKEN,
        action: "batal_izin",
        username: currentUserData.username
      })
    })
    .then(r => r.json())
    .then(res => {
      if (res.status === "success") {
        showDashboard(currentUserData.nama);
        alert("Permohonan Izin / Sakit berhasil dibatalkan.");
      } else {
        alert("Gagal mencatat pembatalan ke server: " + res.message);
      }
    })
    .catch(() => alert("Gagal koneksi ke server."));
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
function bukaForm(jenis) {
  if (window.AndroidBridge && typeof window.AndroidBridge.requestBssidUpdate === 'function') {
    window.AndroidBridge.requestBssidUpdate();
  }

  if (jenis === 'Masuk' || jenis === 'Keluar') {
    if (!isBssidValid()) {
      alert(`Akses Ditolak!\nAnda harus terhubung ke WiFi resmi sekolah untuk melakukan Absen ${jenis}.\n\n(BSSID Terdeteksi: ${bssidPengguna || 'Tidak Terdeteksi'})`);
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
  if (jenis === 'Masuk' || jenis === 'Keluar') {
    document.getElementById('menuTitle').innerText = "Foto Absen " + jenis;
    document.getElementById('cameraArea').classList.remove('hidden');
    startCamera();
  }
}

function batal() {
  if (faceDetectInterval) clearInterval(faceDetectInterval);
  stopCamera();
  document.getElementById('cameraArea').classList.add('hidden');
  document.getElementById('izinArea').classList.add('hidden');
  document.getElementById('mainButtons').classList.remove('hidden');
  document.getElementById('status').innerText = "";
}

async function startCamera() {
  try {
    isLivenessPassed = false;
    const btnKirim = document.getElementById('btnKirimAbsen');
    if (btnKirim) btnKirim.classList.add('hidden');

    const statusEl = document.getElementById('livenessStatus');
    if (statusEl) {
      statusEl.innerText = "Kamera aktif. Posisikan wajah Anda...";
      statusEl.style.color = "red";
    }

    streamRef = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    const videoEl = document.getElementById('video');
    videoEl.srcObject = streamRef;
    videoEl.onplay = () => {
      if (statusEl && btnKirim) jalankanLivenessDetection(videoEl, statusEl, btnKirim);
    };
  } catch (e) {
    alert("Gagal membuka kamera.");
    batal();
  }
}

function jalankanLivenessDetection(videoEl, statusEl, btnKirim) {
  if (faceDetectInterval) clearInterval(faceDetectInterval);

  faceDetectInterval = setInterval(async () => {
    if (isLivenessPassed) {
      clearInterval(faceDetectInterval);
      return;
    }

    const detection = await faceapi.detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions()).withFaceExpressions();
    if (detection) {
      if (detection.expressions.happy > 0.7) {
        isLivenessPassed = true;
        statusEl.innerText = "Liveness Test Sukses! Silakan Lanjutkan Absen.";
        statusEl.style.color = "green";
        btnKirim.classList.remove('hidden');
        clearInterval(faceDetectInterval);
      } else {
        statusEl.innerText = "Wajah terdeteksi. Silakan SENYUM LEBAR untuk absen!";
        statusEl.style.color = "#ff9800";
      }
    } else {
      statusEl.innerText = "Wajah TIDAK terdeteksi. Posisikan wajah ke kamera.";
      statusEl.style.color = "red";
    }
  }, 500);
}

function stopCamera() {
  if (streamRef) streamRef.getTracks().forEach(t => t.stop());
}

async function loadFaceAPIModels() {
  const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
  await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
  await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);
}

// EKSEKUSI & RESIZE FOTO (MENGHINDARI SLOW/TIMEOUT)
function eksekusiAbsen() {
  if (!isBssidValid()) {
    alert(`Akses Ditolak!\nRouter WiFi tidak terdaftar sebagai milik sekolah atau koneksi terputus.\n(MAC Detected: ${bssidPengguna || 'Tidak Terdeteksi'})`);
    batal();
    return;
  }

  document.getElementById('status').innerText = "Mendapatkan lokasi GPS...";
  document.getElementById('status').style.color = "blue";

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => kirim(pos, true),
      () => alert("Gagal mengambil GPS. Pastikan GPS HP Aktif!"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }
}

function eksekusiIzin() {
  let ket = document.getElementById('keteranganIzin').value.trim();
  if (!ket) return alert("Isi keterangan izin!");

  document.getElementById('status').innerText = "Mengirim izin...";
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => kirim(pos, false), () => alert("Gagal mengambil GPS."));
  }
}

function kirim(pos, adaFoto) {
  if (!currentUserData || !currentUserData.username) {
    alert("Sesi Anda tidak valid. Silakan login ulang!");
    logout();
    return;
  }

  // PREVENT DOUBLE SUBMIT
  if (isSubmitting) return;
  isSubmitting = true;

  const btnKirim = document.getElementById('btnKirimAbsen');
  if (btnKirim) {
    btnKirim.disabled = true;
    btnKirim.innerText = "MEMPROSES...";
    btnKirim.style.opacity = "0.5";
  }

  document.getElementById('status').innerText = "Mengunggah foto & memvalidasi data ke server...";

  let fotoBase64 = "";
  if (adaFoto) {
    const v = document.getElementById('video');
    const c = document.getElementById('canvas');

    // RESIZE FOTO KE MAX WIDTH 640PX (2MB -> ~60KB)
    const maxWidth = 640;
    const scale = maxWidth / v.videoWidth;
    c.width = maxWidth;
    c.height = v.videoHeight * scale;

    const ctx = c.getContext('2d');
    ctx.drawImage(v, 0, 0, c.width, c.height);
    fotoBase64 = c.toDataURL('image/jpeg', 0.6);
  }

  const payload = {
    token: SECRET_TOKEN,
    action: "absen",
    username: currentUserData.username,
    jenis: adaFoto ? modePilihan : document.getElementById('jenisIzin').value,
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    keterangan: adaFoto ? "" : document.getElementById('keteranganIzin').value,
    photo: fotoBase64
  };

  fetch(GAS_URL, { method: 'POST', body: JSON.stringify(payload) })
  .then(r => r.json())
  .then(res => {
    if (res.status === "success") {
      alert("Berhasil: " + res.message);
      showDashboard(currentUserData.nama);
      batal();
    } else {
      alert("Ditolak Server: " + res.message);
      document.getElementById('status').innerText = "";
    }
  })
  .catch(() => {
    alert("Gagal koneksi ke server.");
    document.getElementById('status').innerText = "";
  })
  .finally(() => {
    isSubmitting = false;
    if (btnKirim) {
      btnKirim.disabled = false;
      btnKirim.innerText = "KIRIM ABSEN";
      btnKirim.style.opacity = "1";
    }
  });
}
