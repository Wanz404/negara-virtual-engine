/**
 * SFX emote ala mobile game — 100% sintesis Web Audio API, tanpa file audio eksternal.
 *
 * - AudioContext dibagi dengan lib/fx.ts (unlock otomatis saat gesture pertama, aman iOS/Android).
 * - Menghormati tombol Mute/Unmute HUD (isSfxMuted).
 * - Anti-berisik: emote milik sendiri selalu diputar penuh; emote warga lain maks. 1 per 400 ms
 *   dengan volume 45%.
 * - Semua suara melewati DynamicsCompressor + master gain agar tidak menusuk telinga.
 */
import type { EmoteKey } from '../services/types';
import { getAudioContext, isSfxMuted } from '../lib/fx';

const OTHERS_THROTTLE_MS = 400;
const OTHERS_VOLUME = 0.45;
const MASTER_VOLUME = 0.9;

let master: GainNode | null = null;
let masterCtx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;
let lastOthersAt = 0;

function out(a: AudioContext): GainNode {
  if (!master || masterCtx !== a) {
    const comp = a.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    master = a.createGain();
    master.gain.value = MASTER_VOLUME;
    master.connect(comp).connect(a.destination);
    masterCtx = a;
  }
  return master;
}

function noise(a: AudioContext): AudioBuffer {
  if (!noiseBuf || noiseBuf.sampleRate !== a.sampleRate) {
    noiseBuf = a.createBuffer(1, Math.floor(a.sampleRate * 0.8), a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

interface Voice {
  a: AudioContext;
  dest: AudioNode;
  t: number;
  vol: number;
}

/** Envelope ADSR sederhana pada GainNode. */
function env(g: GainNode, t0: number, peak: number, attack: number, dur: number): void {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
}

function osc(v: Voice, type: OscillatorType, f0: number, f1: number | null, start: number, dur: number, peak: number, attack = 0.01, filterHz?: number): OscillatorNode {
  const { a, dest } = v;
  const t0 = v.t + start;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== null) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur * 0.9);
  env(g, t0, peak * v.vol, attack, dur);
  if (filterHz) {
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = filterHz;
    lp.Q.value = 0.8;
    o.connect(lp).connect(g);
  } else o.connect(g);
  g.connect(dest);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
  return o;
}

// ---------------------------------------------------------------------------
// Desain suara per emote
// ---------------------------------------------------------------------------

/** Ngakak: deretan "pop" ceria naik-turun cepat (giggle). */
function laugh(v: Voice): void {
  const notes = [740, 988, 830, 1109, 880, 1245, 988];
  notes.forEach((f, i) => {
    const s = i * 0.072;
    osc(v, 'sine', f * 1.35, f, s, 0.09, 0.32, 0.004);
    osc(v, 'triangle', f * 2, f * 1.6, s, 0.05, 0.06, 0.003);
  });
}

/** Nangis: "wah-wah" kartun — 3 nada turun dengan pitch-slide + vibrato di nada terakhir. */
function cry(v: Voice): void {
  const parts: Array<[number, number, number, number]> = [
    [392, 370, 0, 0.26],
    [370, 349, 0.3, 0.26],
    [349, 233, 0.6, 0.75],
  ];
  parts.forEach(([f0, f1, s, d], i) => {
    const o = osc(v, 'sawtooth', f0, f1, s, d, 0.2, 0.03, 1100);
    if (i === 2) {
      const lfo = v.a.createOscillator();
      const depth = v.a.createGain();
      lfo.frequency.value = 6.5;
      depth.gain.value = 9;
      lfo.connect(depth).connect(o.frequency);
      lfo.start(v.t + s);
      lfo.stop(v.t + s + d + 0.05);
    }
    osc(v, 'triangle', f0 / 2, f1 / 2, s, d, 0.1, 0.03);
  });
}

/** Hormat: mini fanfare terompet tegas (3 nada naik, nada akhir ditahan). */
function salute(v: Voice): void {
  const seq: Array<[number, number, number]> = [
    [392, 0, 0.13],
    [523.25, 0.14, 0.13],
    [659.25, 0.28, 0.5],
  ];
  seq.forEach(([f, s, d]) => {
    osc(v, 'sawtooth', f, null, s, d, 0.17, 0.025, 2200);
    osc(v, 'square', f * 2, null, s, d * 0.8, 0.035, 0.02, 3000);
  });
  osc(v, 'triangle', 783.99, null, 0.28, 0.5, 0.08, 0.04);
}

/** Membara: whoosh noise (bandpass menyapu naik) + power-up synth naik yang energik. */
function fire(v: Voice): void {
  const { a, dest } = v;
  const t0 = v.t;
  const src = a.createBufferSource();
  src.buffer = noise(a);
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(300, t0);
  bp.frequency.exponentialRampToValueAtTime(3200, t0 + 0.45);
  const g = a.createGain();
  env(g, t0, 0.5 * v.vol, 0.08, 0.55);
  src.connect(bp).connect(g).connect(dest);
  src.start(t0);
  src.stop(t0 + 0.6);
  osc(v, 'square', 220, 880, 0.05, 0.42, 0.11, 0.02, 2400);
  osc(v, 'sawtooth', 330, 1320, 0.1, 0.38, 0.07, 0.02, 3000);
  osc(v, 'sine', 1046.5, null, 0.42, 0.25, 0.12, 0.01);
}

/** Sultan/koin: "cha-ching" 2 nada tinggi khas koin game + kilau. */
function coin(v: Voice): void {
  osc(v, 'square', 987.77, null, 0, 0.08, 0.13, 0.003, 5000);
  osc(v, 'square', 1318.51, null, 0.08, 0.38, 0.13, 0.003, 5000);
  osc(v, 'sine', 2637, null, 0.08, 0.3, 0.05, 0.003);
  osc(v, 'sine', 3520, null, 0.16, 0.22, 0.03, 0.003);
}

/** Marah: growl/buzz kartun pendek rendah (sawtooth + modulasi amplitudo), 2 dengusan. */
function angry(v: Voice): void {
  const { a, dest } = v;
  [0, 0.2].forEach((s, i) => {
    const t0 = v.t + s;
    const dur = i === 0 ? 0.16 : 0.3;
    const o = a.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(i === 0 ? 150 : 135, t0);
    o.frequency.exponentialRampToValueAtTime(i === 0 ? 110 : 80, t0 + dur);
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const am = a.createGain();
    am.gain.value = 0.6;
    const lfo = a.createOscillator();
    const lfoDepth = a.createGain();
    lfo.frequency.value = 32;
    lfoDepth.gain.value = 0.4;
    lfo.connect(lfoDepth).connect(am.gain);
    const g = a.createGain();
    env(g, t0, 0.32 * v.vol, 0.015, dur);
    o.connect(lp).connect(am).connect(g).connect(dest);
    o.start(t0);
    lfo.start(t0);
    o.stop(t0 + dur + 0.05);
    lfo.stop(t0 + dur + 0.05);
  });
}

const DESIGNS: Record<EmoteKey, (v: Voice) => void> = { laugh, cry, salute, fire, coin, angry };

/**
 * Putar SFX emote. `own` = emote milik user sendiri (prioritas penuh, tidak di-throttle).
 * Mengembalikan true bila suara benar-benar diputar.
 */
export function playEmoteSfx(key: EmoteKey, own: boolean): boolean {
  if (isSfxMuted()) return false;
  const now = performance.now();
  if (!own) {
    if (now - lastOthersAt < OTHERS_THROTTLE_MS) return false;
    lastOthersAt = now;
  }
  const a = getAudioContext();
  if (!a || a.state !== 'running') return false;
  try {
    DESIGNS[key]?.({ a, dest: out(a), t: a.currentTime + 0.01, vol: own ? 1 : OTHERS_VOLUME });
    return true;
  } catch {
    return false;
  }
}
