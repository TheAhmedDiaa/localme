import {
  ANIMAL_COUNT,
  LIMITS,
  ROOM_CODE_RE,
  type ClientMsg,
  type Device,
  type ItemMeta,
  type NewItem,
  type RoomInfo,
  type ServerMsg,
} from '@localme/shared';

interface Env {
  ROOMS: DurableObjectNamespace;
}

/** Devices behind the same public IP (IPv6: same /64) share a room. */
function networkId(req: Request): string {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
  return ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== '/ws') return new Response('Not found', { status: 404 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });

    const code = (url.searchParams.get('room') ?? '').toUpperCase();
    let key: string;
    if (code) {
      if (!ROOM_CODE_RE.test(code)) return new Response('Bad room code', { status: 400 });
      key = `code:${code}`;
    } else {
      key = `net:${networkId(req)}`;
    }

    const stub = env.ROOMS.get(env.ROOMS.idFromName(key));
    const target = new URL(req.url);
    target.search = '';
    target.searchParams.set('k', key);
    return stub.fetch(new Request(target, req));
  },
};

interface Peer {
  ws: WebSocket;
  device: Device;
  windowStart: number;
  count: number;
}

/**
 * One Durable Object per room. Holds ONLY in-memory presence + file metadata.
 * File bytes never touch the server; they travel browser-to-browser (WebRTC).
 */
export class Room {
  private peers = new Map<string, Peer>();
  private items = new Map<string, ItemMeta>();

  constructor(_state: DurableObjectState, _env: Env) {}

  async fetch(req: Request): Promise<Response> {
    const key = new URL(req.url).searchParams.get('k') ?? 'net:local';
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.attach(server, key);
    return new Response(null, { status: 101, webSocket: client });
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket already closing */
    }
  }

  private broadcast(msg: ServerMsg, exceptId?: string) {
    const data = JSON.stringify(msg);
    for (const [id, p] of this.peers) {
      if (id === exceptId) continue;
      try {
        p.ws.send(data);
      } catch {
        /* ignore */
      }
    }
  }

  private attach(ws: WebSocket, key: string) {
    if (this.peers.size >= LIMITS.maxDevices) {
      this.send(ws, { t: 'error', code: 'room-full' });
      ws.close(1013, 'room full');
      return;
    }

    const device: Device = {
      id: crypto.randomUUID().slice(0, 8),
      animal: Math.floor(Math.random() * ANIMAL_COUNT),
      num: 10 + Math.floor(Math.random() * 90),
    };
    const peer: Peer = { ws, device, windowStart: Date.now(), count: 0 };
    const room: RoomInfo = key.startsWith('code:') ? { kind: 'private', code: key.slice(5) } : { kind: 'network' };

    this.send(ws, {
      t: 'welcome',
      you: device,
      room,
      devices: [...this.peers.values()].map((p) => p.device),
      items: [...this.items.values()],
    });
    this.peers.set(device.id, peer);
    this.broadcast({ t: 'joined', device }, device.id);

    ws.addEventListener('message', (e: MessageEvent) => this.onMessage(peer, e.data));
    const cleanup = () => this.onGone(peer);
    ws.addEventListener('close', cleanup);
    ws.addEventListener('error', cleanup);
  }

  private onGone(peer: Peer) {
    if (this.peers.get(peer.device.id) !== peer) return;
    this.peers.delete(peer.device.id);
    for (const [id, item] of this.items) if (item.ownerId === peer.device.id) this.items.delete(id);
    this.broadcast({ t: 'left', id: peer.device.id });
  }

  private onMessage(peer: Peer, raw: unknown) {
    const now = Date.now();
    if (now - peer.windowStart > 1000) {
      peer.windowStart = now;
      peer.count = 0;
    }
    if (++peer.count > LIMITS.maxMessagesPerSecond) {
      this.send(peer.ws, { t: 'error', code: 'rate-limit' });
      peer.ws.close(1008, 'rate limit');
      return;
    }
    if (typeof raw !== 'string' || raw.length > LIMITS.maxMessageBytes) {
      this.send(peer.ws, { t: 'error', code: 'too-large' });
      return;
    }

    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw) as ClientMsg;
    } catch {
      return;
    }
    const me = peer.device.id;

    switch (msg.t) {
      case 'add': {
        if (!Array.isArray(msg.items)) return;
        let owned = 0;
        for (const it of this.items.values()) if (it.ownerId === me) owned++;
        const accepted: ItemMeta[] = [];
        for (const raw of msg.items) {
          const item = this.sanitize(raw, me);
          if (!item) continue;
          const existing = this.items.get(item.id);
          if (existing && existing.ownerId !== me) continue; // can't hijack someone else's id
          if (!existing) {
            if (owned >= LIMITS.maxItemsPerDevice) break;
            owned++;
          }
          this.items.set(item.id, item);
          accepted.push(item);
        }
        if (accepted.length) this.broadcast({ t: 'added', items: accepted });
        break;
      }
      case 'remove': {
        if (!Array.isArray(msg.ids)) return;
        const removed: string[] = [];
        for (const id of msg.ids) {
          const it = typeof id === 'string' ? this.items.get(id) : undefined;
          if (it && it.ownerId === me) {
            this.items.delete(id);
            removed.push(id);
          }
        }
        if (removed.length) this.broadcast({ t: 'removed', ids: removed });
        break;
      }
      case 'lock': {
        const it = typeof msg.id === 'string' ? this.items.get(msg.id) : undefined;
        if (it && it.ownerId === me && it.kind === 'file') {
          it.locked = !!msg.locked;
          this.broadcast({ t: 'locked', id: it.id, locked: it.locked });
        }
        break;
      }
      case 'signal': {
        const target = typeof msg.to === 'string' ? this.peers.get(msg.to) : undefined;
        if (target) this.send(target.ws, { t: 'signal', from: me, data: msg.data });
        break;
      }
    }
  }

  private sanitize(raw: NewItem, ownerId: string): ItemMeta | null {
    if (!raw || typeof raw !== 'object') return null;
    const { id, kind, name, path, size, mime, text } = raw;
    if (typeof id !== 'string' || id.length < 1 || id.length > 40) return null;
    if (kind !== 'file' && kind !== 'text') return null;
    if (typeof name !== 'string' || !name || name.length > LIMITS.maxNameLength) return null;
    const p = typeof path === 'string' && path.length <= LIMITS.maxPathLength ? path : name;
    if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return null;
    const item: ItemMeta = {
      id,
      ownerId,
      kind,
      name,
      path: p,
      size,
      mime: typeof mime === 'string' ? mime.slice(0, 100) : 'application/octet-stream',
      locked: kind === 'file' && raw.locked === true,
      addedAt: Date.now(),
    };
    if (kind === 'text') {
      if (typeof text !== 'string' || text.length > LIMITS.maxTextLength) return null;
      item.text = text;
    }
    return item;
  }
}
