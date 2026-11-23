import { useEffect, useState } from 'react';
import { WORLD, type Accessory } from '../configs';
import { normalizeIgUsername, validateDisplayName, validateIgUsername } from '../lib/validation';
import { unlockAudio } from '../lib/fx';
import { api, turnstileRequired, turnstileSiteKey, type RegisterResult } from '../services';
import { Avatar } from './Avatar';
import { Turnstile } from './Turnstile';
import { Button, Field, Modal, errorMessage, inputClass } from './ui';

const ACCESSORY_LABEL: Partial<Record<Accessory, string>> = {
  none: 'Polos',
  cap: 'Topi',
  hat: 'Fedora',
  sunglasses: 'Kacamata',
  helmet: 'Helm',
};

/**
 * Form "Klaim KTP Warga".
 * BLIND REVEAL: form TIDAK PERNAH menampilkan nomor urut yang akan didapat.
 */
export function RegisterModal({
  open,
  onClose,
  onRegistered,
  onOpenRecover,
}: {
  open: boolean;
  onClose: () => void;
  onRegistered: (r: RegisterResult) => void;
  onOpenRecover: () => void;
}) {
  const reg = WORLD.registration;
  const [ig, setIg] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState(reg.avatarColors[0]);
  const [accessory, setAccessory] = useState<Accessory>('none');
  const [token, setToken] = useState<string | null>(null);
  // Token Turnstile sekali pakai: remount widget setelah tiap percobaan agar dapat token baru.
  const [turnstileKey, setTurnstileKey] = useState(0);
  const [gateOpen, setGateOpen] = useState(!reg.softGateFollow);
  const [gateCountdown, setGateCountdown] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (gateCountdown === null) return;
    if (gateCountdown <= 0) {
      setGateOpen(true);
      setGateCountdown(null);
      return;
    }
    const t = setTimeout(() => setGateCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [gateCountdown]);

  const igError = touched ? validateIgUsername(ig, WORLD.igAccountHandle) : null;
  const nameError = validateDisplayName(name, reg.displayNameMaxLength);
  const canSubmit = gateOpen && !submitting && !validateIgUsername(ig, WORLD.igAccountHandle) && !nameError && (!turnstileRequired || !!token);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    unlockAudio();
    if (!canSubmit) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const result = await api.register({
        username: name,
        igUsername: normalizeIgUsername(ig),
        avatarColor: color,
        avatarStyle: { accessory },
        turnstileToken: token,
      });
      setIg('');
      setName('');
      setTouched(false);
      onRegistered(result);
    } catch (err) {
      setServerError(errorMessage(err));
      setToken(null);
      setTurnstileKey((k) => k + 1);
    } finally {
      setSubmitting(false);
    }
  }

  const igUrl = `https://instagram.com/${WORLD.igAccountHandle}`;

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} title={<>🪪 Klaim KTP {WORLD.copy.nationName}</>}>
      <form onSubmit={submit} className="space-y-4">
        {reg.softGateFollow && (
          <div className="rounded-2xl bg-accent/25 p-3">
            <div className="text-xs font-black tracking-wide uppercase">Step 1</div>
            <a
              href={igUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => !gateOpen && setGateCountdown(reg.softGateDelaySeconds)}
              className="mt-1 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-orange-500 px-4 py-2.5 text-sm font-bold text-white"
            >
              Follow @{WORLD.igAccountHandle}
            </a>
            <div className="mt-1 text-center text-xs text-muted">
              {gateOpen ? '✓ Lanjut isi data di bawah' : gateCountdown !== null ? `Membuka form dalam ${gateCountdown}…` : 'Follow dulu untuk membuka form pendaftaran.'}
            </div>
          </div>
        )}

        <fieldset disabled={!gateOpen} className="space-y-4 disabled:opacity-50">
          <Field label="Username Instagram" error={igError} hint="Huruf, angka, titik, garis bawah. Pakai akun pribadimu.">
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 font-bold text-gray-400">@</span>
              <input
                className={`${inputClass} pl-9`}
                value={ig}
                onChange={(e) => setIg(e.target.value.replace(/\s/g, ''))}
                onBlur={() => setTouched(true)}
                placeholder="username_kamu"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                maxLength={31}
                required
              />
            </div>
          </Field>

          <Field label={`Nama panggilan (opsional, maks. ${reg.displayNameMaxLength})`} error={name ? nameError : null}>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="cth. Novi"
              maxLength={reg.displayNameMaxLength + 4}
            />
          </Field>

          <div>
            <span className="mb-1 block text-xs font-bold tracking-wide text-muted uppercase">Gaya avatar</span>
            <div className="flex items-center gap-3">
              <div className="shrink-0 rounded-2xl bg-black/5 p-1">
                <Avatar color={color} look={{ outfit: 'casual', accessory: 'none', accentColor: '#475569' }} accessory={accessory} size={64} />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {reg.avatarColors.map((c) => (
                    <button
                      type="button"
                      key={c}
                      aria-label={`Warna ${c}`}
                      onClick={() => setColor(c)}
                      className={`h-7 w-7 rounded-full ring-offset-2 ${color === c ? 'ring-2 ring-brand' : ''}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {reg.avatarAccessories.map((a) => (
                    <button
                      type="button"
                      key={a}
                      onClick={() => setAccessory(a)}
                      className={`rounded-full px-2.5 py-1 text-xs font-bold ${accessory === a ? 'bg-brand text-white' : 'bg-black/5'}`}
                    >
                      {ACCESSORY_LABEL[a] ?? a}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </fieldset>

        <p className="rounded-2xl bg-black/5 p-3 text-xs leading-relaxed text-muted">
          <b className="text-ink">Satu kali saja.</b> Setelah disimpan, pengecekan follow <b>@{WORLD.igAccountHandle}</b> dilakukan otomatis maksimal 1x24 jam.
          KTP-mu bisa langsung dilihat setelah username Instagram disimpan.
        </p>

        {turnstileRequired && <Turnstile key={turnstileKey} siteKey={turnstileSiteKey} onToken={setToken} />}

        {serverError && <div className="rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700">{serverError}</div>}

        <Button type="submit" className="w-full py-4 text-base" loading={submitting} disabled={!canSubmit}>
          {submitting ? 'Mencetak KTP…' : `🎲 ${WORLD.copy.registerCta} Sekarang`}
        </Button>
        <button type="button" onClick={onOpenRecover} className="w-full text-center text-xs font-semibold text-muted underline">
          Sudah punya KTP? Masuk dengan Kode Pemulihan
        </button>
      </form>
    </Modal>
  );
}
