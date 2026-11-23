import { useCallback, useEffect, useState } from 'react';
import { WORLD } from '../configs';
import { formatRelative } from '../lib/format';
import { api, type LeaderboardRow, type NewsItem, type Poll, type WorldState } from '../services';
import { Button, inputClass } from './ui';

type Run = (key: string, fn: () => Promise<void>) => Promise<void>;

/** Bagian Admin Panel Fase 4: Sidang Warga, moderasi, proyek nasional, pemulihan pejabat, Studio. */
export function AdminExtras({
  secret,
  world,
  news,
  busy,
  run,
  addLog,
  onWorld,
  onOpenStudio,
}: {
  secret: string;
  world: WorldState | null;
  news: NewsItem[];
  busy: string | null;
  run: Run;
  addLog: (l: string) => void;
  onWorld: () => void;
  onOpenStudio: () => void;
}) {
  const [pending, setPending] = useState<Poll[]>([]);
  const [active, setActive] = useState<Poll[]>([]);
  const [question, setQuestion] = useState('');
  const [optionsText, setOptionsText] = useState('');
  const [kind, setKind] = useState<'policy' | 'project'>('policy');
  const [projectId, setProjectId] = useState(world?.activeProjectId ?? WORLD.projects[0]?.id ?? '');
  const [resetFunding, setResetFunding] = useState(true);
  const [plotCode, setPlotCode] = useState('');
  const [impeached, setImpeached] = useState<LeaderboardRow[]>([]);

  const loadPolls = useCallback(async () => {
    const [p, a] = await Promise.all([api.adminListPendingPolls(secret), api.getActivePolls(null)]);
    setPending(p);
    setActive(a);
  }, [secret]);

  const loadImpeached = useCallback(async () => {
    const rows = await api.getLeaderboard('founders', 0, 100);
    setImpeached(rows.filter((r) => r.citizen.followStatus === 'impeached'));
  }, []);

  useEffect(() => {
    void loadPolls().catch(() => {});
    void loadImpeached().catch(() => {});
  }, [loadPolls, loadImpeached]);

  const opts = optionsText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <>
      <section className="rounded-2xl bg-gray-900 p-3 text-white">
        <h3 className="text-sm font-black">🎬 Mode Rekam Reels (9:16)</h3>
        <p className="mt-1 text-xs text-white/70">Bingkai 9:16 tanpa HUD + auto-camera sinematik: Istana → warga baru → bangunan baru → proyek → seluruh kota + CTA.</p>
        <Button className="mt-2 w-full" onClick={onOpenStudio}>
          Buka Creator Studio
        </Button>
      </section>

      <section className="rounded-2xl bg-black/5 p-3">
        <h3 className="text-sm font-black">🗳️ Sidang Warga</h3>
        <input className={`${inputClass} mt-2`} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Pertanyaan voting" maxLength={130} />
        <textarea className={`${inputClass} mt-2 h-20 text-sm`} value={optionsText} onChange={(e) => setOptionsText(e.target.value)} placeholder={'Pilihan, 1 per baris (2–4)'} />
        <div className="mt-2 flex gap-2">
          <select className={`${inputClass} flex-1`} value={kind} onChange={(e) => setKind(e.target.value as 'policy' | 'project')}>
            <option value="policy">Kebijakan</option>
            <option value="project">Proyek berikutnya</option>
          </select>
          <Button
            className="flex-1"
            loading={busy === 'poll'}
            disabled={!question.trim() || opts.length < 2 || opts.length > 4}
            onClick={() =>
              run('poll', async () => {
                await api.adminCreatePoll(secret, question, opts, kind);
                addLog(`🗳️ Sidang dibuka: "${question}"`);
                setQuestion('');
                setOptionsText('');
                await loadPolls();
                onWorld();
              })
            }
          >
            Buka Sidang
          </Button>
        </div>

        {pending.length > 0 && <div className="mt-3 text-xs font-black text-muted uppercase">Menunggu moderasi</div>}
        {pending.map((p) => (
          <div key={p.id} className="mt-1.5 rounded-xl bg-white p-2 text-xs">
            <div className="font-bold">{p.question}</div>
            <div className="text-muted">
              {p.createdByTag} • {p.options.map((o) => o.label).join(' / ')}
            </div>
            <div className="mt-1.5 flex gap-2">
              {(['approve', 'reject'] as const).map((a) => (
                <Button
                  key={a}
                  variant={a === 'approve' ? 'primary' : 'secondary'}
                  className="flex-1 py-1.5 text-xs"
                  loading={busy === `${a}-${p.id}`}
                  onClick={() =>
                    run(`${a}-${p.id}`, async () => {
                      await api.adminModeratePoll(secret, p.id, a);
                      addLog(`${a === 'approve' ? '✅ Disetujui' : '⛔ Ditolak'}: "${p.question}"`);
                      await loadPolls();
                      onWorld();
                    })
                  }
                >
                  {a === 'approve' ? 'Setujui' : 'Tolak'}
                </Button>
              ))}
            </div>
          </div>
        ))}
        {active.length > 0 && <div className="mt-3 text-xs font-black text-muted uppercase">Sedang berjalan</div>}
        {active.map((p) => (
          <div key={p.id} className="mt-1.5 flex items-center gap-2 rounded-xl bg-white p-2 text-xs">
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold">{p.question}</div>
              <div className="text-muted">{p.options.map((o) => `${o.label}: ${o.votes}`).join(' • ')}</div>
            </div>
            <Button
              variant="secondary"
              className="py-1.5 text-xs"
              loading={busy === `close-${p.id}`}
              onClick={() =>
                run(`close-${p.id}`, async () => {
                  await api.adminModeratePoll(secret, p.id, 'close');
                  addLog(`🔒 Sidang ditutup: "${p.question}"`);
                  await loadPolls();
                })
              }
            >
              Tutup
            </Button>
          </div>
        ))}
      </section>

      <section className="rounded-2xl bg-black/5 p-3">
        <h3 className="text-sm font-black">🚧 Proyek Nasional</h3>
        <div className="mt-2 flex gap-2">
          <select className={`${inputClass} flex-1`} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {WORLD.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.emoji} {p.name}
                {world?.completedProjects.includes(p.id) ? ' (selesai)' : ''}
              </option>
            ))}
          </select>
          <Button
            loading={busy === 'project'}
            onClick={() =>
              run('project', async () => {
                await api.adminSetActiveProject(secret, projectId, resetFunding);
                addLog(`🚧 Proyek aktif: ${projectId}`);
                onWorld();
              })
            }
          >
            Aktifkan
          </Button>
        </div>
        <label className="mt-1 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={resetFunding} onChange={(e) => setResetFunding(e.target.checked)} /> Reset dana terkumpul ke 0
        </label>
      </section>

      <section className="rounded-2xl bg-black/5 p-3">
        <h3 className="text-sm font-black">🧹 Moderasi Konten</h3>
        <div className="mt-2 flex gap-2">
          <input className={`${inputClass} flex-1 font-mono uppercase`} value={plotCode} onChange={(e) => setPlotCode(e.target.value.toUpperCase())} placeholder="Kode kavling (R1-A004)" />
          <Button
            variant="secondary"
            loading={busy === 'bname'}
            disabled={!plotCode}
            onClick={() =>
              run('bname', async () => {
                await api.adminModerateContent(secret, 'building_name', plotCode);
                addLog(`🧹 Nama bangunan ${plotCode} direset`);
                setPlotCode('');
                onWorld();
              })
            }
          >
            Reset nama
          </Button>
        </div>
        <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
          {news.slice(0, 25).map((n) => (
            <li key={n.id} className="flex items-start gap-2 rounded-xl bg-white p-2 text-xs">
              <span className="min-w-0 flex-1">
                {n.message}
                <span className="block text-[10px] text-muted">
                  {n.category} • {formatRelative(n.createdAt)}
                </span>
              </span>
              {n.category === 'status' && n.citizenId && (
                <button
                  className="shrink-0 rounded-lg bg-amber-100 px-2 py-1 font-bold text-amber-800"
                  onClick={() =>
                    run(`st-${n.id}`, async () => {
                      await api.adminModerateContent(secret, 'status', n.citizenId!);
                      addLog('🧹 Status warga dikosongkan');
                      onWorld();
                    })
                  }
                >
                  Hapus status
                </button>
              )}
              <button
                aria-label="Hapus berita"
                className="shrink-0 rounded-lg bg-red-100 px-2 py-1 font-bold text-red-700"
                onClick={() =>
                  run(`nw-${n.id}`, async () => {
                    await api.adminModerateContent(secret, 'news', String(n.id));
                    addLog('🗑️ Berita dihapus');
                    onWorld();
                  })
                }
              >
                🗑️
              </button>
            </li>
          ))}
        </ul>
      </section>

      {impeached.length > 0 && (
        <section className="rounded-2xl bg-black/5 p-3">
          <h3 className="text-sm font-black">♻️ Pulihkan Pejabat Dimakzulkan</h3>
          {impeached.map((r) => (
            <div key={r.citizen.id} className="mt-1.5 flex items-center gap-2 rounded-xl bg-white p-2 text-xs">
              <span className="min-w-0 flex-1 truncate">
                <b>
                  {r.citizen.username} | {String(r.citizen.citizenNumber).padStart(3, '0')}
                </b>{' '}
                — {r.citizen.originalRoleTitle ?? r.citizen.roleTitle}
              </span>
              <Button
                variant="secondary"
                className="py-1.5 text-xs"
                loading={busy === `rs-${r.citizen.id}`}
                onClick={() =>
                  run(`rs-${r.citizen.id}`, async () => {
                    await api.adminRestoreCitizen(secret, r.citizen.id);
                    addLog(`♻️ Dipulihkan: ${r.citizen.username}`);
                    await loadImpeached();
                    onWorld();
                  })
                }
              >
                Pulihkan
              </Button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
