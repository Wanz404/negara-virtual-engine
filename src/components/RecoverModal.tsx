import { useState } from 'react';
import { WORLD } from '../configs';
import { api, type Session } from '../services';
import { Button, Field, Modal, errorMessage, inputClass } from './ui';

export function RecoverModal({ open, onClose, onRecovered }: { open: boolean; onClose: () => void; onRecovered: (s: Session) => void }) {
  const [ktp, setKtp] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await api.recoverSession(ktp.trim(), pin);
      setKtp('');
      setPin('');
      onRecovered(s);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="🔑 Masuk KTP">
      <form onSubmit={submit} className="space-y-4">
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
        <Field label="PIN Pemulihan">
          <input
            className={`${inputClass} font-mono tracking-[0.4em]`}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        {error && <div className="rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
        <Button type="submit" className="w-full" loading={busy} disabled={!ktp || pin.length < 4}>
          Masuk
        </Button>
        <p className="text-center text-xs text-muted">PIN diatur dari menu KTP di perangkat lama. Salah 5x = dikunci 1 jam.</p>
      </form>
    </Modal>
  );
}
