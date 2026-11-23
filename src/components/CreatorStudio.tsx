import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { WORLD } from '../configs';
import { findBuilding } from '../lib/game';
import { formatCitizenTag, formatNumber } from '../lib/format';
import type { Plot, PublicCitizen, WorldState } from '../services';
import type { MapViewHandle } from './MapView';

interface Step {
  caption: string;
  sub?: string;
  ms: number;
  cta?: boolean;
  run: () => void;
}

/**
 * Creator Studio: overlay siaran untuk rekam layar Reels 9:16.
 * Sekuens auto-camera: (1) Istana & Presiden → (2) 3 warga terbaru → (3) bangunan terbaru →
 * (4) proyek nasional → (5) zoom-out seluruh kota + CTA "Klaim KTP di Link Bio".
 */
export function CreatorStudio({
  mapRef,
  world,
  citizens,
  ownedPlots,
  online,
  onExit,
}: {
  mapRef: RefObject<MapViewHandle | null>;
  world: WorldState | null;
  citizens: PublicCitizen[];
  ownedPlots: Plot[];
  online: number;
  onExit: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [loop, setLoop] = useState(false);
  const [step, setStep] = useState<Step | null>(null);
  const [count, setCount] = useState(0);
  const cancel = useRef<() => void>(() => {});
  const population = world ? Math.max(world.igFollowerCount, world.lastCitizenNumber) : 0;

  // Counter populasi animasi naik (efek "live")
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const from = running ? Math.floor(population * 0.85) : population;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1600);
      setCount(Math.round(from + (population - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [population, running]);

  const buildSteps = useCallback((): Step[] => {
    const map = mapRef.current;
    if (!map) return [];
    const steps: Step[] = [];
    const head = WORLD.tiers[0];
    const president = citizens.find((c) => c.citizenNumber === 1);
    steps.push({
      caption: president ? `🏛️ ${head.seatTitles[0] ?? head.name}` : '🏛️ Kursi #001 masih kosong!',
      sub: president ? formatCitizenTag(president.username, 1) : 'Siapa cepat, dia jadi pemimpin negara',
      ms: 4200,
      run: () => {
        map.locateLandmark('palace', 1.7);
        if (president) setTimeout(() => map.locateCitizen(president.id), 1400);
      },
    });
    const newest = [...citizens].sort((a, b) => b.citizenNumber - a.citizenNumber).filter((c) => c.citizenNumber > 1).slice(0, 3);
    newest.forEach((c, i) =>
      steps.push({
        caption: i === 0 ? `🆕 ${WORLD.copy.citizenNoun} baru hari ini` : '🆕 Lalu ada…',
        sub: `${formatCitizenTag(c.username, c.citizenNumber)} — ${c.roleTitle}`,
        ms: 3000,
        run: () => map.locateCitizen(c.id),
      }),
    );
    const built = ownedPlots.filter((p) => p.buildingLevel > 0).sort((a, b) => (b.purchasedAt ?? '').localeCompare(a.purchasedAt ?? ''))[0];
    if (built) {
      const b = findBuilding(WORLD, built.buildingType);
      steps.push({
        caption: `🏗️ ${built.buildingName ?? b?.name ?? 'Bangunan baru'} ${'★'.repeat(built.buildingLevel)}`,
        sub: `Milik ${built.ownerTag ?? '?'} • ${built.plotCode}`,
        ms: 3500,
        run: () => map.locatePlot(built.plotCode),
      });
    }
    const project = WORLD.projects.find((p) => p.id === world?.activeProjectId);
    if (project && world) {
      const pct = world.activeProjectGoal > 0 ? Math.floor((world.activeProjectFunding / world.activeProjectGoal) * 100) : 0;
      steps.push({
        caption: world.activeProjectCompleted ? '🎉 Semua proyek nasional selesai!' : `${project.emoji} ${project.name}`,
        sub: world.activeProjectCompleted ? 'Kota makin megah' : `Progres patungan warga: ${pct}%`,
        ms: 3600,
        run: () => map.locateLandmark('project_site', 1.6),
      });
    }
    steps.push({
      caption: `${formatNumber(population)} ${WORLD.copy.citizenNoun.toLowerCase()} dan terus bertambah`,
      sub: `Ring ${world?.currentRingUnlocked ?? 1} terbuka`,
      ms: 6000,
      cta: true,
      run: () => map.frameAll(),
    });
    return steps;
  }, [mapRef, citizens, ownedPlots, world, population]);

  const stop = useCallback(() => {
    cancel.current();
    setRunning(false);
    setStep(null);
  }, []);

  const start = useCallback(() => {
    const steps = buildSteps();
    if (steps.length === 0) return;
    let i = 0;
    let timer = 0;
    let cancelled = false;
    const next = () => {
      if (cancelled) return;
      if (i >= steps.length) {
        if (loop) i = 0;
        else {
          timer = window.setTimeout(() => !cancelled && stop(), 400);
          return;
        }
      }
      const s = steps[i++];
      setStep(s);
      s.run();
      timer = window.setTimeout(next, s.ms);
    };
    cancel.current = () => {
      cancelled = true;
      clearTimeout(timer);
    };
    setRunning(true);
    mapRef.current?.frameCore();
    timer = window.setTimeout(next, 900);
  }, [buildSteps, loop, mapRef, stop]);

  useEffect(() => {
    mapRef.current?.setPresentation(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (running) stop();
        else onExit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      mapRef.current?.setPresentation(false);
    };
  }, [mapRef, running, stop, onExit]);

  useEffect(() => () => cancel.current(), []);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col">
      {/* Header siaran */}
      <div className="bg-gradient-to-b from-black/70 to-transparent px-4 pt-4 pb-10 text-white">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-black tracking-wider">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> LIVE
          </span>
          <span className="text-sm font-black tracking-wide">
            HARI KE-{world?.dayNumber ?? 1} • {WORLD.copy.nationName.toUpperCase()}
          </span>
        </div>
        <div className="mt-2 text-4xl leading-none font-black tabular-nums drop-shadow">
          {formatNumber(count)} <span className="text-lg">{WORLD.copy.citizenNoun.toUpperCase()}</span>
        </div>
        <div className="mt-1 text-xs font-semibold text-white/80">🟢 {formatNumber(online)} online sekarang</div>
      </div>

      <div className="flex-1" />

      {/* Caption langkah */}
      {step && (
        <div key={step.caption + step.sub} className="mx-4 mb-4 rounded-3xl bg-black/75 px-4 py-3 text-white shadow-2xl backdrop-blur-sm">
          <div className="text-lg leading-tight font-black">{step.caption}</div>
          {step.sub && <div className="mt-0.5 text-sm font-semibold text-white/85">{step.sub}</div>}
        </div>
      )}
      {step?.cta && (
        <div className="mx-4 mb-6 rounded-3xl bg-accent px-4 py-4 text-center text-gray-900 shadow-2xl">
          <div className="text-2xl leading-tight font-black">Klaim KTP di Link Bio 👆</div>
          <div className="text-sm font-bold">@{WORLD.igAccountHandle} • 1 Follower = 1 {WORLD.copy.citizenNoun}</div>
        </div>
      )}

      {/* Kontrol (disembunyikan saat merekam; Esc untuk berhenti) */}
      {!running && (
        <div className="pointer-events-auto mx-4 mb-4 rounded-3xl bg-white/95 p-3 shadow-2xl">
          <div className="text-sm font-black">🎬 Creator Studio</div>
          <p className="text-xs text-muted">Mulai rekam layar dulu, lalu tekan Mulai. Kontrol ini hilang selama sekuens berjalan (Esc untuk berhenti).</p>
          <label className="mt-2 flex items-center gap-2 text-xs font-semibold">
            <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Ulangi terus (loop)
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button onClick={onExit} className="rounded-2xl bg-black/5 py-3 text-sm font-bold">
              Keluar
            </button>
            <button onClick={start} className="rounded-2xl bg-brand py-3 text-sm font-bold text-white">
              ▶ Mulai Auto-Camera
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
