import type { LandmarkKind, WorldConfig } from '../configs/types';
import { findBuilding, generateRingPlots, ringMilestone, ringName, propertyIncome } from '../lib/game';
import { formatNumber } from '../lib/format';
import type { Plot, PresenceMember, PublicCitizen, WorldState } from '../services/types';
import { AgentManager, type Agent } from './agents';
import { Camera, type ViewRect } from './camera';
import { drawBuilding, drawPlotBase } from './draw/plots';
import {
  drawElite,
  drawGate,
  drawMonument,
  drawPalace,
  drawParliament,
  drawPark,
  drawPlaza,
  drawProjectSite,
  drawShop,
  drawTrainLoop,
} from './draw/landmarks';
import { drawTerrain } from './draw/terrain';
import { Geometry, LANDMARK_SLOTS, MONUMENT_SLOTS, PLOT, type Rect } from './geometry';
import { attachInput } from './input';
import { SpatialHash } from './spatialHash';
import { chibiSprite } from './sprites';
import { EMOTE_DURATION_MS, emoteDef, emoteImage } from '../lib/emotes';
import type { EmoteKey } from '../services/types';

interface ActiveEmote {
  citizenId: string;
  key: EmoteKey;
  start: number;
}

const EMOTE_IN = 0.45; // detik: pop-in bounce
const EMOTE_OUT_AT = 2.45; // detik: mulai exit
const EMOTE_OUT = EMOTE_DURATION_MS / 1000 - EMOTE_OUT_AT;
const MAX_EMOTES = 24;
// Squash & stretch: scale(0) → (1.28,0.85) → (0.9,1.12) → (1.05,0.97) → 1
const POP_KEYS: Array<[number, number, number]> = [
  [0, 0, 0],
  [0.4, 1.28, 0.85],
  [0.65, 0.9, 1.12],
  [0.85, 1.05, 0.97],
  [1, 1, 1],
];

function popScale(p: number): [number, number] {
  for (let i = 1; i < POP_KEYS.length; i++) {
    const [t1, x1, y1] = POP_KEYS[i];
    if (p <= t1) {
      const [t0, x0, y0] = POP_KEYS[i - 1];
      const k = (p - t0) / (t1 - t0);
      const e = 1 - (1 - k) * (1 - k); // easeOutQuad per segmen
      return [x0 + (x1 - x0) * e, y0 + (y1 - y0) * e];
    }
  }
  return [1, 1];
}

export type TapTarget =
  | { type: 'plot'; plot: Plot }
  | { type: 'citizen'; citizenId: string }
  | { type: 'guest'; label: string }
  | { type: 'landmark'; landmarkId: string }
  | { type: 'coin'; plot: Plot }
  | { type: 'none' };

export interface MapData {
  world: WorldState | null;
  citizens: PublicCitizen[];
  ownedPlots: Plot[];
  members: PresenceMember[];
  meId: string | null;
  myIncomeBonusPct: number;
}

interface Label {
  x: number;
  y: number;
  text: string;
  bg: string;
  fg: string;
  bold?: boolean;
  dot?: boolean;
  ring?: string;
  bubble?: boolean;
  /** Lebar maksimum dalam unit dunia; teks dipotong "…" agar tidak menabrak label lain. */
  maxW?: number;
}

const CHAR_SIZE = 30;

/** roundRect manual (CanvasRenderingContext2D.roundRect belum ada di iOS < 16 / in-app browser lama). */
function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
const LABEL_FONT = '700 10px ui-sans-serif, system-ui, sans-serif';
const BUBBLE_FONT = '600 10px ui-sans-serif, system-ui, sans-serif';

export class MapEngine {
  readonly camera = new Camera();
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly config: WorldConfig;
  private readonly geo: Geometry;
  private readonly agentsMgr: AgentManager;
  private readonly hash = new SpatialHash<Agent>(96);
  private readonly ringCache = new Map<number, Plot[]>();
  private plots: Plot[] = [];
  private plotByGrid = new Map<string, Plot>();
  private data: MapData = { world: null, citizens: [], ownedPlots: [], members: [], meId: null, myIncomeBonusPct: 0 };
  private unlocked = 1;
  private raf = 0;
  private last = 0;
  private t = 0;
  private dpr = 1;
  private coinHits: Array<{ x: number; y: number; r: number; plot: Plot }> = [];
  private spotlight: { x: number; y: number; agentId?: string; until: number } | null = null;
  private highlightPlot: string | null = null;
  private widths = new Map<string, number>();
  private visibleRingsKey = '';
  private readonly detach: () => void;
  private readonly ro: ResizeObserver;
  private initialFramed = false;
  private presentation = false;
  private emotes: ActiveEmote[] = [];
  private calloutHits: Array<{ x: number; y: number; w: number; h: number; landmarkId: string }> = [];

  onTap: (target: TapTarget) => void = () => {};
  onVisibleRings: (rings: number[]) => void = () => {};
  onInteract: () => void = () => {};

  constructor(canvas: HTMLCanvasElement, config: WorldConfig) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.config = config;
    this.geo = Geometry.from(config);
    this.agentsMgr = new AgentManager(config, this.geo);
    this.detach = attachInput(canvas, this.camera, (sx, sy) => this.handleTap(sx, sy), () => this.onInteract());
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.applyUnlocked(1);
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.detach();
    this.ro.disconnect();
  }

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------

  setData(data: MapData): void {
    this.data = data;
    const unlocked = Math.max(1, data.world?.currentRingUnlocked ?? 1);
    if (unlocked !== this.unlocked || this.plots.length === 0) this.applyUnlocked(unlocked);
    this.mergeOwned(data.ownedPlots);

    const plotsByOwner = new Map<string, Plot>();
    for (const p of data.ownedPlots) if (p.ownerCitizenId && !plotsByOwner.has(p.ownerCitizenId)) plotsByOwner.set(p.ownerCitizenId, p);
    const w = data.world;
    const npc = w ? Math.max(0, w.igFollowerCount - w.lastCitizenNumber) : 0;
    this.agentsMgr.sync(data.citizens, data.members, npc, data.meId, plotsByOwner);
  }

  private applyUnlocked(unlocked: number): void {
    this.unlocked = unlocked;
    this.agentsMgr.setUnlocked(unlocked);
    for (let r = 1; r <= unlocked; r++) {
      if (!this.ringCache.has(r)) {
        this.ringCache.set(
          r,
          generateRingPlots(this.config, r).map((s) => ({
            id: s.plotCode,
            plotCode: s.plotCode,
            ringLevel: s.ringLevel,
            gridX: s.gridX,
            gridY: s.gridY,
            price: s.price,
            ownerCitizenId: null,
            ownerTag: null,
            ownerNumber: null,
            buildingType: null,
            buildingName: null,
            buildingLevel: 0,
            lastIncomeClaimAt: null,
            purchasedAt: null,
          })),
        );
      }
    }
    this.plots = [];
    for (let r = 1; r <= unlocked; r++) this.plots.push(...(this.ringCache.get(r) ?? []));
    this.plotByGrid = new Map(this.plots.map((p) => [`${p.gridX},${p.gridY}`, p]));
    this.camera.setExtent(this.geo.ringOuterHalf(unlocked + 1) + 120);
    this.mergeOwned(this.data.ownedPlots);
  }

  /** Kavling dijual digenerate di klien (identik SQL); hanya kavling ber-pemilik yang diambil dari server. */
  private mergeOwned(owned: Plot[]): void {
    const ownedByCode = new Map(owned.map((p) => [p.plotCode, p]));
    for (let i = 0; i < this.plots.length; i++) {
      const base = this.plots[i];
      const o = ownedByCode.get(base.plotCode);
      if (o) {
        const merged = { ...o, gridX: base.gridX, gridY: base.gridY };
        this.plots[i] = merged;
        this.plotByGrid.set(`${base.gridX},${base.gridY}`, merged);
      } else if (base.ownerCitizenId) {
        // dulu dimiliki di cache lokal tapi tidak lagi di data → kembalikan ke status dijual
        const fresh = this.ringCache.get(base.ringLevel)?.find((p) => p.plotCode === base.plotCode);
        if (fresh && !fresh.ownerCitizenId) {
          this.plots[i] = fresh;
          this.plotByGrid.set(`${base.gridX},${base.gridY}`, fresh);
        }
      }
    }
  }

  getPlot(code: string): Plot | undefined {
    return this.plots.find((p) => p.plotCode === code);
  }

  // ---------------------------------------------------------------------------
  // Kamera publik
  // ---------------------------------------------------------------------------

  frameCore(animate = false): void {
    const z = Math.min(this.camera.width, this.camera.height) / (this.geo.coreHalf * 2.4);
    if (animate) this.camera.flyTo(0, 0, z, 800);
    else {
      this.camera.x = 0;
      this.camera.y = 30;
      this.camera.zoom = z;
      this.camera.clamp();
    }
  }

  frameAll(): void {
    this.camera.flyTo(0, 0, this.camera.minZoom, 1100);
  }

  /** Click-to-Locate: terbang + zoom-in + spotlight ke warga. Return false bila warga tidak ada di sampel peta. */
  locateCitizen(citizenId: string): boolean {
    const a = this.agentsMgr.agents.get(`c:${citizenId}`);
    if (!a) return false;
    this.camera.flyTo(a.x, a.y - 10, 2, 1100);
    this.spotlight = { x: a.x, y: a.y - 14, agentId: a.id, until: performance.now() + 4200 };
    return true;
  }

  locatePlot(code: string): boolean {
    const p = this.getPlot(code);
    if (!p) return false;
    const w = this.geo.toWorld(p.gridX, p.gridY);
    this.camera.flyTo(w.x, w.y, 1.8, 1000);
    this.spotlight = { x: w.x, y: w.y, until: performance.now() + 4000 };
    this.highlightPlot = code;
    return true;
  }

  /** Terbang ke landmark Ring 0 (dipakai auto-camera Reels). */
  locateLandmark(kind: LandmarkKind, zoom = 1.5): void {
    const r = this.geo.slotRect(LANDMARK_SLOTS[kind]);
    this.camera.flyTo(r.x + r.w / 2, r.y + r.h / 2, zoom, 1200);
  }

  /** Mode presentasi (Reels): sembunyikan koin klaim & label kabut agar frame bersih. */
  setPresentation(on: boolean): void {
    this.presentation = on;
  }

  setHighlight(code: string | null): void {
    this.highlightPlot = code;
  }

  /** Tombol "Deket": ke karakter sendiri, atau ke kerumunan terpadat. */
  flyNear(meId: string | null): void {
    if (meId && this.locateCitizen(meId)) return;
    let best: Agent | null = null;
    let bestN = -1;
    const list = [...this.agentsMgr.agents.values()];
    for (const a of list) {
      let n = 0;
      for (const b of list) if (Math.abs(a.x - b.x) < 120 && Math.abs(a.y - b.y) < 120) n++;
      if (n > bestN) {
        bestN = n;
        best = a;
      }
    }
    if (best) this.camera.flyTo(best.x, best.y, 1.4, 900);
    else this.frameCore(true);
  }

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr));
    this.camera.resize(rect.width, rect.height);
    if (!this.initialFramed && rect.width > 0) {
      this.initialFramed = true;
      this.frameCore();
    }
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0.016);
    this.last = now;
    this.t += dt;
    this.camera.update(dt, now);
    this.agentsMgr.update(dt);
    this.render(now);
    this.emitVisibleRings();
  };

  private emitVisibleRings(): void {
    const v = this.camera.view();
    const dx = v.x0 <= 0 && v.x1 >= 0 ? 0 : Math.min(Math.abs(v.x0), Math.abs(v.x1));
    const dy = v.y0 <= 0 && v.y1 >= 0 ? 0 : Math.min(Math.abs(v.y0), Math.abs(v.y1));
    const dmin = Math.max(dx, dy);
    const dmax = Math.max(Math.abs(v.x0), Math.abs(v.x1), Math.abs(v.y0), Math.abs(v.y1));
    const rings: number[] = [];
    for (let r = 1; r <= this.unlocked; r++) {
      const inner = this.geo.ringOuterHalf(r - 1);
      const outer = this.geo.ringOuterHalf(r);
      if (outer >= dmin && inner <= dmax) rings.push(r);
    }
    const key = rings.join(',');
    if (key !== this.visibleRingsKey) {
      this.visibleRingsKey = key;
      this.onVisibleRings(rings);
    }
  }

  private visible(v: ViewRect, x: number, y: number, pad: number): boolean {
    return x + pad >= v.x0 && x - pad <= v.x1 && y + pad >= v.y0 && y - pad <= v.y1;
  }

  private render(now: number): void {
    const { ctx, camera: cam, config, geo } = this;
    const z = cam.zoom;
    const t = this.t;
    ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (cam.width / 2 - cam.x * z), this.dpr * (cam.height / 2 - cam.y * z));
    const v = cam.view(40);
    const labels: Label[] = [];
    const w = this.data.world;

    drawTerrain(ctx, geo, config.theme, this.unlocked, v, t, z);

    // MRT selesai → rel & kereta melingkari jalan lingkar inti
    const done = w?.completedProjects ?? [];
    const trainProject = done.find((id) => id.includes('mrt'));
    if (trainProject) {
      const b = geo.boundaryBand(0);
      drawTrainLoop(ctx, (b.inner + b.outer) / 2, t, config.theme.primary);
    }

    // --- Landmark Ring 0 ---
    const project = config.projects.find((p) => p.id === w?.activeProjectId);
    const progress = w && w.activeProjectGoal > 0 ? Math.min(1, w.activeProjectFunding / w.activeProjectGoal) : 0;
    const president = this.data.citizens.find((c) => c.citizenNumber === 1);
    for (const lm of config.landmarks) {
      const r = geo.slotRect(LANDMARK_SLOTS[lm.kind]);
      if (!this.visible(v, r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h))) continue;
      switch (lm.kind) {
        case 'palace':
          drawPalace(ctx, r, t, config.theme);
          if (z >= 0.5)
            labels.push({ x: r.x + r.w / 2, y: r.y + r.h - 18, maxW: r.w, text: president ? `🏛️ ${config.tiers[0].shortName}: ${president.username} | 001` : '🏛️ Kursi #001 masih kosong!', bg: '#fef3c7', fg: '#78350f', bold: true });
          break;
        case 'parliament':
          drawParliament(ctx, r, t);
          break;
        case 'elite_complex':
          drawElite(ctx, r, t);
          break;
        case 'shop':
          drawShop(ctx, r, t);
          break;
        case 'gate':
          drawGate(ctx, r, t, config.theme);
          break;
        case 'plaza':
          drawPlaza(ctx, r, t, config.theme);
          break;
        case 'project_site':
          drawProjectSite(ctx, r, t, progress, project?.emoji ?? '🚧', !!w?.activeProjectCompleted);
          if (z >= 0.45 && project)
            labels.push({ x: r.x + r.w / 2, y: r.y + 6, maxW: r.w - 6, text: w?.activeProjectCompleted ? '🎉 Semua proyek selesai' : `${project.name} ${Math.floor(progress * 100)}%`, bg: '#111827', fg: '#fff' });
          break;
      }
      if (z >= 0.32 && lm.kind !== 'palace') {
        const ly = lm.kind === 'plaza' ? r.y + r.h * 0.8 : lm.kind === 'gate' ? r.y + 4 : lm.kind === 'project_site' ? r.y + r.h - 34 : r.y + r.h - 18;
        labels.push({ x: r.x + r.w / 2, y: ly, maxW: r.w - 4, text: `${lm.emoji} ${lm.name}`, bg: 'rgba(255,255,255,0.9)', fg: '#1f2937', bold: true });
      }
    }
    MONUMENT_SLOTS.forEach((slot, i) => {
      const r = geo.slotRect(slot);
      const id = done.filter((d) => d !== trainProject)[i];
      const p = config.projects.find((x) => x.id === id);
      if (p) {
        drawMonument(ctx, r, p.emoji, t);
        if (z >= 0.45) labels.push({ x: r.x + r.w / 2, y: r.y + r.h - 18, maxW: r.w - 4, text: `${p.emoji} ${p.name}`, bg: '#fef3c7', fg: '#78350f', bold: true });
      } else drawPark(ctx, r);
    });
    if (trainProject && z >= 0.45) {
      const p = config.projects.find((x) => x.id === trainProject);
      const b = geo.boundaryBand(0);
      labels.push({ x: 0, y: -(b.inner + b.outer) / 2 - 10, text: `${p?.emoji ?? '🚇'} ${p?.name ?? 'MRT'}`, bg: '#1d4ed8', fg: '#fff', bold: true });
    }

    // --- Kavling & bangunan ---
    const meId = this.data.meId;
    const built: Array<{ p: Plot; x: number; y: number }> = [];
    this.coinHits = [];
    const showPlotLabels = z >= 0.95;
    for (const p of this.plots) {
      const pos = geo.toWorld(p.gridX, p.gridY);
      if (!this.visible(v, pos.x, pos.y, PLOT)) continue;
      const b = p.buildingLevel > 0 ? findBuilding(config, p.buildingType) : undefined;
      const mine = !!meId && p.ownerCitizenId === meId;
      drawPlotBase(ctx, { x: pos.x, y: pos.y, owned: !!p.ownerCitizenId, mine, level: p.buildingLevel, building: b, highlighted: this.highlightPlot === p.plotCode }, config.theme, z);
      if (b) built.push({ p, x: pos.x, y: pos.y });
      if (showPlotLabels) {
        if (!p.ownerCitizenId) {
          if (z >= 1.25) labels.push({ x: pos.x, y: pos.y + PLOT / 2 - 6, text: `${p.plotCode} • ${formatNumber(p.price)}`, bg: 'rgba(255,255,255,0.85)', fg: '#374151' });
        } else if (!b) {
          labels.push({ x: pos.x, y: pos.y + 10, text: `Milik ${p.ownerTag ?? '?'}`, bg: '#fef3c7', fg: '#78350f', bold: true });
        }
      }
      if (mine && b) {
        const income = propertyIncome(config, b, p.buildingLevel, p.lastIncomeClaimAt, this.data.myIncomeBonusPct);
        if (income >= 1) {
          const s = cam.worldToScreen(pos.x + 18, pos.y - 30 + Math.sin(t * 3 + p.gridX) * 3);
          this.coinHits.push({ x: s.x, y: s.y, r: 16, plot: p });
        }
      }
    }
    built.sort((a, b) => a.y - b.y || a.x - b.x);
    for (const { p, x, y } of built) {
      const b = findBuilding(config, p.buildingType);
      if (!b) continue;
      drawBuilding(ctx, x, y, b, p.buildingLevel, z, t);
      if (showPlotLabels) labels.push({ x, y: y + PLOT / 2 + 4, text: `${p.buildingName ?? b.name} ${'★'.repeat(p.buildingLevel)}`, bg: '#fff', fg: '#1f2937', bold: true });
    }

    // --- Karakter (culling via spatial hash, urut Y) ---
    this.hash.clear();
    for (const a of this.agentsMgr.agents.values()) this.hash.insert(a.x, a.y, a);
    const vis = this.hash.query(v.x0, v.y0, v.x1, v.y1).sort((a, b) => a.y - b.y);
    const showNames = z >= 0.55;
    const showBubbles = z >= 0.8;
    for (const a of vis) {
      const bob = a.wait > 0 ? 0 : Math.abs(Math.sin(a.phase)) * 2;
      if (z < 0.3) {
        ctx.fillStyle = a.kind === 'citizen' ? a.color : 'rgba(100,116,139,0.6)';
        ctx.beginPath();
        ctx.arc(a.x, a.y - 6, a.isMe ? 9 : 5, 0, Math.PI * 2);
        ctx.fill();
        if (a.isMe) labels.push({ x: a.x, y: a.y - 20, text: `📍 ${a.label}`, bg: config.theme.primary, fg: '#fff', bold: true });
        continue;
      }
      const size = a.kind === 'npc' ? CHAR_SIZE * 0.8 : a.isMe ? CHAR_SIZE * 1.2 : CHAR_SIZE;
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.ellipse(a.x, a.y, size * 0.28, size * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
      if (a.isMe) {
        ctx.strokeStyle = config.theme.primary;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(a.x, a.y, size * 0.42 + Math.sin(t * 4) * 1.5, size * 0.14, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      const sprite = chibiSprite(a.color, a.look, a.accessory, a.dim || a.kind === 'npc');
      ctx.save();
      ctx.translate(a.x, a.y - bob);
      if (a.facing < 0) ctx.scale(-1, 1);
      ctx.globalAlpha = a.kind === 'guest' ? 0.85 : 1;
      ctx.drawImage(sprite, -size / 2, -size * 0.95, size, size);
      ctx.restore();
      if (a.kind !== 'npc' && (showNames || a.isMe)) {
        labels.push({
          x: a.x,
          y: a.y + 3,
          text: a.label,
          bg: a.isMe ? config.theme.primary : a.labelBg,
          fg: a.isMe ? '#fff' : a.labelFg,
          bold: a.kind === 'citizen',
          dot: a.online,
        });
      }
      if (showBubbles && a.status && a.kind === 'citizen') labels.push({ x: a.x, y: a.y - size - 6, text: a.status, bg: '#fff', fg: '#111827', bubble: true });
    }

    // --- Lapisan layar: label, koin, kabut ekspansi, spotlight ---
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!this.presentation) this.drawFogLabel(z);
    this.drawLabels(labels);
    if (!this.presentation) this.drawCoins(t);
    else this.coinHits = [];
    if (!this.presentation) this.drawCallouts(t);
    else this.calloutHits = [];
    this.drawEmotes(now);
    this.drawSpotlight(now);
  }

  // ---------------------------------------------------------------------------
  // Callout pin melayang (v3): "🚧 STASIUN X% • PATUNGAN!" & "🏪 BELI WARUNG / KAVLING RT"
  // ---------------------------------------------------------------------------
  private drawCallouts(t: number): void {
    this.calloutHits = [];
    const w = this.data.world;
    const items: Array<{ kind: LandmarkKind; text: string; bg: string; border: string; fg: string; phase: number }> = [];
    if (w && !w.activeProjectCompleted) {
      const project = this.config.projects.find((p) => p.id === w.activeProjectId);
      const pct = w.activeProjectGoal > 0 ? (w.activeProjectFunding / w.activeProjectGoal) * 100 : 0;
      const name = (project?.name.split(' ')[0] ?? 'PROYEK').toUpperCase();
      const pctText = pct > 0 && pct < 1 ? pct.toFixed(1) : String(Math.floor(pct));
      items.push({ kind: 'project_site', text: `🚧 ${name} ${pctText}% • PATUNGAN!`, bg: '#c8102e', border: '#fbbf24', fg: '#ffffff', phase: 0 });
    }
    items.push({ kind: 'shop', text: '🏪 BELI WARUNG / KAVLING RT', bg: '#fbbf24', border: '#ffffff', fg: '#3b1d00', phase: 1.7 });

    const ctx = this.ctx;
    const cam = this.camera;
    const font = '900 11px ui-sans-serif, system-ui, sans-serif';
    for (const it of items) {
      const lm = this.config.landmarks.find((l) => l.kind === it.kind);
      if (!lm) continue;
      const r = this.geo.slotRect(LANDMARK_SLOTS[it.kind]);
      const s = cam.worldToScreen(r.x + r.w / 2, r.y + r.h * 0.3);
      const tw = this.textWidth(it.text, font);
      const pw = tw + 20;
      const ph = 24;
      const bob = Math.sin(t * 2.4 + it.phase) * 3;
      const pulse = 1 + Math.max(0, Math.sin(t * 3 + it.phase)) * 0.05;
      const cx = s.x;
      const cy = s.y - 18 + bob;
      if (cx < -pw || cx > cam.width + pw || cy < -40 || cy > cam.height + 40) continue;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(pulse, pulse);
      // glow denyut
      ctx.globalAlpha = 0.35 * Math.max(0, Math.sin(t * 3 + it.phase));
      ctx.fillStyle = it.border;
      ctx.beginPath();
      rrect(ctx, -pw / 2 - 4, -ph / 2 - 4, pw + 8, ph + 8, 16);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowColor = 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;
      ctx.fillStyle = it.bg;
      ctx.beginPath();
      rrect(ctx, -pw / 2, -ph / 2, pw, ph, 12);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      // ekor penunjuk
      ctx.beginPath();
      ctx.moveTo(-6, ph / 2 - 1);
      ctx.lineTo(6, ph / 2 - 1);
      ctx.lineTo(0, ph / 2 + 7);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = it.border;
      ctx.beginPath();
      rrect(ctx, -pw / 2, -ph / 2, pw, ph, 12);
      ctx.stroke();
      ctx.fillStyle = it.fg;
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(it.text, 0, 1);
      ctx.restore();
      this.calloutHits.push({ x: cx - pw / 2 - 6, y: cy - ph / 2 - 6, w: pw + 12, h: ph + 14, landmarkId: lm.id });
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // ---------------------------------------------------------------------------
  // Emote 3D di atas kepala warga (lapisan layar, ikut pan/zoom, 60fps)
  // ---------------------------------------------------------------------------

  /** Tampilkan emote di atas karakter warga. false bila warga sedang tidak ada di peta. */
  showEmote(citizenId: string, key: EmoteKey): boolean {
    if (!this.agentsMgr.agents.has(`c:${citizenId}`)) return false;
    this.emotes = this.emotes.filter((e) => e.citizenId !== citizenId);
    this.emotes.push({ citizenId, key, start: performance.now() });
    if (this.emotes.length > MAX_EMOTES) this.emotes.shift();
    return true;
  }

  private drawEmotes(now: number): void {
    if (this.emotes.length === 0) return;
    const ctx = this.ctx;
    const cam = this.camera;
    const z = cam.zoom;
    const px = Math.max(46, Math.min(78, 40 + z * 22));
    this.emotes = this.emotes.filter((e) => now - e.start < EMOTE_DURATION_MS);

    for (const em of this.emotes) {
      const a = this.agentsMgr.agents.get(`c:${em.citizenId}`);
      if (!a) continue;
      const charSize = a.isMe ? CHAR_SIZE * 1.2 : CHAR_SIZE;
      const head = z < 0.3 ? cam.worldToScreen(a.x, a.y - 12) : cam.worldToScreen(a.x, a.y - charSize * 0.95);
      const baseY = head.y - 2;
      if (head.x < -px || head.x > cam.width + px || baseY < -20 || baseY > cam.height + px * 1.5) continue;

      const T = Math.max(0, (now - em.start) / 1000);
      let sx = 1;
      let sy = 1;
      let rot = 0;
      let dx = 0;
      let dy = 0;
      let alpha = 1;
      let glow = 0;
      let glowColor = 'rgba(251,191,36,0.95)';
      const u = Math.max(0, T - EMOTE_IN);
      const k = Math.min(1, u / 0.18); // amplitudo aksi naik halus setelah pop-in

      if (T < EMOTE_IN) {
        [sx, sy] = popScale(T / EMOTE_IN);
      } else {
        switch (em.key) {
          case 'laugh': {
            const hop = Math.abs(Math.sin(u * Math.PI * 3.2));
            dy = -hop * 13 * k;
            sx = 1 + (1 - hop) * 0.09 * k;
            sy = 1 - (1 - hop) * 0.09 * k;
            rot = Math.sin(u * 9) * 0.2 * k;
            break;
          }
          case 'cry':
            dx = Math.sin(u * 48) * 1.6 * k;
            dy = (Math.sin(u * 3.2) * 3 + 2) * k;
            sy = 1 + Math.sin(u * 3.2) * 0.03 * k;
            break;
          case 'salute':
            sx = sy = 1 + Math.sin(u * 4) * 0.025;
            glow = (0.55 + 0.45 * Math.sin(u * 5)) * k;
            break;
          case 'fire': {
            const pulse = Math.abs(Math.sin(u * 10));
            sx = sy = 1 + pulse * 0.13 * k;
            dx = Math.sin(u * 61) * 1.7 * k;
            dy = Math.cos(u * 53) * 1.7 * k;
            glow = (0.4 + pulse * 0.6) * k;
            glowColor = 'rgba(249,115,22,0.95)';
            break;
          }
          case 'coin': {
            const hop = Math.abs(Math.sin(u * 6));
            dy = -hop * 8 * k;
            rot = Math.sin(u * 5) * 0.28 * k;
            sx = 1 - (1 - Math.abs(Math.cos(u * 5))) * 0.12 * k;
            glow = 0.35 * k;
            break;
          }
          case 'angry': {
            const burst = 0.45 + 0.55 * Math.abs(Math.sin(u * 4.2));
            dx = Math.sin(u * 58) * 5 * burst * k;
            rot = Math.sin(u * 58) * 0.06 * burst * k;
            glow = 0.5 * burst * k;
            glowColor = 'rgba(239,68,68,0.95)';
            break;
          }
        }
        if (T >= EMOTE_OUT_AT) {
          const p = Math.min(1, (T - EMOTE_OUT_AT) / EMOTE_OUT);
          const e = p * p * (3 - 2 * p);
          dy -= 20 * e;
          sx *= 1 - 0.4 * e;
          sy *= 1 - 0.4 * e;
          alpha = 1 - e;
          glow *= 1 - e;
        }
      }

      const x = head.x + dx;
      const y = baseY + dy;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.scale(sx, sy);
      if (glow > 0.01) {
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 6 + glow * 16;
      }
      const img = emoteImage(em.key);
      if (img) ctx.drawImage(img, -px / 2, -px, px, px);
      else {
        ctx.font = `${Math.round(px * 0.78)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(emoteDef(em.key).emoji, 0, 0);
      }
      ctx.restore();

      // Partikel kecil (tanpa scale) — air mata, kilau emas
      if (T >= EMOTE_IN && alpha > 0.05) this.drawEmoteParticles(em.key, x, y, px, u, alpha);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  private drawEmoteParticles(key: EmoteKey, x: number, y: number, px: number, u: number, alpha: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (key === 'cry') {
      ctx.fillStyle = '#60a5fa';
      for (let i = 0; i < 2; i++) {
        const ph = (u * 1.6 + i * 0.5) % 1;
        const side = i === 0 ? -1 : 1;
        const tx = x + side * px * 0.28 + side * ph * 6;
        const ty = y - px * 0.55 + ph * px * 0.5;
        ctx.globalAlpha = alpha * (1 - ph);
        ctx.beginPath();
        ctx.ellipse(tx, ty, 2.4, 3.6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (key === 'salute' || key === 'coin') {
      ctx.fillStyle = '#fde047';
      const n = key === 'coin' ? 3 : 4;
      for (let i = 0; i < n; i++) {
        const ang = u * 2.2 + (i / n) * Math.PI * 2;
        const r = px * 0.62;
        const sxp = x + Math.cos(ang) * r;
        const syp = y - px * 0.5 + Math.sin(ang) * r * 0.55;
        const s = 2.5 + 2 * Math.abs(Math.sin(u * 6 + i));
        ctx.globalAlpha = alpha * (0.5 + 0.5 * Math.abs(Math.sin(u * 5 + i)));
        ctx.beginPath();
        ctx.moveTo(sxp, syp - s * 1.6);
        ctx.lineTo(sxp + s * 0.45, syp - s * 0.45);
        ctx.lineTo(sxp + s * 1.6, syp);
        ctx.lineTo(sxp + s * 0.45, syp + s * 0.45);
        ctx.lineTo(sxp, syp + s * 1.6);
        ctx.lineTo(sxp - s * 0.45, syp + s * 0.45);
        ctx.lineTo(sxp - s * 1.6, syp);
        ctx.lineTo(sxp - s * 0.45, syp - s * 0.45);
        ctx.closePath();
        ctx.fill();
      }
    } else if (key === 'angry') {
      // Uap kepala marah
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < 2; i++) {
        const ph = (u * 1.8 + i * 0.5) % 1;
        const side = i === 0 ? -1 : 1;
        ctx.globalAlpha = alpha * (1 - ph) * 0.9;
        ctx.beginPath();
        ctx.arc(x + side * (px * 0.42 + ph * 10), y - px * 0.45 - ph * 6, 3 + ph * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private textWidth(text: string, font: string): number {
    const key = `${font}|${text}`;
    let w = this.widths.get(key);
    if (w === undefined) {
      this.ctx.font = font;
      w = this.ctx.measureText(text).width;
      if (this.widths.size > 4000) this.widths.clear();
      this.widths.set(key, w);
    }
    return w;
  }

  private drawLabels(labels: Label[]): void {
    const ctx = this.ctx;
    const cam = this.camera;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let drawn = 0;
    for (const l of labels) {
      if (drawn > 160) break;
      const s = cam.worldToScreen(l.x, l.y);
      if (s.x < -80 || s.y < -20 || s.x > cam.width + 80 || s.y > cam.height + 20) continue;
      const font = l.bubble ? BUBBLE_FONT : LABEL_FONT;
      let text = l.text.length > 34 ? `${l.text.slice(0, 33)}…` : l.text;
      let tw = this.textWidth(text, font);
      if (l.maxW) {
        const max = l.maxW * cam.zoom - 12;
        if (max < 24) continue;
        while (tw > max && text.length > 2) {
          text = `${text.replace(/…$/, '').slice(0, -1)}…`;
          tw = this.textWidth(text, font);
        }
      }
      const pad = 5;
      const dotW = l.dot ? 8 : 0;
      const w = tw + pad * 2 + dotW;
      const h = l.bubble ? 18 : 15;
      const x = s.x - w / 2;
      const y = s.y;
      ctx.fillStyle = l.bg;
      ctx.beginPath();
      rrect(ctx, x, y, w, h, l.bubble ? 8 : 7.5);
      ctx.fill();
      if (l.bubble) {
        ctx.beginPath();
        ctx.moveTo(s.x - 4, y + h);
        ctx.lineTo(s.x, y + h + 5);
        ctx.lineTo(s.x + 4, y + h);
        ctx.fill();
      }
      if (l.dot) {
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.arc(x + pad + 3, y + h / 2, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = l.fg;
      ctx.font = font;
      ctx.fillText(text, s.x + dotW / 2, y + h / 2 + 0.5);
      drawn++;
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  private drawCoins(t: number): void {
    const ctx = this.ctx;
    for (const c of this.coinHits) {
      const pulse = 1 + Math.sin(t * 5) * 0.08;
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y + 14, 8, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#facc15';
      ctx.strokeStyle = '#b45309';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 11 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#92400e';
      ctx.font = '900 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('$', c.x, c.y + 0.5);
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  private drawFogLabel(z: number): void {
    if (z < 0.2) return;
    const next = this.unlocked + 1;
    const half = this.geo.ringOuterHalf(next);
    const s = this.camera.worldToScreen(0, -half + 26);
    const pop = ringMilestone(this.config, this.unlocked);
    const text = `🚧 ${ringName(this.config, next)} (Ring ${next}) • terbuka saat ${formatNumber(pop)} warga`;
    const ctx = this.ctx;
    if (s.y < -20 || s.y > this.camera.height + 20) return;
    const tw = this.textWidth(text, LABEL_FONT);
    ctx.fillStyle = 'rgba(15,23,42,0.75)';
    ctx.beginPath();
    rrect(ctx, s.x - tw / 2 - 8, s.y - 10, tw + 16, 20, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, s.x, s.y + 0.5);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  private drawSpotlight(now: number): void {
    const sp = this.spotlight;
    if (!sp) return;
    if (now > sp.until) {
      this.spotlight = null;
      this.highlightPlot = null;
      return;
    }
    if (sp.agentId) {
      const a = this.agentsMgr.agents.get(sp.agentId);
      if (a) {
        sp.x = a.x;
        sp.y = a.y - 14;
      }
    }
    const remaining = sp.until - now;
    const alpha = Math.min(1, remaining / 600) * 0.62;
    const s = this.camera.worldToScreen(sp.x, sp.y);
    const r = 44 + Math.sin(now / 180) * 4;
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(s.x, s.y, r * 0.7, s.x, s.y, r * 2.2);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${alpha})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.camera.width, this.camera.height);
    ctx.strokeStyle = `rgba(250,204,21,${alpha + 0.3})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ---------------------------------------------------------------------------
  // Tap / hit-test
  // ---------------------------------------------------------------------------

  private handleTap(sx: number, sy: number): void {
    for (const c of this.coinHits) {
      if (Math.hypot(sx - c.x, sy - c.y) <= c.r + 6) return this.onTap({ type: 'coin', plot: c.plot });
    }
    for (const h of this.calloutHits) {
      if (sx >= h.x && sx <= h.x + h.w && sy >= h.y && sy <= h.y + h.h) return this.onTap({ type: 'landmark', landmarkId: h.landmarkId });
    }
    const wp = this.camera.screenToWorld(sx, sy);
    const z = this.camera.zoom;

    // karakter: pilih yang terdekat dengan badan sprite (warga diprioritaskan)
    const rad = Math.max(16, 22 / z);
    let best: Agent | null = null;
    let bestD = Infinity;
    for (const a of this.hash.query(wp.x - rad, wp.y - rad, wp.x + rad, wp.y + CHAR_SIZE + rad)) {
      if (a.kind === 'npc') continue;
      const d = Math.hypot(a.x - wp.x, a.y - CHAR_SIZE * 0.45 - wp.y) - (a.kind === 'citizen' ? 6 : 0);
      if (d < rad && d < bestD) {
        best = a;
        bestD = d;
      }
    }
    if (best) {
      if (best.kind === 'citizen') return this.onTap({ type: 'citizen', citizenId: best.id.slice(2) });
      return this.onTap({ type: 'guest', label: best.label });
    }

    const g = this.geo.worldToGrid(wp.x, wp.y);
    if (g) {
      const p = this.plotByGrid.get(`${g.gx},${g.gy}`);
      if (p) return this.onTap({ type: 'plot', plot: p });
    }

    for (const lm of this.config.landmarks) {
      const r: Rect = this.geo.slotRect(LANDMARK_SLOTS[lm.kind]);
      if (wp.x >= r.x && wp.x <= r.x + r.w && wp.y >= r.y && wp.y <= r.y + r.h) return this.onTap({ type: 'landmark', landmarkId: lm.id });
    }
    this.onTap({ type: 'none' });
  }
}

