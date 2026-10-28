import { LIMITS } from '@localme/shared';

const SIZE = 96;

/** Cover-crop a source into a SIZE x SIZE JPEG data URL that fits the server's thumbnail limit. */
function draw(src: CanvasImageSource, w: number, h: number): string | null {
  if (!w || !h) return null;
  const side = Math.min(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SIZE, SIZE);
  for (const q of [0.6, 0.4, 0.25]) {
    const url = canvas.toDataURL('image/jpeg', q);
    if (url.length <= LIMITS.maxThumbLength) return url;
  }
  return null;
}

function once(target: HTMLMediaElement, event: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    target.addEventListener(
      event,
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    target.addEventListener(
      'error',
      () => {
        clearTimeout(timer);
        reject(new Error('media error'));
      },
      { once: true },
    );
  });
}

/** Small preview image for an image or video file; null when the browser can't decode it. */
export async function makeThumb(file: File): Promise<string | null> {
  try {
    if (file.type.startsWith('image/') && file.size <= 40 * 1024 * 1024) {
      const bmp = await createImageBitmap(file);
      try {
        return draw(bmp, bmp.width, bmp.height);
      } finally {
        bmp.close();
      }
    }
    if (file.type.startsWith('video/')) {
      const url = URL.createObjectURL(file);
      try {
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.preload = 'auto';
        v.src = url;
        await once(v, 'loadeddata', 4000);
        const seeked = once(v, 'seeked', 3000);
        v.currentTime = Math.min(1, (v.duration || 2) / 4);
        await seeked;
        return draw(v, v.videoWidth, v.videoHeight);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  } catch {
    /* undecodable: the file badge is shown instead */
  }
  return null;
}
