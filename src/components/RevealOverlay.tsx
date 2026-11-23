import { useEffect, useMemo, useState } from 'react';
import { WORLD } from '../configs';
import { findTier } from '../lib/game';
import { formatCitizenNumber } from '../lib/format';
import { confetti, haptic, playFanfare, playStamp, playTick } from '../lib/fx';
import type { MyCitizen } from '../services';
import { Avatar } from './Avatar';
import { Button } from './ui';

const ROULETTE_MS = 1500;

/**
 * Animasi roulette 1,5 detik SETELAH server mengembalikan nomor asli, lalu reveal + konfeti + fanfare.
 * Nomor yang berputar murni efek visual; nomor asli sudah final di database (strict FCFS).
 */
export function RevealOverlay({ citizen, onDone }: { citizen: MyCitizen; onDone: () => void }) {
  const [phase, setPhase] = useState<'spin' | 'reveal'>('spin');
  const [fakeNum, setFakeNum] = useState(1);
  const [fakeTitle, setFakeTitle] = useState('');
  const tier = findTier(WORLD, citizen.tierId);
  const titles = useMemo(() => WORLD.tiers.flatMap((t) => [...t.seatTitles.slice(0, 3), ...t.titlePool.slice(0, 2)]).filter(Boolean), []);

  useEffect(() => {
    const iv = setInterval(() => {
      const max = Math.max(999, citizen.citizenNumber * 2);
      setFakeNum(1 + Math.floor(Math.random() * max));
      setFakeTitle(titles[Math.floor(Math.random() * titles.length)] ?? '');
      playTick();
    }, 70);
    const t = setTimeout(() => {
      clearInterval(iv);
      setPhase('reveal');
      playStamp();
      haptic(60);
      setTimeout(() => {
        playFanfare();
        confetti([WORLD.theme.primary, WORLD.theme.accent, tier.nametagColor, '#ffffff', '#22c55e']);
      }, 180);
    }, ROULETTE_MS);
    return () => {
      clearInterval(iv);
      clearTimeout(t);
    };
  }, [citizen.citizenNumber, tier.nametagColor, titles]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-950/90 p-6 text-white backdrop-blur-sm">
      <div className="w-full max-w-sm text-center">
        {phase === 'spin' ? (
          <>
            <div className="text-xs font-black tracking-[0.3em] text-white/60 uppercase">Mengundi kursi…</div>
            <div className="mt-4 font-mono text-7xl font-black tabular-nums text-accent">{formatCitizenNumber(fakeNum)}</div>
            <div className="mt-3 h-6 truncate text-base font-bold text-white/70">{fakeTitle}</div>
          </>
        ) : (
          <>
            <div className="text-xs font-black tracking-[0.3em] text-white/60 uppercase">Selamat! Kamu resmi tercatat sebagai</div>
            <div className="mx-auto mt-4 w-fit rounded-3xl p-2" style={{ background: tier.ktpBorder }}>
              <div className="rounded-2xl bg-white p-2">
                <Avatar color={citizen.avatarColor} look={tier.look} accessory={citizen.avatarStyle.accessory} size={96} />
              </div>
            </div>
            <div className="mt-4 text-4xl leading-tight font-black">
              {citizen.username} <span className="text-white/50">|</span> <span style={{ color: tier.nametagColor }}>{formatCitizenNumber(citizen.citizenNumber)}</span>
            </div>
            <div className="mt-1 text-lg font-bold">
              {citizen.roleTitle} — {WORLD.copy.nationName}
            </div>
            <div className="mt-2 inline-block rounded-full px-3 py-1 text-xs font-black text-gray-900" style={{ background: tier.nametagColor }}>
              {tier.name}
            </div>
            <div className="relative mt-6 flex justify-center">
              <div className="animate-stamp rounded-lg border-4 border-amber-400 px-3 py-1.5 text-sm font-black tracking-wider text-amber-300 uppercase">
                {WORLD.copy.stamps.pending}
              </div>
            </div>
            <p className="mt-4 text-xs text-white/60">Follow @{WORLD.igAccountHandle} dicek otomatis maks. 1x24 jam agar jabatanmu resmi dilantik.</p>
            <Button className="mt-6 w-full py-4 text-base" onClick={onDone}>
              🪪 Lihat KTP-ku
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
