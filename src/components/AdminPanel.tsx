import { useState } from 'react';
import { WORLD } from '../configs';
import { formatNumber, formatSyncedAt } from '../lib/format';
import { parseFollowersInput, type ParsedFollowers } from '../lib/followersParser';
import { api, type NewsItem, type WorldState } from '../services';
import { AdminExtras } from './AdminExtras';
import { Button, Field, Modal, errorMessage, inputClass } from './ui';

const SECRET_KEY = `nv:${WORLD.worldId}:admin`;

/** Studio hanya terbuka bila PIN admin sudah tervalidasi di tab ini. */
export function hasAdminSession(): boolean {
  return loadSecret() !== '';
}

function loadSecret(): string {
  try {
    return sessionStorage.getItem(SECRET_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * Admin Panel ber-PIN (dibuka lewat URL rahasia #admin).
 * Update Hari/followers, Sync & Verifikasi Followers, Pemakzulan, Sidang Warga, moderasi,
 * proyek nasional, pemulihan pejabat, dan pintu ke Creator Studio (Mode Rekam Reels 9:16).
 */
export function AdminPanel({
  open,
  onClose,
  world,
  news,
  onWorld,
  onOpenStudio,
  toast,
}: {
  open: boolean;
  onClose: () => void;
  world: WorldState | null;
  news: NewsItem[];
  onWorld: () => void;
  onOpenStudio: () => void;
  toast: (m: string, k?: 'info' | 'success' | 'error') => void;
}) {
  const [secret, setSecret] = useState(loadSecret);
  const [authed, setAuthed] = useState(() => loadSecret() !== '');
  const [pinInput, setPinInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [day, setDay] = useState('');
  const [followers, setFollowers] = useState('');
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<ParsedFollowers | null>(null);
  const [total, setTotal] = useState('');
  const [fullList, setFullList] = useState(false);
  const [mode, setMode] = useState<'partial' | 'full'>('partial');
  const [log, setLog] = useState<string[]>([]);

  const addLog = (line: string) => setLog((l) => [`${new Date().toLocaleTimeString('id-ID')} — ${line}`, ...l].slice(0, 30));

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      const msg = errorMessage(e);
      toast(msg, 'error');
      addLog(`❌ ${msg}`);
      if (msg.includes('Akses admin ditolak')) {
        setAuthed(false);
        try {
          sessionStorage.removeItem(SECRET_KEY);
        } catch {
          // abaikan
        }
      }
    } finally {
      setBusy(null);
    }
  }

  async function login(e: React.FormEvent) {
    e.preventDefault();
    await run('login', async () => {
      const ok = await api.adminLogin(pinInput);
      if (!ok) throw new Error('Akses admin ditolak (PIN salah, atau terkunci 15 menit setelah 10x gagal).');
      setSecret(pinInput);
      setAuthed(true);
      setPinInput('');
      try {
        sessionStorage.setItem(SECRET_KEY, pinInput);
      } catch {
        // abaikan
      }
    });
  }

  function onParse(text: string) {
    setRaw(text);
    if (!text.trim()) {
      setParsed(null);
      return;
    }
    const p = parseFollowersInput(text);
    setParsed(p);
    // Ekspor resmi Meta = daftar lengkap; tempelan teks dianggap SEBAGIAN (aman untuk warga lain).
    const full = p.format === 'meta-json';
    setMode(full ? 'full' : 'partial');
    setTotal(full ? String(p.usernames.length) : '');
    if (!full) setFullList(false);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    onParse(text);
    addLog(`📄 ${file.name} dibaca (${formatNumber(text.length)} byte)`);
  }

  async function verify() {
    if (!parsed) return;
    await run('verify', async () => {
      const totalNum = total.trim() ? Math.max(0, Math.floor(Number(total))) : null;
      if (mode === 'partial') {
        const r = await api.adminReportFollowChecks(secret, parsed.usernames, [], totalNum);
        addLog(`✅ Mode sebagian: ${r.verified} dilantik • warga lain tidak diubah`);
        toast(`${r.verified} warga resmi dilantik (warga lain tidak diubah).`, 'success');
        onWorld();
        return;
      }
      const queue = await api.adminGetFollowQueue(secret);
      const followerSet = new Set(parsed.usernames);
      // Kirim hanya irisan antrean ∩ followers (payload kecil walau followers 100rb+),
      // kecuali mode "daftar lengkap" yang perlu seluruh daftar untuk deteksi unfollow.
      const payload = fullList ? parsed.usernames : queue.usernames.filter((u) => followerSet.has(u));
      const r = await api.adminBatchVerify(secret, payload, totalNum, queue.snapshotAt, fullList);
      addLog(
        `✅ Verifikasi: ${r.verified} dilantik, ${r.notFollowing} belum follow${fullList ? `, ${r.unfollowed} unfollow` : ''} • antrean ${queue.usernames.length}`,
      );
      toast(`${r.verified} warga resmi dilantik, ${r.notFollowing} belum follow.`, 'success');
      onWorld();
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="🛠️ Admin Panel" wide>
      {!authed ? (
        <form onSubmit={login} className="space-y-3">
          <Field label="PIN / Admin Secret" hint={api.mode === 'sandbox' ? 'Mode sandbox: PIN default "admin123".' : 'Diatur lewat set_world_secrets() di SQL Editor Supabase.'}>
            <input className={inputClass} type="password" value={pinInput} onChange={(e) => setPinInput(e.target.value)} autoComplete="current-password" required />
          </Field>
          <Button type="submit" className="w-full" loading={busy === 'login'}>
            Masuk
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          <section className="rounded-2xl bg-black/5 p-3">
            <h3 className="text-sm font-black">🌍 Dunia</h3>
            <div className="mt-1 text-xs text-muted">
              DAY {world?.dayNumber} • {formatNumber(world?.igFollowerCount ?? 0)} followers • diperbarui {formatSyncedAt(world?.followersSyncedAt)} •{' '}
              {formatNumber(world?.lastCitizenNumber ?? 0)} terdaftar
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input className={inputClass} inputMode="numeric" placeholder="Hari ke-" value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, ''))} />
              <Button
                variant="secondary"
                loading={busy === 'day'}
                disabled={!day}
                onClick={() =>
                  run('day', async () => {
                    await api.adminUpdateWorld(secret, { dayNumber: Number(day) });
                    addLog(`📅 Hari diubah ke DAY ${day}`);
                    setDay('');
                    onWorld();
                  })
                }
              >
                Simpan Hari
              </Button>
              <input
                className={inputClass}
                inputMode="numeric"
                placeholder="Total followers IG"
                value={followers}
                onChange={(e) => setFollowers(e.target.value.replace(/\D/g, ''))}
              />
              <Button
                variant="secondary"
                loading={busy === 'followers'}
                disabled={!followers}
                onClick={() =>
                  run('followers', async () => {
                    await api.adminUpdateWorld(secret, { igFollowerCount: Number(followers) });
                    addLog(`👥 Followers disinkronkan: ${formatNumber(Number(followers))}`);
                    setFollowers('');
                    onWorld();
                  })
                }
              >
                Sync Followers
              </Button>
            </div>
          </section>

          <section className="rounded-2xl bg-black/5 p-3">
            <h3 className="text-sm font-black">✅ Sync & Verifikasi Followers</h3>
            <p className="mt-1 text-xs text-muted">
              Upload <code>followers_1.json</code> dari Meta Accounts Center (Ekspor informasi → Followers & following, format JSON), array JSON, CSV, atau tempel 1
              username per baris.
            </p>
            <input
              type="file"
              accept=".json,.csv,.txt,application/json,text/plain,text/csv"
              className="mt-2 block w-full text-xs file:mr-3 file:rounded-xl file:border-0 file:bg-brand file:px-3 file:py-2 file:font-bold file:text-white"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <textarea
              className={`${inputClass} mt-2 h-24 font-mono text-xs`}
              placeholder={'username1\nusername2\n…'}
              value={raw.length > 20000 ? `${raw.slice(0, 20000)}\n… (dipotong untuk tampilan)` : raw}
              onChange={(e) => onParse(e.target.value)}
            />
            {parsed && (
              <div className="mt-2 space-y-2 text-xs">
                <div className="font-semibold">
                  Terdeteksi <b>{formatNumber(parsed.usernames.length)}</b> username • format: {parsed.format}
                </div>
                <div className="grid grid-cols-2 items-center gap-2">
                  <span className="text-muted">Total followers (HUD){mode === 'partial' ? ' — kosongkan = tidak diubah' : ''}</span>
                  <input className={inputClass} inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value.replace(/\D/g, ''))} />
                </div>
                <div className="space-y-1.5 rounded-xl bg-white p-2">
                  <label className="flex items-start gap-2">
                    <input type="radio" name="sync-mode" className="mt-0.5" checked={mode === 'partial'} onChange={() => setMode('partial')} />
                    <span>
                      <b>Sebagian (aman)</b> — hanya lantik username di daftar ini. Warga lain <b>tidak diubah</b>.
                    </span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input type="radio" name="sync-mode" className="mt-0.5" checked={mode === 'full'} onChange={() => setMode('full')} />
                    <span>
                      <b>Lengkap</b> (ekspor followers Meta) — warga antrean yang <b>tidak ada</b> di daftar ditandai "Belum Follow".
                    </span>
                  </label>
                  {mode === 'full' && (
                    <>
                      <p className="rounded-lg bg-amber-50 p-1.5 font-semibold text-amber-800">
                        Pakai hanya untuk daftar followers utuh. Daftar parsial akan salah menandai warga lain sebagai warga gelap.
                      </p>
                      <label className="flex items-start gap-2">
                        <input type="checkbox" className="mt-0.5" checked={fullList} onChange={(e) => setFullList(e.target.checked)} />
                        <span>Turunkan juga warga terverifikasi yang sudah unfollow.</span>
                      </label>
                    </>
                  )}
                </div>
                <Button className="w-full" loading={busy === 'verify'} disabled={parsed.usernames.length === 0} onClick={() => void verify()}>
                  Verifikasi Sekarang
                </Button>
              </div>
            )}
          </section>

          <section className="rounded-2xl bg-red-50 p-3">
            <h3 className="text-sm font-black text-red-700">🚨 Makzulkan Pejabat Gelap</h3>
            <p className="mt-1 text-xs text-red-700/80">
              Pejabat #001–#{formatNumber(WORLD.verification.impeachMaxNumber)} berstatus "Belum Follow" lebih dari {WORLD.verification.impeachAfterHours} jam akan turun
              kasta & masuk Breaking News.
            </p>
            <Button
              variant="danger"
              className="mt-2 w-full"
              loading={busy === 'impeach'}
              onClick={() =>
                window.confirm('Makzulkan semua pejabat gelap yang memenuhi syarat?') &&
                run('impeach', async () => {
                  const r = await api.adminImpeach(secret);
                  addLog(r.impeached.length ? `🚨 Dimakzulkan: ${r.impeached.map((x) => `${x.tag} (${x.roleTitle})`).join(', ')}` : '🚨 Tidak ada pejabat yang memenuhi syarat.');
                  toast(`${r.impeached.length} pejabat dimakzulkan.`, r.impeached.length ? 'success' : 'info');
                  onWorld();
                })
              }
            >
              Makzulkan Pejabat Gelap
            </Button>
          </section>

          <AdminExtras secret={secret} world={world} news={news} busy={busy} run={run} addLog={addLog} onWorld={onWorld} onOpenStudio={onOpenStudio} />

          {log.length > 0 && (
            <section className="max-h-40 overflow-y-auto rounded-2xl bg-gray-950 p-3 font-mono text-[11px] text-emerald-300">
              {log.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </section>
          )}

          <button
            className="w-full text-center text-xs font-semibold text-muted underline"
            onClick={() => {
              setAuthed(false);
              setSecret('');
              try {
                sessionStorage.removeItem(SECRET_KEY);
              } catch {
                // abaikan
              }
            }}
          >
            Keluar admin
          </button>
        </div>
      )}
    </Modal>
  );
}
