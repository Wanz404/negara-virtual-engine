/**
 * Aturan game deterministik. SETIAP fungsi di sini punya padanan SQL di
 * supabase/migrations/001_init.sql (nama di komentar). Mode Supabase memakai versi SQL sebagai
 * otoritas; mode sandbox memakai versi TypeScript ini.
 */
import type {
  BuildingType,
  EconomyConfig,
  TierConfig,
  WorldConfig,
} from '../configs/types';

/** nv_number_hash — Knuth multiplicative hash, (n · 2654435761) mod 2^32. */
export function numberHash(n: number): number {
  return Math.imul(n, 2654435761 | 0) >>> 0;
}

/** nv_resolve_tier */
export function resolveTier(config: WorldConfig, n: number): TierConfig {
  const tier = [...config.tiers]
    .sort((a, b) => b.min - a.min)
    .find((t) => t.min <= n && (t.max === null || n <= t.max));
  return tier ?? config.tiers[config.tiers.length - 1];
}

/** nv_resolve_title */
export function resolveTitle(tier: TierConfig, n: number): string {
  const offset = n - tier.min;
  if (offset >= 0 && offset < tier.seatTitles.length) return tier.seatTitles[offset];
  if (tier.titlePool.length > 0) return tier.titlePool[numberHash(n) % tier.titlePool.length];
  return tier.name;
}

/** nv_find_tier — termasuk tier khusus 'impeached'. */
export function findTier(config: WorldConfig, tierId: string): TierConfig {
  if (tierId === config.impeachedTier.id) return config.impeachedTier;
  return config.tiers.find((t) => t.id === tierId) ?? config.tiers[config.tiers.length - 1];
}

/** nv_milestone — populasi minimal agar ring ke-(index+1) terbuka. */
export function ringMilestone(config: WorldConfig, index: number): number {
  const arr = config.map.ringMilestones;
  if (index < arr.length) return arr[index];
  const last = Math.max(arr[arr.length - 1] ?? 1, 1);
  return last * 2 ** (index - arr.length + 1);
}

/** nv_rings_for_population — berapa ring yang terbuka untuk populasi `pop`. */
export function ringsForPopulation(config: WorldConfig, pop: number): number {
  let r = 1;
  while (r < 60 && ringMilestone(config, r) <= pop) r++;
  return r;
}

/** Ring "alamat" warga ke-n (populasi sebelum dia mendaftar). */
export function ringForCitizenNumber(config: WorldConfig, n: number): number {
  return ringsForPopulation(config, n - 1);
}

export function ringName(config: WorldConfig, ring: number): string {
  return config.map.ringNames[ring] ?? config.map.ringNameFallback.replace('{n}', String(ring));
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** Kode KTP: "RK-0001", "RK-12345". */
export function ktpCode(config: WorldConfig, n: number): string {
  return `${config.ktpPrefix}-${pad(n, 4)}`;
}

/** Alamat otomatis: "RT 01 / RW 01 • Ring 1". */
export function rtRwAddress(config: WorldConfig, n: number): string {
  const rt = (Math.floor((n - 1) / 50) % 10) + 1;
  const rw = Math.floor((n - 1) / 500) + 1;
  return `RT ${pad(rt, 2)} / RW ${pad(rw, 2)} • Ring ${ringForCitizenNumber(config, n)}`;
}

// ---------------------------------------------------------------------------
// Kavling tanah (nv_plot_price, nv_ensure_plots)
// ---------------------------------------------------------------------------

export interface PlotSeed {
  plotCode: string;
  ringLevel: number;
  layer: number;
  gridX: number;
  gridY: number;
  price: number;
}

export function plotPrice(config: WorldConfig, ring: number, layer: number): number {
  const l = config.economy.land;
  let price = Math.max(l.minPrice, l.basePrice * Math.pow(1 - l.ringDecayPct / 100, ring - 1));
  if (layer === 0) price *= 1 + l.innerLayerBonusPct / 100;
  return Math.round(price / 5) * 5;
}

/** Jarak Chebyshev lapis kavling untuk ring tertentu. */
export function ringLayerDistance(config: WorldConfig, ring: number, layer: number): number {
  return config.map.coreRadius + (ring - 1) * config.map.layersPerRing + layer + 1;
}

/** Keliling persegi berjarak d, searah jarum jam mulai pojok kiri atas (urutan sama dengan SQL). */
export function perimeter(d: number): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let x = -d; x <= d; x++) cells.push([x, -d]);
  for (let y = -d + 1; y <= d; y++) cells.push([d, y]);
  for (let x = d - 1; x >= -d; x--) cells.push([x, d]);
  for (let y = d - 1; y >= -d + 1; y--) cells.push([-d, y]);
  return cells;
}

export function generateRingPlots(config: WorldConfig, ring: number): PlotSeed[] {
  const plots: PlotSeed[] = [];
  for (let layer = 0; layer < config.map.layersPerRing; layer++) {
    const d = ringLayerDistance(config, ring, layer);
    perimeter(d).forEach(([x, y], i) => {
      const idx = i + 1;
      plots.push({
        plotCode: `R${ring}-${String.fromCharCode(65 + layer)}${String(idx).padStart(Math.max(3, String(idx).length), '0')}`,
        ringLevel: ring,
        layer,
        gridX: x,
        gridY: y,
        price: plotPrice(config, ring, layer),
      });
    });
  }
  return plots;
}

// ---------------------------------------------------------------------------
// Properti
// ---------------------------------------------------------------------------

export function findBuilding(config: WorldConfig, id: string | null | undefined): BuildingType | undefined {
  return config.buildings.find((b) => b.id === id);
}

/** Biaya menaikkan bangunan dari `currentLevel` ke `currentLevel + 1` (0 = membangun baru). */
export function buildingCost(b: BuildingType, currentLevel: number): number {
  return Math.round(b.baseCost * Math.pow(b.upgradeMultiplier, currentLevel));
}

/** nv_property_income — pendapatan pasif yang sudah terkumpul (dibulatkan ke bawah). */
export function propertyIncome(
  config: WorldConfig,
  b: BuildingType,
  level: number,
  lastClaimIso: string | null,
  incomeBonusPct: number,
  now = Date.now(),
): number {
  if (!lastClaimIso || level <= 0) return 0;
  const hours = Math.min(config.economy.income.maxAccrualHours, Math.max(0, (now - new Date(lastClaimIso).getTime()) / 3_600_000));
  return Math.floor(((b.incomePerLevelPerDay * level * hours) / 24) * (1 + incomeBonusPct / 100));
}

// ---------------------------------------------------------------------------
// Cooldown
// ---------------------------------------------------------------------------

export type EconomyMode = 'supabase' | 'sandbox';

/** Ekonomi efektif: di sandbox cooldown dipersingkat agar mudah dites. */
export function effectiveEconomy(config: WorldConfig, mode: EconomyMode): EconomyConfig {
  if (mode !== 'sandbox') return config.economy;
  return { ...config.economy, ...config.sandbox };
}

export function nextAvailableAt(lastIso: string | null | undefined, cooldownMinutes: number): number {
  if (!lastIso) return 0;
  return new Date(lastIso).getTime() + cooldownMinutes * 60_000;
}
