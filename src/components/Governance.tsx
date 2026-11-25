import { useCallback, useEffect, useState } from 'react';
import { WORLD } from '../configs';
import { effectiveEconomy, findTier } from '../lib/game';
import { formatRelative } from '../lib/format';
import { validateFreeText } from '../lib/validation';
import { isInaugurated } from '../lib/inauguration';
import { api, type MyCitizen, type Poll, type Session, type WorldState } from '../services';
import { Button, Modal, errorMessage, inputClass } from './ui';

const econ = effectiveEconomy(WORLD, api.mode);

export function PollCard({ poll, canVote, onVote, busy }: { poll: Poll; canVote: boolean; onVote: (opt: string) => void; busy: boolean }) {
  const voted = poll.myVote !== null;
  return (
    <div className="rounded-2xl bg-black/5 p-3">
      <div className="text-sm font-black">{poll.question}</div>
      <div className="text-[11px] text-muted">
        {poll.createdByTag ? `Diajukan ${poll.createdByTag}` : 'Diajukan Admin'} • {formatRelative(poll.createdAt)} • {poll.totalVotes} suara
      </div>
      <div className="mt-2 space-y-1.5">
        {poll.options.map((o) => {
          const pct = poll.totalVotes ? Math.round((o.votes / poll.totalVotes) * 100) : 0;
          const mine = poll.myVote === o.id;
          const showResult = voted || !canVote;
          return (
            <button
              key={o.id}
              disabled={!canVote || voted || busy}
              onClick={() => onVote(o.id)}
              className={`relative w-full overflow-hidden rounded-xl border px-3 py-2 text-left text-sm font-semibold disabled:cursor-default ${mine ? 'border-brand' : 'border-black/10'} bg-white`}
            >
              {showResult && <span className="absolute inset-y-0 left-0 bg-brand/15" style={{ width: `${pct}%` }} />}
              <span className="relative flex justify-between gap-2">
                <span>
                  {mine && '✓ '}
                  {o.label}
                </span>
                {showResult && (
                  <span className="text-muted">
                    {pct}% ({o.votes})
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Sidang Warga (voting 1 warga sah = 1 suara) + Panel Pejabat (pidato & usulan voting). */
export function GovernancePanel({
  open,
  onClose,
  me,
  session,
  world,
  onWorld,
  toast,
}: {
  open: boolean;
  onClose: () => void;
  me: MyCitizen | null;
  session: Session | null;
  world: WorldState | null;
  onWorld: (w: WorldState) => void;
  toast: (m: string, k?: 'info' | 'success' | 'error') => void;
}) {
  const perks = me ? findTier(WORLD, me.tierId).perks : null;
  const isOfficial = !!perks && (perks.canAnnounce || perks.canProposePoll || perks.canCreatePoll);
  const [tab, setTab] = useState<'sidang' | 'pejabat'>('sidang');
  const [polls, setPolls] = useState<Poll[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [speech, setSpeech] = useState('');
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);

  const load = useCallback(async () => {
    try {
      setPolls(await api.getActivePolls(session));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }, [session, toast]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

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

  const canVote = !!me && (isInaugurated(me) || !WORLD.economy.requireVerified.vote);
  const verifiedGov = !!me && (isInaugurated(me) || !WORLD.economy.requireVerified.governance);
  const speechErr = speech ? validateFreeText(speech, econ.announcementMaxLength, 'Pidato') : null;
  const filledOpts = options.map((o) => o.trim()).filter(Boolean);
  const pollErr = question ? validateFreeText(question, 120, 'Pertanyaan') : null;

  return (
    <Modal open={open} onClose={onClose} title="🏛️ Pemerintahan & Sidang Warga">
      {isOfficial && (
        <div className="mb-3 flex gap-1">
          {(['sidang', 'pejabat'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${tab === t ? 'bg-brand text-white' : 'bg-black/5'}`}>
              {t === 'sidang' ? '🗳️ Sidang Warga' : '📢 Panel Pejabat'}
            </button>
          ))}
        </div>
      )}

      {tab === 'sidang' || !isOfficial ? (
        <div className="space-y-3">
          {!canVote && (
            <p className="rounded-2xl bg-amber-50 p-3 text-xs font-semibold text-amber-800">
              {me ? 'Hak suara terbuka setelah kamu resmi dilantik (verifikasi follow).' : 'Daftar jadi warga untuk ikut voting.'}
            </p>
          )}
          {polls.length === 0 && <p className="py-6 text-center text-sm text-muted">Belum ada sidang warga yang aktif.</p>}
          {polls.map((p) => (
            <PollCard
              key={p.id}
              poll={p}
              canVote={canVote}
              busy={busy === p.id}
              onVote={(opt) =>
                run(p.id, async () => {
                  const updated = await api.castVote(session!, p.id, opt);
                  setPolls((list) => list.map((x) => (x.id === p.id ? updated : x)));
                  toast('Suaramu tercatat!', 'success');
                })
              }
            />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {!verifiedGov && <p className="rounded-2xl bg-amber-50 p-3 text-xs font-semibold text-amber-800">Hak pemerintahan aktif setelah kamu resmi dilantik.</p>}
          {perks?.canAnnounce && (
            <section className="rounded-2xl bg-black/5 p-3">
              <h3 className="text-sm font-black">📢 Pidato / Pengumuman Negara</h3>
              <p className="text-xs text-muted">Ter-pin di {WORLD.copy.tvName} untuk semua warga.</p>
              <textarea className={`${inputClass} mt-2 h-20`} value={speech} onChange={(e) => setSpeech(e.target.value)} maxLength={econ.announcementMaxLength + 20} />
              <div className="flex justify-between text-xs">
                <span className="font-semibold text-red-600">{speechErr}</span>
                <span className="text-muted">
                  {[...speech].length}/{econ.announcementMaxLength}
                </span>
              </div>
              <Button
                className="mt-2 w-full"
                loading={busy === 'speech'}
                disabled={!speech.trim() || !!speechErr || !verifiedGov}
                onClick={() =>
                  run('speech', async () => {
                    onWorld(await api.postAnnouncement(session!, speech));
                    setSpeech('');
                    toast('Pidato tayang di Breaking News!', 'success');
                  })
                }
              >
                Umumkan
              </Button>
            </section>
          )}
          {(perks?.canProposePoll || perks?.canCreatePoll) && (
            <section className="rounded-2xl bg-black/5 p-3">
              <h3 className="text-sm font-black">🗳️ Ajukan Voting Kebijakan</h3>
              <p className="text-xs text-muted">{perks.canCreatePoll ? 'Langsung aktif untuk rakyat.' : 'Masuk antrean moderasi admin sebelum tayang.'}</p>
              <input className={`${inputClass} mt-2`} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder='cth. "Ubah warna Tugu jadi pink?"' maxLength={130} />
              {pollErr && <div className="text-xs font-semibold text-red-600">{pollErr}</div>}
              <div className="mt-2 space-y-1.5">
                {options.map((o, i) => (
                  <input
                    key={i}
                    className={inputClass}
                    value={o}
                    maxLength={40}
                    placeholder={`Pilihan ${String.fromCharCode(65 + i)}`}
                    onChange={(e) => setOptions((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                {options.length < 4 && (
                  <Button variant="ghost" className="flex-1" onClick={() => setOptions((l) => [...l, ''])}>
                    + Pilihan
                  </Button>
                )}
                <Button
                  className="flex-1"
                  loading={busy === 'poll'}
                  disabled={!question.trim() || !!pollErr || filledOpts.length < 2 || !verifiedGov}
                  onClick={() =>
                    run('poll', async () => {
                      const p = await api.proposePoll(session!, question, filledOpts);
                      setQuestion('');
                      setOptions(['', '']);
                      toast(p.status === 'active' ? 'Sidang warga dibuka!' : 'Usulan dikirim ke admin untuk moderasi.', 'success');
                      void load();
                    })
                  }
                >
                  Ajukan
                </Button>
              </div>
            </section>
          )}
          {world?.presidentAnnouncement && (
            <p className="text-xs text-muted">
              Pidato aktif: “{world.presidentAnnouncement}” • {formatRelative(world.announcementAt)}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
