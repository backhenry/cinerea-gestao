// Service worker da Cinérea Gestão — deixa o app abrir mesmo sem internet.
// Estratégia: rede primeiro (para pegar atualizações), cache como reserva offline.
const CACHE = 'cinerea-v7';
const SHELL = ['./', './index.html', './styles.css', './app.js', './core.js', './catalogo.html', './pedido.html', './cotacao.html', './config.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  // sem skipWaiting aqui: a nova versão fica em espera até o usuário aceitar o aviso
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        const cp = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, cp));
        return r;
      })
      .catch(() =>
        caches.match(e.request, { ignoreSearch: true }).then(m => m || caches.match('./index.html'))
      )
  );
});
