import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WORLD } from './configs';
import { effectiveEconomy, findTier, nextAvailableAt } from './lib/game';
import { formatCitizenTag, formatCoins, formatDuration, formatNumber } from './lib/format';
import { installAudioUnlock, playCoin, unlockAudio } from './lib/fx';
import type { MapData, TapTarget } from './engine';
import {
  api,
  devToolsEnabled,
  guestTag,
  isSandbox,
  loadCachedMe,
  loadSession,
  saveCachedMe,
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
import { EconomySheet, type EconomyTab } from './components/EconomySheet';
import { economyStatus, MISSIONS } from './lib/economy';
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
const POLL_MIN_MS = 60_000;
const POLL_JITTER_MS = 15_000;
const RING_STALE_MS = 5 * 60_000;

/** Presence dimatikan: referensi tetap agar mapData tidak dibuat ulang (dan dikirim ke kanvas) tiap render. */
const NO_MEMBERS: PresenceMember[] = [];

const pollDelay = () => POLL_MIN_MS + Math.random() * POLL_JITTER_MS;
/** KTP disegarkan diam-diam di latar belakang paling sering sekali tiap 2,5–3 menit. */
const ME_REFRESH_MS = 150_000;
const meRefreshDelay = () => ME_REFRESH_MS + Math.random() * 30_000;
/** Belum punya KTP sama sekali & server sibuk: coba ulang 15–25 dtk acak, maksimal 2x, lalu berhenti (tombol manual). */
const meRetryDelay = () => 15_000 + Math.random() * 10_000;
const ME_MAX_AUTO_RETRIES = 2;
const ME_MANUAL_COOLDOWN_MS = 5_000;

type ModalName = 'register' | 'recover' | 'ktp' | 'status' | 'admin' | 'dev' | 'news' | 'leaderboard' | 'gov' | 'chat' | 'economy' | null;
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
  const [lastDataSyncAt, setLastDataSyncAt] = useState<number | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [citizens, setCitizens] = useState<PublicCitizen[]>([]);
  const members = NO_MEMBERS;
  const [session, setSession] = useState<Session | null>(loadSession);
  // KTP instan dari cache lokal (stale-while-revalidate) — tidak menunggu server saat buka/refresh.
  const [me, setMe] = useState<MyCitizen | null>(() => loadCachedMe(loadSession()?.citizenId)?.me ?? null);
  const meFetchedAt = useRef<number>(loadCachedMe(loadSession()?.citizenId)?.at ?? 0);
  const meRef = useRef(me);
  meRef.current = me;
  /** Coba ulang otomatis habis & KTP belum pernah termuat → tunggu tombol manual. */
  const [meStalled, setMeStalled] = useState(false);
  const [meCooldownUntil, setMeCooldownUntil] = useState(0);
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
  const ringLoads = useRef(new Set<number>());
  const ringLoadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleRings = useRef<number[]>([1]);
  const worldRequest = useRef<Promise<boolean> | null>(null);
  const mapRequest = useRef<Promise<boolean> | null>(null);
  const meRequest = useRef<Promise<boolean> | null>(null);
  const newsRequest = useRef<Promise<boolean> | null>(null);
  const newsLoaded = useRef(false);
  const newsFetchedAt = useRef(0);
  const now = useNow();

  // Upgrade v2: Global Chat realtime + Emote broadcast
  const chat = useGlobalChat(modal === 'chat');
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

  // Upgrade v3: Ekonomi & Misi
  const [econTab, setEconTab] = useState<EconomyTab>('misi');
  const [emoteSignal, setEmoteSignal] = useState(0);
  const openEconomy = useCallback((tab: EconomyTab) => {
    setSheet(null);
    setEconTab(tab);
    setModal('economy');
  }, []);
  const econStatus = me ? economyStatus(me, now) : null;
  const econAlert = !!econStatus && (econStatus.salaryReady || econStatus.quickReady || econStatus.missionsReady > 0);
  // Saldo naik → angka "+XX RpK" melayang dari dompet + SFX koin (semua sumber: gaji, misi, kerja, sewa).
  const [walletFx, setWalletFx] = useState<{ id: number; amount: number } | null>(null);
  const prevCoins = useRef<{ id: string; coins: number } | null>(null);
  useEffect(() => {
    const prev = prevCoins.current;
    prevCoins.current = me ? { id: me.id, coins: me.coins } : null;
    if (!me || !prev || prev.id !== me.id || me.coins <= prev.coins) return;
    setWalletFx({ id: Date.now(), amount: me.coins - prev.coins });
    playCoin();
  }, [me?.id, me?.coins]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Data (polling ringan, hemat kuota free tier)
  // ---------------------------------------------------------------------------
  const refreshWorld = useCallback((): Promise<boolean> => {
    if (worldRequest.current) return worldRequest.current;
    const request = api.getWorldState().then((w) => {
      setWorld(w);
      setLastDataSyncAt(Date.now());
      setLoadError(null);
      return true;
    }).catch((e) => {
      setLoadError(errorMessage(e));
      return false;
    }).finally(() => { worldRequest.current = null; });
    worldRequest.current = request;
    return request;
  }, []);

  const refreshNews = useCallback((): Promise<boolean> => {
    if (newsRequest.current) return newsRequest.current;
    const request = api.getNews(30).then((items) => {
      setNews(items);
      newsLoaded.current = true;
      newsFetchedAt.current = Date.now();
      return true;
    }).catch(() => {
      return false;
    }).finally(() => { newsRequest.current = null; });
    newsRequest.current = request;
    return request;
  }, []);

  const refreshMap = useCallback((): Promise<boolean> => {
    if (mapRequest.current) return mapRequest.current;
    const request = api.getMapCitizens(session?.citizenId ?? null, 120).then((items) => {
      setCitizens(items);
      setLastDataSyncAt(Date.now());
      return true;
    }).catch(() => {
      setLoadError('Gagal memuat data peta.');
      return false;
    }).finally(() => { mapRequest.current = null; });
    mapRequest.current = request;
    return request;
  }, [session?.citizenId]);

  const publishPlots = useCallback(() => {
    setOwnedPlots([...ringCache.current.values()].flatMap((v) => v.plots));
  }, []);

  /** Ambil kavling ber-pemilik hanya untuk ring yang terlihat kamera (dan sudah basi). */
  const loadRings = useCallback(
    async (rings: number[], force = false) => {
      const stale = rings.filter((r) => !ringLoads.current.has(r) && (force || !ringCache.current.has(r) || Date.now() - ringCache.current.get(r)!.at > RING_STALE_MS));
      if (stale.length === 0) return;
      stale.forEach((r) => ringLoads.current.add(r));
      try {
        const plots = await api.getOwnedPlots(stale);
        for (const r of stale) ringCache.current.set(r, { plots: plots.filter((p) => p.ringLevel === r), at: Date.now() });
        publishPlots();
      } catch {
        // abaikan: dicoba lagi saat polling berikutnya
      } finally {
        stale.forEach((r) => ringLoads.current.delete(r));
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

  /** 1 RPC ringan (get_my_citizen, baca saja). Gagal → diam: KTP lama tetap tampil, sesi TIDAK dihapus. */
  const refreshMe = useCallback((): Promise<boolean> => {
    if (!session) return Promise.resolve(true);
    if (meRequest.current) return meRequest.current;
    const request = api.getMe(session).then((c) => {
      if (!c) {
        // Hanya bila server tegas menyatakan token tidak valid (bukan karena sibuk/timeout).
        saveSession(null);
        saveCachedMe(null);
        setSession(null);
        setMe(null);
        return true;
      }
      meFetchedAt.current = Date.now();
      setMe(c);
      setMeStalled(false);
      return true;
    }).catch(() => false).finally(() => { meRequest.current = null; });
    meRequest.current = request;
    return request;
  }, [session]);

  // Simpan snapshot KTP terbaru ke localStorage setiap kali berubah (login, refresh, kerja, edit profil, dst).
  useEffect(() => {
    if (me && session && me.id === session.citizenId) saveCachedMe(me, meFetchedAt.current || Date.now());
  }, [me, session]);

  const retryMeNow = useCallback(() => {
    if (Date.now() < meCooldownUntil) return;
    setMeCooldownUntil(Date.now() + ME_MANUAL_COOLDOWN_MS);
    setTimeout(() => setMeCooldownUntil(0), ME_MANUAL_COOLDOWN_MS + 50);
    void refreshMe();
  }, [meCooldownUntil, refreshMe]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    let cancelled = false;
    const schedule = (delay: number) => {
      if (cancelled) return;
      timer = setTimeout(async () => {
        if (cancelled) return;
        if (document.hidden) return schedule(pollDelay());
        const ok = await refreshWorld();
        if (cancelled) return;
        failures = ok ? 0 : failures + 1;
        schedule(ok ? pollDelay() : Math.min(60_000, 15_000 * 2 ** Math.min(failures - 1, 2)));
      }, delay);
    };
    void refreshWorld().then((ok) => {
      if (cancelled) return;
      failures = ok ? 0 : 1;
      schedule(ok ? pollDelay() : 15_000);
    });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [refreshWorld]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    let cancelled = false;
    const schedule = (delay: number) => {
      if (cancelled) return;
      timer = setTimeout(async () => {
        if (cancelled) return;
        if (document.hidden) return schedule(pollDelay());
        const ok = await refreshMap();
        if (cancelled) return;
        failures = ok ? 0 : failures + 1;
        schedule(ok ? pollDelay() : Math.min(60_000, 15_000 * 2 ** Math.min(failures - 1, 2)));
      }, delay);
    };
    void refreshMap().then((ok) => {
      if (cancelled) return;
      failures = ok ? 0 : 1;
      schedule(ok ? pollDelay() : 15_000);
    });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [refreshMap, loadRings]);

  useEffect(() => {
    if (!session) {
      setMe(null);
      setMyPlotCount(0);
      return;
    }
    setMeStalled(false);
    let timer: ReturnType<typeof setTimeout>;
    let retries = 0;
    let cancelled = false;
    const schedule = (delay: number) => {
      if (!cancelled) timer = setTimeout(run, delay);
    };
    const run = async () => {
      if (cancelled) return;
      if (document.hidden) return schedule(meRefreshDelay());
      const ok = await refreshMe();
      if (cancelled) return;
      if (ok) {
        retries = 0;
        return schedule(meRefreshDelay());
      }
      // Sudah ada KTP (cache) → gagal didiamkan, coba lagi di jadwal normal berikutnya.
      if (meRef.current) return schedule(meRefreshDelay());
      // Belum ada KTP sama sekali → maksimal 2x coba ulang berjitter, lalu berhenti total.
      if (retries < ME_MAX_AUTO_RETRIES) {
        retries += 1;
        return schedule(meRetryDelay());
      }
      setMeStalled(true);
    };
    const age = Date.now() - meFetchedAt.current;
    if (!meRef.current) schedule(0);
    else if (age < ME_REFRESH_MS) schedule(ME_REFRESH_MS - age + Math.random() * 30_000);
    else schedule(1_000 + Math.random() * 4_000); // cache basi: segarkan di latar belakang, tersebar acak
    return () => { cancelled = true; clearTimeout(timer); };
  }, [session, refreshMe]);

  // Feed sekunder dimuat sekali setelah peta siap; pembukaan panel menyegarkan cache yang sudah lama.
  useEffect(() => {
    if (!world || newsLoaded.current) return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    let failures = 0;
    const schedule = (delay: number) => {
      timer = setTimeout(async () => {
        if (cancelled || newsLoaded.current) return;
        if (document.hidden) return schedule(pollDelay());
        const ok = await refreshNews();
        if (cancelled || ok) return;
        failures += 1;
        schedule(Math.min(60_000, 15_000 * 2 ** Math.min(failures - 1, 2)));
      }, delay);
    };
    schedule(3_000 + Math.random() * 2_000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [world, refreshNews]);

  useEffect(() => {
    if (modal === 'news' && Date.now() - newsFetchedAt.current >= POLL_MIN_MS) void refreshNews();
  }, [modal, refreshNews]);

  useEffect(() => {
    let lastFocusRefresh = 0;
    const onFocus = () => {
      if (document.hidden) return;
      if (Date.now() - lastFocusRefresh < POLL_MIN_MS) return;
      lastFocusRefresh = Date.now();
      // KTP: hormati batas 1x / 2,5 menit (tab dipindah-pindah tidak boleh menembak Supabase).
      if (meRef.current && Date.now() - meFetchedAt.current >= ME_REFRESH_MS) void refreshMe();
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

  // Presence Realtime tetap dimatikan untuk menghemat slot koneksi Free Tier.
  const presenceIdentity = useMemo(
    () =>
      me
        ? { kind: 'citizen' as const, tag: formatCitizenTag(me.username, me.citizenNumber), citizenId: me.id, color: me.avatarColor }
        : { kind: 'guest' as const, tag: guestTag(), citizenId: null, color: WORLD.registration.avatarColors[3] },
    [me?.id, me?.username, me?.citizenNumber, me?.avatarColor], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Production landing page does not open Presence channels; online count stays zero to save slots.

  // ---------------------------------------------------------------------------
  // Peta
  // ---------------------------------------------------------------------------
  const tier = me ? findTier(WORLD, me.tierId) : null;
  // Warga hasil Click-to-Locate yang tidak ada di sampel 120 ikut ditampilkan di peta.
  const mapCitizens = useMemo(() => {
    const ids = new Set(citizens.map((c) => c.id));
    const extra = extraCitizens.filter((c) => !ids.has(c.id));
    // Snapshot edge bersifat publik (tanpa p_me) → pastikan warga sendiri selalu ada di peta.
    const self = me && !ids.has(me.id) && !extra.some((c) => c.id === me.id) ? [me] : [];
    return [...self, ...citizens, ...extra];
  }, [citizens, extraCitizens, me]);
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
      // Biarkan world + peta inti selesai lebih dulu sebelum meminta data kavling.
      if (!world) return;
      if (ringLoadTimer.current) clearTimeout(ringLoadTimer.current);
      const wait = 3_000 + Math.random() * 2_000;
      ringLoadTimer.current = setTimeout(() => {
        ringLoadTimer.current = null;
        if (!document.hidden) void loadRings(rings);
      }, wait);
    },
    [loadRings, world],
  );

  useEffect(() => () => {
    if (ringLoadTimer.current) clearTimeout(ringLoadTimer.current);
  }, []);

  useEffect(() => {
    if (modal !== 'ktp' || !session) return;
    let cancelled = false;
    const rings = Array.from({ length: Math.max(1, world?.currentRingUnlocked ?? 1) }, (_, i) => i + 1);
    void api.getOwnedPlots(rings).then((plots) => {
      if (!cancelled) setMyPlotCount(plots.filter((p) => p.ownerCitizenId === session.citizenId).length);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [modal, session, world?.currentRingUnlocked]);

  const onTap = useCallback(
    async (t: TapTarget) => {
      if (t.type === 'plot') {
        setSheet({ type: 'plot', code: t.plot.plotCode });
        mapRef.current?.setHighlight(t.plot.plotCode);
      } else if (t.type === 'citizen') setSheet({ type: 'citizen', id: t.citizenId });
      else if (t.type === 'landmark') {
        // v3: Zona Proyek → Patungan Stasiun, Warung → Properti RT; landmark lain tetap sheet info.
        const kind = WORLD.landmarks.find((l) => l.id === t.landmarkId)?.kind;
        if (kind === 'project_site') openEconomy('stasiun');
        else if (kind === 'shop') openEconomy('properti');
        else setSheet({ type: 'landmark', id: t.landmarkId });
      }
      else if (t.type === 'guest') toast(`👋 ${t.label} sedang jalan-jalan. Ajak daftar jadi warga!`);
      else if (t.type === 'coin' && session) {
        try {
          const r = await api.claimPropertyIncome(session, t.plot.plotCode);
          setMe((m) => (m ? { ...m, coins: r.coins } : m));
          upsertPlot({ ...t.plot, lastIncomeClaimAt: new Date().toISOString() });
          setFloatReward({ id: Date.now(), text: `+${r.total} ${WORLD.currency.code}` });
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
    meFetchedAt.current = Date.now();
    setSession(r.session);
    setMe(r.citizen);
    setMyPlotCount(0);
    setModal(null);
    setReveal(r.citizen);
    void refreshWorld();
    void refreshMap();
  }

  function onRecovered(s: Session, pinCreated = false, citizen: MyCitizen | null = null) {
    saveSession(s);
    // Server (007) mengembalikan data KTP bersama token → KTP langsung tampil tanpa request kedua.
    const cached = citizen ? null : loadCachedMe(s.citizenId);
    meFetchedAt.current = citizen ? Date.now() : (cached?.at ?? 0);
    setMe(citizen ?? cached?.me ?? null);
    setSession(s);
    setModal(null);
    toast(pinCreated ? 'PIN dibuat & KTP-mu aman. Selamat datang kembali!' : 'Selamat datang kembali!', 'success');
  }

  function logout() {
    saveSession(null);
    saveCachedMe(null);
    meFetchedAt.current = 0;
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

  const sheetCitizen = sheet?.type === 'citizen' ? (mapCitizens.find((c) => c.id === sheet.id) ?? null) : null;

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
            <Hud world={world} online={members.length} presenceEnabled={false} syncedAt={lastDataSyncAt} onProject={() => openEconomy('stasiun')}>
              {/* Dompet RpK: selalu terlihat di detik pertama */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => openEconomy(me ? 'kerja' : 'misi')}
                  className="tactile flex w-full items-center gap-1.5 rounded-full border-2 border-amber-300 bg-gradient-to-b from-[#3b1d00] to-[#1c0d00] py-1 pr-3 pl-1 text-left shadow-lg"
                  aria-label="Dompet RpK"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-b from-amber-200 to-amber-500 text-sm">🪙</span>
                  <span className="text-[15px] font-black text-amber-300 tabular-nums">{formatNumber(me?.coins ?? 0)}</span>
                  <span className="text-[10px] font-black text-amber-100/80">{WORLD.currency.code}</span>
                  <span className="ml-auto text-[10px] font-black text-amber-200">＋</span>
                </button>
                {walletFx && (
                  <span key={walletFx.id} className="animate-wallet-gain pointer-events-none absolute top-0 left-8 text-lg font-black text-amber-300 drop-shadow-[0_2px_0_rgba(0,0,0,0.6)]">
                    +{formatNumber(walletFx.amount)} {WORLD.currency.code}
                  </span>
                )}
              </div>
              {(!me || (econStatus && econStatus.missionsLeft > 0)) && (
                <button
                  type="button"
                  onClick={() => (me ? openEconomy('misi') : (unlockAudio(), setModal('register')))}
                  className="tactile flex w-full items-center gap-1.5 rounded-2xl bg-white/90 px-2.5 py-1.5 text-left text-[11px] font-black text-ink shadow ring-1 ring-amber-300"
                >
                  🎯
                  <span className="min-w-0 flex-1 truncate">
                    {me ? `Misi Warga Baru ${MISSIONS.length - (econStatus?.missionsLeft ?? 0)}/${MISSIONS.length}` : 'Daftar → dapat 190+ RpK'}
                  </span>
                  {econStatus && econStatus.missionsReady > 0 && <span className="h-2 w-2 animate-ping rounded-full bg-red-500" />}
                </button>
              )}
            </Hud>
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
            <HudButton variant="gold" icon="💼" label="Kerja" onClick={() => openEconomy(econStatus?.missionsReady ? 'misi' : 'kerja')}>
              {econAlert && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-80" />
                  <span className="relative inline-flex h-4 w-4 rounded-full border-2 border-white bg-red-500" />
                </span>
              )}
            </HudButton>
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
              onOpen={emotes.connect}
              onClose={emotes.disconnect}
              onLocked={() => toast('😆 Daftar jadi warga dulu untuk kirim emote ke peta!')}
              openSignal={emoteSignal}
            />
          </div>
        </div>

        <FloatingEmotes items={emotes.floating} />
        </>
        )}

        {loadError && (
          <div className="absolute inset-x-3 top-40 rounded-2xl bg-red-600 p-3 text-sm font-semibold text-white shadow-lg">
            <div>Gagal memuat data: {loadError}</div>
            <button type="button" className="mt-2 rounded-xl bg-white/20 px-3 py-1.5 font-black" onClick={() => void refreshWorld().then(refreshMap).then(refreshMe)}>
              Muat Ulang
            </button>
          </div>
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
        ) : session ? (
          // Sesi tersimpan tapi data warga belum termuat (server lambat): JANGAN tampilkan tombol daftar,
          // supaya warga tidak mengira akunnya hilang lalu mendaftar ulang. Sesi lokal tetap utuh.
          <div className="space-y-2 rounded-2xl bg-black/5 p-3 text-center">
            <div className="text-sm font-bold">{meStalled ? '🪪 KTP-mu aman' : '⏳ Memuat KTP-mu…'}</div>
            <div className="text-[11px] text-muted">
              {meStalled
                ? 'Server sedang sibuk. Kamu tetap login — tekan tombol di bawah untuk memuat ulang.'
                : 'Sebentar ya. Kamu tetap login.'}
            </div>
            <Button variant="secondary" className="w-full text-xs" disabled={now < meCooldownUntil} onClick={retryMeNow}>
              {now < meCooldownUntil ? `⏳ Tunggu ${Math.ceil((meCooldownUntil - now) / 1000)} dtk` : '🔄 Coba lagi sekarang'}
            </Button>
          </div>
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
      <EconomySheet
        open={modal === 'economy'}
        tab={econTab}
        onTab={setEconTab}
        onClose={() => setModal(null)}
        me={me}
        session={session}
        world={world}
        tierWork={
          me && tier ? { label: tier.work.label, reward: tier.work.reward, readyAt: workAt, busy: working, run: () => void work() } : null
        }
        onMe={onMeUpdated}
        onWorld={(w) => {
          setWorld(w);
          void refreshWorld();
        }}
        onOpenChat={() => setModal('chat')}
        onOpenEmote={() => {
          setModal(null);
          setTimeout(() => setEmoteSignal((n) => n + 1), 300);
        }}
        onOpenKtp={() => setModal('ktp')}
        onRegister={() => {
          unlockAudio();
          setModal('register');
        }}
        toast={toast}
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
