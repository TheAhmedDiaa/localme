export interface Picked {
  file: File;
  path: string;
}

export function fromInput(list: FileList | null): Picked[] {
  if (!list) return [];
  return [...list].map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}

async function walk(entry: FileSystemEntry, out: Picked[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push({ file, path: entry.fullPath.replace(/^\//, '') });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    let batch: FileSystemEntry[];
    do {
      batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      for (const e of batch) await walk(e, out);
    } while (batch.length);
  }
}

/** Handles dropped files AND folders (entries must be grabbed synchronously). */
export async function fromDrop(dt: DataTransfer): Promise<Picked[]> {
  const entries: FileSystemEntry[] = [];
  const plain: File[] = [];
  for (const item of [...dt.items]) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
    else {
      const f = item.getAsFile();
      if (f) plain.push(f);
    }
  }
  const out: Picked[] = plain.map((file) => ({ file, path: file.name }));
  for (const e of entries) await walk(e, out);
  return out;
}
