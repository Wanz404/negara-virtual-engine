import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { WORLD } from '../configs';
import {
  DEFAULT_PROPERTY_CATALOG,
  DONATION_ANNOUNCE_MIN,
  MISSIONS,
  QUICK_DONATIONS,
  QUICK_WORK_LABELS,
  QUICK_WORK_MAX_PER_DAY,
  QUICK_WORK_REWARD,
  SALARY_BASE,
  economyStatus,
  isDonaturPerintis,
  missionProgress,
  projectPhase,
  rankSalaryBonus,
  type MissionKey,
  type PropertyType,
} from '../lib/economy';
import { effectiveEconomy } from '../lib/game';
import { isInaugurated } from '../lib/inauguration';
import { formatCoins, formatNumber, formatRelative } from '../lib/format';
import { playClick } from '../lib/fx';
import { api, type DonorBoardRow, type MyCitizen, type PropertyOwnerRow, type Session, type WorldState } from '../services';
import { SeatBadge } from './GlobalChat';
import { BottomSheet, Button, errorMessage, inputClass } from './ui';

const CUR = WORLD.currency.code;
const econ = effectiveEconomy(WORLD, api.mode);

export type EconomyTab = 'misi' | 'kerja' | 'properti' | 'stasiun';

type Toast = (m: string, k?: 'info' | 'success' | 'error') => void;

export interface TierWork {
  label: string;
  reward: number;
  readyAt: number;
  busy: boolean;
  run: () => void;
}

function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** "14j 22m" / "3m 10d" — ringkas untuk countdown tombol. */
function shortWait(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}j ${m}m`;
  if (m > 0) return `${m}m ${s % 60}d`;
  return `${s}d`;
}

function Dot() {
  return (
    <span className="relative ml-1 inline-flex h-2.5 w-2.5">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
    </span>
  );
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-3xl bg-black/[0.04] p-3.5 ring-1 ring-black/5 ${className}`}>{children}</section>;
}

/** Bottom Sheet Ekonomi & Misi: Misi Warga Baru • Kerja & Gaji • Properti RT • Patungan Stasiun. */
export function EconomySheet({
  open,
  tab,
  onTab,
  onClose,
  me,
  session,
  world,
  tierWork,
  onMe,
  onWorld,
  onOpenChat,
  onOpenEmote,
  onOpenKtp,
  onRegister,
  toast,
}: {
  open: boolean;
  tab: EconomyTab;
  onTab: (t: EconomyTab) => void;
  onClose: () => void;
  me: MyCitizen | null;
  session: Session | null;
  world: WorldState | null;
  tierWork: TierWork | null;
  onMe: (c: MyCitizen) => void;
  onWorld: (w: WorldState) => void;
  onOpenChat: () => void;
  onOpenEmote: () => void;
  onOpenKtp: () => void;
  onRegister: () => void;
  toast: Toast;
}) {
  const now = useNow();
  const status = me ? economyStatus(me, now) : null;
  const [catalog, setCatalog] = useState<PropertyType[]>([]);
  const [mine, setMine] = useState<string[]>([]);
  const propsLoadedFor = useRef(new Set<string>());

  const loadProps = useCallback(async () => {
    const key = me?.id ?? 'guest';
    if (propsLoadedFor.current.has(key)) return;
    const cat = await api.getPropertyCatalog().catch(() => []);
    setCatalog(cat.length ? cat : api.mode === 'sandbox' ? DEFAULT_PROPERTY_CATALOG : []);
    if (me) setMine(await api.getMyProperties(me.id).catch(() => []));
    propsLoadedFor.current.add(key);
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open && tab === 'properti') void loadProps();
  }, [open, tab, loadProps]);

  const propertyBonus = useMemo(() => catalog.filter((t) => mine.includes(t.id)).reduce((s, t) => s + t.dailyBonus, 0), [catalog, mine]);

  const tabs: Array<{ id: EconomyTab; label: string; dot: boolean }> = [
    { id: 'misi', label: '🎯 Misi', dot: !!status && status.missionsReady > 0 },
    { id: 'kerja', label: '💼 Kerja', dot: !!status && (status.salaryReady || status.quickReady) },
    { id: 'properti', label: '🏪 Properti', dot: false },
    { id: 'stasiun', label: '🚇 Stasiun', dot: false },
  ];

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      tall
      title="🪙 Ekonomi & Misi"
      headerRight={
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-b from-amber-200 to-amber-400 px-2.5 py-1 text-[12px] font-black text-amber-950 shadow-inner tabular-nums">
          🪙 {formatNumber(me?.coins ?? 0)} {CUR}
        </span>
      }
    >
      <div className="sticky top-0 z-10 -mx-5 mb-3 bg-surface px-5 pb-2">
        <div className="grid grid-cols-4 gap-1 rounded-2xl bg-black/5 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                playClick();
                onTab(t.id);
              }}
              className={`tactile flex items-center justify-center rounded-xl px-1 py-2 text-[12px] font-black ${tab === t.id ? 'bg-brand text-white shadow' : 'text-ink'}`}
            >
              {t.label}
              {t.dot && <Dot />}
            </button>
          ))}
        </div>
      </div>

      {!me || !session ? (
        <GuestPitch onRegister={onRegister} />
      ) : (
        <>
          {tab === 'misi' && (
            <MissionsTab
              me={me}
              session={session}
              onMe={onMe}
              toast={toast}
              go={(k) => {
                if (k === 'first_salary') onTab('kerja');
                else if (k === 'first_chat') onOpenChat();
                else if (k === 'first_emote') onOpenEmote();
                else onTab('stasiun');
              }}
              onTab={onTab}
            />
          )}
          {tab === 'kerja' && status && (
            <WorkTab me={me} session={session} status={status} propertyBonus={propertyBonus} tierWork={tierWork} onMe={onMe} toast={toast} now={now} />
          )}
          {tab === 'properti' && (
            <PropertyTab
              me={me}
              session={session}
              catalog={catalog}
              mine={mine}
              onBought={(c, id) => {
                onMe(c);
                setMine((m) => [...m, id]);
              }}
              onOpenKtp={onOpenKtp}
              toast={toast}
            />
          )}
          {tab === 'stasiun' && <StationTab me={me} session={session} world={world} onMe={onMe} onWorld={onWorld} onOpenKtp={onOpenKtp} toast={toast} />}
        </>
      )}
    </BottomSheet>
  );
}

function GuestPitch({ onRegister }: { onRegister: () => void }) {
  return (
    <Card className="text-center">
      <div className="text-4xl">🪪</div>
      <div className="mt-1 text-lg font-black">Daftar warga, langsung dapat {CUR}!</div>
      <p className="mt-1 text-sm text-muted">
        Modal awal 20 {CUR} + Gaji Harian {SALARY_BASE} {CUR} + 4 Misi Warga Baru (+120 {CUR}). Cukup buat beli Warung pertamamu hari ini.
      </p>
      <Button className="mt-3 w-full" onClick={onRegister}>
        🪪 Daftar Warga Gratis
      </Button>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tab Misi
// ---------------------------------------------------------------------------
function MissionsTab({
  me,
  session,
  onMe,
  toast,
  go,
  onTab,
}: {
  me: MyCitizen;
  session: Session;
  onMe: (c: MyCitizen) => void;
  toast: Toast;
  go: (k: MissionKey) => void;
  onTab: (t: EconomyTab) => void;
}) {
  const [busy, setBusy] = useState<MissionKey | null>(null);
  const prog = missionProgress(me, me.totalDonated);
  const claimedCount = MISSIONS.filter((m) => prog[m.key].claimed).length;
  const totalReward = MISSIONS.reduce((s, m) => s + m.reward, 0);

  async function claim(k: MissionKey) {
    setBusy(k);
    try {
      const r = await api.claimMission(session, k);
      onMe(r.citizen);
      toast(`🎉 Misi selesai! +${r.reward} ${CUR}${k === 'first_donation' ? ' • Lencana Donatur Perintis didapat!' : ''}`, 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 pb-2">
      <Card className="bg-gradient-to-br from-rose-50 to-amber-50">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-black tracking-wide text-brand uppercase">Misi Warga Baru</div>
            <div className="text-base font-black">
              {claimedCount}/{MISSIONS.length} selesai • total +{totalReward} {CUR}
            </div>
          </div>
          {isDonaturPerintis(me) && <span className="rounded-full bg-amber-400 px-2 py-1 text-[10px] font-black text-amber-950">🏅 Donatur Perintis</span>}
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-black/10">
          <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-brand transition-all duration-700" style={{ width: `${(claimedCount / MISSIONS.length) * 100}%` }} />
        </div>
        <ol className="mt-3 space-y-2">
          {MISSIONS.map((m, i) => {
            const p = prog[m.key];
            return (
              <li key={m.key} className={`flex items-center gap-2.5 rounded-2xl bg-white p-2.5 shadow-sm ${p.claimed ? 'opacity-60' : ''}`}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/5 text-lg">{p.claimed ? '✅' : m.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] leading-tight font-bold">
                    {i + 1}. {m.title}
                  </div>
                  <div className="text-[11px] font-black text-amber-600">
                    +{m.reward} {CUR}
                    {m.key === 'first_donation' && ' + lencana Donatur Perintis'}
                  </div>
                </div>
                {p.claimed ? (
                  <span className="text-[11px] font-black text-emerald-600">Diambil</span>
                ) : p.done ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void claim(m.key)}
                    className="hud-btn hud-gold animate-pulse"
                    style={{ width: 'auto', height: 38, padding: '0 12px', flexDirection: 'row', borderRadius: 12 }}
                  >
                    <span className="text-[12px] font-black text-amber-950">{busy === m.key ? '…' : `Klaim +${m.reward}`}</span>
                  </button>
                ) : (
                  <Button variant="secondary" className="shrink-0 px-3 py-2 text-xs" onClick={() => go(m.key)}>
                    {m.cta} →
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      </Card>

      <Card>
        <div className="mb-2 text-[11px] font-black tracking-wide text-muted uppercase">Cara cari {CUR}</div>
        <div className="grid grid-cols-3 gap-2 text-center text-[11px] font-bold">
          <button type="button" className="tactile rounded-2xl bg-white p-2 shadow-sm" onClick={() => onTab('kerja')}>
            <div className="text-2xl">💰</div>Gaji Harian
            <div className="text-amber-600">+{SALARY_BASE}/hari</div>
          </button>
          <button type="button" className="tactile rounded-2xl bg-white p-2 shadow-sm" onClick={() => onTab('kerja')}>
            <div className="text-2xl">⚡</div>Kerja Cepat
            <div className="text-amber-600">+{QUICK_WORK_REWARD} ×3</div>
          </button>
          <button type="button" className="tactile rounded-2xl bg-white p-2 shadow-sm" onClick={() => onTab('properti')}>
            <div className="text-2xl">🏪</div>Punya Usaha
            <div className="text-amber-600">bonus gaji</div>
          </button>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab Kerja & Gaji
// ---------------------------------------------------------------------------
function WorkTab({
  me,
  session,
  status,
  propertyBonus,
  tierWork,
  onMe,
  toast,
  now,
}: {
  me: MyCitizen;
  session: Session;
  status: NonNullable<ReturnType<typeof economyStatus>>;
  propertyBonus: number;
  tierWork: TierWork | null;
  onMe: (c: MyCitizen) => void;
  toast: Toast;
  now: number;
}) {
  const [salaryBusy, setSalaryBusy] = useState(false);
  const [shift, setShift] = useState<{ label: string; start: number } | null>(null);
  const rank = rankSalaryBonus(me.citizenNumber);
  const salaryTotal = SALARY_BASE + rank + propertyBonus;

  async function claimSalary() {
    setSalaryBusy(true);
    try {
      const r = await api.claimDailySalary(session);
      onMe(r.citizen);
      toast(`💰 Gaji cair +${r.reward} ${CUR}!`, 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setSalaryBusy(false);
    }
  }

  async function quickWork() {
    const label = QUICK_WORK_LABELS[Math.floor(Math.random() * QUICK_WORK_LABELS.length)];
    setShift({ label, start: performance.now() });
    const wait = new Promise((r) => setTimeout(r, 1500));
    try {
      const [r] = await Promise.all([api.doQuickWork(session), wait]);
      onMe(r.citizen);
      toast(`⚡ ${label} beres! +${r.reward} ${CUR} (sisa ${r.remaining}x hari ini)`, 'success');
    } catch (e) {
      await wait;
      toast(errorMessage(e), 'error');
    } finally {
      setShift(null);
    }
  }

  return (
    <div className="space-y-3 pb-2">
      <Card className="bg-gradient-to-br from-amber-50 to-yellow-100">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[11px] font-black tracking-wide text-amber-700 uppercase">Gaji Harian Warga</div>
            <div className="text-2xl font-black text-amber-900">
              +{salaryTotal} {CUR}
            </div>
            <div className="text-[11px] text-amber-800">
              {SALARY_BASE} pokok{rank ? ` + ${rank} jabatan` : ''}
              {propertyBonus ? ` + ${propertyBonus} properti` : ''} • 1x / 24 jam
            </div>
          </div>
          <span className="text-4xl">💰</span>
        </div>
        {status.salaryReady ? (
          <button
            type="button"
            disabled={salaryBusy}
            onClick={() => void claimSalary()}
            className="hud-btn hud-gold mt-3 w-full"
            style={{ width: '100%', height: 54, flexDirection: 'row', borderRadius: 18 }}
          >
            <span className="text-[15px] font-black tracking-wide text-amber-950">{salaryBusy ? 'Mencairkan…' : '💰 KLAIM GAJI HARI INI'}</span>
          </button>
        ) : (
          <div className="mt-3 rounded-2xl bg-white/70 py-3 text-center text-sm font-black text-amber-900 tabular-nums">
            ⏳ Tersedia dalam {shortWait(status.salaryAt - now)}
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[11px] font-black tracking-wide text-muted uppercase">Kerja Cepat / Cari Cuan</div>
            <div className="text-xl font-black">
              +{QUICK_WORK_REWARD} {CUR} <span className="text-xs font-bold text-muted">per shift</span>
            </div>
            <div className="text-[11px] text-muted">
              Jeda 2 jam • {status.quickUsedToday}/{QUICK_WORK_MAX_PER_DAY} shift hari ini
            </div>
          </div>
          <span className="text-4xl">⚡</span>
        </div>
        {shift ? (
          <div className="mt-3">
            <div className="mb-1 text-center text-sm font-black">🛠️ {shift.label}…</div>
            <div className="h-4 overflow-hidden rounded-full bg-black/10">
              <div key={shift.start} className="animate-shift-progress h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600" />
            </div>
          </div>
        ) : status.quickReady ? (
          <Button className="mt-3 w-full py-3.5 text-base" onClick={() => void quickWork()}>
            ⚡ Mulai Shift (+{QUICK_WORK_REWARD} {CUR})
          </Button>
        ) : (
          <div className="mt-3 rounded-2xl bg-white py-3 text-center text-sm font-bold text-muted tabular-nums">
            {status.quickLeft === 0 ? '😴 Jatah hari ini habis — balik besok!' : `⏳ Shift berikutnya dalam ${shortWait(status.quickAt - now)}`}
          </div>
        )}
      </Card>

      {tierWork && (
        <Card>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-black tracking-wide text-muted uppercase">Kerja Jabatan</div>
              <div className="truncate text-base font-black">💼 {tierWork.label}</div>
              <div className="text-[11px] text-muted">
                +{tierWork.reward} {CUR} • jeda {Math.round(econ.workCooldownMinutes)} menit
              </div>
            </div>
            <Button className="shrink-0 px-3 text-xs" disabled={tierWork.readyAt > now || tierWork.busy} loading={tierWork.busy} onClick={tierWork.run}>
              {tierWork.readyAt > now ? `⏳ ${shortWait(tierWork.readyAt - now)}` : 'Kerja'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab Properti & Usaha RT
// ---------------------------------------------------------------------------
function VerifyLock({ me, what, onOpenKtp }: { me: MyCitizen; what: string; onOpenKtp: () => void }) {
  return (
    <div className="rounded-2xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
      🔒 <b>{what}</b> terbuka setelah kamu resmi dilantik. Kursi <b>#{String(me.citizenNumber).padStart(4, '0')}</b> masuk antrean pelantikan gelombang berikutnya — atau lebih cepat lewat verifikasi follow (<b>@{me.igUsername}</b> → <b>@{WORLD.igAccountHandle}</b>, dicek otomatis maks. 1x24 jam).
      <button type="button" className="mt-2 block font-black text-brand underline" onClick={onOpenKtp}>
        Cek status / Cek Ulang di e-KTP →
      </button>
    </div>
  );
}

function PropertyTab({
  me,
  session,
  catalog,
  mine,
  onBought,
  onOpenKtp,
  toast,
}: {
  me: MyCitizen;
  session: Session;
  catalog: PropertyType[];
  mine: string[];
  onBought: (c: MyCitizen, id: string) => void;
  onOpenKtp: () => void;
  toast: Toast;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [owners, setOwners] = useState<PropertyOwnerRow[]>([]);
  const locked = econ.requireVerified.buyLand && !isInaugurated(me);

  useEffect(() => {
    api.getPropertyOwners(15).then(setOwners).catch(() => setOwners([]));
  }, [mine.length]);

  async function buy(t: PropertyType) {
    setBusy(t.id);
    try {
      const r = await api.buyProperty(session, t.id);
      onBought(r.citizen, t.id);
      setConfirm(null);
      toast(`${t.emoji} ${t.name} resmi milikmu! Bonus gaji +${t.dailyBonus} ${CUR}/hari. Cek e-KTP-mu!`, 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 pb-2">
      {me.topProperty && (
        <div className="rounded-2xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200">
          🪪 Properti di e-KTP-mu: <b>{me.topProperty}</b> — simpan ulang PNG e-KTP buat pamer!
        </div>
      )}
      {locked && <VerifyLock me={me} what="Beli properti" onOpenKtp={onOpenKtp} />}
      {catalog.length === 0 && <Card className="text-center text-sm text-muted">Katalog properti belum tersedia di dunia ini.</Card>}
      <div className="space-y-2">
        {catalog.map((t) => {
          const owned = mine.includes(t.id);
          const short = t.price - me.coins;
          return (
            <div key={t.id} className={`flex items-center gap-3 rounded-3xl bg-white p-3 shadow-sm ring-1 ${owned ? 'ring-emerald-300' : 'ring-black/5'}`}>
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-b from-amber-100 to-amber-200 text-2xl">{t.emoji}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black">{t.name}</div>
                <div className="text-[12px] font-black text-amber-700 tabular-nums">{formatCoins(t.price, CUR)}</div>
                <div className="text-[11px] font-semibold text-emerald-700">+{t.dailyBonus} {CUR}/hari bonus gaji</div>
              </div>
              {owned ? (
                <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-black text-emerald-700">✓ Dimiliki</span>
              ) : confirm === t.id ? (
                <div className="flex shrink-0 flex-col gap-1">
                  <Button className="px-3 py-2 text-xs" loading={busy === t.id} onClick={() => void buy(t)}>
                    Yakin beli
                  </Button>
                  <button type="button" className="text-[10px] font-bold text-muted" onClick={() => setConfirm(null)}>
                    batal
                  </button>
                </div>
              ) : (
                <Button className="shrink-0 px-3 py-2 text-xs" disabled={locked || short > 0} onClick={() => setConfirm(t.id)}>
                  {short > 0 ? `Kurang ${formatNumber(short)}` : 'Beli'}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <p className="px-1 text-[11px] text-muted">Mau kavling sendiri di peta? Ketuk kavling kosong (bertanda 🪧) di ring yang sudah terbuka.</p>

      <Card>
        <div className="mb-2 text-[11px] font-black tracking-wide text-muted uppercase">🏘️ Pemilik usaha terbaru di RT</div>
        {owners.length === 0 ? (
          <div className="py-3 text-center text-xs text-muted">Belum ada yang buka usaha. Jadilah juragan pertama di RT-mu!</div>
        ) : (
          <ul className="space-y-1.5">
            {owners.map((o) => (
              <li key={`${o.citizenId}-${o.propertyType}`} className="flex items-center gap-2 rounded-xl bg-white px-2.5 py-1.5 text-[12px]">
                <span className="text-base">{o.emoji}</span>
                <SeatBadge seat={o.citizenNumber} small />
                <span className="min-w-0 flex-1 truncate">
                  <b>{o.username}</b> <span className="text-muted">• {o.propertyName}</span>
                </span>
                <span className="shrink-0 text-[10px] text-muted">{o.rtLabel || formatRelative(o.purchasedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab Patungan Stasiun
// ---------------------------------------------------------------------------
function StationTab({
  me,
  session,
  world,
  onMe,
  onWorld,
  onOpenKtp,
  toast,
}: {
  me: MyCitizen;
  session: Session;
  world: WorldState | null;
  onMe: (c: MyCitizen) => void;
  onWorld: (w: WorldState) => void;
  onOpenKtp: () => void;
  toast: Toast;
}) {
  const project = WORLD.projects.find((p) => p.id === world?.activeProjectId);
  const [board, setBoard] = useState<DonorBoardRow[]>([]);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const funding = world?.activeProjectFunding ?? 0;
  const goal = world?.activeProjectGoal ?? 0;
  const pct = goal > 0 ? Math.min(100, (funding / goal) * 100) : 0;
  const phase = projectPhase(world?.activeProjectCompleted ? 100 : pct);
  const locked = econ.requireVerified.donate && !isInaugurated(me);
  const done = !!world?.activeProjectCompleted;

  const refresh = useCallback(() => {
    if (project) api.getDonorBoard(project.id, 10).then(setBoard).catch(() => setBoard([]));
  }, [project]);
  useEffect(refresh, [refresh]);

  async function donate(amount: number) {
    if (!Number.isFinite(amount) || amount < 1) return toast('Nominal patungan minimal 1.', 'error');
    if (amount > me.coins) return toast(`Saldo ${CUR} kamu belum cukup. Ambil gaji / kerja cepat dulu!`, 'error');
    setBusy(amount);
    try {
      const r = await api.donateToProject(session, amount);
      onMe({ ...me, coins: r.coins, totalDonated: me.totalDonated + amount });
      onWorld(r.world);
      setCustom('');
      toast(
        r.completedProjectId
          ? '🎉 PROYEK SELESAI berkat sumbanganmu!'
          : `🏛️ Terima kasih! ${formatCoins(amount, CUR)} masuk kas proyek${amount >= DONATION_ANNOUNCE_MIN ? ' & diumumkan di Global Chat' : ''}.`,
        'success',
      );
      refresh();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  if (!project) return <Card className="text-center text-sm text-muted">Belum ada proyek nasional aktif.</Card>;

  return (
    <div className="space-y-3 pb-2">
      <Card className="bg-gradient-to-br from-slate-800 to-slate-900 text-white ring-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-black tracking-wide text-amber-300 uppercase">Proyek Nasional</div>
            <div className="text-lg leading-tight font-black">
              {project.emoji} {done ? 'Semua proyek selesai!' : project.name}
            </div>
            <div className="text-[11px] text-white/70">{project.description}</div>
          </div>
          <span className="shrink-0 rounded-full bg-amber-400 px-2 py-1 text-[10px] font-black text-amber-950">
            {phase.emoji} {phase.label}
          </span>
        </div>
        <div className="relative mt-3 h-5 overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full bg-gradient-to-r from-amber-300 via-amber-400 to-emerald-400 transition-all duration-700" style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }} />
          <span className="absolute inset-0 flex items-center justify-center text-[11px] font-black text-white drop-shadow tabular-nums">{pct.toFixed(pct < 10 ? 2 : 1)}%</span>
        </div>
        <div className="mt-1 flex justify-between text-[9px] font-bold text-white/60">
          <span>🚧 Lahan</span>
          <span>🧱 25%</span>
          <span>🏗️ 50%</span>
          <span>🏗️ 75%</span>
          <span>🚆 100%</span>
        </div>
        <div className="mt-2 text-center text-sm font-black tabular-nums">
          {formatCoins(funding, CUR)} <span className="text-white/60">/ {formatCoins(goal, CUR)}</span>
        </div>
      </Card>

      {locked ? (
        <VerifyLock me={me} what="Patungan proyek" onOpenKtp={onOpenKtp} />
      ) : (
        !done && (
          <Card>
            <div className="mb-2 flex items-center justify-between text-[11px] font-black tracking-wide text-muted uppercase">
              <span>Donasi cepat 1-klik</span>
              <span className="normal-case">
                Saldo: {formatNumber(me.coins)} {CUR}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {QUICK_DONATIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={busy !== null || n > me.coins}
                  onClick={() => void donate(n)}
                  className="hud-btn disabled:opacity-40"
                  style={{ width: '100%', height: 52, borderRadius: 16 }}
                >
                  <span className="text-[15px] font-black">{busy === n ? '…' : n}</span>
                  <span className="hud-lbl">{CUR}</span>
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                className={`${inputClass} flex-1`}
                inputMode="numeric"
                value={custom}
                onChange={(e) => setCustom(e.target.value.replace(/\D/g, '').slice(0, 7))}
                placeholder={`Nominal lain (${CUR})`}
              />
              <Button disabled={!custom || busy !== null} loading={busy === Number(custom)} onClick={() => void donate(Number(custom))}>
                Patungan
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted">
              Donasi ≥ {DONATION_ANNOUNCE_MIN} {CUR} diumumkan di Global Chat. Patungan pertama min. 10 {CUR} = misi +40 {CUR} & lencana 🏅 Donatur Perintis.
            </p>
          </Card>
        )
      )}

      <Card>
        <div className="mb-2 text-[11px] font-black tracking-wide text-muted uppercase">🏆 Top 10 Donatur {project.name}</div>
        {board.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted">Kas masih kosong. Jadilah donatur #1 dan namamu tampil paling atas!</div>
        ) : (
          <ol className="space-y-1.5">
            {board.map((d) => (
              <li
                key={d.citizenId}
                className={`flex items-center gap-2 rounded-2xl px-2.5 py-2 ${d.citizenId === me.id ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-white'}`}
              >
                <span className="w-6 shrink-0 text-center text-sm font-black">{['🥇', '🥈', '🥉'][d.rank - 1] ?? d.rank}</span>
                <SeatBadge seat={d.citizenNumber} small />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-[13px] font-black">{d.username}</div>
                  <div className="truncate text-[10px] text-muted">{d.roleTitle}</div>
                </div>
                <b className="shrink-0 text-[12px] text-amber-700 tabular-nums">{formatCoins(d.amount, CUR)}</b>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
