/** Short label + colour class for a file-type badge ("PDF", "ZIP", "IMG"…). */
export function fileBadge(kind: 'file' | 'text', mime: string, name: string): { label: string; cls: string } {
  if (kind === 'text') return { label: 'TXT', cls: 'k-text' };
  const ext = /\.([a-z0-9]{1,4})$/i.exec(name)?.[1]?.toUpperCase();
  if (mime.startsWith('image/')) return { label: ext ?? 'IMG', cls: 'k-image' };
  if (mime.startsWith('video/')) return { label: ext ?? 'VID', cls: 'k-video' };
  if (mime.startsWith('audio/')) return { label: ext ?? 'AUD', cls: 'k-audio' };
  if (mime === 'application/pdf') return { label: 'PDF', cls: 'k-pdf' };
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return { label: ext ?? 'ZIP', cls: 'k-archive' };
  if (mime.startsWith('text/') || /\.(docx?|xlsx?|pptx?)$/i.test(name)) return { label: ext ?? 'DOC', cls: 'k-doc' };
  return { label: ext ?? 'FILE', cls: 'k-file' };
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text';
const MB = 1024 * 1024;
const TEXT_EXT = /\.(txt|md|json|csv|log|xml|ya?ml|ini|js|ts|tsx|jsx|css|html?|py|java|c|cpp|h|cs|go|rs|sh|sql)$/i;

/** What the preview dialog can show for an item (null = download only). Size limits keep phones safe. */
export function previewKind(item: { kind: 'file' | 'text'; mime: string; name: string; size: number }): PreviewKind | null {
  if (item.kind !== 'file') return null;
  const { mime, name, size } = item;
  if (mime.startsWith('image/')) return size <= 25 * MB ? 'image' : null;
  if (mime.startsWith('video/')) return size <= 300 * MB ? 'video' : null;
  if (mime.startsWith('audio/')) return size <= 100 * MB ? 'audio' : null;
  if (mime === 'application/pdf') return size <= 50 * MB ? 'pdf' : null;
  if (mime.startsWith('text/') || mime === 'application/json' || TEXT_EXT.test(name)) return size <= MB ? 'text' : null;
  return null;
}

/** Make zip entry paths unique ("a.txt", "a (2).txt"). */
export function uniquePath(path: string, used: Set<string>): string {
  let p = path;
  let n = 2;
  while (used.has(p)) {
    const dot = path.lastIndexOf('.');
    const slash = path.lastIndexOf('/');
    p = dot > slash + 1 ? `${path.slice(0, dot)} (${n})${path.slice(dot)}` : `${path} (${n})`;
    n++;
  }
  used.add(p);
  return p;
}
