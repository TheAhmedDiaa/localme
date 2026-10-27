import type { NewItem } from '@localme/shared';

/**
 * Everything this device is sharing. Lives only in this tab's memory:
 * close the tab and it's gone — exactly the behaviour we want.
 */
export interface Local {
  meta: NewItem;
  file?: File;
  /** plain password, checked on this device when someone requests the file */
  password?: string;
}

export const local = new Map<string, Local>();

/** Random id. Works on plain http:// LAN origins (crypto.randomUUID needs a secure context). */
export const uid = (bytes = 8) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
