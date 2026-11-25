import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { EMOTES, EMOTE_COOLDOWN_MS, EMOTE_DURATION_MS, emoteDef, isEmoteKey, preloadEmotes } from '../lib/emotes';
import { haptic } from '../lib/fx';
import { cleanProfileText } from '../lib/validation';
import { api, type EmoteChannel, type EmoteEvent, type EmoteKey, type MyCitizen } from '../services';
import { playEmoteSfx } from '../utils/emoteSfx';
import { SeatBadge, EmoteSticker } from './GlobalChat';
import type { MapViewHandle } from './MapView';

interface FloatingEmote {
  id: number;
  key: EmoteKey;
  name: string;
  seat: number;
}

const SENDER_THROTTLE_MS = 2000;

/**
 * Emote via Supabase Realtime Broadcast (event 'citizen_emote') — tidak menyentuh database.
 * Emote ditampilkan di atas kepala karakter di peta; bila warga tidak tampil di peta, muncul sebagai
 * kartu melayang kecil (fallback DOM) agar tetap terlihat.
 */
export function useEmotes(me: MyCitizen | null, mapRef: RefObject<MapViewHandle | null>) {
  const chanRef = useRef<EmoteChannel | null>(null);
  const lastBySender = useRef(new Map<string, number>());
  const [floating, setFloating] = useState<FloatingEmote[]>([]);
  const [lastSentAt, setLastSentAt] = useState(0);
  const idRef = useRef(1);

  const display = useCallback(
    (e: EmoteEvent, own: boolean) => {
      const onMap = mapRef.current?.showEmote(e.citizen_id, e.emote_key) ?? false;
      if (!onMap) {
        const id = idRef.current++;
        setFloating((list) => [...list.slice(-2), { id, key: e.emote_key, name: e.display_name, seat: e.seat_number }]);
        setTimeout(() => setFloating((list) => list.filter((x) => x.id !== id)), EMOTE_DURATION_MS + 100);
      }
      playEmoteSfx(e.emote_key, own);
    },
    [mapRef],
  );

  useEffect(() => {
    preloadEmotes();
    const ch = api.joinEmotes((raw) => {
      // Payload broadcast tidak terautentikasi → validasi ketat di sisi penerima.
      if (!raw || typeof raw !== 'object') return;
      if (!isEmoteKey(raw.emote_key) || typeof raw.citizen_id !== 'string' || raw.citizen_id.length > 64) return;
      const seat = Number(raw.seat_number);
      if (!Number.isFinite(seat) || seat < 1 || seat > 10_000_000) return;
      const now = Date.now();
      const last = lastBySender.current.get(raw.citizen_id) ?? 0;
      if (now - last < SENDER_THROTTLE_MS) return;
      lastBySender.current.set(raw.citizen_id, now);
      if (lastBySender.current.size > 500) lastBySender.current.clear();
      const name = cleanProfileText(String(raw.display_name ?? '')).replace(/[<>]/g, '').slice(0, 24) || `Warga ${seat}`;
      display({ citizen_id: raw.citizen_id, seat_number: Math.floor(seat), display_name: name, emote_key: raw.emote_key, timestamp: now }, false);
    });
    chanRef.current = ch;
    return () => {
      ch.leave();
      chanRef.current = null;
    };
  }, [display]);

  const cooldownLeft = (now = Date.now()) => Math.max(0, lastSentAt + EMOTE_COOLDOWN_MS - now);

  const send = useCallback(
    (key: EmoteKey): boolean => {
      if (!me) return false;
      if (Date.now() - lastSentAt < EMOTE_COOLDOWN_MS) return false;
      const e: EmoteEvent = { citizen_id: me.id, seat_number: me.citizenNumber, display_name: me.username, emote_key: key, timestamp: Date.now() };
      setLastSentAt(Date.now());
      haptic(20);
      display(e, true);
      chanRef.current?.send(e);
      return true;
    },
    [me, lastSentAt, display],
  );

  return { send, floating, lastSentAt, cooldownLeft };
}

/** Progress cooldown 0→1 (rAF) untuk ring tipis di tombol emote. */
function useCooldownProgress(lastSentAt: number): number {
  const [p, setP] = useState(1);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = Math.min(1, (Date.now() - lastSentAt) / EMOTE_COOLDOWN_MS);
      setP(v);
      if (v < 1) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [lastSentAt]);
  return p;
}

/** Tombol Emote HUD + bar picker melayang. */
export function EmotePicker({
  enabled,
  lastSentAt,
  onPick,
  onLocked,
}: {
  enabled: boolean;
  lastSentAt: number;
  onPick: (k: EmoteKey) => boolean;
  onLocked: () => void;
}) {
  const [open, setOpen] = useState(false);
  const p = useCooldownProgress(lastSentAt);
  const cooling = p < 1;
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      {open && (
        <div className="hud-panel animate-picker-in absolute right-0 bottom-[calc(100%+12px)] z-10 grid w-[min(86vw,316px)] grid-cols-3 gap-1.5 rounded-3xl p-2">
          {EMOTES.map((e) => (
            <button
              key={e.key}
              type="button"
              disabled={cooling}
              className="emote-chip flex flex-col items-center rounded-2xl bg-white/10 py-1.5 disabled:opacity-45"
              onClick={() => {
                if (onPick(e.key)) setOpen(false);
              }}
            >
              <EmoteSticker k={e.key} size={52} />
              <span className="mt-0.5 text-[10px] font-black text-amber-100">{e.label}</span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className={`hud-btn hud-gold hud-lg ${open ? 'ring-4 ring-amber-200/80' : ''}`}
        aria-label="Emote"
        aria-expanded={open}
        onClick={() => {
          if (!enabled) return onLocked();
          setOpen((o) => !o);
        }}
      >
        <span className="hud-ico" style={{ opacity: cooling ? 0.55 : 1 }}>😆</span>
        <span className="hud-lbl">Emote</span>
        {cooling && <span className="cooldown-ring" style={{ ['--p' as string]: p }} />}
      </button>
    </div>
  );
}

/** Kartu emote melayang untuk warga yang sedang tidak tampil di peta. */
export function FloatingEmotes({ items }: { items: FloatingEmote[] }) {
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[38%] z-20 flex flex-col items-center gap-2">
      {items.map((f) => (
        <div key={f.id} className="animate-emote-pop flex items-center gap-2 rounded-2xl bg-black/55 py-1 pr-3 pl-1 text-white shadow-xl backdrop-blur-sm">
          <EmoteSticker k={f.key} size={44} />
          <div className="leading-tight">
            <div className="text-[12px] font-black">{f.name}</div>
            <div className="flex items-center gap-1 text-[10px] text-white/80">
              <SeatBadge seat={f.seat} small /> {emoteDef(f.key).label}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
