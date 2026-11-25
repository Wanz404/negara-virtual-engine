/** Efek suara synth (Web Audio API) & konfeti kanvas — tanpa aset eksternal. */

let ctx: AudioContext | null = null;

// ---------------------------------------------------------------------------
// Mute / Unmute SFX global (tersimpan di localStorage, dipakai HUD + emoteSfx)
// ---------------------------------------------------------------------------
const MUTE_KEY = 'nv:sfx-muted';
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
})();
const muteListeners = new Set<(m: boolean) => void>();

export function isSfxMuted(): boolean {
  return muted;
}

export function setSfxMuted(next: boolean): void {
  muted = next;
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  } catch {
    // storage diblokir → hanya berlaku di tab ini
  }
  muteListeners.forEach((fn) => fn(next));
}

export function onSfxMuteChange(fn: (m: boolean) => void): () => void {
  muteListeners.add(fn);
  return () => muteListeners.delete(fn);
}

/** AudioContext bersama (dipakai juga oleh utils/emoteSfx). Null bila tidak didukung. */
export function getAudioContext(): AudioContext | null {
  return audio();
}

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'triangle', gain = 0.12): void {
  if (muted) return;
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = a.currentTime + start;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** Panggil saat interaksi user pertama agar audio diizinkan browser (iOS / IG in-app). */
export function unlockAudio(): void {
  const a = audio();
  if (!a) return;
  try {
    // iOS Safari: memutar buffer senyap di dalam gesture user "membuka kunci" output audio.
    const src = a.createBufferSource();
    src.buffer = a.createBuffer(1, 1, 22050);
    src.connect(a.destination);
    src.start(0);
  } catch {
    // abaikan
  }
}

let unlockInstalled = false;
/** Pasang listener sekali: gesture pertama (tap/klik/tombol) membuka kunci AudioContext. */
export function installAudioUnlock(): void {
  if (unlockInstalled || typeof window === 'undefined') return;
  unlockInstalled = true;
  const events = ['pointerdown', 'touchend', 'keydown'] as const;
  const handler = () => {
    unlockAudio();
    if (ctx && ctx.state === 'running') events.forEach((e) => window.removeEventListener(e, handler, true));
  };
  events.forEach((e) => window.addEventListener(e, handler, true));
}

/** Micro-click lembut untuk tombol HUD / buka Bottom Sheet. */
export function playClick(): void {
  tone(1250, 0, 0.035, 'sine', 0.035);
}

export function playTick(): void {
  tone(880 + Math.random() * 300, 0, 0.05, 'square', 0.03);
}

export function playStamp(): void {
  tone(110, 0, 0.25, 'sawtooth', 0.15);
  tone(70, 0.02, 0.3, 'sine', 0.2);
}

export function playFanfare(): void {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => tone(f, i * 0.12, 0.35, 'triangle', 0.13));
  tone(1046.5, 0.5, 0.8, 'triangle', 0.12);
  tone(783.99, 0.5, 0.8, 'sine', 0.08);
  tone(1318.5, 0.62, 0.7, 'triangle', 0.08);
}

export function playCoin(): void {
  tone(988, 0, 0.08, 'square', 0.05);
  tone(1319, 0.08, 0.2, 'square', 0.05);
}

export function haptic(ms = 30): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // abaikan
  }
}

/** Konfeti ringan di kanvas fullscreen, auto-hapus. */
export function confetti(colors: string[], durationMs = 2600): void {
  if (typeof document === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '9999' });
  document.body.appendChild(canvas);
  const g = canvas.getContext('2d');
  if (!g) return canvas.remove();
  g.scale(dpr, dpr);
  const W = window.innerWidth;
  const H = window.innerHeight;
  const parts = Array.from({ length: 140 }, () => ({
    x: W / 2 + (Math.random() - 0.5) * 80,
    y: H * 0.38,
    vx: (Math.random() - 0.5) * 12,
    vy: -Math.random() * 13 - 4,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    w: 6 + Math.random() * 6,
    h: 4 + Math.random() * 4,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const start = performance.now();
  const frame = (t: number) => {
    const el = t - start;
    g.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.32;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      g.save();
      g.globalAlpha = Math.max(0, 1 - el / durationMs);
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.fillStyle = p.c;
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    }
    if (el < durationMs) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
