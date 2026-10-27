import { uid } from './registry';
/**
 * Where downloaded bytes go. Priority:
 *  1. File System Access API (Chrome/Edge desktop + Android) -> straight to disk
 *  2. Service-worker streaming (Firefox/Safari) -> straight to disk via a normal browser download
 *  3. In-memory Blob (last resort; fine for small files only)
 */

export class SaveCancelled extends Error {}

let swReady: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  swReady = navigator.serviceWorker
    .register('/sw.js')
    .then(() => navigator.serviceWorker.ready)
    .catch(() => null);
}

function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_') || 'download';
}

async function swSink(name: string, size: number | undefined, mime: string): Promise<WritableStream<Uint8Array> | null> {
  const reg = swReady ? await swReady : null;
  const sw = reg?.active;
  if (!sw) return null;

  const SW_WINDOW = 8 * 1024 * 1024; // max bytes handed to the service worker but not yet read by the browser
  const id = uid(16);
  const ch = new MessageChannel();
  let sent = 0;
  let delivered = 0;
  let lastAck = Date.now();
  let cancelled = false;
  let waiter: (() => void) | null = null;
  const wake = () => {
    const w = waiter;
    waiter = null;
    w?.();
  };
  const waitSignal = () =>
    new Promise<void>((r) => {
      waiter = r;
      setTimeout(r, 1000);
    });

  // Wait until the service worker confirms it holds the stream, so the iframe request can't miss it.
  const ready = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 3000);
    ch.port1.onmessage = (ev) => {
      const d = ev.data;
      if (d === 'ready') {
        clearTimeout(timer);
        resolve(true);
      } else if (d === 'cancel') {
        cancelled = true;
        wake();
      } else if (d && typeof d.delivered === 'number') {
        delivered = d.delivered;
        lastAck = Date.now();
        wake();
      }
    };
  });
  sw.postMessage({ type: 'dl', id, name: safeName(name), size, mime }, [ch.port2]);
  if (!(await ready)) return null;

  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.src = `/__dl/${id}`;
  document.body.append(frame);
  // a message every few seconds keeps the service worker from being stopped mid-download
  const keepAlive = window.setInterval(() => sw.postMessage({ type: 'ping' }), 10000);
  const cleanup = () => {
    clearInterval(keepAlive);
    setTimeout(() => frame.remove(), 60000);
  };

  return new WritableStream<Uint8Array>({
    async write(chunk) {
      // Backpressure: never run far ahead of what the browser has actually read.
      while (!cancelled && sent - delivered >= SW_WINDOW) {
        if (Date.now() - lastAck > 30000) {
          cleanup();
          throw new Error('The browser did not start the download.');
        }
        await waitSignal();
      }
      if (cancelled) {
        cleanup();
        throw new SaveCancelled();
      }
      const copy = chunk.slice(); // own the buffer so we can transfer it
      sent += copy.byteLength;
      ch.port1.postMessage(copy.buffer, [copy.buffer]);
    },
    async close() {
      // Only finish once the browser has taken every byte.
      while (!cancelled && delivered < sent) {
        if (Date.now() - lastAck > 30000) {
          cleanup();
          throw new Error('The browser stopped the download.');
        }
        await waitSignal();
      }
      ch.port1.postMessage('end');
      cleanup();
    },
    abort() {
      ch.port1.postMessage('abort');
      cleanup();
    },
  });
}

function blobSink(name: string, mime: string): WritableStream<Uint8Array> {
  const parts: BlobPart[] = [];
  return new WritableStream<Uint8Array>({
    write(chunk) {
      parts.push(chunk.slice());
    },
    close() {
      const url = URL.createObjectURL(new Blob(parts, { type: mime }));
      const a = document.createElement('a');
      a.href = url;
      a.download = safeName(name);
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
  });
}

export async function openSink(name: string, size: number | undefined, mime: string): Promise<WritableStream<Uint8Array>> {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: safeName(name) });
      return await handle.createWritable();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw new SaveCancelled();
      // SecurityError (gesture expired) etc. -> fall through to the other sinks
    }
  }
  return (await swSink(name, size, mime)) ?? blobSink(name, mime);
}
