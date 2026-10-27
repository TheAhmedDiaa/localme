/// <reference types="vite/client" />

interface SaveFilePickerOptions {
  suggestedName?: string;
}
interface Window {
  showSaveFilePicker?: (opts?: SaveFilePickerOptions) => Promise<{
    createWritable(): Promise<WritableStream<Uint8Array>>;
  }>;
}
