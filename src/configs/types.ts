/**
 * Skema konfigurasi multi-tenant.
 *
 * Satu file `src/configs/worlds/<worldId>.ts` = satu dunia (satu akun IG, satu proyek Cloudflare Pages).
 * Config yang sudah di-resolve juga di-seed ke kolom `world_states.config` (JSONB) lewat
 * `npm run db:seed`, sehingga fungsi RPC di PostgreSQL membaca aturan yang SAMA PERSIS dengan frontend
 * (kasta, jabatan, harga tanah, cooldown, dsb.). Sumber kebenaran tunggal: file TypeScript ini.
 */

export type WorldId =
  | 'republik-konoha'
  | 'pt-virtual'
  | 'kampus-virtual'
  | 'kampung-mistis'
  | 'kerajaan-nusantara'
  | 'guild-petualang'
  | 'kota-mafia'
  | 'pulau-penjara'
  | 'koloni-mars'
  | 'kerajaan-kucing';

export type FollowStatus = 'pending' | 'verified' | 'not_following' | 'recheck_requested' | 'impeached';

/** Preset posisi kasta. Menentukan rentang nomor default, hak istimewa, warna, & zona peta. */
export type TierPreset =
  | 'head' // #001
  | 'deputy' // #002
  | 'cabinet' // #003–#030
  | 'council' // #031–#060
  | 'elite' // #061–#100
  | 'ring2' // #101–#250
  | 'grassroot' // #251–#500
  | 'street' // #501–#1000
  | 'civil'; // #1001+

export type Outfit =
  | 'suit'
  | 'formal'
  | 'casual'
  | 'uniform'
  | 'jacket'
  | 'robe'
  | 'armor'
  | 'spacesuit'
  | 'fur'
  | 'prison'
  | 'ghost';

export type Accessory =
  | 'none'
  | 'crown'
  | 'star'
  | 'nametag'
  | 'pin'
  | 'sunglasses'
  | 'sparkle'
  | 'cap'
  | 'helmet'
  | 'whistle'
  | 'halo'
  | 'horns'
  | 'hat'
  | 'antenna'
  | 'ears';

export type MapZone =
  | 'palace'
  | 'parliament'
  | 'elite_complex'
  | 'ring1'
  | 'commercial'
  | 'residential'
  | 'gate'
  | 'anywhere';

export interface CharacterLook {
  outfit: Outfit;
  accessory: Accessory;
  /** Warna aksen kostum (dasi, helm, jubah). */
  accentColor: string;
}

export interface TierPerks {
  /** Menulis Pidato / Pengumuman Negara yang di-pin di TV. */
  canAnnounce: boolean;
  /** Membuat voting yang langsung aktif (tanpa moderasi). */
  canCreatePoll: boolean;
  /** Mengusulkan voting kebijakan (masuk antrean moderasi admin). */
  canProposePoll: boolean;
  /** Boleh membangun kategori bangunan `government`. */
  canBuildGovernment: boolean;
  /** Diskon beli kavling (persen). */
  landDiscountPct: number;
  /** Bonus pendapatan pasif properti (persen). */
  incomeBonusPct: number;
}

export interface TierConfig {
  id: string;
  preset: TierPreset;
  /** Nama golongan, cth. "RI 1 (Presiden)". */
  name: string;
  /** Label badge pendek, cth. "RI 1". */
  shortName: string;
  min: number;
  /** null = tak terbatas (tier terakhir). */
  max: number | null;
  /** Jabatan tetap berdasarkan urutan kursi di dalam tier (index 0 = nomor `min`). */
  seatTitles: string[];
  /** Jabatan sisa dipilih deterministik via hash nomor urut. */
  titlePool: string[];
  nametagColor: string;
  ktpBorder: string;
  zone: MapZone;
  look: CharacterLook;
  work: { label: string; reward: number };
  perks: TierPerks;
}

export type BuildingCategory = 'residential' | 'commercial' | 'government' | 'community';

export interface BuildingType {
  id: string;
  name: string;
  category: BuildingCategory;
  emoji: string;
  /** Biaya membangun level 1. Upgrade ke level L+1 = round(baseCost * upgradeMultiplier^L). */
  baseCost: number;
  upgradeMultiplier: number;
  /** Pendapatan pasif per level per 24 jam. */
  incomePerLevelPerDay: number;
  maxLevel: number;
  /** Warna dasar bangunan di peta. */
  color: string;
  requiresPerk?: 'canBuildGovernment';
}

export interface ProjectConfig {
  id: string;
  name: string;
  description: string;
  emoji: string;
  goal: number;
}

export type LandmarkKind =
  | 'palace'
  | 'parliament'
  | 'elite_complex'
  | 'shop'
  | 'gate'
  | 'plaza'
  | 'project_site';

export interface LandmarkConfig {
  id: string;
  kind: LandmarkKind;
  name: string;
  emoji: string;
}

export interface EconomyConfig {
  startingCoins: number;
  workCooldownMinutes: number;
  statusCooldownMinutes: number;
  statusMaxLength: number;
  announcementMaxLength: number;
  igChangeCooldownMinutes: number;
  recheckCooldownMinutes: number;
  pollProposalCooldownMinutes: number;
  land: {
    basePrice: number;
    ringDecayPct: number;
    minPrice: number;
    innerLayerBonusPct: number;
    maxPlotsPerCitizen: number;
  };
  income: { maxAccrualHours: number };
  requireVerified: {
    buyLand: boolean;
    build: boolean;
    donate: boolean;
    vote: boolean;
    governance: boolean;
  };
  /**
   * Pelantikan massal: kursi #1..inauguratedUpto dianggap resmi dilantik walau belum terverifikasi follow
   * (kecuali dimakzulkan). Dibaca juga oleh nv_require_verified di Supabase. Kosong = hanya verifikasi follow.
   */
  inauguratedUpto?: number;
}

export interface MapConfig {
  /** Ring 0 (landmark) menempati jarak Chebyshev 0..coreRadius dalam satuan kavling. */
  coreRadius: number;
  /** Jumlah lapis kavling per ring. Ring r berisi 8·d kavling untuk tiap lapis berjarak d. */
  layersPerRing: number;
  /** Ring ke-(i+1) terbuka saat populasi ≥ ringMilestones[i]. Setelah habis: digandakan terus. */
  ringMilestones: number[];
  /** Ring berikutnya juga terbuka bila ring terluar sudah terisi ≥ X% kavlingnya. */
  occupancyUnlockPct: number;
  /** Nama ring (index 0 = Ring 0 / inti). Ring di luar daftar memakai `ringNameFallback`. */
  ringNames: string[];
  ringNameFallback: string;
}

export interface RegistrationConfig {
  /** Tampilkan "Step 1: Follow @handle" — tombol daftar terbuka 3 detik setelah diklik. */
  softGateFollow: boolean;
  softGateDelaySeconds: number;
  displayNameMaxLength: number;
  maxRegistrationsPerIp24h: number;
  avatarColors: string[];
  avatarAccessories: Accessory[];
}

export interface VerificationConfig {
  checkWindowHours: number;
  impeachAfterHours: number;
  impeachMaxNumber: number;
}

export interface WorldTheme {
  primary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  ground: string;
  road: string;
}

export interface WorldCopy {
  nationName: string;
  nationShort: string;
  citizenNoun: string;
  guestLabel: string;
  registerCta: string;
  tvName: string;
  ktpTitle: string;
  ktpDisclaimer: string;
  stamps: Record<'pending' | 'verified' | 'not_following' | 'impeached', string>;
  tagline: string;
}

export interface SandboxOverrides {
  workCooldownMinutes: number;
  statusCooldownMinutes: number;
  igChangeCooldownMinutes: number;
  recheckCooldownMinutes: number;
  pollProposalCooldownMinutes: number;
}

export interface WorldConfig {
  worldId: WorldId;
  igAccountHandle: string;
  domain: string;
  ktpPrefix: string;
  currency: { code: string; name: string };
  copy: WorldCopy;
  theme: WorldTheme;
  tiers: TierConfig[];
  /** Tier pengganti untuk pejabat yang dimakzulkan. */
  impeachedTier: TierConfig;
  buildings: BuildingType[];
  projects: ProjectConfig[];
  landmarks: LandmarkConfig[];
  economy: EconomyConfig;
  map: MapConfig;
  registration: RegistrationConfig;
  verification: VerificationConfig;
  sandbox: SandboxOverrides;
}

// ---------------------------------------------------------------------------
// Input yang ditulis per dunia (default diisi oleh defineWorld()).
// ---------------------------------------------------------------------------

export interface TierInput {
  preset: TierPreset;
  name: string;
  shortName: string;
  workLabel: string;
  workReward?: number;
  seatTitles?: string[];
  titlePool?: string[];
  id?: string;
  min?: number;
  max?: number | null;
  look?: Partial<CharacterLook>;
  zone?: MapZone;
  nametagColor?: string;
  ktpBorder?: string;
  perks?: Partial<TierPerks>;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

export interface WorldInput {
  worldId: WorldId;
  igAccountHandle: string;
  domain: string;
  ktpPrefix: string;
  currency: { code: string; name: string };
  copy: Omit<WorldCopy, 'stamps' | 'citizenNoun' | 'guestLabel' | 'registerCta' | 'ktpTitle' | 'ktpDisclaimer'> &
    Partial<Pick<WorldCopy, 'stamps' | 'citizenNoun' | 'guestLabel' | 'registerCta' | 'ktpTitle' | 'ktpDisclaimer'>>;
  theme: WorldTheme;
  tiers: TierInput[];
  impeachedTier?: Partial<TierInput>;
  buildings: BuildingType[];
  projects: ProjectConfig[];
  landmarks: LandmarkConfig[];
  economy?: DeepPartial<EconomyConfig>;
  map?: Partial<MapConfig>;
  registration?: Partial<RegistrationConfig>;
  verification?: Partial<VerificationConfig>;
  sandbox?: Partial<SandboxOverrides>;
}
