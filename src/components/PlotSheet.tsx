import { useEffect, useMemo, useState } from 'react';
import { WORLD, type BuildingType } from '../configs';
import { buildingCost, findBuilding, findTier, propertyIncome, ringName } from '../lib/game';
import { formatCoins, formatNumber } from '../lib/format';
import { playCoin } from '../lib/fx';
import { validateFreeText } from '../lib/validation';
import { isInaugurated } from '../lib/inauguration';
import { api, type MyCitizen, type Plot, type Session } from '../services';
import { Button, Modal, errorMessage, inputClass } from './ui';

const CUR = WORLD.currency.code;
const CATEGORY_LABEL: Record<BuildingType['category'], string> = {
  residential: '🏠 Hunian',
  commercial: '🏪 Usaha / Komersial',
  government: '🏛️ Pemerintahan & Umum',
  community: '🌳 Komunitas',
};

/** Alasan aksi ekonomi terkunci (cermin nv_require_verified) — server tetap otoritas. */
function lockReason(me: MyCitizen | null, action: keyof typeof WORLD.economy.requireVerified): string | null {
  if (!me) return `Daftar jadi ${WORLD.copy.citizenNoun.toLowerCase()} dulu untuk punya tanah.`;
  if (!WORLD.economy.requireVerified[action] || isInaugurated(me)) return null;
  if (me.followStatus === 'impeached') return 'Akses terkunci: kamu sudah dimakzulkan.';
  if (me.followStatus === 'not_following') return `Akun @${me.igUsername} belum terdeteksi follow @${WORLD.igAccountHandle}. Follow lalu klik Cek Ulang di KTP.`;
  return `Kursi #${String(me.citizenNumber).padStart(4, '0')} masih antre pelantikan gelombang berikutnya (atau verifikasi follow @${WORLD.igAccountHandle} maks. 1x24 jam).`;
}

export function PlotSheet({
  plot,
  me,
  session,
  onClose,
  onPlot,
  onCoins,
  toast,
}: {
  plot: Plot | null;
  me: MyCitizen | null;
  session: Session | null;
  onClose: () => void;
  onPlot: (p: Plot) => void;
  onCoins: (coins: number) => void;
  toast: (m: string, k?: 'info' | 'success' | 'error') => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [rename, setRename] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setPicked(null);
    setName('');
    setRename('');
  }, [plot?.plotCode]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const tier = me ? findTier(WORLD, me.tierId) : null;
  const perks = tier?.perks;
  const groups = useMemo(() => {
    const g = new Map<BuildingType['category'], BuildingType[]>();
    for (const b of WORLD.buildings) g.set(b.category, [...(g.get(b.category) ?? []), b]);
    return [...g.entries()];
  }, []);

  if (!plot) return null;
  const mine = !!me && plot.ownerCitizenId === me.id;
  const building = findBuilding(WORLD, plot.buildingType);
  const discount = perks?.landDiscountPct ?? 0;
  const price = Math.floor((plot.price * (100 - discount)) / 100);

  async function run(key: string, fn: () => Promise<void>) {
    if (!session) return;
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  const title = (
    <>
      📍 Kavling {plot.plotCode}
      <div className="text-xs font-semibold text-muted">
        Ring {plot.ringLevel} • {ringName(WORLD, plot.ringLevel)}
      </div>
    </>
  );

  // ----- Belum dimiliki: beli -----
  if (!plot.ownerCitizenId) {
    const reason = lockReason(me, 'buyLand');
    return (
      <Modal open onClose={onClose} title={title}>
        <div className="rounded-2xl bg-black/5 p-4 text-center">
          <div className="text-xs font-bold tracking-wide text-muted uppercase">Dijual</div>
          <div className="mt-1 text-3xl font-black">{formatCoins(price, CUR)}</div>
          {discount > 0 && price !== plot.price && (
            <div className="text-xs text-muted">
              <s>{formatCoins(plot.price, CUR)}</s> • diskon {tier?.shortName} {discount}%
            </div>
          )}
          {me && <div className="mt-2 text-xs text-muted">Saldo kamu: {formatCoins(me.coins, CUR)}</div>}
        </div>
        {reason ? (
          <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">{reason}</p>
        ) : (
          <Button
            className="mt-3 w-full py-4"
            loading={busy === 'buy'}
            disabled={!me || me.coins < price}
            onClick={() =>
              run('buy', async () => {
                const r = await api.buyPlot(session!, plot.plotCode);
                onPlot(r.plot);
                onCoins(r.coins);
                playCoin();
                toast(`Kavling ${plot.plotCode} resmi jadi milikmu!`, 'success');
              })
            }
          >
            {me && me.coins < price ? `Saldo kurang (${formatCoins(price - me.coins, CUR)} lagi)` : '🏷️ Beli Tanah'}
          </Button>
        )}
        <p className="mt-3 text-center text-xs text-muted">
          Maks. {WORLD.economy.land.maxPlotsPerCitizen} kavling per warga. Makin dekat Istana, makin mahal.
        </p>
      </Modal>
    );
  }

  // ----- Milik orang lain -----
  if (!mine) {
    return (
      <Modal open onClose={onClose} title={title}>
        <div className="rounded-2xl bg-black/5 p-4">
          <div className="text-xs font-bold text-muted uppercase">Pemilik</div>
          <div className="text-lg font-black">{plot.ownerTag}</div>
          {building ? (
            <div className="mt-3">
              <div className="text-xs font-bold text-muted uppercase">Bangunan</div>
              <div className="font-bold">
                {building.emoji} {plot.buildingName} <span className="text-amber-500">{'★'.repeat(plot.buildingLevel)}</span>
              </div>
              <div className="text-xs text-muted">
                {building.name} • Level {plot.buildingLevel}/{building.maxLevel}
              </div>
            </div>
          ) : (
            <div className="mt-2 text-sm text-muted">Tanah kosong, belum dibangun.</div>
          )}
        </div>
      </Modal>
    );
  }

  // ----- Milik sendiri -----
  const reason = lockReason(me, 'build');
  if (!building || plot.buildingLevel === 0) {
    const b = findBuilding(WORLD, picked);
    const cost = b ? buildingCost(b, 0) : 0;
    const nameErr = name ? validateFreeText(name, 24, 'Nama bangunan') : null;
    return (
      <Modal open onClose={onClose} title={title}>
        <p className="text-sm text-muted">Tanah milikmu masih kosong. Pilih bangunan untuk didirikan:</p>
        {reason && <p className="mt-2 rounded-2xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">{reason}</p>}
        <div className="mt-3 space-y-3">
          {groups.map(([cat, list]) => (
            <div key={cat}>
              <div className="mb-1 text-xs font-black text-muted">{CATEGORY_LABEL[cat]}</div>
              <div className="grid grid-cols-2 gap-2">
                {list.map((bt) => {
                  const locked = bt.requiresPerk ? !perks?.[bt.requiresPerk] : false;
                  return (
                    <button
                      key={bt.id}
                      disabled={locked}
                      onClick={() => setPicked(bt.id)}
                      className={`rounded-2xl border p-2 text-left text-xs transition disabled:opacity-40 ${picked === bt.id ? 'border-brand bg-brand/10' : 'border-black/10'}`}
                    >
                      <div className="font-bold">
                        {bt.emoji} {bt.name}
                      </div>
                      <div className="text-muted">
                        {formatCoins(bt.baseCost, CUR)} • +{bt.incomePerLevelPerDay}/hari
                      </div>
                      {locked && <div className="font-semibold text-red-600">Khusus pejabat</div>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {b && (
          <div className="sticky bottom-0 mt-3 space-y-2 bg-surface pt-2">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={28} placeholder={`Nama bangunan (cth. "${b.name} Mas ${me?.username ?? 'Budi'}")`} />
            {nameErr && <div className="text-xs font-semibold text-red-600">{nameErr}</div>}
            <Button
              className="w-full py-4"
              loading={busy === 'build'}
              disabled={!!reason || !!nameErr || (me?.coins ?? 0) < cost}
              onClick={() =>
                run('build', async () => {
                  const r = await api.buildOrUpgrade(session!, plot.plotCode, b.id, name.trim() || null);
                  onPlot(r.plot);
                  onCoins(r.coins);
                  playCoin();
                  toast(`${r.plot.buildingName} berdiri!`, 'success');
                })
              }
            >
              🏗️ Bangun ({formatCoins(cost, CUR)})
            </Button>
          </div>
        )}
      </Modal>
    );
  }

  const bonus = perks?.incomeBonusPct ?? 0;
  const accrued = propertyIncome(WORLD, building, plot.buildingLevel, plot.lastIncomeClaimAt, bonus, now);
  const perDay = Math.floor(building.incomePerLevelPerDay * plot.buildingLevel * (1 + bonus / 100));
  const maxed = plot.buildingLevel >= building.maxLevel;
  const upCost = maxed ? 0 : buildingCost(building, plot.buildingLevel);
  const renameErr = rename ? validateFreeText(rename, 24, 'Nama bangunan') : null;

  return (
    <Modal open onClose={onClose} title={title}>
      <div className="rounded-2xl bg-black/5 p-4">
        <div className="text-lg font-black">
          {building.emoji} {plot.buildingName}
        </div>
        <div className="text-sm">
          <span className="text-amber-500">{'★'.repeat(plot.buildingLevel)}</span>
          <span className="text-black/20">{'★'.repeat(building.maxLevel - plot.buildingLevel)}</span> • {building.name}
        </div>
        <div className="mt-2 text-xs text-muted">
          Pendapatan pasif: <b className="text-ink">{formatCoins(perDay, CUR)}/hari</b>
          {bonus > 0 && ` (bonus ${tier?.shortName} +${bonus}%)`} • terkumpul maks. {WORLD.economy.income.maxAccrualHours} jam
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          loading={busy === 'claim'}
          disabled={accrued < 1}
          onClick={() =>
            run('claim', async () => {
              const r = await api.claimPropertyIncome(session!, plot.plotCode);
              onCoins(r.coins);
              onPlot({ ...plot, lastIncomeClaimAt: new Date().toISOString() });
              playCoin();
              toast(`+${formatCoins(r.total, CUR)} dari ${plot.buildingName}`, 'success');
            })
          }
        >
          💰 Klaim {formatNumber(accrued)}
        </Button>
        <Button
          loading={busy === 'up'}
          disabled={maxed || !!reason || (me?.coins ?? 0) + accrued < upCost}
          onClick={() =>
            run('up', async () => {
              const r = await api.buildOrUpgrade(session!, plot.plotCode, null, null);
              onPlot(r.plot);
              onCoins(r.coins);
              playCoin();
              toast(`${r.plot.buildingName} naik ke Level ${r.plot.buildingLevel}!`, 'success');
            })
          }
        >
          {maxed ? '🏆 Level Maks' : `⬆️ Upgrade (${formatCoins(upCost, CUR)})`}
        </Button>
      </div>
      {reason && <p className="mt-2 text-xs font-semibold text-amber-700">{reason}</p>}

      <div className="mt-3 flex gap-2">
        <input className={`${inputClass} flex-1`} value={rename} onChange={(e) => setRename(e.target.value)} maxLength={28} placeholder="Ganti nama bangunan" />
        <Button
          variant="secondary"
          loading={busy === 'rename'}
          disabled={!rename.trim() || !!renameErr}
          onClick={() =>
            run('rename', async () => {
              onPlot(await api.renameProperty(session!, plot.plotCode, rename));
              setRename('');
              toast('Nama bangunan diperbarui.', 'success');
            })
          }
        >
          Simpan
        </Button>
      </div>
      {renameErr && <div className="mt-1 text-xs font-semibold text-red-600">{renameErr}</div>}
    </Modal>
  );
}
