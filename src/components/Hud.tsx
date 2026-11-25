import type { ReactNode } from 'react';
import { WORLD } from '../configs';
import { formatCoins, formatNumber, formatSyncedAt } from '../lib/format';
import type { WorldState } from '../services';

/** HUD kiri atas: WARGA (max followers IG vs terdaftar) + "diperbarui …" + DAY + online. */
export function Hud({ world, online, onProject, children }: { world: WorldState | null; online: number; onProject?: () => void; children?: ReactNode }) {
  const population = world ? Math.max(world.igFollowerCount, world.lastCitizenNumber) : 0;
  const project = WORLD.projects.find((p) => p.id === world?.activeProjectId);
  const pct = world && world.activeProjectGoal > 0 ? Math.min(100, (world.activeProjectFunding / world.activeProjectGoal) * 100) : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="hud-panel rounded-2xl px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-amber-400 text-[#3b1d00] px-1.5 py-0.5 text-[10px] font-black tracking-wider">DAY {world?.dayNumber ?? 1}</span>
          <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-300">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            {formatNumber(online)} {WORLD.copy.citizenNoun.toLowerCase()} online
          </span>
        </div>
        <div className="mt-1 text-[22px] leading-none font-black tracking-tight text-amber-300 drop-shadow">
          {WORLD.copy.citizenNoun.toUpperCase()}: {formatNumber(population)}
        </div>
        <div className="mt-1 text-[11px] text-white/70">diperbarui {formatSyncedAt(world?.followersSyncedAt)}</div>
        <div className="mt-0.5 text-[11px] text-white/70">
          {formatNumber(world?.lastCitizenNumber ?? 0)} terdaftar • Ring {world?.currentRingUnlocked ?? 1} terbuka
        </div>
      </div>

      {project && world && (
        <button type="button" onClick={onProject} className="hud-panel tactile block w-full rounded-2xl px-3.5 py-2 text-left" aria-label="Buka patungan proyek">
          <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
            <span className="truncate">
              {project.emoji} {world.activeProjectCompleted ? 'Semua proyek selesai!' : project.name}
            </span>
            <span className="shrink-0 rounded-full bg-amber-400 px-1.5 text-[9px] font-black text-amber-950">{world.activeProjectCompleted ? `${pct.toFixed(0)}%` : 'PATUNGAN ›'}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-0.5 text-[10px] text-white/70">
            {formatCoins(world.activeProjectFunding, WORLD.currency.code)} / {formatCoins(world.activeProjectGoal, WORLD.currency.code)} • {pct.toFixed(pct < 10 ? 1 : 0)}%
          </div>
        </button>
      )}
      {children}
    </div>
  );
}
