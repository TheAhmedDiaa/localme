import type { SignalData } from '@localme/shared';
import { uid } from './registry';

const ICE: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }],
};

const CHUNK = 64 * 1024; // used when the browser allows it (maxMessageSize), else 16 KB
const READ_BLOCK = 4 * 1024 * 1024;
const WINDOW = 16 * 1024 * 1024; // max un-acked bytes in flight
const HIGH_WATER = 8 * 1024 * 1024; // dc.bufferedAmount ceiling
const ACK_EVERY = 2 * 1024 * 1024;

export class DenyError extends Error {
  constructor(public why: 'password' | 'gone') {
    super(why);
  }
}

interface Conn {
  pc: RTCPeerConnection;
  peerId: string;
  remoteSet: boolean;
  pendingIce: RTCIceCandidateInit[];
  /** outgoing ICE held back until our offer/answer went out */
  ready: boolean;
  outbox: RTCIceCandidateInit[];
}

export interface P2POptions {
  send(to: string, data: SignalData): void;
  getFile(itemId: string): File | undefined;
  isLocked(itemId: string): boolean;
  checkPassword(itemId: string, password: string): boolean;
}

export interface Download {
  name: string;
  size: number;
  mime: string;
  stream: ReadableStream<Uint8Array>;
}

/**
 * Direct browser-to-browser file transfer.
 * - Requester opens one RTCPeerConnection per download and asks the owner for an item.
 * - Owner checks the (optional) password itself, then streams the file in 16 KB chunks
 *   with ack-based flow control (so the requester's disk speed paces the sender).
 */
export class P2P {
  private conns = new Map<string, Conn>();

  constructor(private o: P2POptions) {}

  private make(connId: string, peerId: string, outgoingReady: boolean): Conn {
    const pc = new RTCPeerConnection(ICE);
    const conn: Conn = { pc, peerId, remoteSet: false, pendingIce: [], ready: outgoingReady, outbox: [] };
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const ice = e.candidate.toJSON();
      if (conn.ready) this.o.send(peerId, { c: connId, k: 'ice', ice });
      else conn.outbox.push(ice);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.drop(connId);
    };
    this.conns.set(connId, conn);
    return conn;
  }

  private drop(connId: string) {
    const c = this.conns.get(connId);
    if (!c) return;
    this.conns.delete(connId);
    try {
      c.pc.close();
    } catch {
      /* ignore */
    }
  }

  private async flushRemote(conn: Conn) {
    conn.remoteSet = true;
    for (const ice of conn.pendingIce.splice(0)) await conn.pc.addIceCandidate(ice).catch(() => {});
  }

  /** Feed every `signal` message from the server here. */
  async onSignal(from: string, d: SignalData): Promise<void> {
    if (!d || typeof d.c !== 'string') return;
    if (d.k === 'offer' && d.sdp) {
      if (this.conns.has(d.c)) return;
      const conn = this.make(d.c, from, true);
      conn.pc.ondatachannel = (e) => this.serve(d.c, e.channel);
      await conn.pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
      await this.flushRemote(conn);
      const answer = await conn.pc.createAnswer();
      await conn.pc.setLocalDescription(answer);
      this.o.send(from, { c: d.c, k: 'answer', sdp: answer.sdp });
      return;
    }
    const conn = this.conns.get(d.c);
    if (!conn || conn.peerId !== from) return;
    if (d.k === 'answer' && d.sdp) {
      await conn.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp });
      await this.flushRemote(conn);
    } else if (d.k === 'ice' && d.ice) {
      if (conn.remoteSet) await conn.pc.addIceCandidate(d.ice as RTCIceCandidateInit).catch(() => {});
      else conn.pendingIce.push(d.ice as RTCIceCandidateInit);
    }
  }

  // ───────────────────────── owner side ─────────────────────────

  private serve(connId: string, dc: RTCDataChannel) {
    dc.binaryType = 'arraybuffer';
    let acked = 0;
    let aborted = false;
    let wakeAck: (() => void) | null = null;
    let wakeLow: (() => void) | null = null;
    let busy = false;

    dc.bufferedAmountLowThreshold = 2 * 1024 * 1024;
    dc.onbufferedamountlow = () => wakeLow?.();
    dc.onclose = () => {
      aborted = true;
      wakeAck?.();
      wakeLow?.();
      this.drop(connId);
    };

    const sendJson = (m: object) => dc.readyState === 'open' && dc.send(JSON.stringify(m));

    dc.onmessage = async (e) => {
      if (typeof e.data !== 'string') return;
      let m: { t: string; item?: string; pw?: string; n?: number };
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === 'ack' && typeof m.n === 'number') {
        acked = m.n;
        wakeAck?.();
      } else if (m.t === 'cancel') {
        aborted = true;
        wakeAck?.();
        wakeLow?.();
      } else if (m.t === 'req' && !busy && typeof m.item === 'string') {
        busy = true;
        const file = this.o.getFile(m.item);
        if (!file) return sendJson({ t: 'deny', why: 'gone' });
        if (this.o.isLocked(m.item) && !this.o.checkPassword(m.item, String(m.pw ?? ''))) {
          busy = false; // allow retry on the same channel is not needed; requester reconnects
          return sendJson({ t: 'deny', why: 'password' });
        }
        sendJson({ t: 'start', name: file.name, size: file.size, mime: file.type || 'application/octet-stream' });

        const maxMsg = this.conns.get(connId)?.pc.sctp?.maxMessageSize ?? 16 * 1024;
        const chunk = maxMsg >= CHUNK ? CHUNK : 16 * 1024;
        const readBlock = (at: number) =>
          file
            .slice(at, at + READ_BLOCK)
            .arrayBuffer()
            .then((b) => new Uint8Array(b));
        let next: Promise<Uint8Array<ArrayBuffer>> | null = file.size > 0 ? readBlock(0) : null;
        let sent = 0;
        for (let blockStart = 0; blockStart < file.size && !aborted; blockStart += READ_BLOCK) {
          const block = await next!;
          next = blockStart + READ_BLOCK < file.size ? readBlock(blockStart + READ_BLOCK) : null; // read ahead while sending
          for (let o = 0; o < block.byteLength && !aborted; o += chunk) {
            while (!aborted && sent - acked >= WINDOW) await new Promise<void>((r) => (wakeAck = r));
            while (!aborted && dc.readyState === 'open' && dc.bufferedAmount > HIGH_WATER)
              await new Promise<void>((r) => (wakeLow = r));
            if (aborted || dc.readyState !== 'open') return;
            const piece = block.subarray(o, Math.min(o + chunk, block.byteLength));
            dc.send(piece);
            sent += piece.byteLength;
          }
        }
        if (!aborted) sendJson({ t: 'end' });
      }
    };
  }

  // ─────────────────────── requester side ───────────────────────

  /** Resolves once the owner accepted; the returned stream yields the file bytes. */
  download(ownerId: string, itemId: string, password: string | undefined, onBytes?: (n: number) => void): Promise<Download> {
    const connId = uid(16);
    const conn = this.make(connId, ownerId, false);
    const dc = conn.pc.createDataChannel('file');
    dc.binaryType = 'arraybuffer';

    return new Promise<Download>((resolve, reject) => {
      const queue: ArrayBuffer[] = [];
      let ended = false;
      let closedEarly = false;
      let wake: (() => void) | null = null;
      let consumed = 0;
      let lastAck = 0;
      let total = 0;
      let started = false;

      const fail = (e: Error) => {
        clearTimeout(timer);
        this.drop(connId);
        reject(e);
      };
      const timer = setTimeout(() => fail(new DenyError('gone')), 20000);

      dc.onopen = () => dc.send(JSON.stringify({ t: 'req', item: itemId, pw: password }));
      dc.onclose = () => {
        if (!started) return fail(new DenyError('gone'));
        if (!ended) closedEarly = true;
        wake?.();
      };
      dc.onmessage = (e) => {
        if (typeof e.data !== 'string') {
          queue.push(e.data as ArrayBuffer);
          wake?.();
          return;
        }
        const m = JSON.parse(e.data) as { t: string; why?: 'password' | 'gone'; name?: string; size?: number; mime?: string };
        if (m.t === 'deny') return fail(new DenyError(m.why === 'password' ? 'password' : 'gone'));
        if (m.t === 'end') {
          ended = true;
          wake?.();
        } else if (m.t === 'start') {
          started = true;
          clearTimeout(timer);
          total = m.size ?? 0;
          const stream = new ReadableStream<Uint8Array>(
            {
              pull: async (ctl) => {
                while (!queue.length && !ended && !closedEarly) await new Promise<void>((r) => (wake = r));
                const buf = queue.shift();
                if (buf) {
                  consumed += buf.byteLength;
                  onBytes?.(buf.byteLength);
                  ctl.enqueue(new Uint8Array(buf));
                  if (consumed - lastAck >= ACK_EVERY && dc.readyState === 'open') {
                    dc.send(JSON.stringify({ t: 'ack', n: consumed }));
                    lastAck = consumed;
                  }
                  return;
                }
                if (ended && consumed === total) {
                  ctl.close();
                  setTimeout(() => this.drop(connId), 500);
                } else {
                  ctl.error(new Error('Transfer interrupted'));
                  this.drop(connId);
                }
              },
              cancel: () => {
                if (dc.readyState === 'open') dc.send(JSON.stringify({ t: 'cancel' }));
                setTimeout(() => this.drop(connId), 200);
              },
            },
            { highWaterMark: 0 },
          );
          resolve({ name: m.name ?? 'file', size: total, mime: m.mime ?? 'application/octet-stream', stream });
        }
      };

      (async () => {
        const offer = await conn.pc.createOffer();
        await conn.pc.setLocalDescription(offer);
        this.o.send(ownerId, { c: connId, k: 'offer', sdp: offer.sdp });
        conn.ready = true;
        for (const ice of conn.outbox.splice(0)) this.o.send(ownerId, { c: connId, k: 'ice', ice });
      })().catch((e) => fail(e instanceof Error ? e : new Error(String(e))));
    });
  }
}
