// === KONFIGURASI UTAMA ===
const GAS_URL = "https://script.google.com/macros/s/AKfycbz7icYUkFrdgZO2kA82WsvoXOG2kisOUBBq7Txvq31k_tC-a7Dv3vOKc55KgbvaRpL9/exec"; // Ganti dengan URL Web App Apps Script Anda
const SECRET_TOKEN = "ErangaT0ken_2026";

const SCHOOL_LAT = -8.670458;  
const SCHOOL_LNG = 115.212629; 
const MAX_RADIUS = 50; // Meter

const DAFTAR_BSSID_SEKOLAH = [
    "00:1a:2b:3c:4d:5e",
    "11:22:33:44:55:66"
];

let bssidSiswa = "";
let streamRef = null;
let modePilihan = "";
let currentUserData = null;

function terimaDataWiFiFromAndroid(ssid, bssid) {
    bssidSiswa = bssid.replace(/"/g, "").trim().toLowerCase();
}

// --- PERSISTENT LOGIN (LocalStorage & Cookie) ---
function simpanSesi(userData) {
    localStorage.setItem("session_user", JSON.stringify(userData));
    document.cookie = "user_session=" + encodeURIComponent(JSON.stringify(userData)) + "; max-age=" + (365*24*60*60) + "; path=/; Secure; SameSite=Strict";
}

function ambilSesi() {
    let localData = localStorage.getItem("session_user");
    if (localData) {
        try { return JSON.parse(localData); } catch(e) { return null; }
    }
    let name = "user_session=";
    let decodedCookie = decodeURIComponent(document.cookie);
    let ca = decodedCookie.split(';');
    for(let i = 0; i < ca.length; i++) {
        let c = ca[i].trim();
        if (c.indexOf(name) == 0) {
            try { return JSON.parse(c.substring(name.length, c.length)); } catch(e) { return null; }
        }
    }
    return null;
}

function hapusSesi() {
    localStorage.removeItem("session_user");
    document.cookie = "user_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
}

window.onload = function() {
    const savedUser = ambilSesi();
    if(savedUser) {
        currentUserData = savedUser;
        showDashboard(currentUserData.nama);
    }
}

document.getElementById('togglePassword').onclick = function() {
    let p = document.getElementById('password');
    p.type = p.type === 'password' ? 'text' : 'password';
    this.querySelector('i').className = p.type === 'password' ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
};

function login() {
    let u = document.getElementById('username').value.trim();
    let p = document.getElementById('password').value.trim();
    
    if(!u || !p) {
        document.getElementById('loginMsg').innerText = "Isi username & password!";
        return;
    }

    document.getElementById('loginMsg').innerText = "Memverifikasi login...";

    const payload = {
        token: SECRET_TOKEN,
        action: "login",
        username: u,
        password: p
    };

    fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify(payload)
    })
    .then(r => r.json())
    .then(res => {
        if(res.status === "success") {
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

function getHariIndonesia(date) {
    const hariArray = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    return hariArray[date.getDay()];
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
    
    const statusSimpanKey = `status_absen_${currentUserData.username}_${tanggalHariIni}`;
    let statusHariIni = localStorage.getItem(statusSimpanKey) || "Belum Absen";
    let warnaStatus = statusHariIni === "Belum Absen" ? "#d9534f" : "#198754";

    document.getElementById('userInfo').innerHTML = `
        <b>Hari / Tanggal:</b> ${namaHari}, ${tanggalHariIni}<br>
        <b>Nama:</b> ${currentUserData.nama}<br>
        <b>NUPTK:</b> ${currentUserData.nuptk}<br>
        <b>Jabatan:</b> ${currentUserData.jabatan}<br>
        <b>Status Hari Ini:</b> <span id="textStatusAbsen" style="color: ${warnaStatus}; font-weight: bold;">${statusHariIni}</span>
    `;
}

function updateClock() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const wita = new Date(utc + (3600000 * 8));
    document.getElementById('clock').innerText = 
        `${String(wita.getHours()).padStart(2,'0')}:${String(wita.getMinutes()).padStart(2,'0')}:${String(wita.getSeconds()).padStart(2,'0')} WITA`;
}
setInterval(updateClock, 1000);

function bukaForm(jenis) {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const wita = new Date(utc + (3600000 * 8));
    const hari = wita.getDay();
    const menitTotal = (wita.getHours() * 60) + wita.getMinutes();

    if (hari === 0 || hari === 6) {
        alert("Absensi hanya hari Senin - Jumat.");
        return;
    }
    if (menitTotal < (6 * 60 + 30) || menitTotal > (23 * 60 + 59)) {
        alert("Absensi dibuka jam 06.30 - 23.59 WITA.");
        return;
    }

    modePilihan = jenis;
    document.getElementById('mainButtons').classList.add('hidden');
    
    if(jenis === 'Masuk' || jenis === 'Keluar') {
        document.getElementById('menuTitle').innerText = "Foto Absen " + jenis;
        document.getElementById('cameraArea').classList.remove('hidden');
        startCamera();
    } else {
        document.getElementById('izinArea').classList.remove('hidden');
    }
}

function batal() {
    stopCamera();
    document.getElementById('cameraArea').classList.add('hidden');
    document.getElementById('izinArea').classList.add('hidden');
    document.getElementById('mainButtons').classList.remove('hidden');
    document.getElementById('status').innerText = "";
}

async function startCamera() {
    try {
        streamRef = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        document.getElementById('video').srcObject = streamRef;
    } catch (e) {
        alert("Gagal membuka kamera.");
        batal();
    }
}

function stopCamera() {
    if(streamRef) streamRef.getTracks().forEach(t => t.stop());
}

function eksekusiAbsen() {
    if (!bssidSiswa || !DAFTAR_BSSID_SEKOLAH.includes(bssidSiswa)) {
        alert(`Akses Ditolak!\nRouter WiFi tidak terdaftar sebagai milik sekolah.\n(MAC Detected: ${bssidSiswa || 'Tidak Terdeteksi'})`);
        return;
    }

    document.getElementById('status').innerText = "Mengecek GPS...";
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
    if(!ket) { alert("Isi keterangan izin!"); return; }

    document.getElementById('status').innerText = "Mengambil GPS...";
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => kirim(pos, false), () => alert("Gagal mengambil GPS."));
    }
}

function hitungJarak(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const p1 = lat1 * Math.PI/180, p2 = lat2 * Math.PI/180;
    const dp = (lat2-lat1) * Math.PI/180, dl = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function kirim(pos, adaFoto) {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const akurasi = pos.coords.accuracy;

    if (adaFoto) {
        if (akurasi > 50) {
            alert(`Sinyal GPS lemah (${Math.round(akurasi)}m). Silakan pindah ke area terbuka.`);
            return;
        }
        const jarak = hitungJarak(lat, lng, SCHOOL_LAT, SCHOOL_LNG);
        if (jarak > MAX_RADIUS) {
            alert(`Di luar area sekolah! Jarak Anda: ${Math.round(jarak)}m dari lokasi.`);
            return;
        }
    }

    document.getElementById('status').innerText = "Mengunggah foto & menyimpan data...";

    let fotoBase64 = "";
    if (adaFoto) {
        const v = document.getElementById('video');
        const c = document.getElementById('canvas');
        c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        fotoBase64 = c.toDataURL('image/jpeg', 0.6);
    }

    const payload = {
        token: SECRET_TOKEN,
        action: "absen",
        username: currentUserData.username,
        namaLengkap: currentUserData.nama,
        nuptk: currentUserData.nuptk,
        jenisKelamin: currentUserData.jenisKelamin,
        jabatan: currentUserData.jabatan,
        jenis: adaFoto ? modePilihan : document.getElementById('jenisIzin').value,
        latitude: lat,
        longitude: lng,
        keterangan: adaFoto ? "" : document.getElementById('keteranganIzin').value,
        photo: fotoBase64
    };

    fetch(GAS_URL, { method: 'POST', body: JSON.stringify(payload) })
    .then(r => r.json())
    .then(res => {
        if(res.status === "success") {
            alert("Absen Berhasil Dicatat!");

            const now = new Date();
            const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
            const wita = new Date(utc + (3600000 * 8));
            const tglHariIni = wita.toISOString().split('T')[0];
            const statusKey = `status_absen_${currentUserData.username}_${tglHariIni}`;
            
            let statusTerbaru = adaFoto ? `Sudah Absen (${modePilihan})` : document.getElementById('jenisIzin').value;
            localStorage.setItem(statusKey, statusTerbaru);

            const statusEl = document.getElementById('textStatusAbsen');
            if(statusEl) {
                statusEl.innerText = statusTerbaru;
                statusEl.style.color = "#198754";
            }

            batal();
        } else {
            alert("Error: " + res.message);
        }
    })
    .catch(() => alert("Gagal koneksi server."));
}
