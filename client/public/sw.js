// Streaming-download service worker (fallback for browsers without showSaveFilePicker).
// The page posts {type:'dl', id, name, size, mime} + a MessagePort; then navigates a hidden
// iframe to /__dl/<id>. We answer with a ReadableStream fed from the port, so huge files
// never sit in memory.
const pending = new Map();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.type !== 'dl' || !e.ports[0]) return;
  const port = e.ports[0];
  const stream = new ReadableStream({
    start(ctl) {
      port.onmessage = (ev) => {
        if (ev.data === 'end') ctl.close();
        else if (ev.data === 'abort') ctl.error(new Error('aborted'));
        else ctl.enqueue(new Uint8Array(ev.data));
      };
    },
    cancel() {
      port.postMessage('cancel');
    },
  });
  pending.set(d.id, { stream, name: d.name, size: d.size, mime: d.mime });
  // forget unclaimed downloads
  setTimeout(() => pending.delete(d.id), 60000);
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (!url.pathname.startsWith('/__dl/')) return;
  const entry = pending.get(url.pathname.slice('/__dl/'.length));
  if (!entry) return;
  pending.delete(url.pathname.slice('/__dl/'.length));
  const headers = {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(entry.name),
    'X-Content-Type-Options': 'nosniff',
  };
  if (entry.size) headers['Content-Length'] = String(entry.size);
  e.respondWith(new Response(entry.stream, { headers }));
});
