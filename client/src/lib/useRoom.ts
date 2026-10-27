import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientMsg, Device, ItemMeta, NewItem, RoomInfo, ServerMsg, SignalData } from '@localme/shared';
import { P2P } from './p2p';
import { local, uid } from './registry';
import type { Picked } from './files';

export interface RoomState {
  status: 'connecting' | 'online' | 'offline';
  you: Device | null;
  room: RoomInfo | null;
  devices: Device[];
  items: ItemMeta[];
  error: string | null;
}

const INITIAL: RoomState = { status: 'connecting', you: null, room: null, devices: [], items: [], error: null };

function wsUrl(code: string | null) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws${code ? `?room=${encodeURIComponent(code)}` : ''}`;
}

export function useRoom(code: string | null) {
  const [state, setState] = useState<RoomState>(INITIAL);
  const wsRef = useRef<WebSocket | null>(null);

  const send = useCallback((m: ClientMsg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  }, []);

  /** Sends items in batches that stay under the server's message size cap. */
  const sendAdd = useCallback(
    (items: NewItem[]) => {
      let batch: NewItem[] = [];
      let bytes = 0;
      for (const it of items) {
        const size = JSON.stringify(it).length;
        if (batch.length && (bytes + size > 60_000 || batch.length >= 100)) {
          send({ t: 'add', items: batch });
          batch = [];
          bytes = 0;
        }
        batch.push(it);
        bytes += size;
      }
      if (batch.length) send({ t: 'add', items: batch });
    },
    [send],
  );

  const p2p = useMemo(
    () =>
      new P2P({
        send: (to, data) => send({ t: 'signal', to, data }),
        getFile: (id) => local.get(id)?.file,
        isLocked: (id) => !!local.get(id)?.password,
        checkPassword: (id, pw) => local.get(id)?.password === pw,
      }),
    [send],
  );

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let timer: number | undefined;

    const onMessage = (m: ServerMsg) => {
      switch (m.t) {
        case 'welcome':
          setState({ status: 'online', you: m.you, room: m.room, devices: [...m.devices, m.you], items: m.items, error: null });
          // Re-announce what this device is sharing (first connect, or after a reconnect).
          sendAdd([...local.values()].map((l) => l.meta));
          break;
        case 'joined':
          setState((s) => ({ ...s, devices: [...s.devices.filter((d) => d.id !== m.device.id), m.device] }));
          break;
        case 'left':
          setState((s) => ({
            ...s,
            devices: s.devices.filter((d) => d.id !== m.id),
            items: s.items.filter((i) => i.ownerId !== m.id),
          }));
          break;
        case 'added':
          setState((s) => {
            const ids = new Set(m.items.map((i) => i.id));
            return { ...s, items: [...s.items.filter((i) => !ids.has(i.id)), ...m.items] };
          });
          break;
        case 'removed':
          setState((s) => ({ ...s, items: s.items.filter((i) => !m.ids.includes(i.id)) }));
          break;
        case 'locked':
          setState((s) => ({ ...s, items: s.items.map((i) => (i.id === m.id ? { ...i, locked: m.locked } : i)) }));
          break;
        case 'signal':
          void p2p.onSignal(m.from, m.data as SignalData);
          break;
        case 'error':
          setState((s) => ({ ...s, error: m.code }));
          break;
      }
    };

    const connect = () => {
      setState((s) => ({ ...s, status: s.you ? 'offline' : 'connecting' }));
      const ws = new WebSocket(wsUrl(code));
      wsRef.current = ws;
      ws.onopen = () => {
        retry = 0;
      };
      ws.onmessage = (e) => {
        try {
          onMessage(JSON.parse(e.data as string) as ServerMsg);
        } catch {
          /* ignore malformed */
        }
      };
      ws.onclose = () => {
        if (closed) return;
        setState((s) => ({ ...s, status: 'offline', devices: [], items: [] }));
        timer = window.setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
      };
    };

    setState(INITIAL);
    connect();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [code, p2p, sendAdd]);

  const addPicked = useCallback(
    (picked: Picked[], password?: string, to?: string) => {
      const metas: NewItem[] = [];
      for (const { file, path } of picked) {
        const meta: NewItem = {
          id: uid(),
          kind: 'file',
          name: file.name,
          path,
          size: file.size,
          mime: file.type || 'application/octet-stream',
          locked: !!password,
          ...(to ? { to } : {}),
        };
        local.set(meta.id, { meta, file, password: password || undefined });
        metas.push(meta);
      }
      sendAdd(metas);
    },
    [sendAdd],
  );

  const addText = useCallback(
    (text: string, to?: string) => {
      const clean = text.trim();
      if (!clean) return;
      const firstLine = clean.split('\n', 1)[0] ?? clean;
      const meta: NewItem = {
        id: uid(),
        kind: 'text',
        name: firstLine.slice(0, 60),
        path: firstLine.slice(0, 60),
        size: new Blob([clean]).size,
        mime: 'text/plain',
        locked: false,
        text: clean,
        ...(to ? { to } : {}),
      };
      local.set(meta.id, { meta });
      sendAdd([meta]);
    },
    [sendAdd],
  );

  const remove = useCallback(
    (ids: string[]) => {
      ids.forEach((id) => local.delete(id));
      send({ t: 'remove', ids });
    },
    [send],
  );

  const setPassword = useCallback(
    (id: string, password: string) => {
      const l = local.get(id);
      if (!l || l.meta.kind !== 'file') return;
      l.password = password || undefined;
      l.meta.locked = !!password;
      send({ t: 'lock', id, locked: !!password });
    },
    [send],
  );

  return { state, p2p, addPicked, addText, remove, setPassword };
}
