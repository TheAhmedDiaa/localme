import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import QRCode from 'qrcode';
import type { Device, ItemMeta, RoomInfo } from '@localme/shared';
import { ROOM_CODE_RE } from '@localme/shared';
import { useI18n } from '../lib/i18n';
import { fileBadge, formatSize } from '../lib/format';
import { copyText } from '../lib/clipboard';
import { Icon } from './Icon';

// ───────────────────────────── generic modal ─────────────────────────────

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // keep the page from scrolling behind a dialog
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('close')}>
            <Icon name="x" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ───────────────────────────── password dialogs ─────────────────────────────

/** Downloader side: ask for the password of a protected file. */
export function PasswordPrompt({
  name,
  wrong,
  onSubmit,
  onClose,
}: {
  name: string;
  wrong: boolean;
  onSubmit: (pw: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [pw, setPw] = useState('');
  return (
    <Modal title={name} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (pw) onSubmit(pw);
        }}
      >
        <p className="muted">{t('passwordNeeded')}</p>
        {wrong && <p className="error">{t('wrongPassword')}</p>}
        <input type="password" autoFocus autoComplete="off" aria-label={t('password')} placeholder={t('password')} value={pw} onChange={(e) => setPw(e.target.value)} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={!pw}>
            {t('download')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Owner side: set / change / remove the password of one of your files. */
export function SetPasswordDialog({
  name,
  current,
  onSave,
  onClose,
}: {
  name: string;
  current: string;
  onSave: (pw: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [pw, setPw] = useState(current);
  return (
    <Modal title={t('setPasswordTitle')} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(pw);
        }}
      >
        <p className="muted">
          <b>{name}</b>
          <br />
          {t('setPasswordHelp')}
        </p>
        <input type="text" autoFocus autoComplete="off" aria-label={t('password')} placeholder={t('password')} value={pw} onChange={(e) => setPw(e.target.value)} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="btn primary">
            {t('ok')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ───────────────────────────── send-to picker ─────────────────────────────

/** Choose who can see what you share: everyone in the room, or one device. '' = everyone. */
export function TargetPicker({ devices, value, onChange }: { devices: Device[]; value: string; onChange: (id: string) => void }) {
  const { t, deviceName } = useI18n();
  const labelId = useId();
  if (!devices.length) return null;
  return (
    <div className="field">
      <span className="field-label" id={labelId}>
        {t('sendTo')}
      </span>
      <div className="target-picker" role="radiogroup" aria-labelledby={labelId}>
        <button type="button" role="radio" aria-checked={value === ''} className={`target${value === '' ? ' on' : ''}`} onClick={() => onChange('')}>
          <Icon name="wifi" size={16} />
          {t('everyone')}
        </button>
        {devices.map((d) => (
          <button key={d.id} type="button" role="radio" aria-checked={value === d.id} className={`target${value === d.id ? ' on' : ''}`} onClick={() => onChange(d.id)}>
            <Avatar device={d} />
            {deviceName(d)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────────── share (password choice) dialog ─────────────────────────────

/** Shown before anything is shared: protect with a password or not. */
export function ShareDialog({
  names,
  devices,
  onConfirm,
  onClose,
}: {
  names: string[];
  devices: Device[];
  onConfirm: (password: string, to: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [pw, setPw] = useState('');
  const [to, setTo] = useState('');
  const shown = names.slice(0, 4);
  const inputId = useId();
  const hintId = useId();
  return (
    <Modal title={t('shareTitle', { n: names.length })} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(pw, to);
        }}
      >
        <ul className="share-list">
          {shown.map((n, i) => (
            <li key={i}>
              <span className="share-name">
                <bdi>{n}</bdi>
              </span>
            </li>
          ))}
          {names.length > shown.length && <li className="share-more">+{names.length - shown.length}</li>}
        </ul>
        <div className="field">
          <label className="field-label" htmlFor={inputId}>
            {t('passwordOptional')}
          </label>
          <input id={inputId} type="text" autoFocus autoComplete="off" aria-describedby={hintId} placeholder={t('password')} value={pw} onChange={(e) => setPw(e.target.value)} />
          <div className="field-hint" id={hintId}>
            {t('shareHint')}
          </div>
        </div>
        <TargetPicker devices={devices} value={to} onChange={setTo} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="btn primary">
            <Icon name={pw ? 'lock' : 'check'} size={16} />
            {pw ? t('shareWithPw') : t('shareNoPw')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ───────────────────────────── text dialog ─────────────────────────────

export function TextDialog({ devices, onSubmit, onClose }: { devices: Device[]; onSubmit: (text: string, to: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [to, setTo] = useState('');
  return (
    <Modal title={t('addText')} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onSubmit(text, to);
        }}
      >
        <textarea autoFocus aria-label={t('addText')} rows={7} maxLength={20000} placeholder={t('textPlaceholder')} value={text} onChange={(e) => setText(e.target.value)} />
        <TargetPicker devices={devices} value={to} onChange={setTo} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={!text.trim()}>
            {t('share')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ───────────────────────────── room dialog ─────────────────────────────

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function RoomDialog({
  room,
  onSwitch,
  onClose,
}: {
  room: RoomInfo | null;
  onSwitch: (code: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [join, setJoin] = useState('');
  const [err, setErr] = useState(false);
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState<'' | 'code' | 'link'>('');
  const doCopy = async (what: 'code' | 'link', text: string) => {
    if (await copyText(text)) {
      setCopied(what);
      setTimeout(() => setCopied(''), 1500);
    }
  };
  const link = room?.code ? `${location.origin}/?room=${room.code}` : '';

  useEffect(() => {
    if (!link) return setQr('');
    QRCode.toDataURL(link, { margin: 1, width: 220 }).then(setQr, () => setQr(''));
  }, [link]);

  return (
    <Modal title={room?.kind === 'private' ? t('roomPrivate') : t('roomNetwork')} onClose={onClose}>
      {room?.kind === 'private' && room.code ? (
        <div className="room-private">
          <p className="muted">{t('scanQr')}</p>
          {qr && <img className="qr" src={qr} alt="QR" width={220} height={220} />}
          <div className="code" dir="ltr">
            {room.code}
          </div>
          <div className="copy-row">
            <button className="btn" onClick={() => void doCopy('code', room.code!)}>
              <Icon name={copied === 'code' ? 'check' : 'copy'} size={16} />
              {copied === 'code' ? t('copied') : t('copyCode')}
            </button>
            <button className="btn" onClick={() => void doCopy('link', link)}>
              <Icon name={copied === 'link' ? 'check' : 'copy'} size={16} />
              {copied === 'link' ? t('copied') : t('copyLink')}
            </button>
          </div>
          <button className="btn wide leave" onClick={() => onSwitch(null)}>
            <Icon name="wifi" size={16} />
            {t('leaveRoom')}
          </button>
        </div>
      ) : (
        <div className="room-pick">
          <p className="room-note">
            <Icon name="wifi" size={18} />
            <span>{t('roomNetworkNote')}</span>
          </p>
          <section className="room-card">
            <h3>{t('createRoom')}</h3>
            <p className="muted">{t('createRoomHint')}</p>
            <button className="btn primary wide" onClick={() => onSwitch(newRoomCode())}>
              <Icon name="key" size={16} />
              {t('createRoomBtn')}
            </button>
          </section>
          <section className="room-card">
            <h3>{t('joinRoom')}</h3>
          <form
            className="join-row"
            onSubmit={(e) => {
              e.preventDefault();
              const c = join.trim().toUpperCase();
              if (ROOM_CODE_RE.test(c)) onSwitch(c);
              else setErr(true);
            }}
          >
            <input
              dir="ltr"
              maxLength={6}
              aria-label={t('roomCode')}
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              placeholder={t('roomCode')}
              value={join}
              onChange={(e) => {
                setJoin(e.target.value.toUpperCase());
                setErr(false);
              }}
            />
            <button className="btn" type="submit">
              {t('join')}
            </button>
          </form>
          {err && <p className="error">{t('invalidCode')}</p>}
          </section>
        </div>
      )}
    </Modal>
  );
}

// ───────────────────────────── devices ─────────────────────────────

function hueOf(d: Device) {
  return (d.animal * 53 + d.num * 7) % 360;
}

export function Avatar({ device, big }: { device: Device | null; big?: boolean }) {
  const { deviceName } = useI18n();
  const initial = device ? (Array.from(deviceName(device))[0] ?? '?') : '…';
  const style = { '--h': device ? hueOf(device) : 180 } as CSSProperties;
  return (
    <span className={`avatar${big ? ' big' : ''}`} style={style} aria-hidden="true">
      {initial}
    </span>
  );
}

/** "You are Fox 42" card plus the other devices currently in this room. */
export function Presence({ you, devices, online }: { you: Device | null; devices: Device[]; online: boolean }) {
  const { t, deviceName } = useI18n();
  const others = devices.filter((d) => d.id !== you?.id);
  return (
    <section className={`presence${online ? '' : ' offline'}`} aria-label={t('devices')}>
      <div className="you-card">
        <Avatar device={you} big />
        <div>
          <p className="you-label">{t('youAre')}</p>
          <p className="you-name">{deviceName(you ?? undefined)}</p>
        </div>
      </div>
      <p className="nearby" aria-live="polite">
        {others.length === 0 ? t('alone') : others.length === 1 ? t('nearbyOne') : t('nearby', { n: others.length })}
      </p>
      {others.length > 0 && (
        <ul className="peer-list">
          {others.map((d) => (
            <li key={d.id} className="peer">
              <Avatar device={d} />
              <span>{deviceName(d)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ───────────────────────────── item list ─────────────────────────────

export interface ItemActions {
  download(item: ItemMeta): void;
  preview(item: ItemMeta): void;
  copyText(item: ItemMeta): void;
  askPassword(item: ItemMeta): void;
  remove(item: ItemMeta): void;
}

export function ItemRow({
  item,
  mine,
  ownerName,
  toName,
  actions,
  copied,
}: {
  item: ItemMeta;
  mine: boolean;
  ownerName: string;
  toName?: string;
  actions: ItemActions;
  copied: boolean;
}) {
  const { t } = useI18n();
  const canPreview = item.kind === 'file' && item.mime.startsWith('image/') && item.size <= 25 * 1024 * 1024;
  const badge = fileBadge(item.kind, item.mime, item.name);
  return (
    <li className="row">
      <span className={`file-badge ${badge.cls}`} aria-hidden="true">
        {badge.label}
      </span>
      <div className="row-main">
        <div className="row-name">
          {item.kind === 'text' ? (
            <p className="text-body" dir="auto">
              {item.text?.slice(0, 400)}
            </p>
          ) : (
            <span title={item.path}>
              <bdi>{item.path}</bdi>
            </span>
          )}
          {item.to && (
            <span className="badge">
              <Icon name="eye" size={12} />
              {mine ? t('onlyFor', { name: toName ?? '…' }) : t('privateToYou')}
            </span>
          )}
          {item.locked && (
            <span className="badge">
              <Icon name="lock" size={12} />
              {t('protectedFile')}
            </span>
          )}
        </div>
        <div className="row-meta">
          <span>{formatSize(item.size)}</span>
          <span>{mine ? t('sharedByMe') : t('from', { name: ownerName })}</span>
        </div>
      </div>
      <div className="row-actions">
        {item.kind === 'text' ? (
          <button className="btn small" onClick={() => actions.copyText(item)}>
            <Icon name={copied ? 'check' : 'copy'} size={16} />
            {copied ? t('copied') : t('copy')}
          </button>
        ) : (
          <>
            {canPreview && (
              <button className="btn small icon" onClick={() => actions.preview(item)} aria-label={t('preview')} title={t('preview')}>
                <Icon name="eye" size={18} />
              </button>
            )}
            <button className="btn small primary" onClick={() => actions.download(item)}>
              <Icon name="download" size={16} />
              {t('download')}
            </button>
            {mine && (
              <button
                className="btn small icon"
                onClick={() => actions.askPassword(item)}
                aria-label={item.locked ? t('unlock') : t('lock')}
                title={item.locked ? t('unlock') : t('lock')}
              >
                <Icon name={item.locked ? 'unlock' : 'lock'} size={18} />
              </button>
            )}
          </>
        )}
        {mine && (
          <button className="btn small icon danger" onClick={() => actions.remove(item)} title={t('remove')} aria-label={t('remove')}>
            <Icon name="trash" size={18} />
          </button>
        )}
      </div>
    </li>
  );
}

// ───────────────────────────── transfers ─────────────────────────────

export interface Transfer {
  id: string;
  name: string;
  done: number;
  total: number;
  state: 'active' | 'done' | 'error';
  msg?: string;
  /** smoothed bytes per second while active */
  speed?: number;
}

/** 75 -> "1:15", 3700 -> "1:01:40" (digits only, works in any language) */
function formatEta(sec: number): string {
  const s = Math.max(1, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export function TransferPanel({
  transfers,
  onStop,
  onDismiss,
}: {
  transfers: Transfer[];
  onStop(id: string): void;
  onDismiss(id: string): void;
}) {
  const { t } = useI18n();
  if (!transfers.length) return null;
  return (
    <div className="transfers">
      <h2>{t('transfers')}</h2>
      {transfers.map((x) => {
        const pct = x.total > 0 ? Math.min(100, Math.round((x.done / x.total) * 100)) : x.state === 'done' ? 100 : 0;
        return (
          <div key={x.id} className={`transfer ${x.state}`}>
            <div className="transfer-top">
              <span className="transfer-name">{x.name}</span>
              {x.state === 'active' ? (
                <button className="link" onClick={() => onStop(x.id)}>
                  {t('stop')}
                </button>
              ) : (
                <button className="link" onClick={() => onDismiss(x.id)}>
                  {t('dismiss')}
                </button>
              )}
            </div>
            <div className="bar" role="progressbar" aria-label={x.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={x.state === 'error' ? 100 : pct}>
              <div style={{ width: `${x.state === 'error' ? 100 : pct}%` }} />
            </div>
            <small className="muted">
              {x.state === 'error' ? `${t('failed')}: ${x.msg ?? ''}` : x.state === 'done' ? t('done') : `${formatSize(x.done)} / ${x.total ? formatSize(x.total) : '…'}  (${pct}%)${x.speed ? ` · ${formatSize(x.speed)}/s` : ''}${x.speed && x.total > x.done ? ` · ${t('timeLeft', { time: formatEta((x.total - x.done) / x.speed) })}` : ''}`}
            </small>
          </div>
        );
      })}
    </div>
  );
}
