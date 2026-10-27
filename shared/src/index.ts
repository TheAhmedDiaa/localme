// Protocol shared by the worker (signaling server) and the client.

export const ANIMAL_COUNT = 12;

export const LIMITS = {
  maxDevices: 40,
  maxItemsPerDevice: 500,
  maxTextLength: 20_000,
  maxMessageBytes: 100_000,
  maxNameLength: 255,
  maxPathLength: 1024,
  maxMessagesPerSecond: 60,
} as const;

export interface Device {
  id: string;
  /** index into the animal name list (localized on the client) */
  animal: number;
  /** 10-99, so "Fox 42" and "Fox 17" can coexist */
  num: number;
}

export interface ItemMeta {
  id: string;
  ownerId: string;
  kind: 'file' | 'text';
  /** display name */
  name: string;
  /** relative path (folder uploads); equals name for single files */
  path: string;
  size: number;
  mime: string;
  /** true when the owner protected it with a password (checked by the owner, P2P) */
  locked: boolean;
  /** only for kind === 'text'; kept in server memory while the owner is connected */
  text?: string;
  addedAt: number;
}

export type NewItem = Omit<ItemMeta, 'ownerId' | 'addedAt'>;

export interface RoomInfo {
  kind: 'network' | 'private';
  code?: string;
}

export type ClientMsg =
  | { t: 'add'; items: NewItem[] }
  | { t: 'remove'; ids: string[] }
  | { t: 'lock'; id: string; locked: boolean }
  | { t: 'signal'; to: string; data: unknown };

export type ServerMsg =
  | { t: 'welcome'; you: Device; room: RoomInfo; devices: Device[]; items: ItemMeta[] }
  | { t: 'joined'; device: Device }
  | { t: 'left'; id: string }
  | { t: 'added'; items: ItemMeta[] }
  | { t: 'removed'; ids: string[] }
  | { t: 'locked'; id: string; locked: boolean }
  | { t: 'signal'; from: string; data: unknown }
  | { t: 'error'; code: 'room-full' | 'rate-limit' | 'too-large' | 'bad-request' };

/** WebRTC signaling payload relayed between two devices. */
export interface SignalData {
  /** connection id (one per download) */
  c: string;
  k: 'offer' | 'answer' | 'ice';
  sdp?: string;
  ice?: { candidate?: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null };
}

export const ROOM_CODE_RE = /^[A-Z2-9]{6}$/;
