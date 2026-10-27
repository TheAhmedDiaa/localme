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
  if (!sw || !navigator.serviceWorker.controller) return null;

  const id = uid(16);
  const ch = new MessageChannel();
  sw.postMessage({ type: 'dl', id, name: safeName(name), size, mime }, [ch.port2]);
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.src = `/__dl/${id}`;
  document.body.append(frame);
  const cleanup = () => setTimeout(() => frame.remove(), 5000);

  return new WritableStream<Uint8Array>({
    write(chunk) {
      const copy = chunk.slice(); // own the buffer so we can transfer it
      ch.port1.postMessage(copy.buffer, [copy.buffer]);
    },
    close() {
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
