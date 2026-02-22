const CACHE_NAME = 'music-hub-v4'; // Naikkan versi
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap'
];

// API endpoints yang TIDAK boleh di-cache
const API_PATHS = ['/api/', '/api/index'];

self.addEventListener('install', event => {
  self.skipWaiting(); // Langsung aktifkan service worker baru
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Caching assets...');
        return cache.addAll(urlsToCache).catch(error => {
          console.error('Cache failed:', error);
        });
      })
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // JANGAN cache panggilan API
  if (API_PATHS.some(path => url.pathname.includes(path))) {
    event.respondWith(
      fetch(event.request)
        .then(response => response)
        .catch(() => {
          // Jika offline, return error
          return new Response(JSON.stringify({ 
            error: 'Anda sedang offline' 
          }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }
  
  // Untuk asset statis, gunakan cache first
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        
        return fetch(event.request)
          .then(response => {
            // Jangan cache response yang bukan success
            if (!response || response.status !== 200) {
              return response;
            }
            
            // Clone response untuk cache
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });
            
            return response;
          })
          .catch(error => {
            console.log('Fetch failed:', error);
            
            // Fallback untuk gambar
            if (event.request.url.match(/\.(jpg|jpeg|png|gif|webp)$/)) {
              return caches.match('https://cdn.odzre.my.id/aax.jpg');
            }
            
            // Return error response
            return new Response('Network error', { status: 408 });
          });
      })
  );
});

self.addEventListener('activate', event => {
  // Hapus cache lama
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME) {
              console.log('Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
    ])
  );
});

// Bersihkan cache secara periodik (opsional)
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});