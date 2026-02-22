// ==================== INITIALIZATION ====================
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
let audioLoadAttempts = 0;
const MAX_RETRY_ATTEMPTS = 3;
let shuffleMode = false;
let repeatMode = 'none'; // 'none', 'all', 'one'
let originalPlaylist = [];

// API Base URL - Relative path ke backend Anda
const API_BASE = '/api'; // Akan memanggil index.js

// ==================== API FUNCTIONS ====================

/**
 * Melakukan pencarian lagu atau mendapatkan detail lagu
 * @param {string} url - URL atau query pencarian
 * @param {string} mode - 'search' atau 'stream'
 */
async function callAPI(url, mode = 'search') {
    try {
        const response = await fetch(`${API_BASE}/index?url=${encodeURIComponent(url)}&mode=${mode}`);
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'API Error');
        }
        
        if (mode === 'stream') {
            return response; // Return response object untuk stream
        }
        
        return await response.json(); // Return JSON untuk search
    } catch (error) {
        console.error('API call failed:', error);
        throw error;
    }
}

/**
 * Melakukan pencarian lagu
 * @param {string} query - Kata kunci pencarian (bisa URL atau query)
 */
async function searchSongs(query) {
    const data = await callAPI(query, 'search');
    return data; // Format: { type: 'list', songs: [...] }
}

/**
 * Mendapatkan stream URL (sebenarnya langsung fetch ke endpoint stream)
 * @param {string} songUrl - URL lagu dari hasil search
 */
function getStreamUrl(songUrl) {
    return `${API_BASE}/index?url=${encodeURIComponent(songUrl)}&mode=stream`;
}

/**
 * Memutar lagu
 * @param {Object} songData - Data lagu {url, title, artist, thumbnail}
 */
async function playMusic(songData) {
    if (!songData || !songData.url) {
        showToast('Data lagu tidak valid', 'error');
        return;
    }
    
    currentMeta = songData;
    updateUI(currentMeta);
    
    audioLoadAttempts = 0;
    
    document.getElementById('mini-play-btn').className = 'fa-solid fa-spinner fa-spin';
    document.getElementById('full-play-icon').className = 'fa-solid fa-spinner fa-spin';
    
    try {
        if (!navigator.onLine) {
            // Cek offline
            const offlineSong = offlineSongs.find(s => s.url === songData.url);
            if (offlineSong) {
                audio.src = offlineSong.audioData;
                await audio.play();
                showToast('Memutar offline', 'success');
                return;
            } else {
                showToast('Tidak ada koneksi internet', 'error');
                return;
            }
        }
        
        // Gunakan stream URL dari API
        const streamUrl = getStreamUrl(songData.url);
        console.log('Streaming from:', streamUrl);
        
        // Set audio source
        audio.src = streamUrl;
        audio.load();
        
        // Play dengan promise
        const playPromise = audio.play();
        
        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    console.log('Playing:', songData.title);
                })
                .catch(error => {
                    console.error('Playback failed:', error);
                    
                    if (error.name === 'NotAllowedError') {
                        showToast('Klik play untuk memulai', 'info');
                        isPlaying = false;
                        updatePlayIcons();
                    } else if (error.name === 'NotSupportedError') {
                        showToast('Format audio tidak didukung', 'error');
                    } else {
                        handleAudioError(error);
                    }
                });
        }
        
        saveToHistory(songData);
        fetchLyrics(songData.title, songData.artist);
        renderOfflineIndicator();
        
    } catch (e) {
        console.error('Fatal error:', e);
        showToast('Terjadi kesalahan: ' + e.message, 'error');
        isPlaying = false;
        updatePlayIcons();
    }
}

/**
 * Melakukan pencarian dengan debounce
 */
let debounceTimer;
searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        if(e.target.value.length > 2) performSearch(e.target.value);
    }, 800);
});

/**
 * Quick search dari home
 */
function quickSearch(term) {
    switchTab('search');
    searchInput.value = term;
    performSearch(term);
}

/**
 * Eksekusi pencarian
 */
async function performSearch(query) {
    if (!query || query.length < 2) return;
    
    loadingDiv.style.display = 'block';
    searchResults.innerHTML = '';
    
    try {
        // Cek cache dulu
        const cached = await searchCache.get('search', query);
        if (cached) {
            console.log('Using cached results for:', query);
            loadingDiv.style.display = 'none';
            renderSearchResults(cached.songs);
            return;
        }
        
        // Panggil API search
        const data = await searchSongs(query);
        console.log('Search results:', data);
        
        loadingDiv.style.display = 'none';

        if (data.songs && data.songs.length > 0) {
            // Simpan ke cache
            await searchCache.set('search', query, data, 24 * 60 * 60 * 1000);
            renderSearchResults(data.songs);
        } else {
            searchResults.innerHTML = '<div class="empty-state"><i class="fa-solid fa-music"></i><p>Lagu tidak ditemukan</p><span>Coba kata kunci lain</span></div>';
        }
    } catch (error) {
        loadingDiv.style.display = 'none';
        console.error('Search error:', error);
        
        searchResults.innerHTML = `
            <div class="error-state">
                <i class="fa-solid fa-wifi-slash"></i>
                <p>Gagal mencari</p>
                <span>${error.message || 'Periksa koneksi internet'}</span>
                <button onclick="performSearch('${query.replace(/'/g, "\\'")}')" class="retry-btn">
                    <i class="fa-solid fa-rotate-right"></i> Coba Lagi
                </button>
            </div>
        `;
    }
}

/**
 * Render hasil pencarian
 * Format song dari API Anda: 
 * { 
 *   id: "...", 
 *   title: "...", 
 *   artist: "...", 
 *   url: "...", 
 *   thumbnail: "..." 
 * }
 */
function renderSearchResults(songs) {
    const container = document.getElementById('search-results');
    container.innerHTML = '';
    
    songs.forEach((song, index) => {
        const item = document.createElement('div');
        item.className = 'result-item';
        item.innerHTML = `
            <img src="${song.thumbnail || 'https://cdn.odzre.my.id/aax.jpg'}" alt="art" loading="lazy" onerror="this.src='https://cdn.odzre.my.id/aax.jpg'">
            <div class="result-info">
                <h4>${escapeHtml(song.title || 'Unknown Title')}</h4>
                <p>${escapeHtml(song.artist || 'Unknown Artist')}</p>
            </div>
            <i class="fa-solid fa-play" style="color:var(--green)"></i>
        `;
        
        // Simpan data lagu
        item.onclick = () => {
            currentPlaylistSongs = songs;
            playMusic({
                url: song.url,
                title: song.title,
                artist: song.artist,
                cover: song.thumbnail || 'https://cdn.odzre.my.id/aax.jpg'
            });
        };
        
        container.appendChild(item);
    });
}

/**
 * Escape HTML untuk keamanan
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== AUDIO PLAYER SETUP ====================
function setupAudioListeners() {
    // Hapus listener lama
    audio.removeEventListener('timeupdate', handleTimeUpdate);
    audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
    audio.removeEventListener('ended', handleEnded);
    audio.removeEventListener('error', handleAudioError);
    audio.removeEventListener('waiting', handleBuffering);
    audio.removeEventListener('playing', handlePlaying);
    audio.removeEventListener('pause', handlePause);
    audio.removeEventListener('canplay', handleCanPlay);
    audio.removeEventListener('stalled', handleStalled);
    
    // Tambah listener baru
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleAudioError);
    audio.addEventListener('waiting', handleBuffering);
    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('stalled', handleStalled);
}

function handleTimeUpdate() {
    if (!audio.duration || isNaN(audio.duration)) return;
    
    if (!isDraggingSlider) {
        const pct = (audio.currentTime / audio.duration) * 100;
        miniProgress.style.width = pct + '%';
        mainSlider.value = pct;
        document.getElementById('curr-time').innerText = formatTime(audio.currentTime);
    }
    document.getElementById('total-time').innerText = formatTime(audio.duration);
}

function handleLoadedMetadata() {
    mainSlider.max = 100;
    document.getElementById('total-time').innerText = formatTime(audio.duration);
    console.log('Audio duration:', audio.duration);
}

function handleEnded() {
    isPlaying = false;
    updatePlayIcons();
    
    if (repeatMode === 'one') {
        audio.currentTime = 0;
        audio.play().catch(e => console.error('Repeat play failed:', e));
    } else {
        playNextSong();
    }
}

function handleAudioError(e) {
    console.error('Audio Error:', e);
    console.error('Error code:', audio.error ? audio.error.code : 'unknown');
    console.error('Error message:', audio.error ? audio.error.message : 'unknown');
    
    if (audioLoadAttempts < MAX_RETRY_ATTEMPTS) {
        audioLoadAttempts++;
        showToast(`Gagal memuat, mencoba ulang... (${audioLoadAttempts}/${MAX_RETRY_ATTEMPTS})`, 'warning');
        
        setTimeout(() => {
            if (currentMeta) {
                const streamUrl = getStreamUrl(currentMeta.url);
                console.log('Retrying with URL:', streamUrl);
                audio.src = streamUrl;
                audio.load();
                audio.play().catch(err => {
                    console.error('Retry failed:', err);
                });
            }
        }, 2000 * audioLoadAttempts);
    } else {
        showToast('Gagal memutar lagu. Coba lagi nanti.', 'error');
        audioLoadAttempts = 0;
        resetPlayer();
    }
}

function handleBuffering() {
    document.getElementById('mini-play-btn').className = 'fa-solid fa-spinner fa-spin';
    document.getElementById('full-play-icon').className = 'fa-solid fa-spinner fa-spin';
    showToast('Buffering...', 'info');
}

function handleStalled() {
    console.log('Audio stalled');
    showToast('Loading...', 'info');
}

function handlePlaying() {
    isPlaying = true;
    audioLoadAttempts = 0;
    updatePlayIcons();
    document.getElementById('mini-play-btn').className = 'fa-solid fa-pause';
    document.getElementById('full-play-icon').className = 'fa-solid fa-pause';
}

function handlePause() {
    isPlaying = false;
    updatePlayIcons();
}

function handleCanPlay() {
    document.getElementById('mini-play-btn').className = 'fa-solid fa-pause';
    document.getElementById('full-play-icon').className = 'fa-solid fa-pause';
}

/**
 * Reset player
 */
function resetPlayer() {
    audio.pause();
    audio.currentTime = 0;
    audio.src = '';
    isPlaying = false;
    currentMeta = null;
    updateUI({
        title: 'Not Playing',
        artist: 'JHON PLAYING MUSIC',
        cover: 'https://cdn.odzre.my.id/aax.jpg'
    });
    updatePlayIcons();
    miniProgress.style.width = '0%';
    mainSlider.value = 0;
}

/**
 * Putar lagu berikutnya
 */
function playNextSong() {
    if (!currentMeta) return;
    
    if (repeatMode === 'one') {
        audio.currentTime = 0;
        audio.play().catch(e => console.error('Repeat play failed:', e));
        return;
    }
    
    let playlist = shuffleMode ? shuffleArray([...currentPlaylistSongs]) : currentPlaylistSongs;
    
    if (playlist.length === 0) {
        suggestNextSong();
        return;
    }
    
    const currentIndex = playlist.findIndex(s => s.url === currentMeta.url);
    
    if (currentIndex !== -1 && currentIndex < playlist.length - 1) {
        playMusic(playlist[currentIndex + 1]);
    } else if (repeatMode === 'all' && playlist.length > 0) {
        playMusic(playlist[0]);
    } else {
        suggestNextSong();
    }
}

/**
 * Putar lagu sebelumnya
 */
function playPrevious() {
    if (!currentMeta || currentPlaylistSongs.length === 0) return;
    
    const currentIndex = currentPlaylistSongs.findIndex(s => s.url === currentMeta.url);
    
    if (currentIndex > 0) {
        playMusic(currentPlaylistSongs[currentIndex - 1]);
    }
}

/**
 * Acak array
 */
function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

/**
 * Toggle shuffle mode
 */
function toggleShuffle() {
    shuffleMode = !shuffleMode;
    const btn = document.getElementById('shuffle-btn');
    btn.style.color = shuffleMode ? 'var(--green)' : 'white';
    showToast(shuffleMode ? 'Shuffle aktif' : 'Shuffle nonaktif', 'info');
}

/**
 * Toggle repeat mode
 */
function toggleRepeat() {
    const modes = ['none', 'all', 'one'];
    const currentIndex = modes.indexOf(repeatMode);
    repeatMode = modes[(currentIndex + 1) % modes.length];
    
    const btn = document.getElementById('repeat-btn');
    
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

/**
 * Suggest lagu berikutnya berdasarkan artist
 */
async function suggestNextSong() {
    if (!currentMeta) return;
    
    document.getElementById('mini-title').innerText = "Mencari lagu serupa...";
    
    try {
        const data = await searchSongs(currentMeta.artist);
        
        if (data.songs && data.songs.length > 0) {
            const suggestions = data.songs.filter(s => s.url !== currentMeta.url);
            
            if (suggestions.length > 0) {
                const nextSong = suggestions[Math.floor(Math.random() * Math.min(5, suggestions.length))];
                playMusic({
                    url: nextSong.url,
                    title: nextSong.title,
                    artist: nextSong.artist,
                    cover: nextSong.thumbnail || 'https://cdn.odzre.my.id/aax.jpg'
                });
            }
        }
    } catch (e) {
        console.error('Failed to suggest next song:', e);
    }
}

// ==================== CACHE SYSTEM (IndexedDB) ====================
class CacheSystem {
    constructor(name, maxSize = 50 * 1024 * 1024) {
        this.name = name;
        this.maxSize = maxSize;
        this.db = null;
        this.initDB();
    }
    
    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('MusicAppCache', 2);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                if (!db.objectStoreNames.contains('songs')) {
                    const songStore = db.createObjectStore('songs', { keyPath: 'url' });
                    songStore.createIndex('timestamp', 'timestamp');
                }
                
                if (!db.objectStoreNames.contains('search')) {
                    const searchStore = db.createObjectStore('search', { keyPath: 'query' });
                    searchStore.createIndex('timestamp', 'timestamp');
                }
            };
        });
    }
    
    async get(store, key) {
        if (!this.db) await this.initDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([store], 'readonly');
            const objectStore = transaction.objectStore(store);
            const request = objectStore.get(key);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const data = request.result;
                if (data && data.expiry && data.expiry < Date.now()) {
                    this.delete(store, key);
                    resolve(null);
                } else {
                    resolve(data ? data.value : null);
                }
            };
        });
    }
    
    async set(store, key, value, ttl = 24 * 60 * 60 * 1000) {
        if (!this.db) await this.initDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([store], 'readwrite');
            const objectStore = transaction.objectStore(store);
            
            const data = {
                url: key,
                value: value,
                timestamp: Date.now(),
                expiry: Date.now() + ttl
            };
            
            const request = objectStore.put(data);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
        });
    }
    
    async delete(store, key) {
        if (!this.db) await this.initDB();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([store], 'readwrite');
            const objectStore = transaction.objectStore(store);
            const request = objectStore.delete(key);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
        });
    }
}

const songCache = new CacheSystem('songs');
const searchCache = new CacheSystem('search');

// ==================== LYRICS SYSTEM ====================
let currentLyrics = null;
let lyricsSyncInterval = null;
let isLyricsExpanded = false;

/**
 * Fetch lirik dari API
 */
async function fetchLyrics(songTitle, artist) {
    if (!songTitle || !artist) return null;
    
    try {
        const cacheKey = `lyrics_${songTitle}_${artist}`.replace(/[^a-zA-Z0-9]/g, '_');
        const cached = localStorage.getItem(cacheKey);
        
        if (cached) {
            const cachedData = JSON.parse(cached);
            const cacheTime = cachedData.timestamp || 0;
            
            if (Date.now() - cacheTime < 7 * 24 * 60 * 60 * 1000) {
                renderLyrics(cachedData.lyrics);
                return cachedData.lyrics;
            }
        }
        
        // Gunakan API lirik publik
        const response = await fetch(
            `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(songTitle)}`,
            { timeout: 5000 }
        );
        
        if (!response.ok) throw new Error('Lyrics not found');
        
        const data = await response.json();
        
        if (data.lyrics) {
            const lyrics = parseLyrics(data.lyrics);
            
            localStorage.setItem(cacheKey, JSON.stringify({
                lyrics,
                timestamp: Date.now()
            }));
            
            renderLyrics(lyrics);
            return lyrics;
        }
    } catch (error) {
        console.log('Lyrics not found:', error);
        
        const placeholderLyrics = [
            { time: 0, text: `♫ ${songTitle} - ${artist} ♫` },
            { time: 5, text: "Lirik tidak tersedia" },
            { time: 10, text: "Coba cari manual di Google:" },
            { time: 15, text: `${songTitle} ${artist} lyrics` }
        ];
        
        renderLyrics(placeholderLyrics);
        return placeholderLyrics;
    }
}

/**
 * Parse lirik
 */
function parseLyrics(lyricsText) {
    const lines = lyricsText.split('\n');
    const parsed = [];
    let time = 0;
    
    lines.forEach(line => {
        line = line.trim();
        if (line && !line.includes('[') && !line.includes(']')) {
            parsed.push({
                time: time,
                text: line
            });
            time += 4; // Asumsi setiap baris 4 detik
        }
    });
    
    return parsed;
}

/**
 * Toggle tampilan lirik
 */
function toggleLyrics() {
    const container = document.querySelector('.lyrics-container');
    const chevron = document.getElementById('lyrics-chevron');
    
    isLyricsExpanded = !isLyricsExpanded;
    
    if (isLyricsExpanded) {
        container.classList.add('expanded');
        chevron.className = 'fa-solid fa-chevron-up';
        startLyricsSync();
    } else {
        container.classList.remove('expanded');
        chevron.className = 'fa-solid fa-chevron-down';
        stopLyricsSync();
    }
}

/**
 * Start sync lirik dengan waktu lagu
 */
function startLyricsSync() {
    stopLyricsSync();
    
    if (!currentLyrics || currentLyrics.length === 0) return;
    
    lyricsSyncInterval = setInterval(() => {
        if (!audio.currentTime || !currentLyrics) return;
        
        const currentTime = audio.currentTime;
        let activeLineIndex = -1;
        
        for (let i = 0; i < currentLyrics.length; i++) {
            if (currentLyrics[i].time <= currentTime) {
                activeLineIndex = i;
            } else {
                break;
            }
        }
        
        const lyricsElement = document.getElementById('lyrics-content');
        if (!lyricsElement) return;
        
        const lines = lyricsElement.querySelectorAll('.lyric-line');
        lines.forEach((line, index) => {
            if (index === activeLineIndex) {
                line.classList.add('active');
                line.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                line.classList.remove('active');
            }
        });
    }, 100);
}

/**
 * Stop sync lirik
 */
function stopLyricsSync() {
    if (lyricsSyncInterval) {
        clearInterval(lyricsSyncInterval);
        lyricsSyncInterval = null;
    }
}

/**
 * Render lirik ke UI
 */
function renderLyrics(lyrics) {
    const lyricsContent = document.getElementById('lyrics-content');
    
    if (!lyrics || lyrics.length === 0) {
        lyricsContent.innerHTML = `
            <div class="lyrics-empty">
                <i class="fa-regular fa-face-frown"></i>
                <p>Lirik tidak tersedia</p>
            </div>
        `;
        return;
    }
    
    currentLyrics = lyrics;
    
    let html = '<div class="lyrics-scroll">';
    lyrics.forEach(line => {
        html += `<div class="lyric-line">${escapeHtml(line.text) || '♪'}</div>`;
    });
    html += '</div>';
    
    lyricsContent.innerHTML = html;
    
    if (isLyricsExpanded) {
        startLyricsSync();
    }
}

// ==================== VOLUME CONTROL ====================
let previousVolume = 80;
const volumeSlider = document.getElementById('volume-slider');
const volumeIcon = document.getElementById('volume-icon');
const volumePercent = document.getElementById('volume-percent');

audio.volume = 0.8;

try {
    const savedVolume = localStorage.getItem('app_volume');
    if (savedVolume !== null) {
        const vol = parseFloat(savedVolume);
        audio.volume = vol;
        volumeSlider.value = vol * 100;
        updateVolumeIcon(vol);
        volumePercent.textContent = Math.round(vol * 100) + '%';
    }
} catch (e) {}

volumeSlider.addEventListener('input', (e) => {
    const val = e.target.value / 100;
    audio.volume = val;
    updateVolumeIcon(val);
    volumePercent.textContent = Math.round(val * 100) + '%';
    
    try {
        localStorage.setItem('app_volume', val);
    } catch (e) {}
});

volumeSlider.addEventListener('dblclick', () => {
    volumeSlider.value = 100;
    audio.volume = 1;
    updateVolumeIcon(1);
    volumePercent.textContent = '100%';
    localStorage.setItem('app_volume', 1);
    showToast('Volume maksimum', 'success');
});

function updateVolumeIcon(vol) {
    if (vol === 0 || audio.muted) {
        volumeIcon.className = 'fa-solid fa-volume-off';
    } else if (vol < 0.5) {
        volumeIcon.className = 'fa-solid fa-volume-low';
    } else {
        volumeIcon.className = 'fa-solid fa-volume-high';
    }
}

function toggleMute() {
    if (audio.volume === 0) {
        audio.volume = previousVolume / 100;
        volumeSlider.value = previousVolume;
        updateVolumeIcon(previousVolume / 100);
        volumePercent.textContent = previousVolume + '%';
        showToast('Suara diaktifkan', 'info');
    } else {
        previousVolume = Math.round(audio.volume * 100);
        audio.volume = 0;
        volumeSlider.value = 0;
        updateVolumeIcon(0);
        volumePercent.textContent = '0%';
        showToast('Suara dimatikan', 'info');
    }
    
    localStorage.setItem('app_volume', audio.volume);
}

// ==================== OFFLINE DOWNLOAD ====================
let offlineSongs = [];

async function loadOfflineSongs() {
    try {
        const stored = await songCache.get('songs', 'offline_list');
        if (stored) {
            offlineSongs = stored;
        }
        renderOfflineIndicator();
        const offlineCount = document.getElementById('offline-count');
        if (offlineCount) offlineCount.textContent = offlineSongs.length;
    } catch (e) {
        console.error('Failed to load offline songs:', e);
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
        downloadBtn.className = 'fa-solid fa-spinner fa-spin';
        
        // Download dari stream URL
        const streamUrl = getStreamUrl(currentMeta.url);
        console.log('Downloading from:', streamUrl);
        
        const response = await fetch(streamUrl);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const audioBlob = await response.blob();
        
        const reader = new FileReader();
        reader.onloadend = async function() {
            const base64Audio = reader.result;
            
            const songData = {
                ...currentMeta,
                audioData: base64Audio,
                downloadedAt: Date.now(),
                size: audioBlob.size
            };
            
            offlineSongs.push(songData);
            
            await songCache.set('songs', `offline_${currentMeta.url}`, songData);
            await songCache.set('songs', 'offline_list', offlineSongs);
            
            downloadBtn.className = 'fa-solid fa-download';
            downloadBtn.style.color = 'var(--green)';
            
            showToast('Download selesai!', 'success');
            renderOfflineIndicator();
            
            const offlineCount = document.getElementById('offline-count');
            if (offlineCount) offlineCount.textContent = offlineSongs.length;
        };
        
        reader.readAsDataURL(audioBlob);
        
    } catch (error) {
        console.error('Download failed:', error);
        document.getElementById('download-btn').className = 'fa-solid fa-download';
        showToast('Gagal download: ' + error.message, 'error');
    }
}

function renderOfflineIndicator() {
    const downloadBtn = document.getElementById('download-btn');
    if (!downloadBtn) return;
    
    if (currentMeta && offlineSongs.some(s => s.url === currentMeta.url)) {
        downloadBtn.style.color = 'var(--green)';
    } else {
        downloadBtn.style.color = 'white';
    }
}

// ==================== ONLINE/OFFLINE DETECTION ====================
window.addEventListener('online', () => {
    showToast('Kembali online', 'success');
    document.body.classList.remove('offline-mode');
});

window.addEventListener('offline', () => {
    showToast('Mode offline', 'warning');
    document.body.classList.add('offline-mode');
    
    if (!currentMeta || !offlineSongs.some(s => s.url === currentMeta.url)) {
        suggestOfflineSong();
    }
});

function suggestOfflineSong() {
    if (offlineSongs.length > 0) {
        setTimeout(() => {
            if (confirm('Anda sedang offline. Putar lagu yang sudah di-download?')) {
                openOfflineLibrary();
            }
        }, 1000);
    }
}

function openOfflineLibrary() {
    switchTab('library');
    
    const libraryDiv = document.getElementById('library-list');
    libraryDiv.innerHTML = '<h3 style="margin-bottom:15px;">Lagu Offline</h3>';
    
    offlineSongs.forEach(song => {
        const item = document.createElement('div');
        item.className = 'result-item';
        item.innerHTML = `
            <img src="${song.cover}" loading="lazy" onerror="this.src='https://cdn.odzre.my.id/aax.jpg'">
            <div class="result-info">
                <h4>${escapeHtml(song.title)}</h4>
                <p>${escapeHtml(song.artist)}</p>
                <span style="font-size:10px; color:var(--green);">
                    <i class="fa-solid fa-circle-check"></i> Tersedia offline
                </span>
            </div>
            <i class="fa-solid fa-play" style="color:var(--green)"></i>
        `;
        item.onclick = () => playOfflineSong(song);
        libraryDiv.appendChild(item);
    });
}

async function playOfflineSong(songData) {
    if (songData.audioData) {
        audio.src = songData.audioData;
        await audio.play();
        
        currentMeta = songData;
        updateUI(songData);
        showToast('Memutar offline', 'success');
    }
}

// ==================== LOGIN SYSTEM ====================
let currentUser = null;

function loadUser() {
    try {
        const userData = localStorage.getItem('current_user') || sessionStorage.getItem('current_user');
        if (userData) {
            currentUser = JSON.parse(userData);
            updateUserUI();
        }
    } catch (e) {
        console.error('Failed to load user:', e);
    }
}

function showLoginModal() {
    document.getElementById('modal-login').classList.add('active');
    switchLoginTab('login');
}

function switchLoginTab(tab) {
    document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.login-form').forEach(f => f.classList.remove('active'));
    
    if (tab === 'login') {
        document.querySelectorAll('.login-tab')[0].classList.add('active');
        document.getElementById('login-form').classList.add('active');
    } else {
        document.querySelectorAll('.login-tab')[1].classList.add('active');
        document.getElementById('register-form').classList.add('active');
    }
}

function toggleUserMenu() {
    const dropdown = document.getElementById('user-dropdown');
    dropdown.classList.toggle('show');
}

document.addEventListener('click', (e) => {
    const userMenu = document.getElementById('user-menu');
    const dropdown = document.getElementById('user-dropdown');
    
    if (userMenu && dropdown && !userMenu.contains(e.target)) {
        dropdown.classList.remove('show');
    }
});

async function doLogin() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const remember = document.getElementById('remember-me').checked;
    
    if (!email || !password) {
        showToast('Email dan password harus diisi', 'warning');
        return;
    }
    
    if (!email.includes('@') || !email.includes('.')) {
        showToast('Email tidak valid', 'warning');
        return;
    }
    
    showToast('Memproses login...', 'info');
    
    try {
        // Simulasi login - ganti dengan API real jika ada
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const user = {
            id: Date.now(),
            name: email.split('@')[0],
            email: email,
            avatar: 'https://cdn.odzre.my.id/aax.jpg',
            isLoggedIn: true,
            remember: remember
        };
        
        currentUser = user;
        
        if (remember) {
            localStorage.setItem('current_user', JSON.stringify(user));
        } else {
            sessionStorage.setItem('current_user', JSON.stringify(user));
        }
        
        closeModal('modal-login');
        updateUserUI();
        showToast('Login berhasil! Selamat datang ' + user.name, 'success');
        
    } catch (error) {
        showToast('Login gagal: ' + error.message, 'error');
    }
}

async function doRegister() {
    const name = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const confirm = document.getElementById('register-confirm').value;
    
    if (!name || !email || !password) {
        showToast('Semua field harus diisi', 'warning');
        return;
    }
    
    if (password.length < 6) {
        showToast('Password minimal 6 karakter', 'warning');
        return;
    }
    
    if (password !== confirm) {
        showToast('Password tidak cocok', 'warning');
        return;
    }
    
    showToast('Memproses pendaftaran...', 'info');
    
    try {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        showToast('Pendaftaran berhasil! Silakan login', 'success');
        switchLoginTab('login');
        
        document.getElementById('login-email').value = email;
        
    } catch (error) {
        showToast('Pendaftaran gagal: ' + error.message, 'error');
    }
}

function updateUserUI() {
    const avatar = document.getElementById('user-avatar');
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const displayName = document.getElementById('display-name');
    const displayEmail = document.getElementById('display-email');
    
    if (currentUser) {
        avatar.textContent = currentUser.name.charAt(0).toUpperCase();
        if (loginBtn) loginBtn.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'flex';
        if (displayName) displayName.textContent = currentUser.name;
        if (displayEmail) displayEmail.textContent = currentUser.email;
    } else {
        avatar.textContent = 'G';
        if (loginBtn) loginBtn.style.display = 'flex';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (displayName) displayName.textContent = 'Guest User';
        if (displayEmail) displayEmail.textContent = 'guest@music.app';
    }
}

function logout() {
    if (confirm('Yakin ingin keluar?')) {
        currentUser = null;
        localStorage.removeItem('current_user');
        sessionStorage.removeItem('current_user');
        updateUserUI();
        showToast('Berhasil keluar', 'success');
        switchTab('home');
    }
}

function socialLogin(provider) {
    showToast(`Login dengan ${provider} akan segera tersedia`, 'info');
}

function forgotPassword() {
    showToast('Fitur reset password akan segera tersedia', 'info');
}

function viewProfile() {
    showToast('Halaman profil dalam pengembangan', 'info');
}

function viewSettings() {
    showToast('Pengaturan dalam pengembangan', 'info');
}

function viewOfflineSongs() {
    openOfflineLibrary();
    document.getElementById('user-dropdown').classList.remove('show');
}

// ==================== UI FUNCTIONS ====================
function updateUI(meta) {
    document.getElementById('mini-cover').src = meta.cover;
    document.getElementById('mini-title').innerText = meta.title;
    document.getElementById('mini-artist').innerText = meta.artist;
    
    document.getElementById('full-cover').src = meta.cover;
    document.getElementById('full-title').innerText = meta.title;
    document.getElementById('full-artist').innerText = meta.artist;

    checkLikeStatus();
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

function formatTime(s) {
    if(isNaN(s) || !isFinite(s)) return "0:00";
    const min = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${min}:${sec < 10 ? '0' + sec : sec}`;
}

function showToast(message, type = 'info') {
    let toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
    }
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <i class="fa-solid ${type === 'error' ? 'fa-circle-exclamation' : type === 'success' ? 'fa-circle-check' : 'fa-circle-info'}"></i>
        <span>${message}</span>
    `;
    
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('toast-hide');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ==================== NAVIGATION ====================
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

function goBack() {
    switchTab('library');
}

// ==================== PLAYER CONTROLS ====================
miniPlayer.addEventListener('click', (e) => {
    if(!e.target.closest('.mini-controls')) {
        fullPlayer.classList.add('show');
    }
});

function closeFullPlayer() {
    fullPlayer.classList.remove('show');
}

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
    } else {
        audio.play().catch(error => {
            console.error('Play failed:', error);
            if (error.name === 'NotAllowedError') {
                showToast('Interaksi diperlukan untuk memutar', 'info');
            }
        });
    }
}

mainSlider.addEventListener('input', (e) => {
    isDraggingSlider = true;
    const val = e.target.value;
    if (audio.duration && !isNaN(audio.duration)) {
        const time = (val / 100) * audio.duration;
        document.getElementById('curr-time').innerText = formatTime(time);
    }
});

mainSlider.addEventListener('change', (e) => {
    const val = e.target.value;
    if (audio.duration && !isNaN(audio.duration)) {
        const time = (val / 100) * audio.duration;
        audio.currentTime = time;
    }
    isDraggingSlider = false;
});

// ==================== LIBRARY FUNCTIONS ====================
function openLikeOptionModal() {
    if(!currentMeta) return;
    
    document.getElementById('modal-like-options').classList.add('active');
    const listDiv = document.getElementById('like-options-list');
    listDiv.innerHTML = '';

    const likedItem = document.createElement('div');
    likedItem.className = 'pl-select-item';
    likedItem.innerHTML = `<div style="width:40px;height:40px;background:var(--green);display:flex;align-items:center;justify-content:center;border-radius:4px;"><i class="fa-solid fa-heart" style="color:white"></i></div><span>Liked Songs</span>`;
    likedItem.onclick = () => {
        toggleLikedSongs();
        closeModal('modal-like-options');
    };
    listDiv.appendChild(likedItem);

    const playlists = JSON.parse(localStorage.getItem('sann_playlists') || '[]');
    playlists.forEach(pl => {
        const item = document.createElement('div');
        item.className = 'pl-select-item';
        item.innerHTML = `<img src="${pl.image}" onerror="this.src='https://cdn.odzre.my.id/77c.jpg'"><span>${escapeHtml(pl.name)}</span>`;
        item.onclick = () => {
            addSongToPlaylist(pl.id);
            closeModal('modal-like-options');
        };
        listDiv.appendChild(item);
    });
}

function toggleLikedSongs() {
    let lib = JSON.parse(localStorage.getItem('sann_library') || '[]');
    const exists = lib.find(s => s.url === currentMeta.url);
    
    if(!exists) {
        lib.unshift(currentMeta); 
        showToast("Ditambahkan ke Liked Songs", 'success');
    } else {
        lib = lib.filter(s => s.url !== currentMeta.url);
        showToast("Dihapus dari Liked Songs", 'success');
    }
    
    localStorage.setItem('sann_library', JSON.stringify(lib));
    checkLikeStatus();
    loadLibrary();
}

function loadLibrary() {
    libraryList.innerHTML = '';
    
    const liked = JSON.parse(localStorage.getItem('sann_library') || '[]');
    const likedDiv = document.createElement('div');
    likedDiv.className = 'result-item';
    likedDiv.style.background = 'linear-gradient(135deg, #450af5, #8e8e8e)';
    likedDiv.innerHTML = `
        <div style="width:50px; height:50px; display:flex; align-items:center; justify-content:center; font-size:20px;"><i class="fa-solid fa-heart"></i></div>
        <div class="result-info">
            <h4>Liked Songs</h4>
            <p>${liked.length} liked songs</p>
        </div>
    `;
    likedDiv.onclick = () => openPlaylistDetail('liked', 'Liked Songs', 'https://cdn.odzre.my.id/rri.jpg');
    libraryList.appendChild(likedDiv);

    const playlists = JSON.parse(localStorage.getItem('sann_playlists') || '[]');
    playlists.forEach(pl => {
        const item = document.createElement('div');
        item.className = 'result-item';
        item.innerHTML = `
            <img src="${pl.image}" alt="pl" loading="lazy" onerror="this.src='https://cdn.odzre.my.id/77c.jpg'">
            <div class="result-info">
                <h4>${escapeHtml(pl.name)}</h4>
                <p>${pl.songs.length} songs</p>
            </div>
            <i class="fa-solid fa-trash del-pl-btn" onclick="deletePlaylist(${pl.id}, event)"></i>
        `;
        item.onclick = (e) => {
            if(!e.target.classList.contains('del-pl-btn')) {
                openPlaylistDetail(pl.id, pl.name, pl.image);
            }
        };
        libraryList.appendChild(item);
    });
    
    if (offlineSongs.length > 0) {
        const offlineDiv = document.createElement('div');
        offlineDiv.className = 'result-item';
        offlineDiv.innerHTML = `
            <div style="width:50px;height:50px;background:#333;display:flex;align-items:center;justify-content:center;border-radius:4px;">
                <i class="fa-solid fa-download" style="color:var(--green);"></i>
            </div>
            <div class="result-info">
                <h4>Offline Songs</h4>
                <p>${offlineSongs.length} tersedia offline</p>
            </div>
        `;
        offlineDiv.onclick = openOfflineLibrary;
        libraryList.appendChild(offlineDiv);
    }
}

function openCreateModal() { 
    document.getElementById('modal-create-playlist').classList.add('active'); 
}

function closeModal(id) { 
    document.getElementById(id).classList.remove('active'); 
}

document.getElementById('new-pl-file').addEventListener('change', function(e) {
    const fileName = e.target.files[0] ? e.target.files[0].name : "Belum ada foto";
    document.getElementById('file-name-display').innerText = fileName;
});

function saveNewPlaylist() {
    const name = document.getElementById('new-pl-name').value;
    const fileInput = document.getElementById('new-pl-file');
    const file = fileInput.files[0];
    
    if(!name) return showToast("Nama playlist wajib diisi!", 'warning');

    const save = (imgSrc) => {
        const newPl = { id: Date.now(), name: name, image: imgSrc, songs: [] };
        const playlists = JSON.parse(localStorage.getItem('sann_playlists') || '[]');
        playlists.push(newPl);
        localStorage.setItem('sann_playlists', JSON.stringify(playlists));
        
        closeModal('modal-create-playlist');
        document.getElementById('new-pl-name').value = '';
        fileInput.value = '';
        document.getElementById('file-name-display').innerText = "Belum ada foto";
        loadLibrary();
        showToast('Playlist berhasil dibuat', 'success');
    };

    if (file) {
        const reader = new FileReader();
        reader.onloadend = function() {
            save(reader.result);
        };
        reader.readAsDataURL(file);
    } else {
        save("https://cdn.odzre.my.id/77c.jpg");
    }
}

function deletePlaylist(id, e) {
    e.stopPropagation();
    if(!confirm("Hapus playlist ini?")) return;
    let playlists = JSON.parse(localStorage.getItem('sann_playlists') || '[]');
    playlists = playlists.filter(p => p.id !== id);
    localStorage.setItem('sann_playlists', JSON.stringify(playlists));
    loadLibrary();
    showToast('Playlist dihapus', 'success');
}

function openPlaylistDetail(id, name, img) {
    const detailView = document.getElementById('view-playlist-detail');
    const targetId = 'view-playlist-detail';

    document.querySelectorAll('.page-view').forEach(el => {
        if(el.id !== targetId) {
            el.style.display = 'none';
            el.classList.remove('active');
        }
    });

    detailView.style.display = 'block';
    detailView.classList.add('active');

    document.getElementById('pl-detail-name').innerText = name;
    document.getElementById('pl-detail-img').src = img;

    const listContainer = document.getElementById('playlist-songs-list');
    listContainer.innerHTML = '';

    let songs = [];
    if(id === 'liked') {
        songs = JSON.parse(localStorage.getItem('sann_library') || '[]');
    } else {
        const playlists = JSON.parse(localStorage.getItem('sann_playlists') || '[]');
        const pl = playlists.find(p => p.id === id);
        songs = pl ? pl.songs : [];
    }

    currentPlaylistSongs = songs; 
    originalPlaylist = [...songs];
    document.getElementById('pl-detail-count').innerText = `${songs.length} Songs`;

    if(songs.length === 0) {
        listContainer.innerHTML = '<p style="text-align:center; padding:20px; color:#777">Playlist kosong.</p>';
    } else {
        songs.forEach((song, index) => {
            const item = document.createElement('div');
            item.className = 'result-item';
            item.innerHTML = `
                <span style="color:#777; font-size:12px; margin-right:10px;">${index + 1}</span>
                <img src="${song.cover}" alt="art" loading="lazy" onerror="this.src='https://cdn.odzre.my.id/aax.jpg'">
                <div class="result-info">
                    <h4>${escapeHtml(song.title)}</h4>
                    <p>${escapeHtml(song.artist)}</p>
                </div>
            `;
            item.onclick = () => playMusic(song);
            listContainer.appendChild(item);
        });
    }
}

function playPlaylistAll() {
    if(currentPlaylistSongs.length > 0) {
        playMusic(currentPlaylistSongs[0]);
    } else {
        showToast("Playlist kosong!", 'warning');
    }
}

function openAddToPlaylistModal() {
    if(!currentMeta) return showToast("Putar lagu dulu!", 'warning');
    document.getElementById('modal-add-to-pl').classList.add('active');
    
    const listDiv = document.getElementById('list-pl-for-add');
    listDiv.innerHTML = '';
    
    const playlists = JSON.parse(localStorage.getItem('sann_playlists') || '[]');
    if(playlists.length === 0) {
        listDiv.innerHTML = '<p style="text-align:center;">Belum ada playlist.</p>';
        return;
    }

    playlists.forEach(pl => {
        const item = document.createElement('div');
        item.className = 'pl-select-item';
        item.innerHTML = `<img src="${pl.image}" onerror="this.src='https://cdn.odzre.my.id/77c.jpg'"><span>${escapeHtml(pl.name)}</span>`;
        item.onclick = () => addSongToPlaylist(pl.id);
        listDiv.appendChild(item);
    });
}

function addSongToPlaylist(plId) {
    let playlists = JSON.parse(localStorage.getItem('sann_playlists') || '[]');
    const index = playlists.findIndex(p => p.id === plId);
    
    if(index !== -1) {
        const exists = playlists[index].songs.find(s => s.url === currentMeta.url);
        if(exists) {
            showToast("Lagu sudah ada di playlist ini!", 'info');
        } else {
            playlists[index].songs.push(currentMeta);
            localStorage.setItem('sann_playlists', JSON.stringify(playlists));
            showToast("Berhasil ditambahkan!", 'success');
            closeModal('modal-add-to-pl');
        }
    }
}

function saveToHistory(song) {
    let history = JSON.parse(localStorage.getItem('play_history') || '[]');
    history = [song, ...history.filter(s => s.url !== song.url)].slice(0, 50);
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
            <img src="${song.cover}" alt="art" loading="lazy" onerror="this.src='https://cdn.odzre.my.id/aax.jpg'">
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

function showNotifications() {
    showToast('Tidak ada notifikasi baru', 'info');
}

function openSettings() {
    showToast('Pengaturan dalam pengembangan', 'info');
}

function filterCategory(category) {
    document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
    event.target.classList.add('active');
    showToast(`Menampilkan kategori: ${category}`, 'info');
}

function filterLibrary(type) {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    event.target.classList.add('active');
    showToast(`Filter: ${type}`, 'info');
}

function installApp() {
    showToast('Fitur instalasi akan segera tersedia!', 'info');
}

// ==================== INITIALIZATION ====================
window.onload = () => {
    setupAudioListeners();
    loadLibrary();
    loadUser();
    loadOfflineSongs();
    
    const gearIcon = document.querySelector('.fa-gear');
    if (gearIcon) {
        gearIcon.addEventListener('click', openSettings);
    }
    
    const bellIcon = document.querySelector('.fa-bell');
    if (bellIcon) {
        bellIcon.addEventListener('click', showNotifications);
    }
    
    const historyIcon = document.querySelector('.fa-clock-rotate-left');
    if (historyIcon) {
        historyIcon.addEventListener('click', showHistory);
    }
    
    // Cek koneksi awal
    if (!navigator.onLine) {
        document.body.classList.add('offline-mode');
        showToast('Anda sedang offline', 'warning');
    }
};

// Cleanup
window.addEventListener('beforeunload', () => {
    stopLyricsSync();
});