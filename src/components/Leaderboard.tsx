import { useCallback, useEffect, useRef, useState } from 'react';
import { WORLD } from '../configs';
import { findTier } from '../lib/game';
import { formatCitizenTag, formatCoins, formatNumber } from '../lib/format';
import { api, type LeaderboardRow, type LeaderboardTab, type MyCitizen, type MyRanks, type PublicCitizen } from '../services';
import { Modal, errorMessage, inputClass } from './ui';

const TABS: Array<{ id: LeaderboardTab; label: string }> = [
  { id: 'founders', label: 'Top 1–100' },
  { id: 'gen1', label: '101–1000' },
  { id: 'richest', label: 'Terkaya' },
  { id: 'landlords', label: 'Tuan Tanah' },
];
const PAGE = 50;

/** "Buku Sejarah Negara": 4 tab, pencarian instan, Load More, Click-to-Locate, sticky "Posisi Kamu". */
export function Leaderboard({
  open,
  onClose,
  me,
  onLocate,
}: {
  open: boolean;
  onClose: () => void;
  me: MyCitizen | null;
  onLocate: (c: PublicCitizen) => void;
}) {
  const [tab, setTab] = useState<LeaderboardTab>('founders');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ranks, setRanks] = useState<MyRanks | null>(null);
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

  useEffect(() => {
    if (!open || !me) return;
    api.getMyRanks(me.id).then(setRanks).catch(() => setRanks(null));
  }, [open, me]);

  return (
    <Modal open={open} onClose={onClose} title="📜 Buku Sejarah Negara">
      <div className="-mx-1 flex gap-1 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${tab === t.id ? 'bg-brand text-white' : 'bg-black/5'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
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
                <span className="w-9 shrink-0 text-center text-sm font-black text-muted">{r.rank <= 3 && tab !== 'gen1' ? ['🥇', '🥈', '🥉'][r.rank - 1] : `#${r.rank}`}</span>
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
                  ) : tab === 'richest' ? (
                    formatCoins(c.coins, WORLD.currency.code)
                  ) : (
                    <span className="text-muted">🔦</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {!loading && rows.length === 0 && !error && <p className="py-6 text-center text-sm text-muted">{search ? 'Tidak ada hasil.' : 'Belum ada warga di sini. Jadilah yang pertama!'}</p>}
      {error && <p className="mt-2 text-sm font-semibold text-red-600">{error}</p>}
      {loading && <p className="py-3 text-center text-xs text-muted">Memuat…</p>}
      {more && !loading && (
        <button onClick={() => void load(false, rows.length)} className="mt-2 w-full rounded-2xl bg-black/5 py-2.5 text-sm font-bold">
          Load More
        </button>
      )}

      {me && (
        <div className="sticky -bottom-5 -mx-5 mt-3 border-t border-black/10 bg-surface px-5 pt-2 pb-1">
          <div className="text-[10px] font-black text-muted uppercase">Posisi Kamu</div>
          <div className="flex flex-wrap items-center justify-between gap-1 text-xs font-bold">
            <span className="truncate">{formatCitizenTag(me.username, me.citizenNumber)}</span>
            <span>
              💰 Terkaya #{ranks ? formatNumber(ranks.wealthRank) : '…'} • 🏘️ Tuan Tanah {ranks?.landlordRank ? `#${formatNumber(ranks.landlordRank)}` : '—'}
            </span>
          </div>
        </div>
      )}
    </Modal>
  );
}
