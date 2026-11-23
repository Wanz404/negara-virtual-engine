import { useEffect, useState } from 'react';
import { WORLD } from '../configs';
import { findTier } from '../lib/game';
import { formatCitizenNumber, formatCoins, formatRelative } from '../lib/format';
import { playCoin } from '../lib/fx';
import { api, type DonorRow, type MyCitizen, type NewsItem, type PublicCitizen, type Session, type WorldState } from '../services';
import { Avatar } from './Avatar';
import { Button, Modal, errorMessage, inputClass } from './ui';

const CUR = WORLD.currency.code;

const FOLLOW_BADGE: Record<PublicCitizen['followStatus'], { text: string; cls: string }> = {
  pending: { text: 'Menunggu Pelantikan', cls: 'bg-amber-100 text-amber-800' },
  recheck_requested: { text: 'Menunggu Cek Ulang', cls: 'bg-sky-100 text-sky-800' },
  verified: { text: 'Resmi Dilantik ✓', cls: 'bg-emerald-100 text-emerald-800' },
  not_following: { text: 'Warga Gelap ⚠️', cls: 'bg-red-100 text-red-700' },
  impeached: { text: 'Dimakzulkan 🚨', cls: 'bg-gray-200 text-gray-700' },
};

export function CitizenSheet({ citizen, onClose, onLocate }: { citizen: PublicCitizen | null; onClose: () => void; onLocate: (id: string) => void }) {
  if (!citizen) return null;
  const tier = findTier(WORLD, citizen.tierId);
  const badge = FOLLOW_BADGE[citizen.followStatus];
  return (
    <Modal open onClose={onClose} title="👤 Profil Warga">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl p-1" style={{ background: tier.ktpBorder }}>
          <div className="rounded-xl bg-white">
            <Avatar color={citizen.avatarColor} look={tier.look} accessory={citizen.avatarStyle.accessory} size={72} dim={citizen.followStatus === 'impeached'} />
          </div>
        </div>
        <div className="min-w-0">
          <div className="truncate text-2xl font-black">
            {citizen.username} <span className="text-muted">|</span> {formatCitizenNumber(citizen.citizenNumber)}
          </div>
          <div className="font-bold">{citizen.roleTitle}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            <span className="rounded-full px-2 py-0.5 text-[10px] font-black" style={{ background: tier.nametagColor }}>
              {tier.name}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>{badge.text}</span>
          </div>
        </div>
      </div>
      {citizen.statusText && <div className="mt-3 rounded-2xl bg-black/5 p-3 text-sm">💬 “{citizen.statusText}”</div>}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-black/5 p-2">
          <dt className="text-muted">KTP</dt>
          <dd className="font-mono font-bold">{citizen.ktpCode}</dd>
        </div>
        <div className="rounded-xl bg-black/5 p-2">
          <dt className="text-muted">Warga sejak</dt>
          <dd className="font-bold">DAY {citizen.joinedDay}</dd>
        </div>
        <div className="rounded-xl bg-black/5 p-2">
          <dt className="text-muted">Kekayaan</dt>
          <dd className="font-bold">{formatCoins(citizen.coins, CUR)}</dd>
        </div>
        <div className="rounded-xl bg-black/5 p-2">
          <dt className="text-muted">Alamat</dt>
          <dd className="font-bold">{citizen.rtRwAddress}</dd>
        </div>
      </dl>
      <Button variant="secondary" className="mt-3 w-full" onClick={() => onLocate(citizen.id)}>
        🔦 Sorot di peta
      </Button>
    </Modal>
  );
}

/** Detail landmark; Zona Proyek berisi patungan proyek nasional + Top Penyumbang. */
export function LandmarkSheet({
  landmarkId,
  world,
  me,
  session,
  citizens,
  onClose,
  onDonated,
  toast,
}: {
  landmarkId: string | null;
  world: WorldState | null;
  me: MyCitizen | null;
  session: Session | null;
  citizens: PublicCitizen[];
  onClose: () => void;
  onDonated: (coins: number, world: WorldState) => void;
  toast: (m: string, k?: 'info' | 'success' | 'error') => void;
}) {
  const lm = WORLD.landmarks.find((l) => l.id === landmarkId) ?? null;
  const [donors, setDonors] = useState<DonorRow[]>([]);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const project = WORLD.projects.find((p) => p.id === world?.activeProjectId);

  useEffect(() => {
    if (lm?.kind !== 'project_site' || !project) return;
    api.getProjectTopDonors(project.id, 5).then(setDonors).catch(() => setDonors([]));
  }, [lm?.kind, project]);

  if (!lm) return null;
  const president = citizens.find((c) => c.citizenNumber === 1);
  const vice = citizens.find((c) => c.citizenNumber === 2);
  const pct = world && world.activeProjectGoal > 0 ? Math.min(100, (world.activeProjectFunding / world.activeProjectGoal) * 100) : 0;
  const canDonate = !!me && me.followStatus === 'verified' && !world?.activeProjectCompleted;

  return (
    <Modal open onClose={onClose} title={`${lm.emoji} ${lm.name}`}>
      {lm.kind === 'palace' && (
        <div className="space-y-2 text-sm">
          <div className="rounded-2xl bg-amber-50 p-3">
            <div className="text-xs font-bold text-amber-800 uppercase">{WORLD.tiers[0].name}</div>
            <div className="text-lg font-black">{president ? `${president.username} | 001` : 'Kursi #001 masih kosong — daftar sekarang!'}</div>
            {vice && <div className="text-xs text-muted">Didampingi {vice.username} | 002</div>}
          </div>
          {world?.presidentAnnouncement && (
            <div className="rounded-2xl bg-black/5 p-3">
              <div className="text-xs font-bold text-muted uppercase">📢 Pidato terakhir • {formatRelative(world.announcementAt)}</div>
              <div className="font-semibold">“{world.presidentAnnouncement}”</div>
            </div>
          )}
        </div>
      )}
      {lm.kind === 'parliament' && <p className="text-sm text-muted">Kursi #031–#060. Rapat sedang berlangsung… atau mungkin semua sedang tidur. 😴</p>}
      {lm.kind === 'elite_complex' && <p className="text-sm text-muted">Kawasan elit #061–#100. Diskon beli kavling khusus penghuni kompleks ini.</p>}
      {lm.kind === 'shop' && <p className="text-sm text-muted">Buka 24 jam, 7 hari seminggu, termasuk saat kiamat.</p>}
      {lm.kind === 'gate' && <p className="text-sm text-muted">Pintu masuk {WORLD.copy.nationName}. Tamu yang baru datang nongkrong di sini dulu.</p>}
      {lm.kind === 'plaza' && <p className="text-sm text-muted">Pusat kota. Tempat warga & tamu online jalan-jalan.</p>}
      {lm.kind === 'project_site' && project && (
        <div className="space-y-3">
          <div className="rounded-2xl bg-black/5 p-3">
            <div className="font-black">
              {project.emoji} {world?.activeProjectCompleted ? 'Semua proyek nasional selesai!' : project.name}
            </div>
            <div className="text-xs text-muted">{project.description}</div>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-black/10">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 text-xs font-semibold">
              {formatCoins(world?.activeProjectFunding ?? 0, CUR)} / {formatCoins(world?.activeProjectGoal ?? 0, CUR)} ({pct.toFixed(1)}%)
            </div>
          </div>
          {donors.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-black text-muted uppercase">🏆 Top Penyumbang</div>
              <ol className="space-y-1 text-sm">
                {donors.map((d, i) => (
                  <li key={d.citizenId} className="flex justify-between rounded-xl bg-black/5 px-3 py-1.5">
                    <span>
                      {['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`} {d.tag}
                    </span>
                    <b>{formatCoins(d.amount, CUR)}</b>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {canDonate ? (
            <div className="flex gap-2">
              <input className={`${inputClass} flex-1`} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} placeholder={`Jumlah ${CUR}`} />
              <Button
                loading={busy}
                disabled={!amount || Number(amount) < 1 || Number(amount) > (me?.coins ?? 0)}
                onClick={async () => {
                  if (!session) return;
                  setBusy(true);
                  try {
                    const r = await api.donateToProject(session, Number(amount));
                    onDonated(r.coins, r.world);
                    setAmount('');
                    playCoin();
                    toast(r.completedProjectId ? '🎉 Proyek nasional SELESAI berkat sumbanganmu!' : `Terima kasih! ${formatCoins(Number(amount), CUR)} disumbangkan.`, 'success');
                    setDonors(await api.getProjectTopDonors(project.id, 5));
                  } catch (e) {
                    toast(errorMessage(e), 'error');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Patungan
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted">Patungan proyek terbuka untuk warga yang sudah resmi dilantik.</p>
          )}
        </div>
      )}
    </Modal>
  );
}

const NEWS_ICON: Record<string, string> = {
  join: '🆕',
  status: '💬',
  property: '🏗️',
  project: '🚧',
  decree: '📢',
  impeachment: '🚨',
  verification: '✅',
  expansion: '🗺️',
  poll: '🗳️',
  system: 'ℹ️',
};

/** Tombol Megaphone: Pidato Presiden + Breaking News terbaru. */
export function NewsPanel({ open, onClose, news, world }: { open: boolean; onClose: () => void; news: NewsItem[]; world: WorldState | null }) {
  return (
    <Modal open={open} onClose={onClose} title={`📢 ${WORLD.copy.tvName}`}>
      {world?.presidentAnnouncement && (
        <div className="mb-3 rounded-2xl bg-accent/30 p-3">
          <div className="text-[10px] font-black text-muted uppercase">📌 Pidato Negara • {formatRelative(world.announcementAt)}</div>
          <div className="font-bold">“{world.presidentAnnouncement}”</div>
        </div>
      )}
      <ul className="space-y-1.5">
        {news.length === 0 && <li className="text-sm text-muted">Belum ada berita. Jadilah warga pertama!</li>}
        {news.map((n) => (
          <li key={n.id} className="rounded-xl bg-black/5 px-3 py-2 text-sm">
            <span className="mr-1">{NEWS_ICON[n.category] ?? '•'}</span>
            {n.message}
            <div className="text-[10px] text-muted">{formatRelative(n.createdAt)}</div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
