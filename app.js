// === KONFIGURASI UTAMA ===
const GAS_URL = "https://script.google.com/macros/s/AKfycbz7icYUkFrdgZO2kA82WsvoXOG2kisOUBBq7Txvq31k_tC-a7Dv3vOKc55KgbvaRpL9/exec"; // Ganti dengan URL Web App Apps Script Anda
const SECRET_TOKEN = "ErangaT0ken_2026";

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

// --- PERSISTENT LOGIN ---
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

    fetch(GAS_URL, { method: 'POST', body: JSON.stringify(payload) })
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
    
    const keyMasuk = `status_masuk_${currentUserData.username}_${tanggalHariIni}`;
    const keyKeluar = `status_keluar_${currentUserData.username}_${tanggalHariIni}`;
    const keyIzin = `status_izin_${currentUserData.username}_${tanggalHariIni}`;
    
    let statusMasuk = localStorage.getItem(keyMasuk) || "Belum";
    let statusKeluar = localStorage.getItem(keyKeluar) || "Belum";
    let statusIzin = localStorage.getItem(keyIzin);

    let infoStatusHTML = "";
    
    // Ambil referensi semua tombol menu utama
    const btnMasuk = document.querySelector("button[onclick*=\"bukaForm('Masuk')\"]");
    const btnKeluar = document.querySelector("button[onclick*=\"bukaForm('Keluar')\"]");
    const btnIzin = document.querySelector("button[onclick*=\"bukaForm('Izin')\"]");

    if (statusIzin) {
        // Jika sudah izin/sakit, tampilkan status izin + Tombol Batal Izin
        infoStatusHTML = `<span style="color: #ffc107; font-weight: bold;">${statusIzin} (Izin Aktif)</span><br><button onclick="batalkanIzin()" style="margin-top:8px; padding:6px 12px; background-color:#dc3545; color:white; border:none; border-radius:6px; font-size:12px; cursor:pointer;"><i class="fa-solid fa-rotate-left"></i> Batalkan Izin/Sakit</button>`;
        
        // Matikan tombol Masuk, Keluar, dan Izin/Sakit
        if (btnMasuk) { btnMasuk.disabled = true; btnMasuk.style.opacity = "0.5"; btnMasuk.style.cursor = "not-allowed"; }
        if (btnKeluar) { btnKeluar.disabled = true; btnKeluar.style.opacity = "0.5"; btnKeluar.style.cursor = "not-allowed"; }
        if (btnIzin) { btnIzin.disabled = true; btnIzin.style.opacity = "0.5"; btnIzin.style.cursor = "not-allowed"; }
    } else {
        let textMasukColor = statusMasuk === "Sudah" ? "#198754" : "#d9534f";
        let textKeluarColor = statusKeluar === "Sudah" ? "#198754" : "#d9534f";
        
        infoStatusHTML = `Masuk: <span style="color: ${textMasukColor}; font-weight: bold;">${statusMasuk}</span> | Keluar: <span style="color: ${textKeluarColor}; font-weight: bold;">${statusKeluar}</span>`;
        
        // Aktifkan kembali semua tombol jika tidak sedang izin
        if (btnMasuk) { btnMasuk.disabled = false; btnMasuk.style.opacity = "1"; btnMasuk.style.cursor = "pointer"; }
        if (btnKeluar) { btnKeluar.disabled = false; btnKeluar.style.opacity = "1"; btnKeluar.style.cursor = "pointer"; }
        if (btnIzin) { btnIzin.disabled = false; btnIzin.style.opacity = "1"; btnIzin.style.cursor = "pointer"; }
    }

    document.getElementById('userInfo').innerHTML = `
        <b>Hari / Tanggal:</b> ${namaHari}, ${tanggalHariIni} WITA<br>
        <b>Nama:</b> ${currentUserData.nama}<br>
        <b>NUPTK:</b> ${currentUserData.nuptk}<br>
        <b>Jabatan:</b> ${currentUserData.jabatan}<br>
        <b>Status Hari Ini:</b> <span id="textStatusAbsen">${infoStatusHTML}</span>
    `;
}

// Fungsi Baru untuk Membatalkan Izin / Sakit (Dengan Logging ke Server)
function batalkanIzin() {
    if (confirm("Apakah Anda yakin ingin membatalkan permohonan Izin / Sakit ini? Tombol Absen Masuk dan Keluar akan diaktifkan kembali.")) {
        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const wita = new Date(utc + (3600000 * 8));
        const tanggalHariIni = wita.toISOString().split('T')[0];
        
        const keyIzin = `status_izin_${currentUserData.username}_${tanggalHariIni}`;

        const payload = {
            token: SECRET_TOKEN,
            action: "batal_izin",
            username: currentUserData.username,
            namaLengkap: currentUserData.nama,
            nuptk: currentUserData.nuptk,
            jenisKelamin: currentUserData.jenisKelamin,
            jabatan: currentUserData.jabatan
        };

        fetch(GAS_URL, { method: 'POST', body: JSON.stringify(payload) })
        .then(r => r.json())
        .then(res => {
            if(res.status === "success") {
                // Hapus status izin dari localStorage
                localStorage.removeItem(keyIzin);

                // Refresh tampilan dashboard
                showDashboard(currentUserData.username);
                alert("Permohonan Izin / Sakit berhasil dibatalkan dan dicatat ke sistem.");
            } else {
                alert("Gagal mencatat pembatalan ke server: " + res.message);
            }
        })
        .catch(() => {
            alert("Gagal koneksi ke server.");
        });
    }
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
    if (jenis === 'Izin') {
        modePilihan = "Izin";
        document.getElementById('mainButtons').classList.add('hidden');
        document.getElementById('izinArea').classList.remove('hidden');
        return;
    }

    modePilihan = jenis;
    document.getElementById('mainButtons').classList.add('hidden');
    
    if(jenis === 'Masuk' || jenis === 'Keluar') {
        document.getElementById('menuTitle').innerText = "Foto Absen " + jenis;
        document.getElementById('cameraArea').classList.remove('hidden');
        startCamera();
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
    if(!ket) { alert("Isi keterangan izin!"); return; }

    document.getElementById('status').innerText = "Mengirim izin...";
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => kirim(pos, false), () => alert("Gagal mengambil GPS."));
    }
}

function kirim(pos, adaFoto) {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;

    document.getElementById('status').innerText = "Mengunggah foto & memvalidasi data ke server...";

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
            alert("Berhasil: " + res.message);

            const now = new Date();
            const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
            const wita = new Date(utc + (3600000 * 8));
            const tglHariIni = wita.toISOString().split('T')[0];

            if (adaFoto) {
                if (modePilihan === "Masuk") {
                    localStorage.setItem(`status_masuk_${currentUserData.username}_${tglHariIni}`, "Sudah");
                } else if (modePilihan === "Keluar") {
                    localStorage.setItem(`status_keluar_${currentUserData.username}_${tglHariIni}`, "Sudah");
                }
            } else {
                let jenisIzinVal = document.getElementById('jenisIzin').value;
                localStorage.setItem(`status_izin_${currentUserData.username}_${tglHariIni}`, jenisIzinVal);
            }

            showDashboard(currentUserData.username);
            batal();
        } else {
            alert("Ditolak Server: " + res.message);
            document.getElementById('status').innerText = "";
        }
    })
    .catch(() => {
        alert("Gagal koneksi ke server.");
        document.getElementById('status').innerText = "";
    });
}
