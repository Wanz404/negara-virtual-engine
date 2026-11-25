import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WORLD } from './configs';
import { effectiveEconomy, findTier, nextAvailableAt } from './lib/game';
import { formatCitizenTag, formatCoins, formatDuration } from './lib/format';
import { installAudioUnlock, playCoin, unlockAudio } from './lib/fx';
import type { MapData, TapTarget } from './engine';
import {
  api,
  devToolsEnabled,
  guestTag,
  isSandbox,
  loadSession,
  saveSession,
  type MyCitizen,
  type NewsItem,
  type Plot,
  type PresenceMember,
  type PublicCitizen,
  type RegisterResult,
  type Session,
  type WorldState,
} from './services';
import { AdminPanel, hasAdminSession } from './components/AdminPanel';
import { CreatorStudio } from './components/CreatorStudio';
import { GovernancePanel } from './components/Governance';
import { Leaderboard } from './components/Leaderboard';
import { DevPanel } from './components/DevPanel';
import { EmotePicker, FloatingEmotes, useEmotes } from './components/Emotes';
import { HudButton, MuteToggle } from './components/GameHud';
import { ChatSheet, ChatTicker, useGlobalChat } from './components/GlobalChat';
import { Hud } from './components/Hud';
import { CitizenSheet, LandmarkSheet, NewsPanel } from './components/InfoSheets';
import { KtpModal } from './components/KtpModal';
import { MapView, type MapViewHandle } from './components/MapView';
import { NewsTicker } from './components/NewsTicker';
import { PlotSheet } from './components/PlotSheet';
import { RecoverModal } from './components/RecoverModal';
import { RegisterModal } from './components/RegisterModal';
import { RevealOverlay } from './components/RevealOverlay';
import { StatusModal } from './components/StatusModal';
import { Button, ToastStack, errorMessage, useToasts } from './components/ui';

const econ = effectiveEconomy(WORLD, api.mode);
const POLL_WORLD_MS = 45_000;
const POLL_MAP_MS = 60_000;
const RING_STALE_MS = 45_000;

type ModalName = 'register' | 'recover' | 'ktp' | 'status' | 'admin' | 'dev' | 'news' | 'leaderboard' | 'gov' | 'chat' | null;
type Sheet = { type: 'plot'; code: string } | { type: 'citizen'; id: string } | { type: 'landmark'; id: string } | null;

function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export default function App() {
  const { toasts, push: toast } = useToasts();
  const [world, setWorld] = useState<WorldState | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [citizens, setCitizens] = useState<PublicCitizen[]>([]);
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const [session, setSession] = useState<Session | null>(loadSession);
  const [me, setMe] = useState<MyCitizen | null>(null);
  const [myPlotCount, setMyPlotCount] = useState(0);
  const [ownedPlots, setOwnedPlots] = useState<Plot[]>([]);
  const [modal, setModal] = useState<ModalName>(() => (location.hash === '#admin' || (location.hash === '#studio' && !hasAdminSession()) ? 'admin' : null));
  const [studio, setStudio] = useState(() => location.hash === '#studio' && hasAdminSession());
  const [extraCitizens, setExtraCitizens] = useState<PublicCitizen[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [tappedPlot, setTappedPlot] = useState<Plot | null>(null);
  const [reveal, setReveal] = useState<MyCitizen | null>(null);
  const [floatReward, setFloatReward] = useState<{ id: number; text: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const mapRef = useRef<MapViewHandle>(null);
  const ringCache = useRef(new Map<number, { plots: Plot[]; at: number }>());
  const visibleRings = useRef<number[]>([1]);
  const now = useNow();

  // Upgrade v2: Global Chat realtime + Emote broadcast
  const chat = useGlobalChat();
  const emotes = useEmotes(me, mapRef);
  const [chatSeenId, setChatSeenId] = useState(0);
  const chatPrimed = useRef(false);
  const lastChatId = chat.messages[chat.messages.length - 1]?.id ?? 0;
  useEffect(() => {
    // Pesan lama yang sudah ada saat app dibuka tidak dihitung "belum dibaca".
    if (!chatPrimed.current && chat.ready) {
      chatPrimed.current = true;
      setChatSeenId(lastChatId);
    }
    if (modal === 'chat') setChatSeenId(lastChatId);
  }, [chat.ready, modal, lastChatId]);
  const chatUnread = chat.messages.filter((m) => m.id > chatSeenId && m.citizenId !== me?.id).length;
  useEffect(() => installAudioUnlock(), []);

  // ---------------------------------------------------------------------------
  // Data (polling ringan, hemat kuota free tier)
  // ---------------------------------------------------------------------------
  const refreshWorld = useCallback(async () => {
    try {
      const [w, n] = await Promise.all([api.getWorldState(), api.getNews(30)]);
      setWorld(w);
      setNews(n);
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, []);

  const refreshMap = useCallback(async () => {
    try {
      setCitizens(await api.getMapCitizens(session?.citizenId ?? null, 120));
    } catch {
      // peta tetap tampil dengan data sebelumnya
    }
  }, [session?.citizenId]);

  const publishPlots = useCallback(() => {
    setOwnedPlots([...ringCache.current.values()].flatMap((v) => v.plots));
  }, []);

  /** Ambil kavling ber-pemilik hanya untuk ring yang terlihat kamera (dan sudah basi). */
  const loadRings = useCallback(
    async (rings: number[], force = false) => {
      const stale = rings.filter((r) => force || !ringCache.current.has(r) || Date.now() - ringCache.current.get(r)!.at > RING_STALE_MS);
      if (stale.length === 0) return;
      try {
        const plots = await api.getOwnedPlots(stale);
        for (const r of stale) ringCache.current.set(r, { plots: plots.filter((p) => p.ringLevel === r), at: Date.now() });
        publishPlots();
      } catch {
        // abaikan: dicoba lagi saat polling berikutnya
      }
    },
    [publishPlots],
  );

  const upsertPlot = useCallback(
    (p: Plot) => {
      const entry = ringCache.current.get(p.ringLevel) ?? { plots: [], at: Date.now() };
      entry.plots = [...entry.plots.filter((x) => x.plotCode !== p.plotCode), p];
      ringCache.current.set(p.ringLevel, entry);
      publishPlots();
    },
    [publishPlots],
  );

  const refreshMe = useCallback(async () => {
    if (!session) {
      setMe(null);
      setMyPlotCount(0);
      return;
    }
    try {
      const c = await api.getMe(session);
      if (!c) {
        saveSession(null);
        setSession(null);
        setMe(null);
        return;
      }
      setMe(c);
      const rings = Array.from({ length: Math.max(1, world?.currentRingUnlocked ?? 1) }, (_, i) => i + 1);
      const plots = await api.getOwnedPlots(rings);
      setMyPlotCount(plots.filter((p) => p.ownerCitizenId === c.id).length);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }, [session, world?.currentRingUnlocked, toast]);

  useEffect(() => {
    void refreshWorld();
    const t = setInterval(() => document.visibilityState === 'visible' && void refreshWorld(), POLL_WORLD_MS);
    return () => clearInterval(t);
  }, [refreshWorld]);

  useEffect(() => {
    void refreshMap();
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void refreshMap();
      void loadRings(visibleRings.current);
    }, POLL_MAP_MS);
    return () => clearInterval(t);
  }, [refreshMap, loadRings]);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    const onFocus = () => {
      void refreshMe();
      void refreshWorld();
    };
    const onHash = () => {
      if (location.hash === '#admin') setModal('admin');
      if (location.hash === '#studio') {
        if (hasAdminSession()) {
          setModal(null);
          setSheet(null);
          setStudio(true);
        } else setModal('admin');
      }
    };
    // Shortcut rahasia kreator: Ctrl/Cmd + Shift + A
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setModal('admin');
      }
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('hashchange', onHash);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('keydown', onKey);
    };
  }, [refreshMe, refreshWorld]);

  // Realtime Presence: Tamu online & titik hijau
  const presenceIdentity = useMemo(
    () =>
      me
        ? { kind: 'citizen' as const, tag: formatCitizenTag(me.username, me.citizenNumber), citizenId: me.id, color: me.avatarColor }
        : { kind: 'guest' as const, tag: guestTag(), citizenId: null, color: WORLD.registration.avatarColors[3] },
    [me?.id, me?.username, me?.citizenNumber, me?.avatarColor], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => api.joinPresence(presenceIdentity, setMembers), [presenceIdentity]);

  // ---------------------------------------------------------------------------
  // Peta
  // ---------------------------------------------------------------------------
  const tier = me ? findTier(WORLD, me.tierId) : null;
  // Warga hasil Click-to-Locate yang tidak ada di sampel 120 ikut ditampilkan di peta.
  const mapCitizens = useMemo(() => {
    const ids = new Set(citizens.map((c) => c.id));
    return [...citizens, ...extraCitizens.filter((c) => !ids.has(c.id))];
  }, [citizens, extraCitizens]);
  const mapData = useMemo<MapData>(
    () => ({ world, citizens: mapCitizens, ownedPlots, members, meId: me?.id ?? null, myIncomeBonusPct: tier?.perks.incomeBonusPct ?? 0 }),
    [world, mapCitizens, ownedPlots, members, me?.id, tier],
  );

  function locateFromList(c: PublicCitizen) {
    setModal(null);
    if (!mapCitizens.some((x) => x.id === c.id)) setExtraCitizens((list) => [...list.filter((x) => x.id !== c.id), c].slice(-20));
    setTimeout(() => {
      if (!mapRef.current?.locateCitizen(c.id)) toast('Warga ini belum tampil di peta.');
    }, 250);
  }

  function exitStudio() {
    setStudio(false);
    if (location.hash === '#studio') history.replaceState(null, '', location.pathname + location.search);
    setTimeout(() => mapRef.current?.frameCore(), 50);
  }

  const onVisibleRings = useCallback(
    (rings: number[]) => {
      visibleRings.current = rings;
      void loadRings(rings);
    },
    [loadRings],
  );

  const onTap = useCallback(
    async (t: TapTarget) => {
      if (t.type === 'plot') {
        setSheet({ type: 'plot', code: t.plot.plotCode });
        mapRef.current?.setHighlight(t.plot.plotCode);
      } else if (t.type === 'citizen') setSheet({ type: 'citizen', id: t.citizenId });
      else if (t.type === 'landmark') setSheet({ type: 'landmark', id: t.landmarkId });
      else if (t.type === 'guest') toast(`👋 ${t.label} sedang jalan-jalan. Ajak daftar jadi warga!`);
      else if (t.type === 'coin' && session) {
        try {
          const r = await api.claimPropertyIncome(session, t.plot.plotCode);
          setMe((m) => (m ? { ...m, coins: r.coins } : m));
          upsertPlot({ ...t.plot, lastIncomeClaimAt: new Date().toISOString() });
          setFloatReward({ id: Date.now(), text: `+${r.total} ${WORLD.currency.code}` });
          playCoin();
        } catch (e) {
          toast(errorMessage(e), 'error');
        }
      }
    },
    [session, toast, upsertPlot],
  );

  // Data kavling terbaru: versi server (ownedPlots) menang; kavling dijual memakai data hasil tap dari engine.
  const sheetPlot =
    sheet?.type === 'plot'
      ? (ownedPlots.find((p) => p.plotCode === sheet.code) ?? (tappedPlot?.plotCode === sheet.code ? tappedPlot : null))
      : null;

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  function onRegistered(r: RegisterResult) {
    saveSession(r.session);
    setSession(r.session);
    setMe(r.citizen);
    setMyPlotCount(0);
    setModal(null);
    setReveal(r.citizen);
    void refreshWorld();
    void refreshMap();
  }

  function onRecovered(s: Session) {
    saveSession(s);
    setSession(s);
    setModal(null);
    toast('Selamat datang kembali!', 'success');
  }

  function logout() {
    saveSession(null);
    setSession(null);
    setMe(null);
    setModal(null);
  }

  /** Auto-sync Edit Profil: e-KTP, peta, dashboard, chat & presence langsung pakai nama/tampilan baru. */
  function onMeUpdated(c: MyCitizen) {
    setMe(c);
    const patch = (list: PublicCitizen[]) =>
      list.some((x) => x.id === c.id)
        ? list.map((x) => (x.id === c.id ? { ...x, username: c.username, avatarColor: c.avatarColor, avatarStyle: c.avatarStyle } : x))
        : list;
    setCitizens(patch);
    setExtraCitizens(patch);
    chat.renameLocal(c.id, c.username);
  }

  function locateFromChat(citizenId: string) {
    setModal(null);
    setTimeout(() => {
      if (!mapRef.current?.locateCitizen(citizenId)) toast('Warga ini sedang tidak tampil di peta.');
    }, 280);
  }

  const workAt = me ? nextAvailableAt(me.lastWorkAt, econ.workCooldownMinutes) : 0;
  const canWork = !!me && workAt <= now && !working;

  async function work() {
    if (!session || !me) return;
    unlockAudio();
    setWorking(true);
    try {
      const r = await api.claimWork(session);
      setMe({ ...me, coins: r.coins, lastWorkAt: r.lastWorkAt });
      setFloatReward({ id: Date.now(), text: `+${r.reward} ${WORLD.currency.code}` });
      playCoin();
      toast(`${r.label}: +${formatCoins(r.reward, WORLD.currency.code)}`, 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setWorking(false);
    }
  }

  function closeSheet() {
    setSheet(null);
    setTappedPlot(null);
    mapRef.current?.setHighlight(null);
  }

  const sheetCitizen = sheet?.type === 'citizen' ? (citizens.find((c) => c.id === sheet.id) ?? null) : null;

  return (
    <div
      className={`mx-auto flex h-dvh flex-col overflow-hidden bg-bg shadow-2xl ${studio ? '' : 'max-w-[560px]'}`}
      style={studio ? { width: 'min(100vw, calc(100dvh * 9 / 16))' } : undefined}
    >
      {!studio && <NewsTicker news={news} world={world} />}

      <main className="relative min-h-0 flex-1">
        <MapView
          ref={mapRef}
          data={mapData}
          onVisibleRings={onVisibleRings}
          onTap={(t) => {
            if (t.type === 'plot') setTappedPlot(t.plot);
            void onTap(t);
          }}
        />

        {studio && (
          <CreatorStudio mapRef={mapRef} world={world} citizens={mapCitizens} ownedPlots={ownedPlots} online={members.length} onExit={exitStudio} />
        )}

        {!studio && (
        <>
        {/* HUD atas: statistik negara (kiri) + kolom tombol taktil (kanan). Tengah peta tetap lega. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <div className="pointer-events-auto max-w-[62%]">
            <Hud world={world} online={members.length} />
          </div>
          <div className="pointer-events-auto flex flex-col items-end gap-2.5">
            {isSandbox && (
              <button
                onClick={() => devToolsEnabled && setModal('dev')}
                className="rounded-full bg-amber-400 px-2.5 py-1 text-[10px] font-black tracking-wide text-gray-900 shadow"
                title="Data disimpan di browser ini (localStorage)"
              >
                SANDBOX{devToolsEnabled ? ' ⚙️' : ''}
              </button>
            )}
            <MuteToggle />
            <HudButton icon="🏆" label="10K" onClick={() => setModal('leaderboard')} />
            <HudButton icon="🪪" label={me ? 'e-KTP' : 'Daftar'} onClick={() => (me ? setModal('ktp') : (unlockAudio(), setModal('register')))} />
            <HudButton icon="📢" label="Berita" onClick={() => setModal('news')} badge={!!world?.presidentAnnouncement} badgeTone="red" />
            <HudButton icon="🗳️" label="Sidang" onClick={() => setModal('gov')} />
          </div>
        </div>

        {/* Pojok kiri bawah: mini chat ticker (hanya kotaknya yang bisa diklik) */}
        <div className="pointer-events-none absolute bottom-3 left-3 right-[150px]">
          <ChatTicker messages={chat.messages} me={me} onOpen={() => setModal('chat')} />
        </div>

        {/* Pojok kanan bawah: navigasi kecil + Chat & Emote */}
        <div className="pointer-events-none absolute right-3 bottom-3 flex flex-col items-end gap-2.5">
          <div className="pointer-events-auto flex flex-col gap-2">
            <HudButton size="sm" icon="📍" label="Dekat" onClick={() => mapRef.current?.flyNear(me?.id ?? null)} />
            <HudButton size="sm" icon="🗺️" label="Kota" onClick={() => mapRef.current?.frameAll()} />
          </div>
          <div className="pointer-events-auto flex items-end gap-2">
            <HudButton size="lg" icon="💬" label="Chat" onClick={() => setModal('chat')} badge={chatUnread} badgeTone="red" />
            <EmotePicker
              enabled={!!me}
              lastSentAt={emotes.lastSentAt}
              onPick={emotes.send}
              onLocked={() => toast('😆 Daftar jadi warga dulu untuk kirim emote ke peta!')}
            />
          </div>
        </div>

        <FloatingEmotes items={emotes.floating} />
        </>
        )}

        {loadError && (
          <div className="absolute inset-x-3 top-40 rounded-2xl bg-red-600 p-3 text-sm font-semibold text-white shadow-lg">Gagal memuat data: {loadError}</div>
        )}

        {floatReward && (
          <div key={floatReward.id} className="animate-float-up pointer-events-none absolute bottom-28 left-1/2 text-2xl font-black text-amber-500 drop-shadow">
            {floatReward.text}
          </div>
        )}
      </main>

      {studio && <NewsTicker news={news} world={world} />}
      {!studio && (
      <footer className="border-t border-black/5 bg-surface px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {me && tier ? (
          <>
            <button onClick={() => setModal('ktp')} className="mb-2 flex w-full items-center gap-2 rounded-2xl bg-black/5 px-3 py-2 text-left">
              <span className="rounded-md px-1.5 py-0.5 text-[10px] font-black" style={{ background: tier.nametagColor }}>
                {tier.shortName}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-bold">
                {formatCitizenTag(me.username, me.citizenNumber)} • {me.roleTitle}
              </span>
              <span className="shrink-0 text-sm font-black">{formatCoins(me.coins, WORLD.currency.code)}</span>
            </button>
            <div className="grid grid-cols-3 gap-2">
              <Button onClick={() => void work()} disabled={!canWork} loading={working} className="px-2 text-xs">
                {workAt > now ? `⏳ ${formatDuration(workAt - now)}` : `💼 ${tier.work.label}`}
              </Button>
              <Button variant="secondary" className="px-2 text-xs" onClick={() => setModal('status')}>
                💬 Status
              </Button>
              <Button variant="secondary" className="px-2 text-xs" onClick={() => setModal('ktp')}>
                🪪 KTP
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <Button
              className="w-full py-4 text-base"
              onClick={() => {
                unlockAudio();
                setModal('register');
              }}
            >
              🪪 {WORLD.copy.registerCta}
            </Button>
            <div className="text-center text-[11px] text-muted">
              Kamu sedang jalan-jalan sebagai{' '}
              <b>
                {WORLD.copy.guestLabel} {presenceIdentity.tag}
              </b>
              . {WORLD.copy.tagline}
            </div>
          </div>
        )}
      </footer>
      )}

      <RegisterModal open={modal === 'register'} onClose={() => setModal(null)} onRegistered={onRegistered} onOpenRecover={() => setModal('recover')} />
      <RecoverModal open={modal === 'recover'} onClose={() => setModal(null)} onRecovered={onRecovered} />
      <NewsPanel open={modal === 'news'} onClose={() => setModal(null)} news={news} world={world} />
      <Leaderboard
        open={modal === 'leaderboard'}
        onClose={() => setModal(null)}
        me={me}
        world={world}
        knownCitizens={mapCitizens}
        onLocate={locateFromList}
        onRegister={() => {
          unlockAudio();
          setModal('register');
        }}
      />
      <ChatSheet
        open={modal === 'chat'}
        onClose={() => setModal(null)}
        messages={chat.messages}
        me={me}
        session={session}
        online={members.length}
        onSent={chat.add}
        onRegister={() => {
          unlockAudio();
          setModal('register');
        }}
        onTapCitizen={locateFromChat}
        toast={toast}
      />
      <GovernancePanel
        open={modal === 'gov'}
        onClose={() => setModal(null)}
        me={me}
        session={session}
        world={world}
        onWorld={(w) => {
          setWorld(w);
          void refreshWorld();
        }}
        toast={toast}
      />
      {me && session && (
        <>
          <KtpModal
            open={modal === 'ktp'}
            onClose={() => setModal(null)}
            me={me}
            session={session}
            ownedPlots={myPlotCount}
            onUpdated={onMeUpdated}
            onLogout={logout}
            toast={toast}
          />
          <StatusModal
            open={modal === 'status'}
            onClose={() => setModal(null)}
            session={session}
            onUpdated={(c) => {
              setMe(c);
              void refreshWorld();
              void refreshMap();
            }}
            toast={toast}
          />
        </>
      )}

      {sheet?.type === 'plot' && (
        <PlotSheet
          plot={sheetPlot}
          me={me}
          session={session}
          onClose={closeSheet}
          onPlot={(p) => {
            setTappedPlot(p);
            upsertPlot(p);
            if (me && p.ownerCitizenId === me.id && !ownedPlots.some((x) => x.plotCode === p.plotCode)) setMyPlotCount((n) => n + 1);
            void refreshWorld();
          }}
          onCoins={(coins) => setMe((m) => (m ? { ...m, coins } : m))}
          toast={toast}
        />
      )}
      <CitizenSheet
        citizen={sheetCitizen}
        onClose={closeSheet}
        onLocate={(id) => {
          closeSheet();
          if (!mapRef.current?.locateCitizen(id)) toast('Warga ini sedang tidak tampil di peta.');
        }}
      />
      <LandmarkSheet
        landmarkId={sheet?.type === 'landmark' ? sheet.id : null}
        world={world}
        me={me}
        session={session}
        citizens={citizens}
        onClose={closeSheet}
        onDonated={(coins, w) => {
          setMe((m) => (m ? { ...m, coins, totalDonated: m.totalDonated } : m));
          setWorld(w);
          void refreshWorld();
        }}
        toast={toast}
      />

      <AdminPanel
        open={modal === 'admin'}
        onClose={() => {
          setModal(null);
          if (location.hash === '#admin') history.replaceState(null, '', location.pathname + location.search);
        }}
        world={world}
        news={news}
        onOpenStudio={() => {
          setModal(null);
          setStudio(true);
        }}
        onWorld={() => {
          void refreshWorld();
          void refreshMe();
          void refreshMap();
          void loadRings(visibleRings.current, true);
        }}
        toast={toast}
      />
      {devToolsEnabled && (
        <DevPanel
          open={modal === 'dev'}
          meId={me?.id ?? null}
          onClose={() => setModal(null)}
          onChanged={() => {
            ringCache.current.clear();
            void refreshWorld();
            void refreshMap();
            void refreshMe();
            void loadRings(visibleRings.current, true);
          }}
          toast={toast}
        />
      )}

      {reveal && (
        <RevealOverlay
          citizen={reveal}
          onDone={() => {
            setReveal(null);
            setModal('ktp');
            setTimeout(() => mapRef.current?.locateCitizen(reveal.id), 400);
          }}
        />
      )}
      <ToastStack toasts={toasts} />
    </div>
  );
}
