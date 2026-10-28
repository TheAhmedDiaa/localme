import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadZip } from 'client-zip';
import { ROOM_CODE_RE, type ItemMeta } from '@localme/shared';
import { useI18n } from './lib/i18n';
import { useRoom } from './lib/useRoom';
import { local, uid } from './lib/registry';
import { fromDrop, fromInput } from './lib/files';
import { openSink, SaveCancelled } from './lib/sink';
import { copyText } from './lib/clipboard';
import { DenyError, type Download } from './lib/p2p';
import { uniquePath } from './lib/format';
import {
  ItemRow,
  Modal,
  PasswordPrompt,
  Presence,
  RoomDialog,
  SetPasswordDialog,
  ShareDialog,
  TextDialog,
  TransferPanel,
  type ItemActions,
  type Transfer,
} from './components/ui';
import { Icon } from './components/Icon';

type Mode = 'download' | 'preview';

function roomFromUrl(): string | null {
  const c = (new URLSearchParams(location.search).get('room') ?? '').toUpperCase();
  return ROOM_CODE_RE.test(c) ? c : null;
}

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('lm-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))] as const;
}

export default function App() {
  const { t, lang, toggleLang, deviceName } = useI18n();
  const [theme, toggleTheme] = useTheme();
  const [code, setCode] = useState<string | null>(roomFromUrl);
  const { state, p2p, addPicked, addText, remove, setPassword, rename } = useRoom(code);
  const { you, items, devices, room } = state;

  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'text' | 'room'>(null);
  const [ask, setAsk] = useState<null | { item: ItemMeta; mode: Mode; wrong: boolean }>(null);
  const [setPw, setSetPw] = useState<ItemMeta | null>(null);
  const [previewing, setPreviewing] = useState<null | { url: string; name: string }>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<ReturnType<typeof fromInput> | null>(null);

  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const aborts = useRef(new Map<string, AbortController>());
  const progress = useRef(new Map<string, number>());
  const samples = useRef(new Map<string, { t: number; done: number; speed: number }>());
  const flushTimer = useRef<number | null>(null);

  // ───────── progress (throttled so big files don't re-render 60k times) ─────────
  const bump = useCallback((id: string, n: number) => {
    progress.current.set(id, (progress.current.get(id) ?? 0) + n);
    if (flushTimer.current !== null) return;
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = null;
      const snap = new Map(progress.current);
      const now = performance.now();
      const speeds = new Map<string, number>();
      for (const [id, done] of snap) {
        const prev = samples.current.get(id);
        let speed = prev?.speed ?? 0;
        if (prev && now > prev.t) {
          const inst = ((done - prev.done) / (now - prev.t)) * 1000;
          speed = prev.speed ? prev.speed * 0.7 + inst * 0.3 : inst; // smoothed
        }
        samples.current.set(id, { t: now, done, speed });
        speeds.set(id, speed);
      }
      setTransfers((ts) =>
        ts.map((x) => (x.state === 'active' && snap.has(x.id) ? { ...x, done: snap.get(x.id)!, speed: speeds.get(x.id) } : x)),
      );
    }, 200);
  }, []);

  const patch = useCallback((id: string, p: Partial<Transfer>) => setTransfers((ts) => ts.map((x) => (x.id === id ? { ...x, ...p } : x))), []);
  const dropTransfer = useCallback((id: string) => {
    progress.current.delete(id);
    samples.current.delete(id);
    setTransfers((ts) => ts.filter((x) => x.id !== id));
  }, []);

  // ───────── getting an item's bytes (local file, or P2P from its owner) ─────────
  const fetchItem = useCallback(
    async (item: ItemMeta, password: string | undefined, onBytes?: (n: number) => void): Promise<Download> => {
      if (item.kind === 'text') {
        const bytes = new TextEncoder().encode(item.text ?? '');
        return { name: `${item.name || 'text'}.txt`, size: bytes.length, mime: 'text/plain', stream: new Blob([bytes]).stream() };
      }
      const own = item.ownerId === you?.id ? local.get(item.id)?.file : undefined;
      if (own) return { name: own.name, size: own.size, mime: own.type || 'application/octet-stream', stream: own.stream() };
      return p2p.download(item.ownerId, item.id, password, onBytes);
    },
    [p2p, you],
  );

  const run = useCallback(
    async (item: ItemMeta, mode: Mode, password?: string) => {
      setNotice(null);
      const tid = uid();
      const ac = new AbortController();
      aborts.current.set(tid, ac);
      const isDownload = mode === 'download';
      if (isDownload) setTransfers((ts) => [...ts, { id: tid, name: item.name, done: 0, total: item.size, state: 'active' }]);
      try {
        const src = await fetchItem(item, password, isDownload ? (n) => bump(tid, n) : undefined);
        if (isDownload) {
          const sink = await openSink(src.name, src.size, src.mime);
          await src.stream.pipeTo(sink, { signal: ac.signal });
          patch(tid, { state: 'done', done: src.size });
        } else {
          const blob = await new Response(src.stream).blob();
          setPreviewing({ url: URL.createObjectURL(new Blob([blob], { type: item.mime })), name: item.name });
        }
      } catch (e) {
        if (isDownload) dropTransfer(tid);
        if (e instanceof DenyError && e.why === 'password') return setAsk({ item, mode, wrong: password !== undefined });
        if (e instanceof SaveCancelled || ac.signal.aborted) return;
        const msg = e instanceof DenyError ? t('ownerGone') : t('interrupted');
        if (isDownload) setTransfers((ts) => [...ts, { id: tid, name: item.name, done: 0, total: item.size, state: 'error', msg }]);
        else setNotice(msg);
      } finally {
        aborts.current.delete(tid);
      }
    },
    [bump, dropTransfer, fetchItem, patch, t],
  );

  const downloadAll = useCallback(async () => {
    const list = items.filter((i) => i.ownerId === you?.id || !i.locked);
    const skipped = items.length - list.length;
    setNotice(skipped ? t('lockedSkipped', { n: skipped }) : null);
    if (!list.length) return;

    let sink: WritableStream<Uint8Array>;
    try {
      sink = await openSink('LocalMe.zip', undefined, 'application/zip'); // first await: keeps the user gesture
    } catch {
      return;
    }
    const tid = uid();
    const ac = new AbortController();
    aborts.current.set(tid, ac);
    const total = list.reduce((s, i) => s + i.size, 0);
    setTransfers((ts) => [...ts, { id: tid, name: 'LocalMe.zip', done: 0, total, state: 'active' }]);

    const used = new Set<string>();
    async function* entries() {
      for (const it of list) {
        if (ac.signal.aborted) return;
        try {
          if (it.kind === 'text') {
            const base = it.name.replace(/[\\/:*?"<>|]/g, '_') || 'text';
            yield { name: uniquePath(`${base}.txt`, used), input: it.text ?? '', lastModified: new Date(it.addedAt) };
          } else {
            const src = await fetchItem(it, undefined, (n) => bump(tid, n));
            yield { name: uniquePath(it.path, used), input: src.stream, lastModified: new Date() };
          }
        } catch {
          /* owner left or denied: skip this one */
        }
      }
    }

    try {
      await downloadZip(entries()).body!.pipeTo(sink, { signal: ac.signal });
      patch(tid, { state: 'done', done: total });
    } catch (e) {
      if (ac.signal.aborted) dropTransfer(tid);
      else patch(tid, { state: 'error', msg: e instanceof Error ? e.message : t('interrupted') });
    } finally {
      aborts.current.delete(tid);
    }
  }, [bump, dropTransfer, fetchItem, items, patch, t, you]);

  // ───────── adding things ─────────
  // Files are not shared yet: first ask whether to protect them with a password.
  const onPicked = useCallback((picked: ReturnType<typeof fromInput>) => {
    if (picked.length) setPending((p) => [...(p ?? []), ...picked]);
  }, []);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void fromDrop(e.dataTransfer!).then(onPicked);
    };
    const paste = (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) onPicked(files.map((file) => ({ file, path: file.name })));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
      window.removeEventListener('paste', paste);
    };
  }, [onPicked]);

  // keep the screen awake while we're sharing (phones sleep tabs -> transfers die)
  const sharingCount = items.filter((i) => i.ownerId === you?.id).length;
  useEffect(() => {
    if (!sharingCount || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = () => {
      if (document.visibilityState !== 'visible' || lock) return;
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (cancelled) return void l.release();
          lock = l;
          l.addEventListener('release', () => (lock = null));
        })
        .catch(() => {});
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release();
    };
  }, [sharingCount]);

  useEffect(() => {
    if (!previewing) return;
    return () => URL.revokeObjectURL(previewing.url);
  }, [previewing]);

  // ───────── rooms ─────────
  const switchRoom = (next: string | null) => {
    if (local.size && !window.confirm(t('switchConfirm'))) return;
    local.clear();
    history.pushState(null, '', next ? `?room=${next}` : location.pathname);
    setCode(next);
    setDialog(null);
  };

  // ───────── row actions ─────────
  const actions: ItemActions = {
    download: (item) => void run(item, 'download'),
    preview: (item) => void run(item, 'preview'),
    copyText: (item) => {
      void copyText(item.text ?? '').then((ok) => {
        if (!ok) return;
        setCopiedId(item.id);
        setTimeout(() => setCopiedId((c) => (c === item.id ? null : c)), 1500);
      });
    },
    askPassword: (item) => setSetPw(item),
    remove: (item) => remove([item.id]),
  };

  const byId = new Map(devices.map((d) => [d.id, d]));
  const others = devices.filter((d) => d.id !== you?.id);
  const sorted = [...items].sort((a, b) => b.addedAt - a.addedAt);
  const countLabel = sorted.length === 1 ? t('itemOne') : t('items', { n: sorted.length });
  const roomLabel = room?.kind === 'private' ? `${t('roomPrivate')} · ${room.code}` : t('roomNetwork');

  return (
    <div className="app">
      <a className="skip" href="#main">
        {t('skipLink')}
      </a>
      <header className="top">
        <h1 className="brand">
          <span className="logo" aria-hidden="true">
            <Icon name="download" size={20} />
          </span>
          LocalMe
        </h1>
        <div className="top-actions">
          <button className="btn small room-btn" onClick={() => setDialog('room')} aria-label={roomLabel} title={roomLabel}>
            <Icon name={room?.kind === 'private' ? 'key' : 'wifi'} size={16} />
            <span className="room-label hide-sm">{roomLabel}</span>
          </button>
          <button className="btn small" onClick={toggleLang} aria-label={t('language')} lang={lang === 'en' ? 'ar' : 'en'}>
            <Icon name="globe" size={16} />
            <span className="hide-sm">{t('language')}</span>
          </button>
          <button className="icon-btn" onClick={toggleTheme} aria-label={t('theme')} title={t('theme')}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="side">
          <p className="tagline">{t('tagline')}</p>

          <Presence you={you} devices={devices} online={state.status === 'online'} onRename={rename} />

          <section className="actions" aria-label={t('addTitle')}>
            <button className="btn primary act" onClick={() => filesInput.current?.click()}>
              <span className="act-icon">
                <Icon name="plus" size={20} />
              </span>
              <span>{t('addFiles')}</span>
            </button>
            <button className="btn act" onClick={() => folderInput.current?.click()}>
              <span className="act-icon">
                <Icon name="folder" size={20} />
              </span>
              <span>{t('addFolder')}</span>
            </button>
            <button className="btn act" onClick={() => setDialog('text')}>
              <span className="act-icon">
                <Icon name="note" size={20} />
              </span>
              <span>{t('addText')}</span>
            </button>
          </section>
        </aside>

        <main id="main" className="content" tabIndex={-1}>
          {state.status !== 'online' && (
            <div className="banner" role="status">
              {state.status === 'connecting' ? t('connecting') : t('offline')}
            </div>
          )}
          {state.error === 'room-full' && (
            <div className="banner warn" role="alert">
              {t('roomFull')}
            </div>
          )}
          {notice && (
            <div className="banner warn" role="status">
              {notice}
            </div>
          )}

          <div className="list-head">
            <h2>
              {t('sharedHeading')} <span className="count">{countLabel}</span>
            </h2>
            <div className="list-tools">
              <button className="btn small" disabled={!items.length} onClick={() => void downloadAll()}>
                <Icon name="download" size={16} />
                {t('downloadAll')}
              </button>
              <button
                className="btn small danger"
                disabled={!sharingCount}
                onClick={() => {
                  if (window.confirm(t('deleteAllConfirm', { n: sharingCount }))) {
                    remove(items.filter((i) => i.ownerId === you?.id).map((i) => i.id));
                  }
                }}
              >
                <Icon name="trash" size={16} />
                {t('deleteAll')}
              </button>
            </div>
          </div>

        <input ref={filesInput} type="file" multiple hidden onChange={(e) => (onPicked(fromInput(e.target.files)), (e.target.value = ''))} />
        <input
          ref={folderInput}
          type="file"
          hidden
          // @ts-expect-error non-standard but widely supported attribute
          webkitdirectory=""
          onChange={(e) => (onPicked(fromInput(e.target.files)), (e.target.value = ''))}
        />

        {sorted.length ? (
          <ul className="list">
            {sorted.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                mine={item.ownerId === you?.id}
                ownerName={deviceName(byId.get(item.ownerId))}
                toName={item.to ? deviceName(byId.get(item.to)) : undefined}
                actions={actions}
                copied={copiedId === item.id}
              />
            ))}
          </ul>
        ) : (
          <div className="empty">
            <span className="empty-icon" aria-hidden="true">
              <Icon name="tray" size={30} />
            </span>
            <b>{t('empty')}</b>
            <p className="muted">{t('emptySub')}</p>
            <p className="muted drop-hint">{t('dropHere')}</p>
          </div>
        )}

        <p className="footnote">{t('keepOpen')}</p>
        </main>
      </div>

      <TransferPanel
        transfers={transfers}
        onStop={(id) => aborts.current.get(id)?.abort()}
        onDismiss={dropTransfer}
      />

      {dragging && <div className="dropzone">{t('dropHere')}</div>}

      {dialog === 'text' && (
        <TextDialog
          devices={others}
          onClose={() => setDialog(null)}
          onSubmit={(text, to) => {
            addText(text, to || undefined);
            setDialog(null);
          }}
        />
      )}
      {pending && (
        <ShareDialog
          names={pending.map((p) => p.path)}
          devices={others}
          onClose={() => setPending(null)}
          onConfirm={(pw, to) => {
            addPicked(pending, pw, to || undefined);
            setPending(null);
          }}
        />
      )}
      {dialog === 'room' && <RoomDialog room={room} onSwitch={switchRoom} onClose={() => setDialog(null)} />}
      {ask && (
        <PasswordPrompt
          name={ask.item.name}
          wrong={ask.wrong}
          onClose={() => setAsk(null)}
          onSubmit={(pw) => {
            const a = ask;
            setAsk(null);
            void run(a.item, a.mode, pw);
          }}
        />
      )}
      {setPw && (
        <SetPasswordDialog
          name={setPw.name}
          current={local.get(setPw.id)?.password ?? ''}
          onClose={() => setSetPw(null)}
          onSave={(pw) => {
            setPassword(setPw.id, pw);
            setSetPw(null);
          }}
        />
      )}
      {previewing && (
        <Modal title={previewing.name} onClose={() => setPreviewing(null)}>
          <img className="preview" src={previewing.url} alt={previewing.name} />
        </Modal>
      )}
    </div>
  );
}
