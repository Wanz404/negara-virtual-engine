import { useState } from 'react';
import { SANDBOX_ADMIN_SECRET } from '../services/sandboxAdapter';
import { sandboxApi } from '../services';
import { Button, Modal, errorMessage } from './ui';

/** Alat uji KHUSUS mode sandbox lokal. Tidak pernah tampil di production (Supabase). */
export function DevPanel({
  open,
  onClose,
  onChanged,
  toast,
  meId,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  toast: (m: string, k?: 'info' | 'success' | 'error') => void;
  meId: string | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!sandboxApi) return null;
  const sb = sandboxApi;

  async function run(key: string, fn: () => Promise<string>) {
    setBusy(key);
    try {
      toast(await fn(), 'success');
      onChanged();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="🧪 Sandbox Dev Tools">
      <p className="text-xs text-muted">
        Mode sandbox menyimpan seluruh dunia di <code>localStorage</code> browser ini. Buka beberapa tab untuk melihat Tamu online antar-tab. PIN admin sandbox:{' '}
        <code className="font-bold">{SANDBOX_ADMIN_SECRET}</code> (buka lewat <code>#admin</code>).
      </p>
      <div className="mt-4 grid gap-2">
        <Button variant="secondary" loading={busy === 'seed'} onClick={() => run('seed', async () => `${await sb.seedDemo(20)} warga demo ditambahkan.`)}>
          👥 Seed 20 warga demo
        </Button>
        <Button
          variant="secondary"
          loading={busy === 'worker'}
          onClick={() =>
            run('worker', async () => {
              const r = await sb.simulateWorkerCheck(0.75);
              return `Simulasi worker: ${r.verified} dilantik, ${r.notFollowing} belum follow.`;
            })
          }
        >
          🤖 Simulasi worker cek follow (75% follow)
        </Button>
        <Button
          variant="secondary"
          loading={busy === 'age'}
          onClick={() =>
            run('age', async () => {
              await sb.ageFollowChecks(49);
              return 'Waktu cek follow dimundurkan 49 jam (tombol pemakzulan siap dites).';
            })
          }
        >
          ⏩ Mundurkan waktu cek follow 49 jam
        </Button>
        {meId && (
          <Button variant="secondary" loading={busy === 'coins'} onClick={() => run('coins', async () => `Saldo sekarang ${await sb.grantCoins(meId, 5000)}.`)}>
            💸 Tambah 5.000 saldo ke akunku
          </Button>
        )}
        <Button
          variant="secondary"
          loading={busy === 'income'}
          onClick={() =>
            run('income', async () => {
              await sb.ageIncome(12);
              return 'Waktu klaim properti dimundurkan 12 jam (koin klaim muncul di peta).';
            })
          }
        >
          🪙 Mundurkan pendapatan properti 12 jam
        </Button>
        <Button
          variant="danger"
          loading={busy === 'reset'}
          onClick={() =>
            window.confirm('Hapus seluruh data sandbox dunia ini?') &&
            run('reset', async () => {
              await sb.reset();
              return 'Sandbox direset ke 0 warga.';
            })
          }
        >
          🗑️ Reset sandbox (0 warga)
        </Button>
      </div>
    </Modal>
  );
}
