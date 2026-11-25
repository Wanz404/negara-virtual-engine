import { useEffect, useState } from 'react';
import { WORLD } from '../configs';
import type { Accessory } from '../configs/types';
import { findTier } from '../lib/game';
import { formatDuration } from '../lib/format';
import { NAME_EDIT_COOLDOWN_MS, PROFILE_NAME_MAX, cleanProfileText, validateProfileName } from '../lib/validation';
import { api, type MyCitizen, type ProfilePatch, type Session } from '../services';
import { Avatar } from './Avatar';
import { Button, errorMessage, inputClass } from './ui';

const ACCESSORY_LABEL: Partial<Record<Accessory, string>> = {
  none: 'Polos',
  cap: 'Topi',
  hat: 'Fedora',
  sunglasses: 'Kacamata',
  helmet: 'Helm',
};

/** Sisa cooldown ganti nama (ms). 0 = boleh ganti. */
export function nameCooldownLeft(me: MyCitizen, now = Date.now()): number {
  if (!me.nameUpdatedAt) return 0;
  return Math.max(0, new Date(me.nameUpdatedAt).getTime() + NAME_EDIT_COOLDOWN_MS - now);
}

/**
 * Form Edit Profil: nama tampilan (2–24 karakter, 1x / 24 jam) + warna & aksesori avatar.
 * Nomor kursi, jabatan, kasta, ring, tanggal gabung & status verifikasi DIKUNCI server (RPC tidak
 * menerima field tersebut sama sekali).
 */
export function EditProfileForm({
  me,
  session,
  onSaved,
  onCancel,
  toast,
}: {
  me: MyCitizen;
  session: Session;
  onSaved: (c: MyCitizen) => void;
  onCancel: () => void;
  toast: (m: string, k?: 'info' | 'success' | 'error') => void;
}) {
  const reg = WORLD.registration;
  const tier = findTier(WORLD, me.tierId);
  const [name, setName] = useState(me.username);
  const [color, setColor] = useState(me.avatarColor);
  const [accessory, setAccessory] = useState<Accessory>(me.avatarStyle?.accessory ?? 'none');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const cooldown = nameCooldownLeft(me, now);
  const cleaned = cleanProfileText(name);
  const nameChanged = cleaned !== me.username;
  const nameError = nameChanged ? validateProfileName(name) : null;
  const colorChanged = color !== me.avatarColor;
  const accChanged = accessory !== (me.avatarStyle?.accessory ?? 'none');
  const dirty = nameChanged || colorChanged || accChanged;
  const blocked = (nameChanged && (!!nameError || cooldown > 0)) || !dirty;

  async function save() {
    const patch: ProfilePatch = {};
    if (nameChanged) patch.displayName = cleaned;
    if (colorChanged) patch.avatarColor = color;
    if (accChanged) patch.accessory = accessory;
    setBusy(true);
    try {
      const c = await api.updateProfile(session, patch);
      onSaved(c);
      toast(nameChanged ? `Nama diganti jadi "${c.username}". KTP, peta, dashboard & chat ikut diperbarui.` : 'Tampilan avatar diperbarui.', 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-2xl bg-white p-3 ring-1 ring-black/10">
      <label className="block">
        <span className="mb-1 flex items-center justify-between text-xs font-bold tracking-wide text-muted uppercase">
          Nama tampilan
          <span className="tabular-nums">
            {[...cleaned].length}/{PROFILE_NAME_MAX}
          </span>
        </span>
        <input
          className={`${inputClass} ${nameError ? 'border-red-400' : ''}`}
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, PROFILE_NAME_MAX + 8))}
          disabled={cooldown > 0}
          maxLength={PROFILE_NAME_MAX + 8}
          autoComplete="off"
          placeholder="Nama warga"
        />
        {cooldown > 0 ? (
          <span className="mt-1 block rounded-xl bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800">
            ⏳ Nama baru saja diganti. Kamu bisa ganti lagi dalam <b>{formatDuration(cooldown)}</b> (maks. 1x / 24 jam).
          </span>
        ) : nameError ? (
          <span className="mt-1 block text-xs font-semibold text-red-600">{nameError}</span>
        ) : (
          <span className="mt-1 block text-xs text-muted">2–{PROFILE_NAME_MAX} karakter. Nama hanya bisa diganti 1x per 24 jam.</span>
        )}
      </label>

      <div>
        <span className="mb-1 block text-xs font-bold tracking-wide text-muted uppercase">Tampilan karakter</span>
        <div className="flex items-center gap-3">
          <div className="shrink-0 rounded-2xl bg-black/5 p-1">
            <Avatar color={color} look={tier.look} accessory={accessory} size={60} />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {reg.avatarColors.map((c) => (
                <button
                  type="button"
                  key={c}
                  aria-label={`Warna ${c}`}
                  onClick={() => setColor(c)}
                  className={`tactile h-7 w-7 rounded-full ring-offset-2 ${color === c ? 'ring-2 ring-brand' : ''}`}
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
                  className={`tactile rounded-full px-2.5 py-1 text-xs font-bold ${accessory === a ? 'bg-brand text-white' : 'bg-black/5'}`}
                >
                  {ACCESSORY_LABEL[a] ?? a}
                </button>
              ))}
            </div>
            {tier.look.accessory !== 'none' && <div className="text-[10px] text-muted">Aksesori jabatan ({tier.shortName}) tetap tampil di peta.</div>}
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-black/5 px-2.5 py-2 text-[11px] leading-relaxed text-muted">
        🔒 <b className="text-ink">Dikunci sistem:</b> nomor kursi, jabatan, kasta/tier, ring/zona, tanggal bergabung & status verifikasi follow.
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onCancel} disabled={busy}>
          Batal
        </Button>
        <Button className="flex-1" loading={busy} disabled={blocked} onClick={() => void save()}>
          💾 Simpan
        </Button>
      </div>
    </div>
  );
}
