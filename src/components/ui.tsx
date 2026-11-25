import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type PointerEvent as RPointerEvent, type ReactNode, type Ref } from 'react';
import { playClick } from '../lib/fx';

const SHEET_ENTER = 'transform 460ms cubic-bezier(0.22, 1.28, 0.36, 1)';
const SHEET_EXIT = 'transform 240ms cubic-bezier(0.4, 0, 1, 1)';
const SHEET_SNAP = 'transform 360ms cubic-bezier(0.22, 1.3, 0.36, 1)';

/**
 * Bottom Sheet draggable ala mobile game:
 * backdrop blur, drag handle (swipe down untuk tutup, flick cepat juga menutup), transisi spring,
 * scroll internal terkunci di dalam sheet (overscroll-behavior: contain) sehingga tidak bocor ke peta.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  headerRight,
  children,
  footer,
  wide = false,
  tall = false,
  bodyRef,
  bodyClassName = '',
  onBodyScroll,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  headerRight?: ReactNode;
  children: ReactNode;
  /** Area tetap di bawah (mis. input chat) — tidak ikut scroll. */
  footer?: ReactNode;
  wide?: boolean;
  /** Tinggi tetap ~86dvh (chat, dashboard). Default: mengikuti isi, maks. 92dvh. */
  tall?: boolean;
  bodyRef?: Ref<HTMLDivElement>;
  bodyClassName?: string;
  onBodyScroll?: () => void;
}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y0: number; t0: number; dy: number; lastY: number; lastT: number; v: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (open) {
      setMounted(true);
      playClick();
      let r2 = 0;
      const r1 = requestAnimationFrame(() => (r2 = requestAnimationFrame(() => setShown(true))));
      return () => {
        cancelAnimationFrame(r1);
        cancelAnimationFrame(r2);
      };
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 260);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const setY = (px: number, transition: string) => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transition = transition;
    el.style.transform = `translate3d(0, ${px}px, 0)`;
  };

  function onPointerDown(e: RPointerEvent) {
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return;
    const now = performance.now();
    drag.current = { y0: e.clientY, t0: now, dy: 0, lastY: e.clientY, lastT: now, v: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: RPointerEvent) {
    const d = drag.current;
    if (!d) return;
    const raw = e.clientY - d.y0;
    // Tarik ke atas: resistansi karet; ke bawah: 1:1
    d.dy = raw < 0 ? -Math.sqrt(-raw) * 2 : raw;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    d.v = 0.8 * ((e.clientY - d.lastY) / dt) + 0.2 * d.v;
    d.lastY = e.clientY;
    d.lastT = now;
    setY(d.dy, 'none');
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const h = sheetRef.current?.offsetHeight ?? 600;
    if (d.dy > Math.min(140, h * 0.28) || (d.v > 0.65 && d.dy > 24)) {
      setY(h + 40, SHEET_EXIT);
      closeRef.current();
    } else setY(0, SHEET_SNAP);
  }

  if (!mounted) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="presentation">
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[3px] transition-opacity duration-300"
        style={{ opacity: shown ? 1 : 0 }}
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        className={`relative flex w-full flex-col rounded-t-[28px] bg-surface shadow-[0_-12px_40px_rgba(0,0,0,0.28)] ${
          wide ? 'max-w-2xl' : 'max-w-[560px]'
        } ${tall ? 'h-[86dvh]' : 'max-h-[92dvh]'}`}
        style={{ transform: shown ? 'translate3d(0,0,0)' : 'translate3d(0,105%,0)', transition: shown ? SHEET_ENTER : SHEET_EXIT, willChange: 'transform' }}
      >
        {/* Area drag: handle + header */}
        <div
          className="shrink-0 cursor-grab touch-none px-5 pt-2.5 select-none active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="mx-auto mb-2.5 h-1.5 w-11 rounded-full bg-black/15" aria-hidden />
          <div className="flex items-center justify-between gap-3 pb-3">
            <div className="min-w-0 flex-1 text-lg leading-tight font-extrabold">{title}</div>
            {headerRight}
            <button
              onClick={onClose}
              aria-label="Tutup"
              className="tactile flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/5 text-lg leading-none font-bold text-muted"
            >
              ×
            </button>
          </div>
        </div>
        <div
          ref={bodyRef}
          onScroll={onBodyScroll}
          className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 ${footer ? 'pb-3' : 'pb-[max(1.25rem,env(safe-area-inset-bottom))]'} ${bodyClassName}`}
        >
          {children}
        </div>
        {footer && <div className="shrink-0 border-t border-black/5 px-3 pt-2 pb-[max(0.6rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

/** Kompatibel dengan API lama: semua modal kini tampil sebagai Bottom Sheet. */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
  tall = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  tall?: boolean;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title={title} wide={wide} tall={tall}>
      {children}
    </BottomSheet>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'primary',
  loading = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold transition active:scale-[0.98] disabled:opacity-50';
  const styles: Record<Variant, string> = {
    primary: 'bg-brand text-white shadow-md hover:brightness-110',
    secondary: 'bg-black/5 text-ink hover:bg-black/10',
    ghost: 'text-ink hover:bg-black/5',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  };
  return (
    <button className={`${base} ${styles[variant]} ${className}`} disabled={disabled || loading} {...rest}>
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold tracking-wide text-muted uppercase">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs font-semibold text-red-600">{error}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  'w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-base text-gray-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(1);
  const push = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = idRef.current++;
    setToasts((t) => [...t.slice(-2), { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5500 : 3500);
  }, []);
  return { toasts, push };
}

export function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-[60] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto max-w-sm rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-lg ${
            t.kind === 'error' ? 'bg-red-600 text-white' : t.kind === 'success' ? 'bg-emerald-600 text-white' : 'bg-gray-900 text-white'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
