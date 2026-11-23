import { WORLD } from '../configs';
import { formatCoins, formatNumber, formatSyncedAt } from '../lib/format';
import type { WorldState } from '../services';

/** HUD kiri atas: WARGA (max followers IG vs terdaftar) + "diperbarui …" + DAY + online. */
export function Hud({ world, online }: { world: WorldState | null; online: number }) {
  const population = world ? Math.max(world.igFollowerCount, world.lastCitizenNumber) : 0;
  const project = WORLD.projects.find((p) => p.id === world?.activeProjectId);
  const pct = world && world.activeProjectGoal > 0 ? Math.min(100, (world.activeProjectFunding / world.activeProjectGoal) * 100) : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-2xl bg-surface/95 px-3.5 py-2.5 shadow-lg ring-1 ring-black/5 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-brand px-1.5 py-0.5 text-[10px] font-black tracking-wider text-white">DAY {world?.dayNumber ?? 1}</span>
          <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            {formatNumber(online)} {WORLD.copy.citizenNoun.toLowerCase()} online
          </span>
        </div>
        <div className="mt-1 text-[22px] leading-none font-black tracking-tight">
          {WORLD.copy.citizenNoun.toUpperCase()}: {formatNumber(population)}
        </div>
        <div className="mt-1 text-[11px] text-muted">diperbarui {formatSyncedAt(world?.followersSyncedAt)}</div>
        <div className="mt-0.5 text-[11px] text-muted">
          {formatNumber(world?.lastCitizenNumber ?? 0)} terdaftar • Ring {world?.currentRingUnlocked ?? 1} terbuka
        </div>
      </div>

      {project && world && (
        <div className="rounded-2xl bg-surface/95 px-3.5 py-2 shadow-lg ring-1 ring-black/5">
          <div className="flex items-center justify-between gap-2 text-[11px] font-bold">
            <span className="truncate">
              {project.emoji} {world.activeProjectCompleted ? 'Semua proyek selesai!' : project.name}
            </span>
            <span className="text-muted">{pct.toFixed(0)}%</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-black/10">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-0.5 text-[10px] text-muted">
            {formatCoins(world.activeProjectFunding, WORLD.currency.code)} / {formatCoins(world.activeProjectGoal, WORLD.currency.code)}
          </div>
        </div>
      )}
    </div>
  );
}
