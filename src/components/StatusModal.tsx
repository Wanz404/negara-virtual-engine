import { useState } from 'react';
import { WORLD } from '../configs';
import { effectiveEconomy } from '../lib/game';
import { validateFreeText } from '../lib/validation';
import { api, type MyCitizen, type Session } from '../services';
import { Button, Modal, errorMessage, inputClass } from './ui';

const econ = effectiveEconomy(WORLD, api.mode);

export function StatusModal({
  open,
  onClose,
  session,
  onUpdated,
  toast,
}: {
  open: boolean;
  onClose: () => void;
  session: Session;
  onUpdated: (c: MyCitizen) => void;
  toast: (m: string, k?: 'info' | 'success' | 'error') => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const err = text ? validateFreeText(text, econ.statusMaxLength, 'Status') : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onUpdated(await api.postStatus(session, text));
      setText('');
      toast(`Status tayang di ${WORLD.copy.tvName}!`, 'success');
      onClose();
    } catch (e2) {
      toast(errorMessage(e2), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`💬 Update Status • ${WORLD.copy.tvName}`}>
      <form onSubmit={submit} className="space-y-3">
        <input
          className={inputClass}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={econ.statusMaxLength + 10}
          placeholder="Tulis 1 kalimat pendek…"
          autoFocus
        />
        <div className="flex justify-between text-xs">
          <span className="font-semibold text-red-600">{err}</span>
          <span className="text-muted">
            {[...text].length}/{econ.statusMaxLength}
          </span>
        </div>
        <Button type="submit" className="w-full" loading={busy} disabled={!text.trim() || !!err}>
          Tayangkan
        </Button>
      </form>
    </Modal>
  );
}
