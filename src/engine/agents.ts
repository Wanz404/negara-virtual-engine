import type { CharacterLook, MapZone, WorldConfig } from '../configs/types';
import { findTier } from '../lib/game';
import { formatCitizenTag } from '../lib/format';
import type { Plot, PresenceMember, PublicCitizen } from '../services/types';
import { Geometry, hashString, seededRng, zonePoint, type Rng } from './geometry';

export type AgentKind = 'citizen' | 'guest' | 'npc';

export interface Agent {
  id: string;
  kind: AgentKind;
  x: number;
  y: number;
  tx: number;
  ty: number;
  speed: number;
  wait: number;
  facing: 1 | -1;
  phase: number;
  color: string;
  look: CharacterLook;
  accessory?: CharacterLook['accessory'];
  dim: boolean;
  label: string;
  labelBg: string;
  labelFg: string;
  online: boolean;
  isMe: boolean;
  status: string;
  zone: MapZone | 'plaza' | 'guest';
  homePlot: { x: number; y: number } | null;
  citizenNumber: number;
  rng: Rng;
}

const NPC_LOOK: CharacterLook = { outfit: 'casual', accessory: 'none', accentColor: '#94a3b8' };
const GUEST_LOOK: CharacterLook = { outfit: 'casual', accessory: 'none', accentColor: '#94a3b8' };
export const MAX_GUESTS = 40;
export const MAX_NPCS = 70;

/** "AI" jalan-jalan 100% client-side: tidak ada sinkronisasi posisi ke server (hemat kuota). */
export class AgentManager {
  readonly agents = new Map<string, Agent>();
  private geo: Geometry;
  private config: WorldConfig;
  private unlocked = 1;

  constructor(config: WorldConfig, geo: Geometry) {
    this.config = config;
    this.geo = geo;
  }

  setUnlocked(r: number): void {
    this.unlocked = r;
  }

  private pickTarget(a: Agent): void {
    if (a.homePlot && a.rng() < 0.5) {
      a.tx = a.homePlot.x + (a.rng() - 0.5) * 50;
      a.ty = a.homePlot.y + 38 + a.rng() * 6;
    } else {
      const p = zonePoint(this.geo, a.zone, this.unlocked, a.rng);
      a.tx = p.x;
      a.ty = p.y;
    }
  }

  private spawn(id: string, kind: AgentKind, zone: Agent['zone'], partial: Partial<Agent>): Agent {
    const rng = seededRng(hashString(id));
    const p = zonePoint(this.geo, zone, this.unlocked, rng);
    const a: Agent = {
      id,
      kind,
      x: p.x,
      y: p.y,
      tx: p.x,
      ty: p.y,
      speed: 16 + rng() * 14,
      wait: rng() * 3,
      facing: 1,
      phase: rng() * Math.PI * 2,
      color: '#94a3b8',
      look: NPC_LOOK,
      dim: false,
      label: '',
      labelBg: '#e5e7eb',
      labelFg: '#111827',
      online: false,
      isMe: false,
      status: '',
      zone,
      homePlot: null,
      citizenNumber: 0,
      rng,
      ...partial,
    };
    this.pickTarget(a);
    return a;
  }

  /** Sinkronkan daftar karakter dari data (warga sampel, Tamu presence, NPC follower). */
  sync(citizens: PublicCitizen[], members: PresenceMember[], npcCount: number, meId: string | null, plotsByOwner: Map<string, Plot>): void {
    const keep = new Set<string>();
    const online = new Set(members.filter((m) => m.citizenId).map((m) => m.citizenId));

    for (const c of citizens) {
      const id = `c:${c.id}`;
      keep.add(id);
      const tier = findTier(this.config, c.tierId);
      const verified = c.followStatus === 'verified';
      const plot = plotsByOwner.get(c.id);
      const home = plot ? this.geo.toWorld(plot.gridX, plot.gridY) : null;
      const props: Partial<Agent> = {
        color: c.avatarColor,
        look: tier.look,
        accessory: c.avatarStyle?.accessory,
        dim: c.followStatus === 'impeached',
        label: formatCitizenTag(c.username, c.citizenNumber),
        labelBg: verified ? tier.nametagColor : '#e5e7eb',
        labelFg: '#111827',
        online: online.has(c.id),
        isMe: c.id === meId,
        status: c.statusText ?? '',
        homePlot: home,
        citizenNumber: c.citizenNumber,
      };
      const existing = this.agents.get(id);
      if (existing) {
        const zoneChanged = existing.zone !== tier.zone;
        Object.assign(existing, props, { zone: tier.zone });
        if (zoneChanged) this.pickTarget(existing);
      } else {
        this.agents.set(id, this.spawn(id, 'citizen', tier.zone, props));
      }
    }

    for (const m of members.filter((x) => x.kind === 'guest').slice(0, MAX_GUESTS)) {
      const id = `g:${m.key}`;
      keep.add(id);
      if (!this.agents.has(id)) {
        this.agents.set(
          id,
          this.spawn(id, 'guest', 'guest', {
            color: m.color,
            look: GUEST_LOOK,
            label: `${this.config.copy.guestLabel} ${m.tag}`,
            labelBg: 'rgba(255,255,255,0.8)',
            labelFg: '#334155',
          }),
        );
      }
    }

    const npcs = Math.min(MAX_NPCS, Math.max(0, npcCount));
    const palette = this.config.registration.avatarColors;
    for (let i = 0; i < npcs; i++) {
      const id = `n:${i}`;
      keep.add(id);
      if (!this.agents.has(id)) {
        this.agents.set(id, this.spawn(id, 'npc', 'anywhere', { color: palette[i % palette.length], speed: 12 + (i % 7) * 2 }));
      }
    }

    for (const id of this.agents.keys()) if (!keep.has(id)) this.agents.delete(id);
  }

  update(dt: number): void {
    for (const a of this.agents.values()) {
      if (a.wait > 0) {
        a.wait -= dt;
        continue;
      }
      const dx = a.tx - a.x;
      const dy = a.ty - a.y;
      const d = Math.hypot(dx, dy);
      if (d < 2) {
        a.wait = 1.5 + a.rng() * 5;
        this.pickTarget(a);
        continue;
      }
      const step = Math.min(d, a.speed * dt);
      a.x += (dx / d) * step;
      a.y += (dy / d) * step;
      if (Math.abs(dx) > 0.5) a.facing = dx > 0 ? 1 : -1;
      a.phase += dt * 9;
    }
  }
}
