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
  const chunks = [];
  let ended = false;
  let failed = false;
  let delivered = 0;
  let wake = null;
  port.onmessage = (ev) => {
    if (ev.data === 'end') ended = true;
    else if (ev.data === 'abort') failed = true;
    else chunks.push(new Uint8Array(ev.data));
    if (wake) wake();
  };
  // Pull-based: a chunk is handed over only when the browser asks for more, and the page is told
  // how much was taken so it can pace itself (and only report "done" when the browser has it all).
  const stream = new ReadableStream(
    {
      async pull(ctl) {
        while (!chunks.length && !ended && !failed) await new Promise((r) => (wake = r));
        if (failed) return ctl.error(new Error('aborted'));
        const c = chunks.shift();
        if (c) {
          delivered += c.byteLength;
          ctl.enqueue(c);
          port.postMessage({ delivered });
        } else {
          ctl.close();
        }
      },
      cancel() {
        port.postMessage('cancel');
      },
    },
    { highWaterMark: 0 },
  );
  pending.set(d.id, { stream, name: d.name, size: d.size, mime: d.mime });
  port.postMessage('ready');
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
