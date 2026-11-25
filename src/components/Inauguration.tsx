import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { inaugurationBadge } from '../lib/inauguration';

const STYLE = {
  pioneer: {
    frame: 'linear-gradient(135deg, #fff3c4, #c8901c 30%, #fde68a 55%, #8a5a0b 80%, #fff3c4)',
    body: 'linear-gradient(180deg, #3b1d00, #1c0d00)',
    title: 'linear-gradient(180deg, #fff7d1, #f5c542 55%, #c8901c)',
    sub: '#fde68a',
    glow: '0 0 0 1px #fde68a55, 0 8px 28px #f5c54266',
    icon: '🏅',
  },
  queue: {
    frame: 'linear-gradient(135deg, #f8fafc, #93c5fd 35%, #e2e8f0 60%, #3b82f6)',
    body: 'linear-gradient(180deg, #0b1b3a, #050b1c)',
    title: 'linear-gradient(180deg, #ffffff, #bfdbfe 60%, #93c5fd)',
    sub: '#bfdbfe',
    glow: '0 6px 20px #3b82f655',
    icon: '⏳',
  },
  wave2: {
    frame: 'linear-gradient(135deg, #ecfdf5, #34d399 35%, #fde68a 60%, #065f46)',
    body: 'linear-gradient(180deg, #052e1f, #021a12)',
    title: 'linear-gradient(180deg, #ffffff, #a7f3d0 60%, #fde68a)',
    sub: '#a7f3d0',
    glow: '0 6px 22px #10b98155',
    icon: '🎖️',
  },
} as const;

/** Stempel/badge status pelantikan di E-KTP — dihitung dari nomor warga saja. */
export function InaugurationBadge({ citizenNumber, followStatus }: { citizenNumber: number; followStatus?: string }) {
  const b = inaugurationBadge(citizenNumber, followStatus);
  if (!b) return null;
  const s = STYLE[b.tier];
  return (
    <div className="rounded-2xl p-[2.5px]" style={{ background: s.frame, boxShadow: s.glow }} role="status" aria-label={`${b.title}. ${b.subtitle}`}>
      <div className="relative flex items-center gap-2.5 overflow-hidden rounded-[14px] px-3 py-2" style={{ background: s.body }}>
        {b.tier === 'pioneer' && <span className="inaug-shine pointer-events-none absolute inset-y-0 -left-1/2 w-1/2" aria-hidden="true" />}
        <span className="text-[26px] leading-none drop-shadow">{s.icon}</span>
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[15px] leading-tight font-black tracking-wide"
            style={{ background: s.title, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}
          >
            {b.title}
          </div>
          <div className="truncate text-[11px] font-bold" style={{ color: s.sub }}>
            {b.subtitle}
          </div>
        </div>
        {b.tier !== 'queue' && <span className="shrink-0 rounded-full bg-amber-300 px-1.5 py-0.5 text-[9px] font-black text-amber-950">#{String(citizenNumber).padStart(4, '0')}</span>}
      </div>
    </div>
  );
}

/** Konfeti emas ringan (canvas, ±2,8 dtk, lalu berhenti total). Tidak menangkap klik. */
export function GoldConfetti({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext('2d');
    if (!c || !g) return void done.current();
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return void done.current();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    g.scale(dpr, dpr);
    const colors = ['#fde68a', '#f5c542', '#c8901c', '#fff3c4', '#ffffff', '#dc2626'];
    const parts = Array.from({ length: 110 }, () => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.3,
      y: h * 0.35,
      vx: (Math.random() - 0.5) * 9,
      vy: -6 - Math.random() * 9,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      s: 5 + Math.random() * 6,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    const DURATION = 2800;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const el = now - start;
      g.clearRect(0, 0, w, h);
      g.globalAlpha = el > DURATION - 700 ? Math.max(0, (DURATION - el) / 700) : 1;
      for (const p of parts) {
        p.vy += 0.32;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.r);
        g.fillStyle = p.c;
        g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        g.restore();
      }
      if (el < DURATION) raf = requestAnimationFrame(tick);
      else done.current();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return createPortal(<canvas ref={ref} className="pointer-events-none fixed inset-0 z-[90] h-full w-full" aria-hidden="true" />, document.body);
}
