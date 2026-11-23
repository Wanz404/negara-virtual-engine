import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WORLD } from '../configs';
import type { TierConfig } from '../configs/types';
import { findTier, resolveTier, resolveTitle } from '../lib/game';
import { formatCitizenTag, formatCoins, formatNumber } from '../lib/format';
import { api, type LeaderboardRow, type LeaderboardTab, type MyCitizen, type MyRanks, type PublicCitizen, type WorldState } from '../services';
import { Avatar } from './Avatar';
import { Modal, errorMessage, inputClass } from './ui';

/** Target kota penuh. */
const TARGET = 10_000;
/** Kursi per halaman — jangan pernah render 10.000 DOM sekaligus. */
const PAGE = 50;
const TOTAL_PAGES = Math.ceil(TARGET / PAGE);

type View = 'seats' | 'richest' | 'landlords';
const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'seats', label: '🪑 Kursi Warga' },
  { id: 'richest', label: '💰 Terkaya' },
  { id: 'landlords', label: '🏘️ Tuan Tanah' },
];

interface Block {
  id: string;
  label: string;
  min: number;
  max: number;
}

/** "#0004" — 4 digit agar seragam sampai #9999, #10000 apa adanya. */
export function formatSeat(n: number): string {
  return `#${String(n).padStart(4, '0')}`;
}

/**
 * Blok kasta 1–10.000, batasnya di-snap ke batas tier di config dunia aktif
 * (cth. Konoha: 1–30 Istana, 31–100 Elite, 101–1.000 Perintis, lalu tier sipil dipecah 1.001–5.000 & 5.001–10.000).
 */
function buildBlocks(): Block[] {
  const bounds = WORLD.tiers.map((t) => t.max).filter((m): m is number => m !== null && m < TARGET);
  const snap = (want: number, floor: number) => {
    const ok = bounds.filter((b) => b > floor);
    if (ok.length === 0) return Math.max(want, floor + 1);
    return ok.reduce((best, b) => (Math.abs(b - want) < Math.abs(best - want) ? b : best), ok[0]);
  };
  const istanaEnd = Math.max(
    WORLD.tiers.filter((t) => t.preset === 'head' || t.preset === 'deputy' || t.preset === 'cabinet').reduce((m, t) => Math.max(m, t.max ?? 0), 0),
    snap(10, 0),
  );
  const eliteEnd = snap(100, istanaEnd);
  const perintisEnd = Math.max(snap(1000, eliteEnd), eliteEnd + 1);
  const utamaEnd = Math.max(5000, perintisEnd + 1);
  const raw: Array<[string, string, number]> = [
    ['istana', 'Istana', istanaEnd],
    ['elite', 'Elite', eliteEnd],
    ['perintis', 'Perintis', perintisEnd],
    ['utama', 'Warga Utama', utamaEnd],
    ['10k', 'Angkatan 10K', TARGET],
  ];
  const out: Block[] = [];
  let start = 1;
  for (const [id, label, end] of raw) {
    const max = Math.min(end, TARGET);
    if (max < start) continue;
    out.push({ id, label, min: start, max });
    start = max + 1;
  }
  return out;
}

const BLOCKS = buildBlocks();

function blockStatus(b: Block, total: number): { text: string; tone: 'full' | 'left' | 'open' } {
  if (total >= b.max) return { text: 'PENUH', tone: 'full' };
  if (total >= b.min) return { text: `SISA ${formatNumber(b.max - total)}`, tone: 'left' };
  return { text: 'TERBUKA', tone: 'open' };
}

const pageOf = (n: number) => Math.min(TOTAL_PAGES, Math.max(1, Math.ceil(n / PAGE)));

/**
 * Ambil warga untuk rentang kursi [start, end] memakai RPC leaderboard yang sudah ada
 * ('founders' = #1–100, 'gen1' = #101–1000, keduanya urut nomor kursi). Kursi > 1000 belum punya
 * endpoint urut-nomor, jadi diisi dari data warga yang sudah dimuat di peta (sisanya tampil "Terisi").
 */
async function fetchSeatRange(start: number, end: number): Promise<PublicCitizen[]> {
  const out: PublicCitizen[] = [];
  const jobs: Array<Promise<void>> = [];
  if (start <= 100) {
    const s = start;
    const e = Math.min(end, 100);
    jobs.push(api.getLeaderboard('founders', s - 1, e - s + 1).then((r) => void out.push(...r.map((x) => x.citizen))));
  }
  if (end >= 101 && start <= 1000) {
    const s = Math.max(start, 101);
    const e = Math.min(end, 1000);
    jobs.push(api.getLeaderboard('gen1', s - 101, e - s + 1).then((r) => void out.push(...r.map((x) => x.citizen))));
  }
  await Promise.all(jobs);
  return out;
}

/** "Dashboard Kursi Warga (Target 1 – 10.000)": milestone, blok kasta, daftar kursi ber-pagination + slot kosong. */
export function Leaderboard({
  open,
  onClose,
  me,
  world,
  knownCitizens,
  onLocate,
  onRegister,
}: {
  open: boolean;
  onClose: () => void;
  me: MyCitizen | null;
  world: WorldState | null;
  knownCitizens: PublicCitizen[];
  onLocate: (c: PublicCitizen) => void;
  onRegister: () => void;
}) {
  const [view, setView] = useState<View>('seats');
  const [ranks, setRanks] = useState<MyRanks | null>(null);
  const total = Math.min(world?.lastCitizenNumber ?? 0, TARGET);
  const next = (world?.lastCitizenNumber ?? 0) + 1;

  useEffect(() => {
    if (!open || !me) return;
    api.getMyRanks(me.id).then(setRanks).catch(() => setRanks(null));
  }, [open, me]);

  return (
    <Modal open={open} onClose={onClose} title="🪑 Dashboard Kursi Warga" wide>
      <MilestoneHeader total={total} next={next} me={me} onRegister={onRegister} />

      <div className="-mx-1 mt-3 flex gap-1 overflow-x-auto pb-1">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${view === v.id ? 'bg-brand text-white' : 'bg-black/5'}`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === 'seats' ? (
        <SeatBoard open={open} total={total} me={me} knownCitizens={knownCitizens} onLocate={onLocate} onRegister={onRegister} />
      ) : (
        <RankList open={open} tab={view} me={me} onLocate={onLocate} />
      )}

      {me && (
        <div className="sticky -bottom-5 -mx-5 mt-3 border-t border-black/10 bg-surface px-5 pt-2 pb-1">
          <div className="text-[10px] font-black text-muted uppercase">Posisi Kamu</div>
          <div className="flex flex-wrap items-center justify-between gap-1 text-xs font-bold">
            <span className="truncate">
              {formatSeat(me.citizenNumber)} · @{me.username}
            </span>
            <span>
              💰 #{ranks ? formatNumber(ranks.wealthRank) : '…'} • 🏘️ {ranks?.landlordRank ? `#${formatNumber(ranks.landlordRank)}` : '—'}
            </span>
          </div>
        </div>
      )}
    </Modal>
  );
}

function MilestoneHeader({ total, next, me, onRegister }: { total: number; next: number; me: MyCitizen | null; onRegister: () => void }) {
  const pct = (total / TARGET) * 100;
  const left = Math.max(0, TARGET - total);
  const full = next > TARGET;
  const nextTier = resolveTier(WORLD, next);
  const nextTitle = resolveTitle(nextTier, next);
  return (
    <div className="rounded-3xl bg-gradient-to-br from-brand/15 via-amber-400/10 to-rose-500/10 p-4 ring-1 ring-brand/20">
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="text-[10px] font-black tracking-wider text-muted uppercase">Milestone Kota Penuh</div>
          <div className="text-2xl leading-tight font-black">
            {formatNumber(total)} <span className="text-base text-muted">/ {formatNumber(TARGET)}</span>
          </div>
          <div className="text-xs font-bold">Kursi Terisi</div>
        </div>
        <div className="text-right text-2xl font-black text-brand">{pct < 1 && pct > 0 ? pct.toFixed(2) : pct.toFixed(1)}%</div>
      </div>
      <div className="mt-2 h-3.5 overflow-hidden rounded-full bg-black/10" role="progressbar" aria-valuenow={total} aria-valuemin={0} aria-valuemax={TARGET}>
        <div className="h-full rounded-full bg-gradient-to-r from-brand to-rose-500 transition-[width] duration-700" style={{ width: `${Math.max(pct, total > 0 ? 1 : 0)}%` }} />
      </div>
      <div className="mt-1.5 text-xs font-bold text-muted">
        {full ? '🎉 Kota Penuh! Semua 10.000 kursi sudah terisi.' : `Sisa ${formatNumber(left)} kursi menuju Kota Penuh`}
      </div>

      {!full && (
        <div className="mt-3 flex flex-col gap-2 rounded-2xl bg-surface/80 p-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-black tracking-wider text-rose-600 uppercase">🔥 Kursi berikutnya yang tersedia</div>
            <div className="truncate text-sm font-black">
              Kursi {formatSeat(next)} ({nextTier.shortName}) masih <span className="text-rose-600">KOSONG!</span>
            </div>
            <div className="truncate text-[11px] text-muted">Jabatan: {nextTitle}</div>
          </div>
          {me ? (
            <div className="shrink-0 text-[11px] font-bold text-muted">Ajak temanmu sebelum diambil orang!</div>
          ) : (
            <button onClick={onRegister} className="shrink-0 animate-pulse rounded-2xl bg-brand px-4 py-2.5 text-sm font-black text-white shadow-lg hover:animate-none">
              Ambil Kursi {formatSeat(next)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SeatBoard({
  open,
  total,
  me,
  knownCitizens,
  onLocate,
  onRegister,
}: {
  open: boolean;
  total: number;
  me: MyCitizen | null;
  knownCitizens: PublicCitizen[];
  onLocate: (c: PublicCitizen) => void;
  onRegister: () => void;
}) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Map<number, PublicCitizen>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicCitizen[] | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const reqId = useRef(0);
  const listRef = useRef<HTMLOListElement>(null);

  const start = (page - 1) * PAGE + 1;
  const end = Math.min(page * PAGE, TARGET);
  const activeBlock = BLOCKS.find((b) => start >= b.min && start <= b.max) ?? BLOCKS[0];

  // Halaman awal: blok tempat kursi berikutnya berada (paling FOMO), atau posisi saya.
  const initialised = useRef(false);
  useEffect(() => {
    if (!open) {
      initialised.current = false;
      return;
    }
    if (initialised.current) return;
    initialised.current = true;
    setPage(pageOf(me ? me.citizenNumber : Math.max(1, total)));
  }, [open, me, total]);

  useEffect(() => {
    if (!open) return;
    const id = ++reqId.current;
    const occupiedEnd = Math.min(end, total);
    if (occupiedEnd < start) {
      setRows(new Map());
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchSeatRange(start, occupiedEnd)
      .then((list) => {
        if (id !== reqId.current) return;
        const m = new Map<number, PublicCitizen>();
        for (const c of [...knownCitizens, ...(me ? [me] : [])]) if (c.citizenNumber >= start && c.citizenNumber <= end) m.set(c.citizenNumber, c);
        for (const c of list) m.set(c.citizenNumber, c);
        setRows(m);
        if (highlight !== null && highlight >= start && highlight <= occupiedEnd && !m.has(highlight)) void lookupSeat(highlight);
      })
      .catch((e) => id === reqId.current && setError(errorMessage(e)))
      .finally(() => id === reqId.current && setLoading(false));
    // knownCitizens/me/highlight sengaja tidak jadi dependensi: refresh peta tak perlu memicu fetch ulang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, start, end, total]);

  /** Kursi > 1000 yang belum termuat: ambil 1 warga via pencarian nomor (RPC leaderboard yang sama). */
  const lookupSeat = useCallback(async (n: number) => {
    try {
      const r = await api.getLeaderboard('richest', 0, 5, String(n));
      const c = r.map((x) => x.citizen).find((x) => x.citizenNumber === n);
      if (c) setRows((m) => new Map(m).set(n, c));
    } catch {
      /* biarkan tampil "Kursi terisi" */
    }
  }, []);

  const goTo = useCallback(
    (n: number) => {
      setResults(null);
      setHighlight(n);
      if (pageOf(n) === page && n <= total && !rows.has(n)) void lookupSeat(n);
      setPage(pageOf(n));
    },
    [page, total, rows, lookupSeat],
  );
  const changePage = (p: number) => {
    setHighlight(null);
    setPage(p);
  };

  // Scroll ke kursi yang di-highlight setelah halaman ter-render.
  useEffect(() => {
    if (highlight === null || loading) return;
    listRef.current?.querySelector(`[data-seat="${highlight}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight, loading, page]);

  // Pencarian: angka → lompat ke kursi; teks → cari @username (debounce).
  useEffect(() => {
    const q = query.trim().replace(/^[@#]+/, '');
    if (!q || /^\d+$/.test(q)) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      api
        .getLeaderboard('richest', 0, 20, q)
        .then((r) => setResults(r.map((x) => x.citizen).sort((a, b) => a.citizenNumber - b.citizenNumber)))
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const submitSearch = () => {
    const q = query.trim().replace(/^[@#]+/, '');
    if (/^\d+$/.test(q)) {
      const n = Number(q);
      if (n >= 1 && n <= TARGET) goTo(n);
      else setError(`Nomor kursi harus 1–${formatNumber(TARGET)}.`);
    } else if (results && results[0]) {
      goTo(results[0].citizenNumber);
    }
  };

  const seats = useMemo(() => Array.from({ length: end - start + 1 }, (_, i) => start + i), [start, end]);

  return (
    <div className="mt-2">
      {/* Blok kasta */}
      <div className="-mx-1 flex snap-x gap-1.5 overflow-x-auto pb-1">
        {BLOCKS.map((b) => {
          const st = blockStatus(b, total);
          const active = b.id === activeBlock.id;
          return (
            <button
              key={b.id}
              onClick={() => {
                setHighlight(null);
                setPage(pageOf(total >= b.min && total < b.max ? total + 1 : b.min));
              }}
              className={`w-[8.5rem] shrink-0 snap-start rounded-2xl px-2.5 py-2 text-left ring-1 transition ${active ? 'bg-brand text-white ring-brand' : 'bg-black/5 ring-transparent hover:bg-black/10'}`}
            >
              <div className={`text-[10px] font-bold ${active ? 'text-white/80' : 'text-muted'}`}>
                {formatNumber(b.min)}–{formatNumber(b.max)}
              </div>
              <div className="truncate text-sm font-black">{b.label}</div>
              <span
                className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-black ${
                  st.tone === 'full' ? 'bg-gray-500/20' : st.tone === 'left' ? 'bg-rose-500 text-white' : 'bg-emerald-500/20 text-emerald-700'
                } ${active && st.tone !== 'left' ? 'bg-white/25 text-white' : ''}`}
              >
                {st.text}
              </span>
            </button>
          );
        })}
      </div>

      {/* Cari / lompat */}
      <form
        className="mt-2 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          submitSearch();
        }}
      >
        <input
          className={`${inputClass} min-w-0 flex-1`}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setError(null);
          }}
          inputMode="search"
          placeholder="Cari @username atau nomor kursi (1–10000)"
        />
        <button type="submit" className="shrink-0 rounded-2xl bg-black/5 px-3 text-sm font-bold">
          Cari
        </button>
        {me && (
          <button type="button" onClick={() => goTo(me.citizenNumber)} className="shrink-0 rounded-2xl bg-brand/15 px-3 text-xs font-black text-brand">
            📍 Posisi Saya
          </button>
        )}
      </form>
      {results && (
        <div className="mt-1.5 max-h-48 overflow-y-auto rounded-2xl bg-black/5 p-1">
          {results.length === 0 ? (
            <p className="py-2 text-center text-xs text-muted">Tidak ada warga dengan nama itu.</p>
          ) : (
            results.map((c) => (
              <button key={c.id} onClick={() => goTo(c.citizenNumber)} className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs hover:bg-black/5">
                <span className="w-12 shrink-0 font-black text-muted">{formatSeat(c.citizenNumber)}</span>
                <span className="min-w-0 flex-1 truncate font-bold">@{c.username}</span>
                <span className="shrink-0 truncate text-[10px] text-muted">{findTier(WORLD, c.tierId).shortName}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Pager atas */}
      <Pager page={page} setPage={changePage} start={start} end={end} />

      {error && <p className="mt-1 text-sm font-semibold text-red-600">{error}</p>}

      <ol ref={listRef} className={`mt-2 space-y-1.5 ${loading ? 'opacity-60' : ''}`}>
        {seats.map((n) => {
          const c = rows.get(n);
          const hl = highlight === n;
          if (n <= total) {
            if (!c) {
              return (
                <li key={n} data-seat={n}>
                  <div className={`flex items-center gap-2 rounded-2xl bg-black/5 px-3 py-2 ${hl ? 'ring-2 ring-amber-400' : ''}`}>
                    <SeatNo n={n} />
                    <span className="h-9 w-9 shrink-0 rounded-full bg-black/10" />
                    <span className="min-w-0 flex-1 text-sm font-bold text-muted">{loading ? 'Memuat…' : 'Kursi terisi'}</span>
                    {!loading && (
                      <button onClick={() => void lookupSeat(n)} className="shrink-0 text-[11px] font-bold text-brand">
                        Lihat
                      </button>
                    )}
                  </div>
                </li>
              );
            }
            const tier = findTier(WORLD, c.tierId);
            const isMe = me?.id === c.id;
            return (
              <li key={n} data-seat={n}>
                <button
                  onClick={() => onLocate(c)}
                  className={`flex w-full items-center gap-2 rounded-2xl px-3 py-1.5 text-left ${isMe ? 'bg-brand/10 ring-2 ring-brand' : hl ? 'bg-amber-400/15 ring-2 ring-amber-400' : 'bg-black/5 hover:bg-black/10'}`}
                >
                  <SeatNo n={n} />
                  <span className="shrink-0">
                    <Avatar color={c.avatarColor} look={tier.look} accessory={c.avatarStyle.accessory} size={36} dim={c.followStatus === 'impeached'} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">
                      {c.username}
                      {c.followStatus === 'verified' && <span className="text-emerald-600"> ✓</span>}
                      {c.followStatus === 'impeached' && <span className="text-gray-500"> 🚨</span>}
                      {isMe && <span className="text-brand"> (Kamu)</span>}
                    </span>
                    <span className="block truncate text-[11px] text-muted">
                      @{c.igUsername || c.username} · {c.roleTitle}
                    </span>
                  </span>
                  <TierBadge tier={tier} />
                </button>
              </li>
            );
          }
          // Kursi kosong
          const tier = resolveTier(WORLD, n);
          const isNext = n === total + 1;
          const body = (
            <>
              <SeatNo n={n} muted />
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-black/20 text-sm text-muted">?</span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm font-bold ${isNext ? 'text-rose-600' : 'text-muted'}`}>
                  {formatSeat(n)} — Kursi Kosong{isNext ? ' 🔥' : ''}
                </span>
                <span className="block truncate text-[11px] text-muted">{resolveTitle(tier, n)}</span>
              </span>
              <TierBadge tier={tier} faded />
            </>
          );
          const cls = `flex w-full items-center gap-2 rounded-2xl border-2 border-dashed px-3 py-1.5 text-left ${
            isNext ? 'border-rose-400 bg-rose-500/5' : 'border-black/10 bg-transparent'
          } ${hl ? 'ring-2 ring-amber-400' : ''}`;
          return (
            <li key={n} data-seat={n}>
              {me ? (
                <div className={cls}>{body}</div>
              ) : (
                <button onClick={onRegister} className={`${cls} hover:border-brand hover:bg-brand/5`} title="Daftar sekarang">
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {!me && total < end && (
        <p className="mt-2 text-center text-[11px] text-muted">Klik kursi kosong untuk daftar — nomor dibagikan berurutan, makin cepat makin tinggi jabatanmu!</p>
      )}

      <Pager page={page} setPage={changePage} start={start} end={end} />
    </div>
  );
}

function Pager({ page, setPage, start, end }: { page: number; setPage: (p: number) => void; start: number; end: number }) {
  return (
    <div className="mt-2 flex items-center justify-between gap-2">
      <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded-2xl bg-black/5 px-3 py-2 text-xs font-bold disabled:opacity-40">
        ‹ Prev
      </button>
      <div className="text-center text-[11px] font-bold text-muted">
        Kursi {formatSeat(start)}–{formatSeat(end)}
        <span className="block text-[10px] font-semibold">
          Hal. {formatNumber(page)} / {formatNumber(TOTAL_PAGES)}
        </span>
      </div>
      <button disabled={page >= TOTAL_PAGES} onClick={() => setPage(page + 1)} className="rounded-2xl bg-black/5 px-3 py-2 text-xs font-bold disabled:opacity-40">
        Next ›
      </button>
    </div>
  );
}

function SeatNo({ n, muted = false }: { n: number; muted?: boolean }) {
  return <span className={`w-12 shrink-0 text-xs font-black tabular-nums ${muted ? 'text-muted/70' : 'text-muted'}`}>{n <= 3 && !muted ? ['🥇', '🥈', '🥉'][n - 1] : formatSeat(n)}</span>;
}

function TierBadge({ tier, faded = false }: { tier: TierConfig; faded?: boolean }) {
  return (
    <span
      className="max-w-[6.5rem] shrink-0 truncate rounded-full border px-2 py-0.5 text-[10px] font-black"
      style={{ background: `${tier.nametagColor}${faded ? '1f' : '40'}`, borderColor: tier.nametagColor, opacity: faded ? 0.75 : 1 }}
    >
      {tier.shortName}
    </span>
  );
}

/** Tab peringkat lama (Terkaya / Tuan Tanah) — tetap dipertahankan. */
function RankList({ open, tab, me, onLocate }: { open: boolean; tab: Extract<LeaderboardTab, 'richest' | 'landlords'>; me: MyCitizen | null; onLocate: (c: PublicCitizen) => void }) {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const load = useCallback(
    async (reset: boolean, offset: number) => {
      const id = ++reqId.current;
      setLoading(true);
      setError(null);
      try {
        const data = await api.getLeaderboard(tab, offset, PAGE, search);
        if (id !== reqId.current) return;
        setRows((r) => (reset ? data : [...r, ...data]));
        setMore(data.length === PAGE);
      } catch (e) {
        if (id === reqId.current) setError(errorMessage(e));
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [tab, search],
  );

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void load(true, 0), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [open, load, search]);

  return (
    <>
      <input className={`${inputClass} mt-2`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari @username, #nomor, atau jabatan…" />
      <ol className="mt-3 space-y-1.5">
        {rows.map((r) => {
          const c = r.citizen;
          const tier = findTier(WORLD, c.tierId);
          const isMe = me?.id === c.id;
          return (
            <li key={`${tab}-${c.id}`}>
              <button
                onClick={() => onLocate(c)}
                className={`flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left ${isMe ? 'bg-brand/10 ring-2 ring-brand' : 'bg-black/5 hover:bg-black/10'}`}
              >
                <span className="w-9 shrink-0 text-center text-sm font-black text-muted">{r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : `#${r.rank}`}</span>
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: tier.nametagColor }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">
                    {formatCitizenTag(c.username, c.citizenNumber)} {c.followStatus === 'verified' && <span className="text-emerald-600">✓</span>}
                    {c.followStatus === 'impeached' && <span className="text-gray-500"> 🚨</span>}
                  </span>
                  <span className="block truncate text-[11px] text-muted">{c.roleTitle}</span>
                </span>
                <span className="shrink-0 text-right text-xs font-bold">
                  {tab === 'landlords' ? (
                    <>
                      {r.plotsCount} kavling
                      <span className="block text-[10px] text-muted">{r.totalLevels}★ total</span>
                    </>
                  ) : (
                    formatCoins(c.coins, WORLD.currency.code)
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {!loading && rows.length === 0 && !error && <p className="py-6 text-center text-sm text-muted">{search ? 'Tidak ada hasil.' : 'Belum ada data.'}</p>}
      {error && <p className="mt-2 text-sm font-semibold text-red-600">{error}</p>}
      {loading && <p className="py-3 text-center text-xs text-muted">Memuat…</p>}
      {more && !loading && (
        <button onClick={() => void load(false, rows.length)} className="mt-2 w-full rounded-2xl bg-black/5 py-2.5 text-sm font-bold">
          Load More
        </button>
      )}
    </>
  );
}
