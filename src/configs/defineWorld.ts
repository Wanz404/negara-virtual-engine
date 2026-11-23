import type {
  CharacterLook,
  EconomyConfig,
  MapConfig,
  MapZone,
  RegistrationConfig,
  SandboxOverrides,
  TierConfig,
  TierInput,
  TierPerks,
  TierPreset,
  VerificationConfig,
  WorldConfig,
  WorldCopy,
  WorldInput,
} from './types';

/** Rentang nomor urut standar per preset (bisa ditimpa per dunia dengan min/max). */
export const STANDARD_RANGES: Record<TierPreset, [number, number | null]> = {
  head: [1, 1],
  deputy: [2, 2],
  cabinet: [3, 30],
  council: [31, 60],
  elite: [61, 100],
  ring2: [101, 250],
  grassroot: [251, 500],
  street: [501, 1000],
  civil: [1001, null],
};

const NO_PERKS: TierPerks = {
  canAnnounce: false,
  canCreatePoll: false,
  canProposePoll: false,
  canBuildGovernment: false,
  landDiscountPct: 0,
  incomeBonusPct: 0,
};

const PRESET_PERKS: Record<TierPreset, Partial<TierPerks>> = {
  head: { canAnnounce: true, canCreatePoll: true, canProposePoll: true, canBuildGovernment: true, landDiscountPct: 10, incomeBonusPct: 20 },
  deputy: { canAnnounce: true, canCreatePoll: true, canProposePoll: true, canBuildGovernment: true, landDiscountPct: 10, incomeBonusPct: 15 },
  cabinet: { canProposePoll: true, canBuildGovernment: true, incomeBonusPct: 10 },
  council: { canProposePoll: true, canBuildGovernment: true, incomeBonusPct: 5 },
  elite: { landDiscountPct: 20, incomeBonusPct: 10 },
  ring2: { incomeBonusPct: 5 },
  grassroot: { canBuildGovernment: true },
  street: {},
  civil: {},
};

const PRESET_COLORS: Record<TierPreset, { nametag: string; border: string }> = {
  head: { nametag: '#facc15', border: '#d4a017' },
  deputy: { nametag: '#fde047', border: '#d4a017' },
  cabinet: { nametag: '#fbbf24', border: '#c9a227' },
  council: { nametag: '#7dd3fc', border: '#0ea5e9' },
  elite: { nametag: '#c084fc', border: '#9333ea' },
  ring2: { nametag: '#2dd4bf', border: '#0d9488' },
  grassroot: { nametag: '#fb923c', border: '#c2410c' },
  street: { nametag: '#a3e635', border: '#65a30d' },
  civil: { nametag: '#e5e7eb', border: '#6b7280' },
};

const PRESET_REWARD: Record<TierPreset, number> = {
  head: 60,
  deputy: 50,
  cabinet: 40,
  council: 35,
  elite: 45,
  ring2: 28,
  grassroot: 22,
  street: 18,
  civil: 12,
};

const PRESET_ZONE: Record<TierPreset, MapZone> = {
  head: 'palace',
  deputy: 'palace',
  cabinet: 'ring1',
  council: 'parliament',
  elite: 'elite_complex',
  ring2: 'commercial',
  grassroot: 'residential',
  street: 'gate',
  civil: 'anywhere',
};

const PRESET_LOOK: Record<TierPreset, CharacterLook> = {
  head: { outfit: 'suit', accessory: 'crown', accentColor: '#dc2626' },
  deputy: { outfit: 'suit', accessory: 'star', accentColor: '#eab308' },
  cabinet: { outfit: 'suit', accessory: 'nametag', accentColor: '#1d4ed8' },
  council: { outfit: 'formal', accessory: 'pin', accentColor: '#0ea5e9' },
  elite: { outfit: 'suit', accessory: 'sunglasses', accentColor: '#7c3aed' },
  ring2: { outfit: 'casual', accessory: 'sparkle', accentColor: '#14b8a6' },
  grassroot: { outfit: 'uniform', accessory: 'cap', accentColor: '#ea580c' },
  street: { outfit: 'jacket', accessory: 'helmet', accentColor: '#16a34a' },
  civil: { outfit: 'casual', accessory: 'none', accentColor: '#64748b' },
};

export const DEFAULT_ECONOMY: EconomyConfig = {
  startingCoins: 20,
  workCooldownMinutes: 120,
  statusCooldownMinutes: 10,
  statusMaxLength: 50,
  announcementMaxLength: 160,
  igChangeCooldownMinutes: 30,
  recheckCooldownMinutes: 60,
  pollProposalCooldownMinutes: 360,
  land: { basePrice: 200, ringDecayPct: 25, minPrice: 50, innerLayerBonusPct: 20, maxPlotsPerCitizen: 5 },
  income: { maxAccrualHours: 24 },
  requireVerified: { buyLand: true, build: true, donate: true, vote: true, governance: true },
};

export const DEFAULT_MAP: MapConfig = {
  coreRadius: 3,
  layersPerRing: 2,
  ringMilestones: [0, 100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000],
  occupancyUnlockPct: 80,
  ringNames: ['Inti Pusat', 'Distrik Perintis', 'Distrik Kota Baru', 'Megapolitan'],
  ringNameFallback: 'Ekspansi Ring {n}',
};

export const DEFAULT_REGISTRATION: RegistrationConfig = {
  softGateFollow: false,
  softGateDelaySeconds: 3,
  displayNameMaxLength: 16,
  maxRegistrationsPerIp24h: 2,
  avatarColors: ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#78716c', '#0f172a'],
  avatarAccessories: ['none', 'cap', 'hat', 'sunglasses', 'helmet'],
};

export const DEFAULT_VERIFICATION: VerificationConfig = {
  checkWindowHours: 24,
  impeachAfterHours: 48,
  impeachMaxNumber: 100,
};

/** Cooldown super pendek khusus mode sandbox (localStorage) agar semua fitur cepat dites. */
export const DEFAULT_SANDBOX: SandboxOverrides = {
  workCooldownMinutes: 1,
  statusCooldownMinutes: 0.25,
  igChangeCooldownMinutes: 0.25,
  recheckCooldownMinutes: 0.25,
  pollProposalCooldownMinutes: 0.5,
};

const DEFAULT_STAMPS: WorldCopy['stamps'] = {
  pending: 'MENUNGGU PELANTIKAN',
  verified: 'DUKCAPIL SAH • RESMI DILANTIK',
  not_following: 'BELUM FOLLOW / WARGA GELAP',
  impeached: 'DIMAKZULKAN',
};

function resolveTier(input: TierInput): TierConfig {
  const [defMin, defMax] = STANDARD_RANGES[input.preset];
  const colors = PRESET_COLORS[input.preset];
  return {
    id: input.id ?? input.preset,
    preset: input.preset,
    name: input.name,
    shortName: input.shortName,
    min: input.min ?? defMin,
    max: input.max === undefined ? defMax : input.max,
    seatTitles: input.seatTitles ?? [],
    titlePool: input.titlePool ?? [],
    nametagColor: input.nametagColor ?? colors.nametag,
    ktpBorder: input.ktpBorder ?? colors.border,
    zone: input.zone ?? PRESET_ZONE[input.preset],
    look: { ...PRESET_LOOK[input.preset], ...input.look },
    work: { label: input.workLabel, reward: input.workReward ?? PRESET_REWARD[input.preset] },
    perks: { ...NO_PERKS, ...PRESET_PERKS[input.preset], ...input.perks },
  };
}

function assertTierCoverage(worldId: string, tiers: TierConfig[]): void {
  let expected = 1;
  tiers.forEach((t, i) => {
    if (t.min !== expected) {
      throw new Error(`[${worldId}] Tier "${t.id}" harus mulai dari #${expected}, bukan #${t.min}`);
    }
    const last = i === tiers.length - 1;
    if (last && t.max !== null) throw new Error(`[${worldId}] Tier terakhir harus max: null`);
    if (!last && (t.max === null || t.max < t.min)) throw new Error(`[${worldId}] Tier "${t.id}" max tidak valid`);
    if (t.max !== null) expected = t.max + 1;
  });
  const ids = new Set(tiers.map((t) => t.id));
  if (ids.size !== tiers.length) throw new Error(`[${worldId}] id tier harus unik`);
}

export function defineWorld(input: WorldInput): WorldConfig {
  const tiers = input.tiers.map(resolveTier);
  assertTierCoverage(input.worldId, tiers);

  const civil = tiers[tiers.length - 1];
  const impeachedTier = resolveTier({
    preset: 'civil',
    id: 'impeached',
    name: 'Warga Gelap (Dimakzulkan)',
    shortName: 'GELAP',
    workLabel: civil.work.label,
    workReward: Math.max(1, Math.round(civil.work.reward * 0.75)),
    nametagColor: '#9ca3af',
    ktpBorder: '#4b5563',
    min: 0,
    max: 0,
    ...input.impeachedTier,
  });

  const e = input.economy ?? {};
  const economy: EconomyConfig = {
    ...DEFAULT_ECONOMY,
    ...e,
    land: { ...DEFAULT_ECONOMY.land, ...e.land },
    income: { ...DEFAULT_ECONOMY.income, ...e.income },
    requireVerified: { ...DEFAULT_ECONOMY.requireVerified, ...e.requireVerified },
  } as EconomyConfig;

  return {
    worldId: input.worldId,
    igAccountHandle: input.igAccountHandle.toLowerCase(),
    domain: input.domain,
    ktpPrefix: input.ktpPrefix,
    currency: input.currency,
    copy: {
      citizenNoun: 'Warga',
      guestLabel: 'Tamu',
      registerCta: 'Daftar Warga',
      ktpTitle: 'KARTU TANDA PENDUDUK',
      ktpDisclaimer: 'Kartu Tanda Penduduk versi virtual • bukan dokumen resmi',
      ...input.copy,
      stamps: { ...DEFAULT_STAMPS, ...input.copy.stamps },
    },
    theme: input.theme,
    tiers,
    impeachedTier,
    buildings: input.buildings.map((b) => ({ ...b })),
    projects: input.projects,
    landmarks: input.landmarks,
    economy,
    map: { ...DEFAULT_MAP, ...input.map },
    registration: { ...DEFAULT_REGISTRATION, ...input.registration },
    verification: { ...DEFAULT_VERIFICATION, ...input.verification },
    sandbox: { ...DEFAULT_SANDBOX, ...input.sandbox },
  };
}

/** Helper ringkas untuk daftar bangunan. */
export function building(
  id: string,
  name: string,
  category: 'residential' | 'commercial' | 'government' | 'community',
  emoji: string,
  baseCost: number,
  incomePerLevelPerDay: number,
  color: string,
): import('./types').BuildingType {
  return {
    id,
    name,
    category,
    emoji,
    baseCost,
    incomePerLevelPerDay,
    color,
    upgradeMultiplier: 1.6,
    maxLevel: 5,
    ...(category === 'government' ? { requiresPerk: 'canBuildGovernment' as const } : {}),
  };
}
