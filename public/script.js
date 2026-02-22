const audio = document.getElementById('audio-source');
// UI Elements
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('search-results');
const loadingDiv = document.getElementById('search-loading');
const libraryList = document.getElementById('library-list');

// Player Elements
const miniPlayer = document.getElementById('bottom-player');
const fullPlayer = document.getElementById('full-player');
const miniProgress = document.getElementById('mini-progress');
const mainSlider = document.getElementById('main-slider');

// State
let isPlaying = false;
let currentMeta = null;
let currentPlaylistSongs = []; 
let isDraggingSlider = false;

// ========== FITUR BARU: Volume Control ==========
let previousVolume = 80;
let isMuted = false;

// ========== FITUR BARU: Shuffle & Repeat ==========
let shuffleMode = false;
let repeatMode = 'none'; // 'none', 'all', 'one'
let originalPlaylist = [];

// ========== FITUR BARU: Offline Download ==========
let offlineSongs = [];

// ========== FITUR BARU: History ==========
const MAX_HISTORY = 50;

// ========== FITUR BARU: Toast Notifications ==========

// --- INITIALIZATION (DITINGKATKAN) ---
window.onload = () => {
    loadLibrary();
    loadOfflineSongs();
    loadVolumeSettings();
    
    // Tambahkan event listener ke icon gear
    const gearIcon = document.querySelector('.fa-gear');
    if (gearIcon) {
        gearIcon.addEventListener('click', function() {
            switchTab('developer');
        });
    }
    
    // Tambahkan ke icon bell
    const bellIcon = document.querySelector('.fa-bell');
    if (bellIcon) {
        bellIcon.addEventListener('click', function() {
            showToast('Tidak ada notifikasi baru', 'info');
        });
    }
    
    // FITUR BARU: History icon sekarang berfungsi
    const historyIcon = document.querySelector('.fa-clock-rotate-left');
    if (historyIcon) {
        historyIcon.addEventListener('click', function() {
            showHistory();
        });
    }
    
    // Setup audio listeners tambahan
    setupAudioListeners();
    
    // Cek koneksi
    if (!navigator.onLine) {
        showToast('Anda sedang offline', 'warning');
        document.body.classList.add('offline-mode');
    }
};

// ========== FITUR BARU: Audio Listeners Tambahan ==========
function setupAudioListeners() {
    audio.addEventListener('volumechange', () => {
        const volumeIcon = document.getElementById('volume-icon');
        if (volumeIcon) {
            if (audio.volume === 0) {
                volumeIcon.className = 'fa-solid fa-volume-off';
            } else if (audio.volume < 0.5) {
                volumeIcon.className = 'fa-solid fa-volume-low';
            } else {
                volumeIcon.className = 'fa-solid fa-volume-high';
            }
        }
    });
}

// ========== FITUR BARU: Toast Notification ==========
function showToast(message, type = 'info') {
    // Hapus toast yang sudah ada
    const existingToast = document.querySelector('.toast-container');
    if (existingToast) existingToast.remove();
    
    const toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <i class="fa-solid ${type === 'error' ? 'fa-circle-exclamation' : type === 'success' ? 'fa-circle-check' : 'fa-circle-info'}"></i>
        <span>${message}</span>
    `;
    
    toastContainer.appendChild(toast);
    document.body.appendChild(toastContainer);
    
    setTimeout(() => {
        toast.classList.add('toast-hide');
        setTimeout(() => toastContainer.remove(), 300);
    }, 3000);
}

// --- NAVIGASI (TIDAK BERUBAH) ---
function switchTab(tabName) {
    let targetId;
    if (tabName === 'playlist-detail') {
        targetId = 'view-playlist-detail';
    } else if (tabName === 'developer') {
        targetId = 'view-developer';
    } else {
        targetId = `view-${tabName}`;
    }
    
    const targetView = document.getElementById(targetId);

    document.querySelectorAll('.page-view').forEach(el => {
        if(el.id !== targetId) {
            el.style.display = 'none';
            el.classList.remove('active');
        }
    });

    if(targetView) {
        targetView.style.display = 'block';
        targetView.classList.add('active');
    }
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    
    const navItems = ['home', 'search', 'library', 'developer'];
    const navIndex = navItems.indexOf(tabName);
    
    if(navIndex !== -1 && document.querySelectorAll('.nav-item')[navIndex]) {
        document.querySelectorAll('.nav-item')[navIndex].classList.add('active');
    }
}

// --- SEARCH LOGIC (TIDAK BERUBAH) ---
let debounceTimer;
searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        if(e.target.value.length > 2) performSearch(e.target.value);
    }, 800);
});

function quickSearch(term) {
    switchTab('search');
    searchInput.value = term;
    performSearch(term);
}

async function performSearch(query) {
    loadingDiv.style.display = 'block';
    searchResults.innerHTML = '';
    
    try {
        const res = await fetch(`/api/index?url=${encodeURIComponent(query)}&mode=search`);
        const data = await res.json();
        
        loadingDiv.style.display = 'none';

        if (data.songs && data.songs.length > 0) {
            data.songs.forEach(song => {
                const item = document.createElement('div');
                item.className = 'result-item';
                item.innerHTML = `
                    <img src="${song.thumbnail}" alt="art" onerror="this.src='https://cdn.odzre.my.id/aax.jpg'">
                    <div class="result-info">
                        <h4>${escapeHtml(song.title)}</h4>
                        <p>${escapeHtml(song.artist)}</p>
                    </div>
                    <i class="fa-solid fa-play" style="color:var(--green)"></i>
                `;
                item.onclick = () => {
                    currentPlaylistSongs = data.songs; // Simpan seluruh hasil search
                    originalPlaylist = [...data.songs]; // Untuk shuffle
                    playMusic({
                        url: song.url,
                        title: song.title,
                        artist: song.artist,
                        cover: song.thumbnail
                    });
                };
                searchResults.appendChild(item);
            });
        } else {
            searchResults.innerHTML = '<div style="text-align:center; padding:20px;">Lagu tidak ditemukan.</div>';
        }
    } catch (e) {
        loadingDiv.style.display = 'none';
        searchResults.innerHTML = '<div style="text-align:center; padding:20px;">Error koneksi.</div>';
        showToast('Gagal mencari: ' + e.message, 'error');
    }
}

// ========== FITUR BARU: Escape HTML ==========
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- PLAYER LOGIC (DITINGKATKAN) ---
async function playMusic(songData) {
    currentMeta = songData;
    updateUI(currentMeta);
    
    document.getElementById('mini-play-btn').className = 'fa-solid fa-spinner fa-spin';
    document.getElementById('full-play-icon').className = 'fa-solid fa-spinner fa-spin';

    try {
        // Cek offline dulu
        if (!navigator.onLine) {
            const offlineSong = offlineSongs.find(s => s.url === songData.url);
            if (offlineSong) {
                audio.src = offlineSong.audioData;
                await audio.play();
                isPlaying = true;
                updatePlayIcons();
                showToast('Memutar offline', 'success');
                return;
            } else {
                showToast('Tidak ada koneksi internet', 'error');
                return;
            }
        }
        
        const streamUrl = `/api/index?url=${encodeURIComponent(songData.url)}&mode=stream`;
        audio.src = streamUrl;
        audio.preload = "auto";
        await audio.play();
        
        isPlaying = true;
        updatePlayIcons();
        
        // FITUR BARU: Simpan ke history
        saveToHistory(songData);
        
        // FITUR BARU: Update offline indicator
        updateOfflineIndicator();

    } catch (e) {
        console.error(e);
        isPlaying = false;
        updatePlayIcons();
        showToast('Gagal memutar: ' + e.message, 'error');
    }
}

function updateUI(meta) {
    document.getElementById('mini-cover').src = meta.cover;
    document.getElementById('mini-title').innerText = meta.title;
    document.getElementById('mini-artist').innerText = meta.artist;
    
    document.getElementById('full-cover').src = meta.cover;
    document.getElementById('full-title').innerText = meta.title;
    document.getElementById('full-artist').innerText = meta.artist;

    checkLikeStatus();
    updateOfflineIndicator();
}

function checkLikeStatus() {
    if(!currentMeta) return;
    const lib = JSON.parse(localStorage.getItem('sann_library') || '[]');
    const isLiked = lib.find(s => s.url === currentMeta.url);
    const likeBtn = document.getElementById('like-btn');
    
    if(isLiked) {
        likeBtn.className = 'fa-solid fa-heart';
        likeBtn.style.color = 'var(--green)';
    } else {
        likeBtn.className = 'fa-regular fa-heart';
        likeBtn.style.color = 'white';
    }
}

// --- CONTROLS (TIDAK BERUBAH) ---
miniPlayer.addEventListener('click', (e) => {
    if(!e.target.closest('.mini-controls')) {
        fullPlayer.classList.add('show');
    }
});

function closeFullPlayer() {
    fullPlayer.classList.remove('show');
}

// ========== FITUR BARU: Toggle Play dengan Enhanced ==========
function togglePlay() {
    if (!audio.src) {
        if (currentMeta) {
            playMusic(currentMeta);
        } else {
            showToast('Pilih lagu terlebih dahulu', 'info');
        }
        return;
    }
    
    if (isPlaying) {
        audio.pause();
        isPlaying = false;
    } else {
        audio.play();
        isPlaying = true;
    }
    updatePlayIcons();
}

function updatePlayIcons() {
    const miniIcon = document.getElementById('mini-play-btn');
    const fullIcon = document.getElementById('full-play-icon');
    
    if (isPlaying) {
        miniIcon.className = 'fa-solid fa-pause';
        fullIcon.className = 'fa-solid fa-pause';
    } else {
        miniIcon.className = 'fa-solid fa-play';
        fullIcon.className = 'fa-solid fa-play';
    }
}

audio.addEventListener('waiting', () => {
    document.getElementById('mini-play-btn').className = 'fa-solid fa-spinner fa-spin';
    document.getElementById('full-play-icon').className = 'fa-solid fa-spinner fa-spin';
});

audio.addEventListener('playing', () => {
    updatePlayIcons();
});

// --- SEEKING & PROGRESS BAR (TIDAK BERUBAH) ---
audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    
    if (!isDraggingSlider) {
        const pct = (audio.currentTime / audio.duration) * 100;
        miniProgress.style.width = pct + '%';
        mainSlider.value = pct;
        document.getElementById('curr-time').innerText = formatTime(audio.currentTime);
    }
    document.getElementById('total-time').innerText = formatTime(audio.duration);
});

mainSlider.addEventListener('input', (e) => {
    isDraggingSlider = true;
    const val = e.target.value;
    const time = (val / 100) * audio.duration;
    document.getElementById('curr-time').innerText = formatTime(time);
});

mainSlider.addEventListener('change', (e) => {
    const val = e.target.value;
    const time = (val / 100) * audio.duration;
    audio.currentTime = time;
    isDraggingSlider = false;
});

// ========== FITUR BARU: Shuffle & Repeat ==========
function toggleShuffle() {
    shuffleMode = !shuffleMode;
    const btn = document.getElementById('shuffle-btn');
    if (btn) {
        btn.style.color = shuffleMode ? 'var(--green)' : 'white';
    }
    showToast(shuffleMode ? 'Shuffle aktif' : 'Shuffle nonaktif', 'info');
}

function toggleRepeat() {
    const modes = ['none', 'all', 'one'];
    const currentIndex = modes.indexOf(repeatMode);
    repeatMode = modes[(currentIndex + 1) % modes.length];
    
    const btn = document.getElementById('repeat-btn');
    if (!btn) return;
    
    if (repeatMode === 'one') {
        btn.className = 'fa-solid fa-repeat-1';
        btn.style.color = 'var(--green)';
        showToast('Repeat satu lagu', 'info');
    } else if (repeatMode === 'all') {
        btn.className = 'fa-solid fa-repeat';
        btn.style.color = 'var(--green)';
        showToast('Repeat semua', 'info');
    } else {
        btn.className = 'fa-solid fa-repeat';
        btn.style.color = 'white';
        showToast('Repeat nonaktif', 'info');
    }
}

function getNextSong() {
    if (currentPlaylistSongs.length === 0) return null;
    
    let playlist = currentPlaylistSongs;
    if (shuffleMode) {
        // Simple shuffle: pilih random
        const randomIndex = Math.floor(Math.random() * playlist.length);
        return playlist[randomIndex];
    }
    
    const currentIndex = playlist.findIndex(s => s.url === currentMeta?.url);
    
    if (currentIndex === -1) return playlist[0];
    
    if (currentIndex < playlist.length - 1) {
        return playlist[currentIndex + 1];
    } else if (repeatMode === 'all') {
        return playlist[0];
    }
    
    return null;
}

// ========== FITUR BARU: Play Next/Previous ==========
function playNext() {
    const nextSong = getNextSong();
    if (nextSong) {
        playMusic(nextSong);
    } else {
        showToast('Tidak ada lagu berikutnya', 'info');
    }
}

function playPrevious() {
    if (currentPlaylistSongs.length === 0 || !currentMeta) return;
    
    const currentIndex = currentPlaylistSongs.findIndex(s => s.url === currentMeta.url);
    
    if (currentIndex > 0) {
        playMusic(currentPlaylistSongs[currentIndex - 1]);
    } else {
        showToast('Ini lagu pertama', 'info');
    }
}

// ========== FITUR BARU: Volume Control ==========
function loadVolumeSettings() {
    try {
        const savedVolume = localStorage.getItem('app_volume');
        if (savedVolume !== null) {
            const vol = parseFloat(savedVolume);
            audio.volume = vol;
            
            const volumeSlider = document.getElementById('volume-slider');
            const volumePercent = document.getElementById('volume-percent');
            
            if (volumeSlider) volumeSlider.value = vol * 100;
            if (volumePercent) volumePercent.textContent = Math.round(vol * 100) + '%';
        }
    } catch (e) {
        console.error('Failed to load volume:', e);
    }
}

function initVolumeControl() {
    const volumeSlider = document.getElementById('volume-slider');
    const volumePercent = document.getElementById('volume-percent');
    
    if (!volumeSlider) return;
    
    volumeSlider.addEventListener('input', (e) => {
        const val = e.target.value / 100;
        audio.volume = val;
        if (volumePercent) volumePercent.textContent = e.target.value + '%';
        
        try {
            localStorage.setItem('app_volume', val);
        } catch (e) {}
    });
    
    volumeSlider.addEventListener('dblclick', () => {
        volumeSlider.value = 100;
        audio.volume = 1;
        if (volumePercent) volumePercent.textContent = '100%';
        localStorage.setItem('app_volume', 1);
        showToast('Volume maksimum', 'success');
    });
}

function toggleMute() {
    if (audio.volume === 0) {
        audio.volume = previousVolume / 100;
        const volumeSlider = document.getElementById('volume-slider');
        const volumePercent = document.getElementById('volume-percent');
        if (volumeSlider) volumeSlider.value = previousVolume;
        if (volumePercent) volumePercent.textContent = previousVolume + '%';
        showToast('Suara diaktifkan', 'info');
    } else {
        previousVolume = Math.round(audio.volume * 100);
        audio.volume = 0;
        const volumeSlider = document.getElementById('volume-slider');
        const volumePercent = document.getElementById('volume-percent');
        if (volumeSlider) volumeSlider.value = 0;
        if (volumePercent) volumePercent.textContent = '0%';
        showToast('Suara dimatikan', 'info');
    }
    
    localStorage.setItem('app_volume', audio.volume);
}

// ========== FITUR BARU: Offline Download ==========
function loadOfflineSongs() {
    try {
        const stored = localStorage.getItem('offline_songs');
        if (stored) {
            offlineSongs = JSON.parse(stored);
        }
        updateOfflineCount();
    } catch (e) {
        console.error('Failed to load offline songs:', e);
    }
}

function updateOfflineCount() {
    const offlineCount = document.getElementById('offline-count');
    if (offlineCount) {
        offlineCount.textContent = offlineSongs.length;
    }
}

function updateOfflineIndicator() {
    const downloadBtn = document.getElementById('download-btn');
    if (!downloadBtn || !currentMeta) return;
    
    if (offlineSongs.some(s => s.url === currentMeta.url)) {
        downloadBtn.style.color = 'var(--green)';
        downloadBtn.title = 'Sudah di-download';
    } else {
        downloadBtn.style.color = 'white';
        downloadBtn.title = 'Download offline';
    }
}

async function downloadCurrentSong() {
    if (!currentMeta) {
        showToast('Pilih lagu terlebih dahulu', 'warning');
        return;
    }
    
    if (offlineSongs.some(s => s.url === currentMeta.url)) {
        showToast('Lagu sudah tersedia offline', 'info');
        return;
    }
    
    if (!navigator.onLine) {
        showToast('Tidak ada koneksi internet', 'error');
        return;
    }
    
    showToast('Menyiapkan download...', 'info');
    
    try {
        const downloadBtn = document.getElementById('download-btn');
        if (downloadBtn) downloadBtn.className = 'fa-solid fa-spinner fa-spin';
        
        const streamUrl = `/api/index?url=${encodeURIComponent(currentMeta.url)}&mode=stream`;
        const response = await fetch(streamUrl);
        
        if (!response.ok) throw new Error('Download gagal');
        
        const audioBlob = await response.blob();
        
        const reader = new FileReader();
        reader.onloadend = function() {
            const base64Audio = reader.result;
            
            const songData = {
                ...currentMeta,
                audioData: base64Audio,
                downloadedAt: Date.now()
            };
            
            offlineSongs.push(songData);
            localStorage.setItem('offline_songs', JSON.stringify(offlineSongs));
            
            if (downloadBtn) {
                downloadBtn.className = 'fa-solid fa-download';
                downloadBtn.style.color = 'var(--green)';
            }
            
            updateOfflineCount();
            showToast('Download selesai!', 'success');
        };
        
        reader.readAsDataURL(audioBlob);
        
    } catch (error) {
        console.error('Download failed:', error);
        const downloadBtn = document.getElementById('download-btn');
        if (downloadBtn) downloadBtn.className = 'fa-solid fa-download';
        showToast('Gagal download: ' + error.message, 'error');
    }
}

function openOfflineLibrary() {
    switchTab('library');
    
    setTimeout(() => {
        const libraryDiv = document.getElementById('library-list');
        if (!libraryDiv) return;
        
        // Tampilkan offline songs di atas
        const offlineSection = document.createElement('div');
        offlineSection.innerHTML = '<h3 style="margin:20px 0 10px;">Lagu Offline</h3>';
        
        if (offlineSongs.length === 0) {
            offlineSection.innerHTML += '<p style="color:#777; text-align:center;">Belum ada lagu offline</p>';
        } else {
            offlineSongs.forEach(song => {
                const item = document.createElement('div');
                item.className = 'result-item';
                item.innerHTML = `
                    <img src="${song.cover}" onerror="this.src='https://cdn.odzre.my.id/aax.jpg'">
                    <div class="result-info">
                        <h4>${escapeHtml(song.title)}</h4>
                        <p>${escapeHtml(song.artist)}</p>
                        <span style="font-size:10px; color:var(--green);">
                            <i class="fa-solid fa-circle-check"></i> Offline
                        </span>
                    </div>
                    <i class="fa-solid fa-play" style="color:var(--green)"></i>
                `;
                item.onclick = () => playOfflineSong(song);
                offlineSection.appendChild(item);
            });
        }
        
        libraryDiv.prepend(offlineSection);
    }, 100);
}

async function playOfflineSong(songData) {
    if (songData.audioData) {
        audio.src = songData.audioData;
        await audio.play();
        currentMeta = songData;
        updateUI(songData);
        isPlaying = true;
        updatePlayIcons();
        showToast('Memutar offline', 'success');
    }
}

// ========== FITUR BARU: History ==========
function saveToHistory(song) {
    let history = JSON.parse(localStorage.getItem('play_history') || '[]');
    // Hapus duplikat
    history = history.filter(s => s.url !== song.url);
    // Tambah di awal
    history.unshift(song);
    // Batasi jumlah
    if (history.length > MAX_HISTORY) history.pop();
    localStorage.setItem('play_history', JSON.stringify(history));
}

function showHistory() {
    const history = JSON.parse(localStorage.getItem('play_history') || '[]');
    
    if (history.length === 0) {
        showToast('Belum ada riwayat', 'info');
        return;
    }
    
    switchTab('search');
    searchResults.innerHTML = '<h3 style="margin-bottom:15px;">Riwayat Putar</h3>';
    
    history.forEach(song => {
        const item = document.createElement('div');
        item.className = 'result-item';
        item.innerHTML = `
            <img src="${song.cover}" onerror="this.src='https://cdn.odzre.my.id/aax.jpg'">
            <div class="result-info">
                <h4>${escapeHtml(song.title)}</h4>
                <p>${escapeHtml(song.artist)}</p>
            </div>
            <i class="fa-solid fa-play" style="color:var(--green)"></i>
        `;
        item.onclick = () => playMusic(song);
        searchResults.appendChild(item);
    });
}

// ========== FITUR BARU: Online/Offline Detection ==========
window.addEventListener('online', () => {
    showToast('Kembali online', 'success');
    document.body.classList.remove('offline-mode');
});

window.addEventListener('offline', () => {
    showToast('Mode offline', 'warning');
    document.body.classList.add('offline-mode');
    
    if (offlineSongs.length > 0 && (!currentMeta || !offlineSongs.some(s => s.url === currentMeta?.url))) {
        setTimeout(() => {
            if (confirm('Anda sedang offline. Putar lagu yang sudah di-download?')) {
                openOfflineLibrary();
            }
        }, 1000);
    }
});

// ========== FITUR BARU: Enhanced End