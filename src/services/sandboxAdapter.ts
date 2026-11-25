/**
 * MODE SANDBOX — dipakai otomatis jika env Supabase kosong (atau VITE_DEV_MOCK_MODE=true).
 * Meniru seluruh aturan RPC di supabase/migrations/001_init.sql memakai localStorage, sehingga
 * semua fitur (FCFS, verifikasi follow, ekonomi, voting, admin, Tamu online) bisa dites lokal.
 * Antar-tab tersinkron: setiap operasi membaca ulang localStorage, presence via BroadcastChannel.
 */
import type { WorldConfig } from '../configs/types';
import {
  buildingCost,
  effectiveEconomy,
  findBuilding,
  findTier,
  generateRingPlots,
  ktpCode,
  nextAvailableAt,
  propertyIncome,
  resolveTier,
  resolveTitle,
  ringName,
  ringsForPopulation,
  rtRwAddress,
} from '../lib/game';
import { formatCitizenNumber, formatCitizenTag, formatDuration } from '../lib/format';
import { containsProfanity } from '../lib/profanity';
import { isInaugurated } from '../lib/inauguration';
import {
  CHAT_COOLDOWN_MS,
  NAME_EDIT_COOLDOWN_MS,
  cleanDisplayName,
  cleanProfileText,
  isHexColor,
  normalizeIgUsername,
  validateChatText,
  validateFreeText,
  validateIgUsername,
  validateProfileName,
} from '../lib/validation';
import { mapChat } from './mappers';
import {
  DEFAULT_PROPERTY_CATALOG,
  DONATION_ANNOUNCE_MIN,
  MISSIONS,
  QUICK_WORK_COOLDOWN_MS,
  QUICK_WORK_LABELS,
  QUICK_WORK_MAX_PER_DAY,
  QUICK_WORK_REWARD,
  SALARY_BASE,
  SALARY_COOLDOWN_MS,
  rankSalaryBonus,
  todayWib,
} from '../lib/economy';
import {
  ApiError,
  type DonorRow,
  type EmoteEvent,
  type EmoteKey,
  type LeaderboardRow,
  type MyCitizen,
  type NationApi,
  type NewsCategory,
  type NewsItem,
  type Plot,
  type Poll,
  type PresenceIdentity,
  type PresenceMember,
  type PublicCitizen,
  type QuickLoginCheck,
  type Session,
  type WorldState,
  normalizeLoginUsername,
} from './types';

export const SANDBOX_ADMIN_SECRET = 'admin123';
export const SANDBOX_SYNC_SECRET = 'sandbox-sync-secret';

interface SbCitizen extends MyCitizen {
  token: string;
  recoveryPin: string | null;
  recoveryFailedAttempts: number;
  recoveryLockedUntil: string | null;
  originalTierId: string | null;
  lastChatAt?: string | null;
}

interface ChatRow {
  id: number;
  citizen_id: string;
  seat_number: number;
  display_name: string;
  role_title: string;
  tier: string;
  message: string;
  emote_key: EmoteKey | null;
  created_at: string;
  kind?: 'chat' | 'system';
}

interface SbPoll {
  id: string;
  question: string;
  kind: 'policy' | 'project';
  status: Poll['status'];
  options: Array<{ id: string; label: string }>;
  createdByCitizenId: string | null;
  createdAt: string;
}

interface SbDb {
  version: 1;
  world: WorldState & { allowDirectRegistration: boolean };
  citizens: SbCitizen[];
  plots: Plot[];
  news: NewsItem[];
  polls: SbPoll[];
  votes: Array<{ pollId: string; citizenId: string; optionId: string }>;
  donations: Array<{ projectId: string; citizenId: string; amount: number }>;
  nextNewsId: number;
}

export interface SandboxApi extends NationApi {
  readonly adminSecret: string;
  /** Hanya dev/sandbox: isi N warga demo (production SELALU mulai 0). */
  seedDemo(count: number): Promise<number>;
  /** Simulasi worker cek follow: tiap warga di antrean punya peluang `followRate` sudah follow. */
  simulateWorkerCheck(followRate: number): Promise<{ verified: number; notFollowing: number }>;
  /** Mundurkan follow_checked_at agar tombol pemakzulan bisa dites. */
  ageFollowChecks(hours: number): Promise<void>;
  /** Tambah saldo warga (uji beli tanah / bangun / patungan). */
  grantCoins(citizenId: string, amount: number): Promise<number>;
  /** Mundurkan waktu klaim pendapatan properti agar koin klaim muncul. */
  ageIncome(hours: number): Promise<void>;
  reset(): Promise<void>;
}

const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

const nowIso = (): string => new Date().toISOString();

/** Sama dengan nv_quick_resolve di SQL: IG username (unik) dulu, lalu nama tampilan bila tepat 1. */
function quickResolve(db: SbDb, raw: string): SbCitizen | 'not_found' | 'ambiguous' {
  const q = normalizeLoginUsername(raw);
  if (!q) return 'not_found';
  const byIg = db.citizens.find((c) => c.igUsername === q);
  if (byIg) return byIg;
  const byName = db.citizens.filter((c) => c.username.toLowerCase() === q);
  return byName.length === 1 ? byName[0] : byName.length > 1 ? 'ambiguous' : 'not_found';
}

function fail(message: string): never {
  throw new ApiError(message);
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createSandboxAdapter(config: WorldConfig): SandboxApi {
  const KEY = `nv:sandbox:${config.worldId}`;
  const CHAT_KEY = `nv:sandbox:${config.worldId}:chat`;
  const LOCAL_CHAT_EVENT = `nv-chat-local:${config.worldId}`;
  const EMOTES_OK: EmoteKey[] = ['laugh', 'cry', 'salute', 'fire', 'coin', 'angry'];
  const chatOut = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`nv-chat:${config.worldId}`) : null;

  /** Kirim event chat ke tab lain (BroadcastChannel) + ke subscriber di tab ini sendiri. */
  function chatBus(msg: { type: 'insert' | 'update'; row: ChatRow }): void {
    chatOut?.postMessage(msg);
    window.dispatchEvent(new CustomEvent(LOCAL_CHAT_EVENT, { detail: msg }));
  }

  function loadChat(): ChatRow[] {
    try {
      const raw = localStorage.getItem(CHAT_KEY);
      const rows = raw ? (JSON.parse(raw) as ChatRow[]) : [];
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  function saveChat(rows: ChatRow[]): void {
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(rows.slice(-150)));
    } catch {
      // abaikan
    }
  }

  /** v3: pesan sistem (pengumuman) di Global Chat. */
  function chatSystem(c: SbCitizen, message: string): void {
    const chat = loadChat();
    const row: ChatRow = {
      id: (chat[chat.length - 1]?.id ?? 0) + 1,
      citizen_id: c.id,
      seat_number: c.citizenNumber,
      display_name: c.username,
      role_title: c.roleTitle,
      tier: c.tierId,
      message: message.slice(0, 140),
      emote_key: null,
      created_at: nowIso(),
      kind: 'system',
    };
    saveChat([...chat, row]);
    chatBus({ type: 'insert', row });
  }

  // v3: kepemilikan properti katalog (disimpan terpisah agar db lama tetap kompatibel)
  const PROP_KEY = `nv:sandbox:${config.worldId}:properties`;
  interface SbProperty {
    citizenId: string;
    type: string;
    rtLabel: string;
    purchasedAt: string;
  }
  function loadProps(): SbProperty[] {
    try {
      const rows = JSON.parse(localStorage.getItem(PROP_KEY) ?? '[]') as SbProperty[];
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }
  function saveProps(rows: SbProperty[]): void {
    try {
      localStorage.setItem(PROP_KEY, JSON.stringify(rows));
    } catch {
      // abaikan
    }
  }
  const catalog = DEFAULT_PROPERTY_CATALOG;
  const propertyBonus = (citizenId: string) =>
    loadProps()
      .filter((p) => p.citizenId === citizenId)
      .reduce((s, p) => s + (catalog.find((t) => t.id === p.type)?.dailyBonus ?? 0), 0);
  const econ = effectiveEconomy(config, 'sandbox');
  const cur = config.currency.code;

  function freshDb(): SbDb {
    const first = config.projects[0];
    const db: SbDb = {
      version: 1,
      world: {
        worldId: config.worldId,
        igAccountHandle: config.igAccountHandle,
        lastCitizenNumber: 0,
        dayNumber: 1,
        igFollowerCount: 0,
        followersSyncedAt: null,
        currentRingUnlocked: 1,
        activeProjectId: first?.id ?? '',
        activeProjectFunding: 0,
        activeProjectGoal: first?.goal ?? 0,
        activeProjectCompleted: false,
        completedProjects: [],
        presidentAnnouncement: '',
        announcementAt: null,
        updatedAt: nowIso(),
        allowDirectRegistration: true,
      },
      citizens: [],
      plots: [],
      news: [],
      polls: [],
      votes: [],
      donations: [],
      nextNewsId: 1,
    };
    ensurePlots(db, 1);
    return db;
  }

  function load(): SbDb {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const db = JSON.parse(raw) as SbDb;
        if (db.version === 1) return db;
      }
    } catch {
      // storage rusak / diblokir → mulai baru
    }
    return freshDb();
  }

  function save(db: SbDb): void {
    db.news = db.news.slice(0, 300);
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch {
      // kuota penuh / mode privat: tetap jalan in-memory untuk sesi ini
    }
  }

  async function tx<T>(fn: (db: SbDb) => T): Promise<T> {
    await delay(60 + Math.random() * 120); // simulasi latensi jaringan
    const db = load();
    const out = fn(db);
    save(db);
    return structuredClone(out);
  }

  function ensurePlots(db: SbDb, uptoRing: number): void {
    for (let r = 1; r <= uptoRing; r++) {
      if (db.plots.some((p) => p.ringLevel === r)) continue;
      for (const s of generateRingPlots(config, r)) {
        db.plots.push({
          id: uid(),
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
        });
      }
    }
  }

  function news(db: SbDb, citizenId: string | null, category: NewsCategory, message: string): void {
    db.news.unshift({ id: db.nextNewsId++, category, message: message.slice(0, 280), citizenId, createdAt: nowIso() });
  }

  const tagOf = (c: { username: string; citizenNumber: number }) => formatCitizenTag(c.username, c.citizenNumber);

  function toPublic(c: SbCitizen): PublicCitizen {
    const {
      token: _t,
      recoveryPin: _p,
      recoveryFailedAttempts: _f,
      recoveryLockedUntil: _l,
      originalTierId: _o,
      followRecheckRequestedAt: _r,
      igChangedAt: _i,
      hasRecoveryPin: _h,
      ...pub
    } = c;
    return pub;
  }

  function toPrivate(c: SbCitizen): MyCitizen {
    const { token: _t, recoveryPin: _p, recoveryFailedAttempts: _f, recoveryLockedUntil: _l, originalTierId: _o, ...rest } = c;
    return { ...rest, hasRecoveryPin: c.recoveryPin !== null };
  }

  function auth(db: SbDb, s: Session): SbCitizen {
    const c = db.citizens.find((x) => x.id === s.citizenId && x.token === s.token);
    if (!c) fail('Sesi warga tidak valid. Masuk ulang lewat "Masuk KTP" dengan Kode Pemulihan.');
    return c;
  }

  function cooldown(lastIso: string | null, minutes: number, message: string): void {
    const next = nextAvailableAt(lastIso, minutes);
    if (next > Date.now()) fail(`${message} Coba lagi dalam ${formatDuration(next - Date.now())}.`);
  }

  function requireVerified(c: SbCitizen, action: keyof WorldConfig['economy']['requireVerified']): void {
    if (!econ.requireVerified[action] || isInaugurated(c)) return;
    if (c.followStatus === 'impeached') fail('Akses terkunci: kamu sudah dimakzulkan. Hubungi admin untuk pemulihan status.');
    if (c.followStatus === 'not_following')
      fail(`Akun @${c.igUsername} belum terdeteksi follow @${config.igAccountHandle}. Follow dulu lalu klik Cek Ulang atau Ganti Instagram.`);
    fail(`Fitur ini terbuka setelah kamu resmi dilantik (verifikasi follow @${config.igAccountHandle} otomatis maks. 1x24 jam).`);
  }

  function assertText(text: string, max: number, label: string): void {
    const err = validateFreeText(text, max, label);
    if (err) fail(err);
  }

  function perk(c: SbCitizen) {
    return findTier(config, c.tierId).perks;
  }

  function pollView(db: SbDb, p: SbPoll, viewer: string | null): Poll {
    const votes = db.votes.filter((v) => v.pollId === p.id);
    const creator = db.citizens.find((c) => c.id === p.createdByCitizenId);
    return {
      id: p.id,
      question: p.question,
      kind: p.kind,
      status: p.status,
      options: p.options.map((o) => ({ ...o, votes: votes.filter((v) => v.optionId === o.id).length })),
      totalVotes: votes.length,
      createdByCitizenId: p.createdByCitizenId,
      createdByTag: creator ? tagOf(creator) : null,
      createdAt: p.createdAt,
      myVote: viewer ? (votes.find((v) => v.citizenId === viewer)?.optionId ?? null) : null,
    };
  }

  function buildOptions(options: string[]): SbPoll['options'] {
    if (!options || options.length < 2 || options.length > 4) fail('Voting harus punya 2–4 pilihan.');
    return options.map((label, i) => {
      const l = cleanDisplayName(label);
      assertText(l, 40, 'Pilihan voting');
      return { id: String.fromCharCode(97 + i), label: l };
    });
  }

  function registerCore(db: SbDb, username: string, igRaw: string, color: string, style: Record<string, unknown>): SbCitizen {
    const ig = normalizeIgUsername(igRaw);
    const igErr = validateIgUsername(ig, config.igAccountHandle);
    if (igErr) fail(igErr);
    const max = config.registration.displayNameMaxLength;
    let name = cleanDisplayName(username);
    if (!name) name = ig.slice(0, max);
    if ([...name].length > max) fail(`Nama tampilan maksimal ${max} karakter.`);
    if (/[\u0000-\u001f\u007f<>{}[\]\\|`"]/.test(name)) fail('Nama tampilan mengandung karakter yang tidak diizinkan.');
    if (containsProfanity(name) || containsProfanity(ig)) fail('Nama atau username mengandung kata yang tidak diizinkan.');
    if (!isHexColor(color)) fail('Warna avatar tidak valid.');
    if (db.citizens.some((c) => c.igUsername === ig)) fail(`Username Instagram @${ig} sudah terdaftar. Kalau itu akunmu, pakai "Masuk KTP".`);

    // Strict FCFS: increment hanya setelah semua validasi lolos (setara rollback di SQL)
    const n = db.world.lastCitizenNumber + 1;
    db.world.lastCitizenNumber = n;
    db.world.updatedAt = nowIso();

    const tier = resolveTier(config, n);
    const c: SbCitizen = {
      id: uid(),
      worldId: config.worldId,
      citizenNumber: n,
      ktpCode: ktpCode(config, n),
      username: name,
      igUsername: ig,
      followStatus: 'pending',
      followCheckedAt: null,
      followRecheckRequestedAt: null,
      igChangedAt: null,
      joinedDay: db.world.dayNumber,
      rtRwAddress: rtRwAddress(config, n),
      avatarColor: color,
      avatarStyle: style,
      tierId: tier.id,
      roleTitle: resolveTitle(tier, n),
      originalRoleTitle: null,
      originalTierId: null,
      impeachedAt: null,
      coins: econ.startingCoins,
      totalDonated: 0,
      statusText: '',
      lastStatusAt: null,
      lastWorkAt: null,
      lastActiveAt: nowIso(),
      createdAt: nowIso(),
      hasRecoveryPin: false,
      token: uid(),
      recoveryPin: null,
      recoveryFailedAttempts: 0,
      recoveryLockedUntil: null,
    };
    db.citizens.push(c);

    const rings = ringsForPopulation(config, n);
    if (rings > db.world.currentRingUnlocked) {
      db.world.currentRingUnlocked = rings;
      ensurePlots(db, rings);
      news(db, null, 'expansion', `EKSPANSI WILAYAH! ${ringName(config, rings)} (Ring ${rings}) resmi dibuka — populasi tembus ${n} warga!`);
    }
    news(db, c.id, 'join', `Selamat datang ${tagOf(c)} — ${c.roleTitle}!`);
    return c;
  }

  function adminOk(secret: string, allowSync = false): void {
    if (secret === SANDBOX_ADMIN_SECRET || (allowSync && secret === SANDBOX_SYNC_SECRET)) return;
    fail('Akses admin ditolak (PIN salah, atau terkunci 15 menit setelah 10x gagal).');
  }

  function batchVerify(db: SbDb, list: string[], total: number | null, snapshotAt: string | null, markUnfollowers: boolean) {
    const set = new Set(list.map((u) => normalizeIgUsername(u)).filter(Boolean));
    const snap = snapshotAt ? new Date(snapshotAt).getTime() : null;
    let verified = 0;
    let notFollowing = 0;
    let unfollowed = 0;
    const t = nowIso();
    for (const c of db.citizens) {
      if (['pending', 'recheck_requested', 'not_following'].includes(c.followStatus) && set.has(c.igUsername)) {
        c.followStatus = 'verified';
        c.followCheckedAt = t;
        verified++;
        if (c.citizenNumber <= 30) news(db, c.id, 'verification', `RESMI DILANTIK! ${tagOf(c)} — ${c.roleTitle}`);
      } else if (['pending', 'recheck_requested'].includes(c.followStatus) && !set.has(c.igUsername)) {
        const latest = Math.max(
          new Date(c.createdAt).getTime(),
          c.followRecheckRequestedAt ? new Date(c.followRecheckRequestedAt).getTime() : 0,
          c.igChangedAt ? new Date(c.igChangedAt).getTime() : 0,
        );
        if (snap === null || latest <= snap) {
          c.followStatus = 'not_following';
          c.followCheckedAt = t;
          notFollowing++;
        }
      } else if (markUnfollowers && c.followStatus === 'verified' && !set.has(c.igUsername)) {
        c.followStatus = 'not_following';
        c.followCheckedAt = t;
        unfollowed++;
      }
    }
    db.world.igFollowerCount = total ?? Math.max(db.world.igFollowerCount, set.size);
    db.world.followersSyncedAt = t;
    db.world.updatedAt = t;
    if (verified > 0) news(db, null, 'verification', `PELANTIKAN: ${verified} warga resmi dilantik setelah verifikasi follow @${config.igAccountHandle}!`);
    return { verified, notFollowing, unfollowed, syncedAt: t };
  }

  function worldView(db: SbDb): WorldState {
    const { allowDirectRegistration: _a, ...w } = db.world;
    return w;
  }

  const api: SandboxApi = {
    mode: 'sandbox',
    adminSecret: SANDBOX_ADMIN_SECRET,

    getWorldState: () => tx((db) => worldView(db)),

    getNews: (limit = 30) => tx((db) => db.news.slice(0, limit)),

    getMapCitizens: (meId = null, limit = 120) =>
      tx((db) => {
        const byNum = [...db.citizens].sort((a, b) => a.citizenNumber - b.citizenNumber);
        const picks: SbCitizen[] = [];
        const add = (c?: SbCitizen) => c && !picks.includes(c) && picks.push(c);
        add(db.citizens.find((c) => c.id === meId));
        byNum.slice(0, 25).forEach(add);
        byNum.slice(-40).reverse().forEach(add);
        [...db.citizens].sort((a, b) => (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? '')).forEach(add);
        return picks.slice(0, Math.min(limit, 200)).map(toPublic);
      }),

    getPlots: (rings) => tx((db) => db.plots.filter((p) => rings.includes(p.ringLevel))),

    getOwnedPlots: (rings) => tx((db) => db.plots.filter((p) => p.ownerCitizenId && rings.includes(p.ringLevel))),

    getLeaderboard: (tab, offset, limit, search) =>
      tx((db) => {
        const q = (search ?? '').trim().replace(/^[@#]+|[@#]+$/g, '').toLowerCase();
        const match = (c: SbCitizen) =>
          !q ||
          c.username.toLowerCase().includes(q) ||
          c.igUsername.includes(q) ||
          String(c.citizenNumber) === q.replace(/^0+/, '') ||
          c.roleTitle.toLowerCase().includes(q);
        let rows: LeaderboardRow[];
        if (tab === 'landlords') {
          const agg = new Map<string, { plots: number; levels: number }>();
          for (const p of db.plots) {
            if (!p.ownerCitizenId) continue;
            const a = agg.get(p.ownerCitizenId) ?? { plots: 0, levels: 0 };
            a.plots++;
            a.levels += p.buildingLevel;
            agg.set(p.ownerCitizenId, a);
          }
          rows = [...agg.entries()]
            .map(([id, a]) => ({ c: db.citizens.find((x) => x.id === id)!, ...a }))
            .filter((x) => x.c)
            .sort((a, b) => b.levels - a.levels || b.plots - a.plots || a.c.citizenNumber - b.c.citizenNumber)
            .map((x, i) => ({ rank: i + 1, citizen: toPublic(x.c), plotsCount: x.plots, totalLevels: x.levels, _c: x.c }))
            .filter((r) => match(r._c))
            .map(({ _c, ...r }) => r);
        } else {
          let base = [...db.citizens];
          if (tab === 'founders') base = base.filter((c) => c.citizenNumber <= 100);
          if (tab === 'gen1') base = base.filter((c) => c.citizenNumber >= 101 && c.citizenNumber <= 1000);
          base.sort(tab === 'richest' ? (a, b) => b.coins - a.coins || a.citizenNumber - b.citizenNumber : (a, b) => a.citizenNumber - b.citizenNumber);
          rows = base
            .map((c, i) => ({ c, rank: tab === 'richest' ? i + 1 : c.citizenNumber }))
            .filter((x) => match(x.c))
            .map((x) => ({ rank: x.rank, citizen: toPublic(x.c), plotsCount: 0, totalLevels: 0 }));
        }
        return rows.slice(offset, offset + Math.min(limit, 100));
      }),

    getMyRanks: (citizenId) =>
      tx((db) => {
        const me = db.citizens.find((c) => c.id === citizenId) ?? fail('Warga tidak ditemukan.');
        const wealthRank =
          1 + db.citizens.filter((c) => c.coins > me.coins || (c.coins === me.coins && c.citizenNumber < me.citizenNumber)).length;
        const mine = db.plots.filter((p) => p.ownerCitizenId === me.id);
        let landlordRank: number | null = null;
        if (mine.length > 0) {
          const levels = mine.reduce((s, p) => s + p.buildingLevel, 0);
          const agg = new Map<string, { plots: number; levels: number; num: number }>();
          for (const p of db.plots) {
            if (!p.ownerCitizenId) continue;
            const a = agg.get(p.ownerCitizenId) ?? { plots: 0, levels: 0, num: p.ownerNumber ?? 0 };
            a.plots++;
            a.levels += p.buildingLevel;
            agg.set(p.ownerCitizenId, a);
          }
          landlordRank =
            1 +
            [...agg.values()].filter(
              (a) =>
                a.levels > levels ||
                (a.levels === levels && a.plots > mine.length) ||
                (a.levels === levels && a.plots === mine.length && a.num < me.citizenNumber),
            ).length;
        }
        return { citizenNumber: me.citizenNumber, wealthRank, landlordRank };
      }),

    getProjectTopDonors: (projectId, limit = 10) =>
      tx((db) =>
        db.donations
          .filter((d) => d.projectId === projectId)
          .map((d) => {
            const c = db.citizens.find((x) => x.id === d.citizenId);
            return { citizenId: d.citizenId, tag: c ? tagOf(c) : '?', amount: d.amount, n: c?.citizenNumber ?? 0 };
          })
          .sort((a, b) => b.amount - a.amount || a.n - b.n)
          .slice(0, limit)
          .map(({ n: _n, ...r }): DonorRow => r),
      ),

    getActivePolls: (session) =>
      tx((db) => {
        const viewer = session ? (db.citizens.find((c) => c.id === session.citizenId && c.token === session.token)?.id ?? null) : null;
        return db.polls
          .filter((p) => p.status === 'active')
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 10)
          .map((p) => pollView(db, p, viewer));
      }),

    register: (input) =>
      tx((db) => {
        const c = registerCore(db, input.username, input.igUsername, input.avatarColor, { ...input.avatarStyle });
        return { citizen: toPrivate(c), session: { citizenId: c.id, token: c.token } };
      }),

    getMe: (session) =>
      tx((db) => {
        const c = db.citizens.find((x) => x.id === session.citizenId && x.token === session.token);
        if (!c) return null;
        c.lastActiveAt = nowIso();
        return toPrivate(c);
      }),

    recoverSession: (ktp, pin) =>
      tx((db) => {
        const c = db.citizens.find((x) => x.ktpCode.toUpperCase() === ktp.trim().toUpperCase());
        if (!c) fail('Kode KTP tidak ditemukan.');
        if (!c.recoveryPin) fail('KTP ini belum mengaktifkan PIN pemulihan.');
        if (c.recoveryLockedUntil && new Date(c.recoveryLockedUntil).getTime() > Date.now())
          fail(`Terlalu banyak percobaan. Coba lagi dalam ${formatDuration(new Date(c.recoveryLockedUntil).getTime() - Date.now())}.`);
        if (pin === c.recoveryPin) {
          c.recoveryFailedAttempts = 0;
          c.recoveryLockedUntil = null;
          return { citizenId: c.id, token: c.token };
        }
        const left = 5 - (c.recoveryFailedAttempts + 1);
        if (left <= 0) {
          c.recoveryFailedAttempts = 0;
          c.recoveryLockedUntil = new Date(Date.now() + 3_600_000).toISOString();
        } else {
          c.recoveryFailedAttempts++;
        }
        save(db);
        return fail(left <= 0 ? 'PIN salah. KTP dikunci 1 jam.' : `PIN salah. Sisa ${left} percobaan.`);
      }),

    quickLoginCheck: (username) =>
      tx((db) => {
        const c = quickResolve(db, username);
        if (typeof c === 'string') return { status: c };
        return {
          status: c.recoveryPin ? 'has_pin' : c.citizenNumber <= 10 ? 'vip_protected' : 'needs_pin_setup',
          citizenNumber: c.citizenNumber,
          username: c.username,
          lockedMinutes: null,
        } as QuickLoginCheck;
      }),

    quickLogin: (username, pin) =>
      tx((db) => {
        const c = quickResolve(db, username);
        if (c === 'ambiguous') return fail('Ada beberapa warga dengan nama itu. Ketik username Instagram-mu.');
        if (c === 'not_found') return fail('Username tidak ditemukan.');
        if (!/^[0-9]{4,6}$/.test(pin)) return fail('PIN harus 4–6 digit angka.');
        if (!c.recoveryPin) {
          if (c.citizenNumber <= 10) return fail('Akun ini dilindungi pengaman khusus. Gunakan pemulihan akun.');
          c.recoveryPin = pin;
          save(db);
          return { session: { citizenId: c.id, token: c.token }, pinCreated: true };
        }
        if (pin !== c.recoveryPin) return fail('PIN salah.');
        return { session: { citizenId: c.id, token: c.token }, pinCreated: false };
      }),

    setRecoveryPin: (session, pin) =>
      tx((db) => {
        const c = auth(db, session);
        if (!/^[0-9]{4,6}$/.test(pin)) fail('PIN pemulihan harus 4–6 digit angka.');
        c.recoveryPin = pin;
        c.recoveryFailedAttempts = 0;
        c.recoveryLockedUntil = null;
      }),

    updateInstagram: (session, igRaw) =>
      tx((db) => {
        const c = auth(db, session);
        const ig = normalizeIgUsername(igRaw);
        const err = validateIgUsername(ig, config.igAccountHandle);
        if (err) fail(err);
        if (ig === c.igUsername) fail('Itu username Instagram yang sama dengan sekarang.');
        cooldown(c.igChangedAt, econ.igChangeCooldownMinutes, 'Username IG baru saja diganti.');
        if (db.citizens.some((x) => x.igUsername === ig && x.id !== c.id)) fail(`Username Instagram @${ig} sudah dipakai warga lain.`);
        c.igUsername = ig;
        c.igChangedAt = nowIso();
        if (c.followStatus !== 'impeached') {
          c.followStatus = 'pending';
          c.followCheckedAt = null;
        }
        c.lastActiveAt = nowIso();
        return toPrivate(c);
      }),

    requestFollowRecheck: (session) =>
      tx((db) => {
        const c = auth(db, session);
        if (c.followStatus === 'verified') fail('Akunmu sudah terverifikasi ✓');
        if (c.followStatus === 'impeached') fail('Status dimakzulkan hanya bisa dipulihkan oleh admin.');
        cooldown(c.followRecheckRequestedAt, econ.recheckCooldownMinutes, 'Permintaan cek ulang sudah tercatat.');
        c.followStatus = 'recheck_requested';
        c.followRecheckRequestedAt = nowIso();
        c.lastActiveAt = nowIso();
        return toPrivate(c);
      }),

    claimWork: (session) =>
      tx((db) => {
        const c = auth(db, session);
        cooldown(c.lastWorkAt, econ.workCooldownMinutes, 'Masih capek habis kerja!');
        const tier = findTier(config, c.tierId);
        c.coins += tier.work.reward;
        c.lastWorkAt = nowIso();
        c.lastActiveAt = c.lastWorkAt;
        return { reward: tier.work.reward, coins: c.coins, label: tier.work.label, lastWorkAt: c.lastWorkAt };
      }),

    postStatus: (session, text) =>
      tx((db) => {
        const c = auth(db, session);
        if (c.followStatus === 'impeached') fail('Warga yang dimakzulkan tidak bisa update status.');
        const t = cleanDisplayName(text);
        assertText(t, econ.statusMaxLength, 'Status');
        cooldown(c.lastStatusAt, econ.statusCooldownMinutes, 'Status baru saja di-update.');
        c.statusText = t;
        c.lastStatusAt = nowIso();
        c.lastActiveAt = c.lastStatusAt;
        news(db, c.id, 'status', `${tagOf(c)}: ${t}`);
        return toPrivate(c);
      }),

    buyPlot: (session, code) =>
      tx((db) => {
        const c = auth(db, session);
        requireVerified(c, 'buyLand');
        const p = db.plots.find((x) => x.plotCode === code.trim().toUpperCase()) ?? fail(`Kavling ${code} tidak ditemukan.`);
        if (p.ringLevel > db.world.currentRingUnlocked) fail(`Ring ${p.ringLevel} belum dibuka.`);
        if (p.ownerCitizenId) fail(`Kavling ${p.plotCode} sudah dimiliki ${p.ownerTag}.`);
        const owned = db.plots.filter((x) => x.ownerCitizenId === c.id).length;
        if (owned >= econ.land.maxPlotsPerCitizen) fail(`Batas kepemilikan tercapai (maks. ${econ.land.maxPlotsPerCitizen} kavling per warga).`);
        const price = Math.floor((p.price * (100 - perk(c).landDiscountPct)) / 100);
        if (c.coins < price) fail(`Saldo kurang! Harga kavling ${p.plotCode} adalah ${price} ${cur}.`);
        c.coins -= price;
        c.lastActiveAt = nowIso();
        Object.assign(p, {
          ownerCitizenId: c.id,
          ownerTag: tagOf(c),
          ownerNumber: c.citizenNumber,
          purchasedAt: nowIso(),
          buildingType: null,
          buildingName: null,
          buildingLevel: 0,
          lastIncomeClaimAt: null,
        });
        news(db, c.id, 'property', `${tagOf(c)} membeli kavling ${p.plotCode} (${price} ${cur}).`);
        if (p.ringLevel === db.world.currentRingUnlocked) {
          const ring = db.plots.filter((x) => x.ringLevel === p.ringLevel);
          const ownedRing = ring.filter((x) => x.ownerCitizenId).length;
          if (ring.length > 0 && ownedRing * 100 >= ring.length * config.map.occupancyUnlockPct) {
            db.world.currentRingUnlocked = p.ringLevel + 1;
            ensurePlots(db, p.ringLevel + 1);
            news(db, null, 'expansion', `EKSPANSI WILAYAH! Kavling Ring ${p.ringLevel} hampir habis, ${ringName(config, p.ringLevel + 1)} (Ring ${p.ringLevel + 1}) resmi dibuka!`);
          }
        }
        return { plot: p, coins: c.coins };
      }),

    buildOrUpgrade: (session, code, buildingType = null, buildingName = null) =>
      tx((db) => {
        const c = auth(db, session);
        requireVerified(c, 'build');
        const p = db.plots.find((x) => x.plotCode === code.trim().toUpperCase()) ?? fail(`Kavling ${code} tidak ditemukan.`);
        if (p.ownerCitizenId !== c.id) fail(`Kamu bukan pemilik kavling ${p.plotCode}.`);
        let pending = 0;
        let b;
        let name: string;
        if (p.buildingLevel === 0) {
          b = findBuilding(config, buildingType) ?? fail('Jenis bangunan tidak dikenal.');
          if (b.requiresPerk && !perk(c)[b.requiresPerk]) fail(`${b.name} hanya boleh dibangun pejabat / pemegang izin pemerintah.`);
          name = cleanDisplayName(buildingName?.trim() ? buildingName : b.name).slice(0, 24);
          assertText(name, 24, 'Nama bangunan');
        } else {
          b = findBuilding(config, p.buildingType) ?? fail('Data bangunan rusak, hubungi admin.');
          if (p.buildingLevel >= b.maxLevel) fail(`${p.buildingName} sudah level maksimal (${b.maxLevel}).`);
          name = p.buildingName ?? b.name;
          if (buildingName?.trim()) {
            name = cleanDisplayName(buildingName);
            assertText(name, 24, 'Nama bangunan');
          }
          pending = propertyIncome(config, b, p.buildingLevel, p.lastIncomeClaimAt, perk(c).incomeBonusPct);
        }
        const cost = buildingCost(b, p.buildingLevel);
        if (c.coins + pending < cost) fail(`Saldo kurang! Butuh ${cost} ${cur}.`);
        c.coins = c.coins + pending - cost;
        c.lastActiveAt = nowIso();
        p.buildingType = b.id;
        p.buildingName = name;
        p.buildingLevel += 1;
        p.lastIncomeClaimAt = nowIso();
        news(
          db,
          c.id,
          'property',
          p.buildingLevel === 1
            ? `${tagOf(c)} membangun "${p.buildingName}" di kavling ${p.plotCode}!`
            : `"${p.buildingName}" milik ${tagOf(c)} naik ke Level ${p.buildingLevel}!`,
        );
        return { plot: p, coins: c.coins, cost };
      }),

    renameProperty: (session, code, buildingName) =>
      tx((db) => {
        const c = auth(db, session);
        const name = cleanDisplayName(buildingName);
        assertText(name, 24, 'Nama bangunan');
        const p = db.plots.find((x) => x.plotCode === code.trim().toUpperCase() && x.ownerCitizenId === c.id && x.buildingLevel > 0);
        if (!p) fail('Bangunan tidak ditemukan atau bukan milikmu.');
        p.buildingName = name;
        return p;
      }),

    claimPropertyIncome: (session, code = null) =>
      tx((db) => {
        const c = auth(db, session);
        let total = 0;
        for (const p of db.plots) {
          if (p.ownerCitizenId !== c.id || p.buildingLevel <= 0) continue;
          if (code && p.plotCode !== code.trim().toUpperCase()) continue;
          const b = findBuilding(config, p.buildingType);
          if (!b) continue;
          const amount = propertyIncome(config, b, p.buildingLevel, p.lastIncomeClaimAt, perk(c).incomeBonusPct);
          if (amount >= 1) {
            p.lastIncomeClaimAt = nowIso();
            total += amount;
          }
        }
        if (total === 0) fail('Belum ada pendapatan properti yang bisa diklaim.');
        c.coins += total;
        c.lastActiveAt = nowIso();
        return { total, coins: c.coins };
      }),

    donateToProject: (session, amount) =>
      tx((db) => {
        const c = auth(db, session);
        requireVerified(c, 'donate');
        const amt = Math.floor(amount);
        if (!Number.isFinite(amt) || amt < 1) fail('Jumlah sumbangan minimal 1.');
        if (c.coins < amt) fail('Saldo tidak cukup untuk menyumbang sebanyak itu.');
        const w = db.world;
        if (w.activeProjectCompleted || !w.activeProjectId) fail('Belum ada proyek nasional aktif. Tunggu proyek baru dari Presiden/Admin.');
        c.coins -= amt;
        c.totalDonated += amt;
        c.lastActiveAt = nowIso();
        const d = db.donations.find((x) => x.projectId === w.activeProjectId && x.citizenId === c.id);
        if (d) d.amount += amt;
        else db.donations.push({ projectId: w.activeProjectId, citizenId: c.id, amount: amt });
        const funding = w.activeProjectFunding + amt;
        let done: string | null = null;
        if (w.activeProjectGoal > 0 && funding >= w.activeProjectGoal) {
          done = w.activeProjectId;
          const completed = [...w.completedProjects, done];
          const doneCfg = config.projects.find((p) => p.id === done);
          news(db, null, 'project', `PROYEK NASIONAL SELESAI! ${doneCfg?.name ?? done} resmi beroperasi berkat gotong royong warga!`);
          const next = config.projects.find((p) => !completed.includes(p.id));
          w.completedProjects = completed;
          if (next) {
            w.activeProjectFunding = Math.min(funding - w.activeProjectGoal, next.goal - 1);
            w.activeProjectId = next.id;
            w.activeProjectGoal = next.goal;
            w.activeProjectCompleted = false;
            news(db, null, 'project', `Proyek berikutnya dimulai: ${next.emoji} ${next.name}. Ayo patungan!`);
          } else {
            w.activeProjectFunding = w.activeProjectGoal;
            w.activeProjectCompleted = true;
          }
        } else {
          w.activeProjectFunding = funding;
        }
        w.updatedAt = nowIso();
        // v3: pengumuman Global Chat untuk donasi besar
        if (amt >= DONATION_ANNOUNCE_MIN) {
          const projName = config.projects.find((p) => p.id === (done ?? w.activeProjectId))?.name ?? 'Proyek Nasional';
          chatSystem(c, `baru saja menyumbang ${amt} ${cur} untuk ${projName}! 🏛️`);
        }
        return { coins: c.coins, world: worldView(db), completedProjectId: done };
      }),

    castVote: (session, pollId, optionId) =>
      tx((db) => {
        const c = auth(db, session);
        requireVerified(c, 'vote');
        const p = db.polls.find((x) => x.id === pollId) ?? fail('Voting tidak ditemukan.');
        if (p.status !== 'active') fail('Sidang warga ini sudah ditutup.');
        if (!p.options.some((o) => o.id === optionId)) fail('Pilihan voting tidak valid.');
        if (db.votes.some((v) => v.pollId === pollId && v.citizenId === c.id)) fail('Kamu sudah memberikan suara di sidang ini.');
        db.votes.push({ pollId, citizenId: c.id, optionId });
        c.lastActiveAt = nowIso();
        return pollView(db, p, c.id);
      }),

    postAnnouncement: (session, text) =>
      tx((db) => {
        const c = auth(db, session);
        if (!perk(c).canAnnounce) fail('Hanya Presiden & Wakil Presiden yang bisa berpidato.');
        requireVerified(c, 'governance');
        const t = cleanDisplayName(text);
        assertText(t, econ.announcementMaxLength, 'Pidato');
        db.world.presidentAnnouncement = t;
        db.world.announcementAt = nowIso();
        news(db, c.id, 'decree', `PIDATO ${c.roleTitle.toUpperCase()} ${tagOf(c)}: "${t}"`);
        return worldView(db);
      }),

    proposePoll: (session, question, options) =>
      tx((db) => {
        const c = auth(db, session);
        const direct = perk(c).canCreatePoll;
        if (!direct && !perk(c).canProposePoll) fail('Hanya Presiden, Wapres, Kabinet, dan DPR yang bisa mengajukan voting.');
        requireVerified(c, 'governance');
        const q = cleanDisplayName(question);
        assertText(q, 120, 'Pertanyaan voting');
        const last = db.polls.filter((p) => p.createdByCitizenId === c.id).map((p) => p.createdAt).sort().pop() ?? null;
        cooldown(last, econ.pollProposalCooldownMinutes, 'Kamu baru saja mengajukan voting.');
        const poll: SbPoll = {
          id: uid(),
          question: q,
          kind: 'policy',
          status: direct ? 'active' : 'pending',
          options: buildOptions(options),
          createdByCitizenId: c.id,
          createdAt: nowIso(),
        };
        db.polls.push(poll);
        if (direct) news(db, c.id, 'poll', `SIDANG WARGA DIBUKA: "${q}" — diajukan ${tagOf(c)}`);
        return pollView(db, poll, c.id);
      }),

    // --- Admin ---
    adminLogin: async (secret) => {
      await delay(80);
      return secret === SANDBOX_ADMIN_SECRET;
    },

    adminUpdateWorld: (secret, patch) =>
      tx((db) => {
        adminOk(secret);
        if (patch.dayNumber !== undefined) {
          if (patch.dayNumber < 1) fail('Hari minimal 1.');
          db.world.dayNumber = Math.floor(patch.dayNumber);
        }
        if (patch.igFollowerCount !== undefined) {
          if (patch.igFollowerCount < 0) fail('Jumlah follower tidak valid.');
          db.world.igFollowerCount = Math.floor(patch.igFollowerCount);
          db.world.followersSyncedAt = nowIso();
        }
        if (patch.allowDirectRegistration !== undefined) db.world.allowDirectRegistration = patch.allowDirectRegistration;
        db.world.updatedAt = nowIso();
        return worldView(db);
      }),

    adminGetFollowQueue: (secret) =>
      tx((db) => {
        adminOk(secret, true);
        const order: Record<string, number> = { recheck_requested: 0, pending: 1, not_following: 2 };
        return {
          snapshotAt: nowIso(),
          usernames: db.citizens
            .filter((c) => c.followStatus in order)
            .sort((a, b) => order[a.followStatus] - order[b.followStatus])
            .map((c) => c.igUsername),
        };
      }),

    adminBatchVerify: (secret, list, total, snapshotAt, markUnfollowers = false) =>
      tx((db) => {
        adminOk(secret, true);
        return batchVerify(db, list, total, snapshotAt, markUnfollowers);
      }),

    adminReportFollowChecks: (secret, followers, notFollowers, totalFollowers) =>
      tx((db) => {
        adminOk(secret, true);
        const yes = new Set(followers.map(normalizeIgUsername).filter(Boolean));
        const no = new Set(notFollowers.map(normalizeIgUsername).filter((u) => u && !yes.has(u)));
        const t = nowIso();
        let verified = 0;
        let notFollowing = 0;
        for (const c of db.citizens) {
          if (['pending', 'recheck_requested', 'not_following'].includes(c.followStatus) && yes.has(c.igUsername)) {
            c.followStatus = 'verified';
            c.followCheckedAt = t;
            verified++;
            if (c.citizenNumber <= 30) news(db, c.id, 'verification', `RESMI DILANTIK! ${tagOf(c)} — ${c.roleTitle}`);
          } else if (['pending', 'recheck_requested'].includes(c.followStatus) && no.has(c.igUsername)) {
            c.followStatus = 'not_following';
            c.followCheckedAt = t;
            notFollowing++;
          }
        }
        if (totalFollowers !== null) {
          db.world.igFollowerCount = totalFollowers;
          db.world.followersSyncedAt = t;
        }
        if (verified > 0) news(db, null, 'verification', `PELANTIKAN: ${verified} warga resmi dilantik setelah verifikasi follow @${config.igAccountHandle}!`);
        return { verified, notFollowing };
      }),

    adminImpeach: (secret) =>
      tx((db) => {
        adminOk(secret);
        const cutoff = Date.now() - config.verification.impeachAfterHours * 3_600_000;
        const impeached: Array<{ citizenId: string; tag: string; roleTitle: string }> = [];
        for (const c of db.citizens.sort((a, b) => a.citizenNumber - b.citizenNumber)) {
          if (
            c.citizenNumber <= config.verification.impeachMaxNumber &&
            c.followStatus === 'not_following' &&
            c.followCheckedAt &&
            new Date(c.followCheckedAt).getTime() < cutoff
          ) {
            c.originalTierId = c.tierId;
            c.originalRoleTitle = c.roleTitle;
            c.tierId = config.impeachedTier.id;
            c.roleTitle = `Mantan ${c.originalRoleTitle}`;
            c.followStatus = 'impeached';
            c.impeachedAt = nowIso();
            impeached.push({ citizenId: c.id, tag: tagOf(c), roleTitle: c.originalRoleTitle });
            news(db, c.id, 'impeachment', `BREAKING NEWS: ${c.originalRoleTitle} #${formatCitizenNumber(c.citizenNumber)} resmi dimakzulkan karena ketahuan belum follow!`);
          }
        }
        return { impeached };
      }),

    adminRestoreCitizen: (secret, citizenId) =>
      tx((db) => {
        adminOk(secret);
        const c = db.citizens.find((x) => x.id === citizenId && x.followStatus === 'impeached');
        if (!c) fail('Warga tidak ditemukan atau tidak berstatus dimakzulkan.');
        c.tierId = c.originalTierId ?? c.tierId;
        c.roleTitle = c.originalRoleTitle ?? c.roleTitle;
        c.originalTierId = null;
        c.originalRoleTitle = null;
        c.impeachedAt = null;
        c.followStatus = 'pending';
        c.followCheckedAt = null;
        news(db, c.id, 'system', `${tagOf(c)} dipulihkan sebagai ${c.roleTitle} (menunggu verifikasi follow ulang).`);
      }),

    adminCreatePoll: (secret, question, options, kind) =>
      tx((db) => {
        adminOk(secret);
        const q = cleanDisplayName(question);
        assertText(q, 120, 'Pertanyaan voting');
        const poll: SbPoll = { id: uid(), question: q, kind, status: 'active', options: buildOptions(options), createdByCitizenId: null, createdAt: nowIso() };
        db.polls.push(poll);
        news(db, null, 'poll', `SIDANG WARGA DIBUKA: "${q}"`);
        return pollView(db, poll, null);
      }),

    adminListPendingPolls: (secret) =>
      tx((db) => {
        adminOk(secret);
        return db.polls.filter((p) => p.status === 'pending').map((p) => pollView(db, p, null));
      }),

    adminModeratePoll: (secret, pollId, action) =>
      tx((db) => {
        adminOk(secret);
        const p = db.polls.find((x) => x.id === pollId) ?? fail('Voting tidak ditemukan atau aksi tidak valid.');
        p.status = action === 'approve' ? 'active' : action === 'reject' ? 'rejected' : 'closed';
        if (action === 'approve') news(db, p.createdByCitizenId, 'poll', `SIDANG WARGA DIBUKA: "${p.question}"`);
      }),

    adminModerateContent: (secret, target, id) =>
      tx((db) => {
        adminOk(secret);
        if (target === 'status') {
          const c = db.citizens.find((x) => x.id === id) ?? fail('Konten tidak ditemukan.');
          c.statusText = '';
        } else if (target === 'building_name') {
          const p = db.plots.find((x) => x.plotCode === id.toUpperCase()) ?? fail('Konten tidak ditemukan.');
          p.buildingName = (findBuilding(config, p.buildingType)?.name ?? 'Bangunan').slice(0, 24);
        } else {
          const before = db.news.length;
          db.news = db.news.filter((n) => String(n.id) !== id);
          if (db.news.length === before) fail('Konten tidak ditemukan.');
        }
      }),

    adminSetActiveProject: (secret, projectId, resetFunding) =>
      tx((db) => {
        adminOk(secret);
        const p = config.projects.find((x) => x.id === projectId) ?? fail(`Proyek ${projectId} tidak ada di config dunia.`);
        const w = db.world;
        w.activeProjectId = p.id;
        w.activeProjectGoal = p.goal;
        w.activeProjectFunding = resetFunding ? 0 : Math.min(w.activeProjectFunding, p.goal - 1);
        w.activeProjectCompleted = false;
        w.completedProjects = w.completedProjects.filter((x) => x !== p.id);
        news(db, null, 'project', `Proyek nasional aktif: ${p.emoji} ${p.name}`);
        return worldView(db);
      }),

    // --- Presence: tab lain via BroadcastChannel + beberapa Tamu simulasi ---
    joinPresence(me: PresenceIdentity, onSync: (members: PresenceMember[]) => void) {
      const selfKey = me.citizenId ?? `guest:${me.tag}`;
      const self: PresenceMember = { key: selfKey, ...me, onlineAt: nowIso() };
      const peers = new Map<string, { m: PresenceMember; seen: number }>();
      const fakes = new Map<string, PresenceMember>();
      const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`nv-presence:${config.worldId}`) : null;

      const emit = () => {
        const all = [self, ...[...peers.values()].map((p) => p.m), ...fakes.values()];
        const uniq = new Map(all.map((m) => [m.key, m]));
        onSync([...uniq.values()].sort((a, b) => a.onlineAt.localeCompare(b.onlineAt)));
      };

      const randomTag = () => {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const len = 3 + Math.floor(Math.random() * 2);
        return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      };
      const spawnFake = () => {
        const tag = randomTag();
        fakes.set(`sim:${tag}`, {
          key: `sim:${tag}`,
          kind: 'guest',
          tag,
          citizenId: null,
          color: config.registration.avatarColors[Math.floor(Math.random() * config.registration.avatarColors.length)],
          onlineAt: nowIso(),
        });
      };
      for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) spawnFake();

      const beat = () => bc?.postMessage({ type: 'beat', m: self });
      if (bc) {
        bc.onmessage = (ev: MessageEvent) => {
          const msg = ev.data as { type: string; m?: PresenceMember; key?: string };
          if (msg.type === 'beat' && msg.m && msg.m.key !== selfKey) {
            const isNew = !peers.has(msg.m.key);
            peers.set(msg.m.key, { m: msg.m, seen: Date.now() });
            if (isNew) {
              beat();
              emit();
            }
          } else if (msg.type === 'leave' && msg.key) {
            peers.delete(msg.key);
            emit();
          }
        };
      }

      const hb = setInterval(() => {
        beat();
        const cutoff = Date.now() - 12_000;
        for (const [k, v] of peers) if (v.seen < cutoff) peers.delete(k);
        // Tamu simulasi datang & pergi
        if (Math.random() < 0.3) {
          if (fakes.size > 2 && Math.random() < 0.5) fakes.delete([...fakes.keys()][0]);
          else if (fakes.size < 8) spawnFake();
        }
        emit();
      }, 5000);

      beat();
      emit();

      return () => {
        clearInterval(hb);
        bc?.postMessage({ type: 'leave', key: selfKey });
        bc?.close();
      };
    },

    // --- Khusus sandbox ---
    seedDemo: (count) =>
      tx((db) => {
        const names = ['Novi', 'Budi', 'Siti', 'Raka', 'Dewi', 'Agus', 'Rina', 'Joko', 'Maya', 'Tono', 'Lala', 'Yudi', 'Fitri', 'Bayu', 'Intan'];
        let made = 0;
        for (let i = 0; i < count; i++) {
          const name = names[(db.world.lastCitizenNumber + i) % names.length];
          const ig = `demo_${name.toLowerCase()}_${db.world.lastCitizenNumber + 1}`;
          const c = registerCore(
            db,
            name,
            ig,
            config.registration.avatarColors[(db.world.lastCitizenNumber + i) % config.registration.avatarColors.length],
            { accessory: config.registration.avatarAccessories[i % config.registration.avatarAccessories.length] },
          );
          c.coins += Math.floor(Math.random() * 400);
          made++;
        }
        return made;
      }),

    simulateWorkerCheck: (followRate) =>
      tx((db) => {
        const queue = db.citizens.filter((c) => ['pending', 'recheck_requested', 'not_following'].includes(c.followStatus));
        const followers = queue.filter(() => Math.random() < followRate).map((c) => c.igUsername);
        const r = batchVerify(db, followers, null, nowIso(), false);
        return { verified: r.verified, notFollowing: r.notFollowing };
      }),

    ageFollowChecks: (hours) =>
      tx((db) => {
        for (const c of db.citizens) {
          if (c.followCheckedAt) c.followCheckedAt = new Date(new Date(c.followCheckedAt).getTime() - hours * 3_600_000).toISOString();
        }
      }),

    grantCoins: (citizenId, amount) =>
      tx((db) => {
        const c = db.citizens.find((x) => x.id === citizenId) ?? fail('Warga tidak ditemukan.');
        c.coins += Math.floor(amount);
        return c.coins;
      }),

    ageIncome: (hours) =>
      tx((db) => {
        for (const p of db.plots) {
          if (p.lastIncomeClaimAt) p.lastIncomeClaimAt = new Date(new Date(p.lastIncomeClaimAt).getTime() - hours * 3_600_000).toISOString();
        }
      }),

    reset: async () => {
      try {
        localStorage.removeItem(KEY);
        localStorage.removeItem(CHAT_KEY);
      } catch {
        // abaikan
      }
    },

    // --- Upgrade v2: Edit Profil ---
    updateProfile: (session, patch) =>
      tx((db) => {
        const c = auth(db, session);
        let changed = false;
        let nameChanged = false;
        const oldName = c.username;
        if (patch.displayName !== undefined) {
          const err = validateProfileName(patch.displayName);
          if (err) fail(err);
          const name = cleanProfileText(patch.displayName);
          if (name !== c.username) {
            const next = c.nameUpdatedAt ? new Date(c.nameUpdatedAt).getTime() + NAME_EDIT_COOLDOWN_MS : 0;
            if (next > Date.now()) fail(`Nama baru saja diganti. Bisa ganti lagi dalam ${formatDuration(next - Date.now())}.`);
            c.username = name;
            c.nameUpdatedAt = nowIso();
            c.nameEditCount = (c.nameEditCount ?? 0) + 1;
            changed = nameChanged = true;
          }
        }
        if (patch.avatarColor !== undefined && patch.avatarColor !== c.avatarColor) {
          if (!isHexColor(patch.avatarColor)) fail('Warna avatar tidak valid.');
          c.avatarColor = patch.avatarColor;
          changed = true;
        }
        if (patch.accessory !== undefined && patch.accessory !== c.avatarStyle?.accessory) {
          if (!config.registration.avatarAccessories.includes(patch.accessory)) fail('Aksesori avatar tidak tersedia.');
          c.avatarStyle = { ...c.avatarStyle, accessory: patch.accessory };
          changed = true;
        }
        if (!changed) fail('Tidak ada perubahan untuk disimpan.');
        c.lastActiveAt = nowIso();
        if (nameChanged) {
          for (const p of db.plots) if (p.ownerCitizenId === c.id) p.ownerTag = tagOf(c);
          const chat = loadChat();
          const mine = chat.filter((m) => m.citizen_id === c.id);
          for (const m of mine) m.display_name = c.username;
          if (mine.length) {
            saveChat(chat);
            for (const m of mine) chatBus({ type: 'update', row: m });
          }
          news(db, c.id, 'system', `🪪 Warga #${String(c.citizenNumber).padStart(4, '0')} ganti nama: ${oldName} → ${c.username}`);
        }
        return toPrivate(c);
      }),

    // --- Upgrade v2: Global Chat (localStorage + BroadcastChannel antar-tab) ---
    getGlobalChat: async (limit = 50) => {
      await delay(80);
      return loadChat()
        .slice(-Math.min(50, limit))
        .map((r) => mapChat(r as unknown as Record<string, unknown>));
    },

    sendGlobalChat: async (session, message, emoteKey = null) => {
      const row = await tx((db) => {
        const c = auth(db, session);
        if (c.followStatus === 'impeached') fail('Warga yang dimakzulkan tidak bisa mengirim chat.');
        const last = c.lastChatAt ? new Date(c.lastChatAt).getTime() : 0;
        if (Date.now() - last < CHAT_COOLDOWN_MS) fail(`Pelan-pelan, tunggu ${Math.ceil((last + CHAT_COOLDOWN_MS - Date.now()) / 1000)} detik lagi.`);
        const ek = emoteKey && EMOTES_OK.includes(emoteKey) ? emoteKey : null;
        if (emoteKey && !ek) fail('Emote tidak dikenal.');
        const err = validateChatText(message, !!ek);
        if (err) fail(err);
        c.lastChatAt = nowIso();
        c.lastActiveAt = nowIso();
        const chat = loadChat();
        const r: ChatRow = {
          id: (chat[chat.length - 1]?.id ?? 0) + 1,
          citizen_id: c.id,
          seat_number: c.citizenNumber,
          display_name: c.username,
          role_title: c.roleTitle,
          tier: c.tierId,
          message: cleanProfileText(message),
          emote_key: ek,
          created_at: nowIso(),
        };
        saveChat([...chat, r]); // auto-prune 150 di saveChat
        return r;
      });
      chatBus({ type: 'insert', row });
      return mapChat(row as unknown as Record<string, unknown>);
    },

    subscribeGlobalChat({ onInsert, onUpdate, onStatus }) {
      onStatus?.('live');
      const handle = (msg: { type: 'insert' | 'update'; row: ChatRow }) => {
        const m = mapChat(msg.row as unknown as Record<string, unknown>);
        if (msg.type === 'insert') onInsert(m);
        else onUpdate(m);
      };
      const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`nv-chat:${config.worldId}`) : null;
      if (bc) bc.onmessage = (ev: MessageEvent) => handle(ev.data);
      const local = (ev: Event) => handle((ev as CustomEvent).detail);
      window.addEventListener(LOCAL_CHAT_EVENT, local);
      return () => {
        bc?.close();
        window.removeEventListener(LOCAL_CHAT_EVENT, local);
      };
    },

    // --- Upgrade v3: Ekonomi ---
    claimDailySalary: (session) =>
      tx((db) => {
        const c = auth(db, session);
        const next = c.lastSalaryAt ? new Date(c.lastSalaryAt).getTime() + SALARY_COOLDOWN_MS : 0;
        if (next > Date.now()) fail(`Gaji hari ini sudah diambil. Tersedia lagi dalam ${formatDuration(next - Date.now())}.`);
        const rank = rankSalaryBonus(c.citizenNumber);
        const prop = propertyBonus(c.id);
        const reward = SALARY_BASE + rank + prop;
        c.coins += reward;
        c.lastSalaryAt = nowIso();
        c.lastActiveAt = nowIso();
        return { reward, base: SALARY_BASE, rankBonus: rank, propertyBonus: prop, citizen: toPrivate(c) };
      }),

    doQuickWork: (session) =>
      tx((db) => {
        const c = auth(db, session);
        const today = todayWib();
        const used = c.quickWorkDate === today ? (c.quickWorkCount ?? 0) : 0;
        if (used >= QUICK_WORK_MAX_PER_DAY) fail('Jatah Kerja Cepat hari ini habis (3/3). Balik lagi besok ya!');
        const next = c.quickWorkAt ? new Date(c.quickWorkAt).getTime() + QUICK_WORK_COOLDOWN_MS : 0;
        if (next > Date.now()) fail(`Masih capek habis kerja! Coba lagi dalam ${formatDuration(next - Date.now())}.`);
        const label = QUICK_WORK_LABELS[Math.floor(Math.random() * QUICK_WORK_LABELS.length)];
        c.coins += QUICK_WORK_REWARD;
        c.quickWorkAt = nowIso();
        c.quickWorkDate = today;
        c.quickWorkCount = used + 1;
        c.lastActiveAt = nowIso();
        return { reward: QUICK_WORK_REWARD, label, remaining: QUICK_WORK_MAX_PER_DAY - (used + 1), citizen: toPrivate(c) };
      }),

    claimMission: (session, mission) =>
      tx((db) => {
        const c = auth(db, session);
        const def = MISSIONS.find((m) => m.key === mission) ?? fail('Misi tidak dikenal.');
        const claimed = c.claimedMissions ?? {};
        if (mission in claimed) fail('Hadiah misi ini sudah kamu ambil.');
        const donated = db.donations.filter((d) => d.citizenId === c.id).reduce((s, d) => s + d.amount, 0);
        const done =
          mission === 'first_salary'
            ? !!c.lastSalaryAt
            : mission === 'first_chat'
              ? !!c.lastChatAt
              : mission === 'first_donation'
                ? donated >= 10
                : true;
        if (!done) fail('Misi belum selesai.');
        c.coins += def.reward;
        c.claimedMissions = { ...claimed, [mission]: nowIso() };
        c.lastActiveAt = nowIso();
        return { reward: def.reward, citizen: toPrivate(c) };
      }),

    getPropertyCatalog: async () => structuredClone(catalog),

    getMyProperties: async (citizenId) =>
      loadProps()
        .filter((p) => p.citizenId === citizenId)
        .map((p) => p.type),

    buyProperty: (session, propertyType) =>
      tx((db) => {
        const c = auth(db, session);
        requireVerified(c, 'buyLand');
        const t = catalog.find((x) => x.id === propertyType) ?? fail('Properti tidak ditemukan di katalog.');
        const props = loadProps();
        if (props.some((p) => p.citizenId === c.id && p.type === t.id)) fail(`Kamu sudah punya ${t.name}.`);
        if (c.coins < t.price) fail(`Saldo kurang ${t.price - c.coins} ${cur} untuk membeli ${t.name}.`);
        c.coins -= t.price;
        const rt = c.rtRwAddress.split(' • ')[0];
        props.push({ citizenId: c.id, type: t.id, rtLabel: rt, purchasedAt: nowIso() });
        saveProps(props);
        const owned = props.filter((p) => p.citizenId === c.id).map((p) => catalog.find((x) => x.id === p.type)!);
        c.topProperty = owned.sort((a, b) => b.price - a.price)[0]?.name ?? null;
        c.lastActiveAt = nowIso();
        news(db, c.id, 'property', `${t.emoji} #${String(c.citizenNumber).padStart(4, '0')} ${c.username} membeli ${t.name} di ${rt}!`);
        return { citizen: toPrivate(c) };
      }),

    getPropertyOwners: async (limit = 20) => {
      const db = load();
      return loadProps()
        .sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt))
        .slice(0, limit)
        .flatMap((p) => {
          const c = db.citizens.find((x) => x.id === p.citizenId);
          const t = catalog.find((x) => x.id === p.type);
          if (!c || !t) return [];
          return [
            {
              citizenId: c.id,
              citizenNumber: c.citizenNumber,
              username: c.username,
              roleTitle: c.roleTitle,
              propertyType: t.id,
              propertyName: t.name,
              emoji: t.emoji,
              rtLabel: p.rtLabel,
              purchasedAt: p.purchasedAt,
            },
          ];
        });
    },

    getDonorBoard: async (projectId, limit = 10) => {
      const db = load();
      return db.donations
        .filter((d) => d.projectId === projectId && d.amount > 0)
        .flatMap((d) => {
          const c = db.citizens.find((x) => x.id === d.citizenId);
          return c ? [{ citizenId: c.id, citizenNumber: c.citizenNumber, username: c.username, roleTitle: c.roleTitle, amount: d.amount }] : [];
        })
        .sort((a, b) => b.amount - a.amount || a.citizenNumber - b.citizenNumber)
        .slice(0, limit)
        .map((r, i) => ({ rank: i + 1, ...r }));
    },

    // --- Upgrade v2: Emote broadcast antar-tab ---
    joinEmotes(onEmote) {
      const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`nv-emotes:${config.worldId}`) : null;
      if (bc) bc.onmessage = (ev: MessageEvent) => onEmote(ev.data as EmoteEvent);
      return {
        send: (e) => bc?.postMessage(e),
        leave: () => bc?.close(),
      };
    },
  };

  return api;
}
