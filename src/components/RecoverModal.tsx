import { useEffect, useState } from 'react';
import { WORLD } from '../configs';
import { BUSY_MESSAGE, api, normalizeLoginUsername, type MyCitizen, type QuickLoginCheck, type Session } from '../services';
import { Button, Field, Modal, errorMessage, inputClass } from './ui';

type Tab = 'username' | 'ktp';

const pinInput = (value: string, set: (v: string) => void, autoComplete: string) => (
  <input
    className={`${inputClass} font-mono tracking-[0.4em]`}
    value={value}
    onChange={(e) => set(e.target.value.replace(/\D/g, '').slice(0, 6))}
    inputMode="numeric"
    type="password"
    autoComplete={autoComplete}
    placeholder="4–6 digit"
    required
  />
);

/** Masuk KTP: (1) Username → PIN / buat PIN baru, atau (2) Kode KTP + PIN. */
export function RecoverModal({ open, onClose, onRecovered }: { open: boolean; onClose: () => void; onRecovered: (s: Session, pinCreated?: boolean, citizen?: MyCitizen | null) => void }) {
  const [tab, setTab] = useState<Tab>('username');
  const [username, setUsername] = useState('');
  const [check, setCheck] = useState<QuickLoginCheck | null>(null);
  const [ktp, setKtp] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setCheck(null);
    setPin('');
    setPin2('');
    setError(null);
  }, [open]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const done = (s: Session, pinCreated = false, citizen: MyCitizen | null = null) => {
    setUsername('');
    setKtp('');
    setPin('');
    setPin2('');
    setCheck(null);
    onRecovered(s, pinCreated, citizen);
  };

  const checkUsername = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api.quickLoginCheck(username);
      if (r.status === 'not_found') throw new Error(`Username "${normalizeLoginUsername(username)}" tidak ditemukan. Coba username Instagram yang dipakai saat daftar.`);
      if (r.status === 'ambiguous') throw new Error('Ada beberapa warga dengan nama itu. Ketik username Instagram-mu (yang dipakai saat daftar).');
      setCheck(r);
    });
  };

  const submitPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (check?.status === 'needs_pin_setup' && pin !== pin2) return setError('Konfirmasi PIN tidak sama.');
    void run(async () => {
      const r = await api.quickLogin(username, pin);
      done(r.session, r.pinCreated, r.citizen ?? null);
    });
  };

  const submitKtp = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { citizen, ...s } = await api.recoverSession(ktp.trim(), pin);
      done(s, false, citizen ?? null);
    });
  };

  /** Server padat/timeout → tombol yang sama berubah jadi "Coba Lagi" (isian & sesi lokal tetap). */
  const retry = error === BUSY_MESSAGE;
  const tag = check?.citizenNumber ? ` | ${String(check.citizenNumber).padStart(3, '0')}` : '';
  const errorBox = error && <div className="rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>;

  return (
    <Modal open={open} onClose={onClose} title="🔑 Masuk KTP">
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-black/5 p-1 text-sm font-bold">
        {(['username', 'ktp'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t);
              setError(null);
              setPin('');
              setPin2('');
            }}
            className={`rounded-xl py-2 ${tab === t ? 'bg-white text-ink shadow' : 'text-muted'}`}
          >
            {t === 'username' ? '👤 Pakai Username' : '🪪 Kode KTP + PIN'}
          </button>
        ))}
      </div>

      {tab === 'username' && !check && (
        <form onSubmit={checkUsername} className="space-y-4">
          <Field label="Username" hint="Username Instagram yang dipakai saat daftar (tanpa @).">
            <input
              className={inputClass}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username_kamu"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="username"
              required
            />
          </Field>
          {errorBox}
          <Button type="submit" className="w-full" loading={busy} disabled={!normalizeLoginUsername(username)}>
            {retry ? '🔄 Coba Lagi' : 'Cari KTP-ku'}
          </Button>
        </form>
      )}

      {tab === 'username' && check && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 rounded-2xl bg-black/5 px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[10px] font-black tracking-wide text-muted uppercase">KTP ditemukan</div>
              <div className="truncate font-black">
                {check.username}
                {tag}
              </div>
            </div>
            <button type="button" className="shrink-0 text-xs font-semibold text-muted underline" onClick={() => { setCheck(null); setError(null); setPin(''); setPin2(''); }}>
              Ganti
            </button>
          </div>

          {check.status === 'vip_protected' && (
            <div className="rounded-2xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">
              🛡️ Akun ini dilindungi pengaman khusus. Gunakan pemulihan akun (Kode KTP + PIN) atau hubungi admin.
            </div>
          )}

          {(check.status === 'has_pin' || check.status === 'needs_pin_setup') && (
            <form onSubmit={submitPin} className="space-y-4">
              {check.status === 'needs_pin_setup' ? (
                <>
                  <div className="rounded-2xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                    KTP ditemukan! Akunmu belum punya PIN. Buat PIN baru sekarang untuk langsung masuk &amp; mengamankan KTP-mu.
                  </div>
                  <Field label="PIN baru">{pinInput(pin, setPin, 'new-password')}</Field>
                  <Field label="Ulangi PIN">{pinInput(pin2, setPin2, 'new-password')}</Field>
                </>
              ) : (
                <Field label="PIN" hint={check.lockedMinutes ? `Dikunci sementara (±${check.lockedMinutes} menit) karena terlalu banyak salah PIN.` : 'Salah 5x = dikunci 1 jam.'}>
                  {pinInput(pin, setPin, 'current-password')}
                </Field>
              )}
              {errorBox}
              <Button type="submit" className="w-full" loading={busy} disabled={pin.length < 4 || (check.status === 'needs_pin_setup' && pin2.length < 4)}>
                {retry ? '🔄 Coba Lagi' : check.status === 'needs_pin_setup' ? 'Buat PIN & Masuk' : 'Masuk'}
              </Button>
            </form>
          )}
        </div>
      )}

      {tab === 'ktp' && (
        <form onSubmit={submitKtp} className="space-y-4">
          <Field label="Kode KTP" hint={`Contoh: ${WORLD.ktpPrefix}-0001 (tertera di KTP-mu)`}>
            <input
              className={`${inputClass} font-mono uppercase`}
              value={ktp}
              onChange={(e) => setKtp(e.target.value.toUpperCase())}
              placeholder={`${WORLD.ktpPrefix}-0001`}
              autoCapitalize="characters"
              required
            />
          </Field>
          <Field label="PIN Pemulihan">{pinInput(pin, setPin, 'current-password')}</Field>
          {errorBox}
          <Button type="submit" className="w-full" loading={busy} disabled={!ktp || pin.length < 4}>
            {retry ? '🔄 Coba Lagi' : 'Masuk'}
          </Button>
          <p className="text-center text-xs text-muted">PIN diatur dari menu KTP. Salah 5x = dikunci 1 jam.</p>
        </form>
      )}
    </Modal>
  );
}
