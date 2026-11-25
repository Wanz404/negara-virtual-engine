import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EMOTES, emoteDef, emoteSrc } from '../lib/emotes';
import { formatNumber } from '../lib/format';
import { seatBadge } from '../lib/seatBadge';
import { CHAT_COOLDOWN_MS, CHAT_MAX_LENGTH, cleanProfileText, validateChatText } from '../lib/validation';
import { api, type ChatMessage, type EmoteKey, type MyCitizen, type Session } from '../services';
import { BottomSheet, Button, errorMessage } from './ui';

const KEEP = 80;

function mergeById(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  const map = new Map<number, ChatMessage>();
  for (const m of a) map.set(m.id, m);
  for (const m of b) map.set(m.id, m);
  return [...map.values()].sort((x, y) => x.id - y.id).slice(-KEEP);
}

/**
 * State Global Chat: 30 pesan terakhir dimuat saat panel dibuka, lalu pesan baru dari Realtime.
 * Bila kanal Realtime ditolak/putus (limit koneksi Free Tier), polling ringan tiap 7 dtk — HANYA selama
 * panel terbuka & tab terlihat. Semua sumber digabung lewat id (tanpa duplikat). Kanal & timer dibersihkan saat ditutup.
 */
const INITIAL_LIMIT = 30;
const POLL_MS = 7_000;

export function useGlobalChat(enabled = false) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [ready, setReady] = useState(false);

  const add = useCallback((m: ChatMessage) => setMessages((list) => mergeById(list, [m])), []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let live = false;
    const load = () =>
      api.getGlobalChat(INITIAL_LIMIT)
        .then((list) => alive && setMessages((prev) => mergeById(prev, list)))
        .catch(() => undefined);
    const unsub = api.subscribeGlobalChat({
      onInsert: add,
      onUpdate: (m) => setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, displayName: m.displayName } : x))),
      onStatus: (st) => {
        live = st === 'live';
      },
    });
    void load().finally(() => alive && setReady(true));
    const poll = setInterval(() => {
      if (alive && !live && !document.hidden) void load();
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(poll);
      unsub();
    };
  }, [enabled, add]);

  /** Sinkron lokal instan setelah ganti nama (server juga memperbarui baris & memancarkan UPDATE). */
  const renameLocal = useCallback((citizenId: string, name: string) => {
    setMessages((list) => list.map((x) => (x.citizenId === citizenId ? { ...x, displayName: name } : x)));
  }, []);

  return { messages, ready, add, renameLocal };
}

export function SeatBadge({ seat, small = false }: { seat: number; small?: boolean }) {
  const b = seatBadge(seat);
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md font-black tabular-nums ${small ? 'px-1 py-px text-[9px]' : 'px-1.5 py-0.5 text-[10px]'} ${b.glow ? 'seat-glow' : ''}`}
      style={{ background: b.bg, color: b.fg, boxShadow: `inset 0 0 0 1px ${b.ring}` }}
      title={b.caste}
    >
      {b.label}
    </span>
  );
}

function EmoteSticker({ k, size }: { k: EmoteKey; size: number }) {
  const [failed, setFailed] = useState(false);
  const def = emoteDef(k);
  if (failed) return <span style={{ fontSize: size * 0.8, lineHeight: 1 }}>{def.emoji}</span>;
  return (
    <picture>
      <source srcSet={emoteSrc(k, 'webp')} type="image/webp" />
      <img src={emoteSrc(k, 'png')} alt={def.label} width={size} height={size} loading="lazy" draggable={false} onError={() => setFailed(true)} style={{ width: size, height: size }} />
    </picture>
  );
}

export { EmoteSticker };

/** Mini ticker MLBB: 1–2 pesan terbaru semi-transparan di sudut bawah peta. */
export function ChatTicker({ messages, me, onOpen }: { messages: ChatMessage[]; me: MyCitizen | null; onOpen: () => void }) {
  const last = messages.slice(-2);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="tactile pointer-events-auto block w-full max-w-[250px] rounded-2xl bg-black/45 px-2.5 py-1.5 text-left text-white shadow-lg ring-1 ring-white/10 backdrop-blur-[2px]"
      aria-label="Buka Global Chat"
    >
      {last.length === 0 ? (
        <div className="py-0.5 text-[11px] font-bold text-white/85">💬 Global Chat — ketuk untuk ngobrol</div>
      ) : (
        last.map((m) => (
          <div key={m.id} className="animate-chat-in flex items-center gap-1 py-px text-[11px] leading-tight">
            <SeatBadge seat={m.seatNumber} small />
            {m.kind === 'system' && <span>🏛️</span>}
            <span className="max-w-[80px] shrink-0 truncate font-black text-amber-200">
              {me && m.citizenId === me.id ? me.username : m.displayName}
              {m.kind === 'system' ? '' : ':'}
            </span>
            <span className="min-w-0 truncate text-white/95">{m.message || (m.emoteKey ? `${emoteDef(m.emoteKey).emoji} ${emoteDef(m.emoteKey).label}` : '')}</span>
          </div>
        ))
      )}
    </button>
  );
}

function useCooldown(until: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [until]);
  return Math.max(0, until - now);
}

interface PendingMsg {
  tempId: string;
  message: string;
  emoteKey: EmoteKey | null;
  failed: boolean;
  error?: string;
}

/** Daftar pesan di-memo: hanya digambar ulang bila pesan / identitas berubah (bukan saat mengetik atau tik jam App). */
const ChatList = memo(function ChatList({ messages, meId, meName, onTap }: { messages: ChatMessage[]; meId: string | null; meName: string; onTap: (citizenId: string) => void }) {
  return (
    <>
      {messages.map((m) => {
        const mine = !!meId && m.citizenId === meId;
        const name = mine ? meName : m.displayName;
        if (m.kind === 'system') {
          return (
            <div key={m.id} className="animate-chat-in flex justify-center">
              <button
                type="button"
                onClick={() => onTap(m.citizenId)}
                className="flex max-w-full items-center gap-1.5 rounded-2xl bg-gradient-to-r from-amber-100 to-yellow-100 px-3 py-1.5 text-left text-[12px] leading-snug text-amber-950 ring-1 ring-amber-300"
              >
                <span>🏛️</span>
                <SeatBadge seat={m.seatNumber} small />
                <span className="min-w-0">
                  <b>{name}</b> {m.message}
                </span>
              </button>
            </div>
          );
        }
        return (
          <div key={m.id} className={`animate-chat-in rounded-2xl px-3 py-2 ${mine ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-black/[0.04]'}`}>
            <button type="button" className="flex w-full min-w-0 items-center gap-1.5 text-left" onClick={() => onTap(m.citizenId)}>
              <SeatBadge seat={m.seatNumber} />
              <span className="min-w-0 truncate text-[13px] font-black">{name}</span>
              <span className="min-w-0 shrink truncate text-[10px] font-semibold text-muted">· {m.roleTitle}</span>
              <span className="ml-auto shrink-0 text-[10px] text-muted">{new Date(m.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
            </button>
            {m.message && <div className="mt-0.5 text-[14px] leading-snug break-words whitespace-pre-wrap text-ink">{m.message}</div>}
            {m.emoteKey && (
              <div className="mt-1">
                <EmoteSticker k={m.emoteKey} size={64} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
});

/** Drawer Global Chat (Bottom Sheet). */
export function ChatSheet({
  open,
  onClose,
  messages,
  me,
  session,
  online,
  onSent,
  onRegister,
  onTapCitizen,
  toast,
}: {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  me: MyCitizen | null;
  session: Session | null;
  online: number;
  onSent: (m: ChatMessage) => void;
  onRegister: () => void;
  onTapCitizen: (citizenId: string) => void;
  toast: (m: string, k?: 'info' | 'success' | 'error') => void;
}) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState<PendingMsg[]>([]);
  const tapRef = useRef(onTapCitizen);
  tapRef.current = onTapCitizen;
  const tap = useCallback((id: string) => tapRef.current(id), []);
  const [stickers, setStickers] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [unseen, setUnseen] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastId = useRef(0);
  const left = useCooldown(cooldownUntil);
  const err = text ? validateChatText(text, false) : null;
  const len = [...cleanProfileText(text)].length;

  const scrollToBottom = (smooth: boolean) => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    atBottom.current = true;
    setUnseen(0);
  };

  // Buka sheet → langsung ke pesan terbaru.
  useLayoutEffect(() => {
    if (!open) return;
    const t = setTimeout(() => scrollToBottom(false), 30);
    return () => clearTimeout(t);
  }, [open]);

  // Auto-scroll pintar: hanya jika user sudah di posisi paling bawah (atau pesannya sendiri).
  useEffect(() => {
    const newest = messages[messages.length - 1];
    if (!newest || newest.id === lastId.current) return;
    const fresh = messages.filter((m) => m.id > lastId.current).length;
    lastId.current = newest.id;
    if (!open) return;
    if (atBottom.current || (me && newest.citizenId === me.id)) requestAnimationFrame(() => scrollToBottom(true));
    else setUnseen((n) => n + fresh);
  }, [messages, open, me]);

  function onScroll() {
    const el = bodyRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (atBottom.current) setUnseen(0);
  }

  /** Kirim optimistis: pesan tampil 0 ms dengan id sementara, RPC berjalan di belakang; gagal → tandai + kirim ulang. */
  function send(emote: EmoteKey | null, retry?: PendingMsg) {
    if (!session || !me) return;
    if (!retry && left > 0) return;
    const msg = retry ? retry.message : emote ? '' : text;
    const key = retry ? retry.emoteKey : emote;
    const v = validateChatText(msg, !!key);
    if (v) return toast(v, 'error');
    const tempId = retry?.tempId ?? `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setPending((list) => [...list.filter((x) => x.tempId !== tempId), { tempId, message: msg, emoteKey: key, failed: false }]);
    if (!retry) {
      if (!emote) setText('');
      setStickers(false);
      setCooldownUntil(Date.now() + CHAT_COOLDOWN_MS);
    }
    requestAnimationFrame(() => scrollToBottom(true));
    api
      .sendGlobalChat(session, msg, key)
      .then((m) => {
        onSent(m);
        setPending((list) => list.filter((x) => x.tempId !== tempId));
      })
      .catch((e) => {
        const message = errorMessage(e);
        const secs = /tunggu (\d+) detik/i.exec(message);
        if (secs) setCooldownUntil(Date.now() + Number(secs[1]) * 1000);
        setPending((list) => list.map((x) => (x.tempId === tempId ? { ...x, failed: true, error: message } : x)));
      });
  }

  const footer = me ? (
    <div>
      {stickers && (
        <div className="animate-picker-in mb-2 grid grid-cols-6 gap-1 rounded-2xl bg-black/5 p-1.5">
          {EMOTES.map((e) => (
            <button key={e.key} type="button" className="emote-chip flex flex-col items-center rounded-xl py-1 disabled:opacity-40" disabled={left > 0} onClick={() => send(e.key)}>
              <EmoteSticker k={e.key} size={38} />
              <span className="text-[9px] font-bold text-muted">{e.label}</span>
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          send(null);
        }}
      >
        <button
          type="button"
          className={`tactile flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl ${stickers ? 'bg-amber-300' : 'bg-black/5'}`}
          onClick={() => setStickers((s) => !s)}
          aria-label="Stiker emote"
        >
          😆
        </button>
        <div className="relative min-w-0 flex-1">
          <input
            className={`w-full rounded-2xl border bg-white px-3.5 py-2.5 pr-12 text-base text-gray-900 outline-none focus:ring-2 focus:ring-brand/30 ${err ? 'border-red-400' : 'border-black/10 focus:border-brand'}`}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, CHAT_MAX_LENGTH + 20))}
            placeholder={left > 0 ? `Tunggu ${Math.ceil(left / 1000)} dtk…` : 'Ketik pesan…'}
            enterKeyHint="send"
            autoComplete="off"
            maxLength={CHAT_MAX_LENGTH + 20}
          />
          <span className={`pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[10px] font-bold tabular-nums ${len > CHAT_MAX_LENGTH ? 'text-red-600' : 'text-muted'}`}>
            {len}/{CHAT_MAX_LENGTH}
          </span>
        </div>
        <button
          type="submit"
          disabled={!text.trim() || !!err || left > 0}
          className="hud-btn hud-sm shrink-0 disabled:opacity-50"
          aria-label="Kirim"
          style={{ width: 44, height: 44 }}
        >
          {left > 0 ? <span className="text-xs font-black">{Math.ceil(left / 1000)}</span> : <span className="hud-ico">➤</span>}
        </button>
      </form>
      {err && <div className="mt-1 px-1 text-[11px] font-semibold text-red-600">{err}</div>}
    </div>
  ) : (
    <Button className="w-full" onClick={onRegister}>
      🪪 Daftar warga untuk ikut ngobrol
    </Button>
  );

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      tall
      title="💬 Global Chat"
      headerRight={
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-black text-emerald-800">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          {formatNumber(online)} online
        </span>
      }
      bodyRef={bodyRef}
      onBodyScroll={onScroll}
      footer={footer}
    >
      <div className="relative space-y-1.5 pb-2">
        {messages.length === 0 && pending.length === 0 && (
          <div className="py-10 text-center text-sm text-muted">
            Belum ada obrolan. Jadilah yang pertama menyapa warga! 👋
            <div className="mt-1 text-[11px]">Pesan maks. {CHAT_MAX_LENGTH} karakter • jeda 4 detik • hanya 30 pesan terbaru yang dimuat.</div>
          </div>
        )}
        <ChatList messages={messages} meId={me?.id ?? null} meName={me?.username ?? ''} onTap={tap} />
        {me &&
          pending.map((x) => (
            <div key={x.tempId} className={`rounded-2xl px-3 py-2 ${x.failed ? 'bg-red-50 ring-1 ring-red-200' : 'bg-amber-50/70 ring-1 ring-amber-200'}`}>
              <div className="flex min-w-0 items-center gap-1.5">
                <SeatBadge seat={me.citizenNumber} />
                <span className="min-w-0 truncate text-[13px] font-black">{me.username}</span>
                <span className="ml-auto shrink-0 text-[10px] font-semibold text-muted">{x.failed ? '⚠️ gagal' : 'mengirim…'}</span>
              </div>
              {x.message && <div className="mt-0.5 text-[14px] leading-snug break-words whitespace-pre-wrap text-ink">{x.message}</div>}
              {x.emoteKey && (
                <div className="mt-1">
                  <EmoteSticker k={x.emoteKey} size={64} />
                </div>
              )}
              {x.failed && (
                <div className="mt-1 flex items-center gap-2 text-[11px]">
                  <span className="min-w-0 flex-1 truncate font-semibold text-red-700">{x.error}</span>
                  <button type="button" className="shrink-0 rounded-lg bg-red-600 px-2 py-0.5 font-black text-white" onClick={() => send(x.emoteKey, x)}>
                    Kirim ulang
                  </button>
                  <button type="button" className="shrink-0 font-semibold text-muted underline" onClick={() => setPending((l) => l.filter((y) => y.tempId !== x.tempId))}>
                    Hapus
                  </button>
                </div>
              )}
            </div>
          ))}
      </div>
      {unseen > 0 && (
        <div className="pointer-events-none sticky bottom-2 flex justify-center">
          <button type="button" className="tactile pointer-events-auto rounded-full bg-brand px-3 py-1.5 text-xs font-black text-white shadow-lg" onClick={() => scrollToBottom(true)}>
            ⬇ {unseen} pesan baru
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
