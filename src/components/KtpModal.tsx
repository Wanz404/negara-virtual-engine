import { useEffect, useState } from 'react';
import { WORLD } from '../configs';
import { effectiveEconomy, nextAvailableAt } from '../lib/game';
import { formatDuration, formatRelative } from '../lib/format';
import { normalizeIgUsername, validateIgUsername } from '../lib/validation';
import { ktpFileName, renderKtpCanvas } from '../lib/ktpCanvas';
import { api, type MyCitizen, type Session } from '../services';
import { EditProfileForm } from './EditProfile';
import { inaugurationBadge, takeConfettiTicket } from '../lib/inauguration';
import { GoldConfetti } from './Inauguration';
import { KtpCardView } from './KtpCardView';
import { Button, Modal, errorMessage, inputClass } from './ui';

const econ = effectiveEconomy(WORLD, api.mode);

const STATUS_LINE: Record<MyCitizen['followStatus'], { text: string; cls: string }> = {
  pending: { text: 'menunggu verifikasi • dicek otomatis 1x24 jam', cls: 'bg-amber-100 text-amber-800' },
  recheck_requested: { text: 'cek ulang diminta • masuk antrean prioritas', cls: 'bg-sky-100 text-sky-800' },
  verified: { text: 'Terverifikasi ✓', cls: 'bg-emerald-100 text-emerald-800' },
  not_following: { text: 'Belum Follow ⚠️', cls: 'bg-red-100 text-red-700' },
  impeached: { text: 'Dimakzulkan 🚨', cls: 'bg-gray-200 text-gray-700' },
};

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Kartu KTP virtual (gaya identik dengan export PNG di lib/ktpCanvas.ts). */
export const KtpCard = KtpCardView;

export function KtpModal({
  open,
  onClose,
  me,
  session,
  ownedPlots,
  onUpdated,
  onLogout,
  toast,
}: {
  open: boolean;
  onClose: () => void;
  me: MyCitizen;
  session: Session;
  ownedPlots: number;
  onUpdated: (c: MyCitizen) => void;
  onLogout: () => void;
  toast: (m: string, k?: 'info' | 'success' | 'error') => void;
}) {
  const now = useNow();
  const [editing, setEditing] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [newIg, setNewIg] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const status = STATUS_LINE[me.followStatus];
  const recheckAt = nextAvailableAt(me.followRecheckRequestedAt, econ.recheckCooldownMinutes);
  const igChangeAt = nextAvailableAt(me.igChangedAt, econ.igChangeCooldownMinutes);
  const newIgError = newIg ? validateIgUsername(newIg, WORLD.igAccountHandle) : null;

  const [preview, setPreview] = useState<string | null>(null);
  // Pratinjau PNG lama dibuang saat nama/tampilan berubah → Simpan PNG berikutnya pakai data terbaru.
  useEffect(() => setPreview(null), [me.username, me.avatarColor, me.avatarStyle?.accessory, me.topProperty]);
  const inInstagram = typeof navigator !== 'undefined' && /Instagram|FBAN|FBAV/i.test(navigator.userAgent);

  // Konfeti emas: hanya Perintis 1K (#0001–#1000), hanya sekali per perangkat saat pertama buka E-KTP.
  const [confetti, setConfetti] = useState(false);
  useEffect(() => {
    if (open && inaugurationBadge(me.citizenNumber, me.followStatus)?.tier === 'pioneer' && takeConfettiTicket()) setConfetti(true);
  }, [open, me.citizenNumber]);

  /**
   * Fallback berlapis (browser IG sering memblokir <a download>):
   *  1) Web Share API dengan file PNG  2) <a download> standar  3) pratinjau <img> untuk tekan-tahan → Simpan Gambar.
   */
  async function saveKtp(preferShare: boolean) {
    const canvas = renderKtpCanvas(me, ownedPlots);
    setPreview(canvas.toDataURL('image/png'));
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Gagal membuat PNG.'))), 'image/png'));
    const file = new File([blob], ktpFileName(me), { type: 'image/png' });
    const text = `Aku ${me.roleTitle} ${WORLD.copy.nationName} (#${me.citizenNumber})! Klaim KTP-mu di link bio @${WORLD.igAccountHandle}`;

    if ((preferShare || inInstagram) && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `KTP ${WORLD.copy.nationName}`, text });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        // lanjut ke fallback berikutnya
      }
    }
    if (!inInstagram) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = ktpFileName(me);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('KTP PNG diunduh. Pamerkan di IG Story!', 'success');
    } else {
      toast('Tekan & tahan gambar KTP di bawah, lalu pilih Simpan Gambar.', 'info');
    }
  }

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="🪪 KTP Virtual-ku">
      {confetti && <GoldConfetti onDone={() => setConfetti(false)} />}
      <KtpCard me={me} ownedPlots={ownedPlots} />
      <p className="mt-2 text-center text-[11px] font-semibold text-muted">📸 Screenshot kartu di atas, atau simpan PNG versi Story (9:16) di bawah.</p>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button variant="secondary" loading={busy === 'png'} onClick={() => run('png', () => saveKtp(false))}>
          ⬇️ Simpan PNG
        </Button>
        <Button loading={busy === 'share'} onClick={() => run('share', () => saveKtp(true))}>
          📤 Bagikan ke Story
        </Button>
      </div>

      {preview && (
        <div className="mt-3 rounded-2xl bg-black/5 p-3">
          {/* Gambar PNG asli: di browser IG, "tekan & tahan → Simpan Gambar" bekerja pada <img> ini. */}
          <img src={preview} alt={`KTP ${me.username} | ${me.citizenNumber}`} className="mx-auto w-full max-w-[260px] rounded-xl shadow-lg" />
          <p className="mt-2 text-center text-xs font-semibold text-muted">
            Kalau tombol download tidak jalan di browser IG, <b className="text-ink">tekan &amp; tahan gambar KTP di atas</b> lalu pilih{' '}
            <b className="text-ink">Simpan Gambar</b> (atau screenshot).
          </p>
        </div>
      )}

      <section className="mt-4 rounded-2xl bg-black/5 p-3">
        <div className="text-[10px] font-black tracking-wide text-muted uppercase">Instagram tertaut</div>
        <div className="truncate font-bold">@{me.igUsername}</div>
        <span className={`mt-1 inline-block rounded-full px-2.5 py-1 text-[11px] font-bold ${status.cls}`}>{status.text}</span>
        {me.followCheckedAt && <div className="mt-1 text-[11px] text-muted">Terakhir dicek {formatRelative(me.followCheckedAt, now)}</div>}

        {me.followStatus === 'not_following' && (
          <div className="mt-2 rounded-xl bg-red-50 p-2.5 text-xs text-red-700">
            Akun <b>@{me.igUsername}</b> belum terdeteksi follow <b>@{WORLD.igAccountHandle}</b>. Follow dulu lalu klik <b>Cek Ulang</b> atau <b>Ganti Instagram</b>.
          </div>
        )}
        {me.followStatus === 'pending' && (
          <div className="mt-2 text-xs text-muted">
            Sambil menunggu, kamu sudah bisa kerja harian & pamer KTP. Beli tanah, patungan, voting & hak pemerintahan terbuka setelah resmi dilantik.
          </div>
        )}

        {editing ? (
          <div className="mt-3 space-y-2">
            <input
              className={inputClass}
              value={newIg}
              onChange={(e) => setNewIg(e.target.value.replace(/\s/g, ''))}
              placeholder="username_instagram_baru"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            {newIgError && <div className="text-xs font-semibold text-red-600">{newIgError}</div>}
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setEditing(false)}>
                Batal
              </Button>
              <Button
                className="flex-1"
                loading={busy === 'ig'}
                disabled={!newIg || !!newIgError}
                onClick={() =>
                  run('ig', async () => {
                    const c = await api.updateInstagram(session, normalizeIgUsername(newIg));
                    onUpdated(c);
                    setEditing(false);
                    setNewIg('');
                    toast('Instagram diperbarui. Status follow kembali menunggu verifikasi.', 'success');
                  })
                }
              >
                Simpan
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              variant={profileOpen ? 'primary' : 'secondary'}
              className={`px-2 ${me.followStatus === 'impeached' ? 'col-span-2' : ''}`}
              onClick={() => setProfileOpen((o) => !o)}
              aria-expanded={profileOpen}
            >
              👤 Edit Profil
            </Button>
            {me.followStatus !== 'impeached' && (
              <Button variant="secondary" className="px-2" disabled={igChangeAt > now} onClick={() => setEditing(true)}>
                ✏️ Ganti Instagram{igChangeAt > now ? ` (${formatDuration(igChangeAt - now)})` : ''}
              </Button>
            )}
            {me.followStatus !== 'impeached' && me.followStatus !== 'verified' && (
                <Button
                  variant="secondary"
                  className="col-span-2"
                  loading={busy === 'recheck'}
                  disabled={recheckAt > now}
                  onClick={() =>
                    run('recheck', async () => {
                      onUpdated(await api.requestFollowRecheck(session));
                      toast('Masuk antrean prioritas cek follow berikutnya.', 'success');
                    })
                  }
                >
                  🔄 Cek Ulang{recheckAt > now ? ` (${formatDuration(recheckAt - now)})` : ''}
                </Button>
            )}
          </div>
        )}
        {profileOpen && !editing && (
          <EditProfileForm
            me={me}
            session={session}
            toast={toast}
            onCancel={() => setProfileOpen(false)}
            onSaved={(c) => {
              onUpdated(c);
              setProfileOpen(false);
            }}
          />
        )}
      </section>

      <section className="mt-3 rounded-2xl bg-black/5 p-3">
        <div className="text-[10px] font-black tracking-wide text-muted uppercase">Kode Pemulihan (pindah HP / browser)</div>
        <div className="mt-1 text-xs text-muted">
          Masuk lagi di perangkat lain dengan <b className="font-mono text-ink">{me.ktpCode}</b> + PIN.{' '}
          {me.hasRecoveryPin ? '✓ PIN sudah diatur.' : 'PIN belum diatur.'}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            className={`${inputClass} flex-1 font-mono tracking-[0.4em]`}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="4–6 digit"
            inputMode="numeric"
            type="password"
            autoComplete="new-password"
          />
          <Button
            loading={busy === 'pin'}
            disabled={pin.length < 4}
            onClick={() =>
              run('pin', async () => {
                await api.setRecoveryPin(session, pin);
                setPin('');
                onUpdated({ ...me, hasRecoveryPin: true });
                toast('PIN pemulihan disimpan.', 'success');
              })
            }
          >
            {me.hasRecoveryPin ? 'Ganti PIN' : 'Atur PIN'}
          </Button>
        </div>
      </section>

      <button
        className="mt-4 w-full text-center text-xs font-semibold text-muted underline"
        onClick={() => {
          if (!me.hasRecoveryPin && !window.confirm('Kamu belum mengatur PIN pemulihan. Keluar sekarang berarti KTP ini tidak bisa dibuka lagi di perangkat ini. Lanjut?')) return;
          onLogout();
        }}
      >
        Keluar dari perangkat ini
      </button>
    </Modal>
  );
}
