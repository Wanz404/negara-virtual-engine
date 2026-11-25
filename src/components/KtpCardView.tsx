import { WORLD } from '../configs';
import { ktpPropertyLabel } from '../lib/economy';
import { findTier, ringName } from '../lib/game';
import { formatCitizenNumber, formatCoins } from '../lib/format';
import { barcodeBars, followStatusLabel, ktpPalette, stampSpec } from '../lib/ktpStyle';
import type { MyCitizen } from '../services';
import { inaugurationBadge } from '../lib/inauguration';
import { Avatar } from './Avatar';
import { InaugurationBadge } from './Inauguration';

function InkStamp({ status, size = 104 }: { status: MyCitizen['followStatus']; size?: number }) {
  const spec = stampSpec(status, WORLD.copy.stamps[status === 'recheck_requested' ? 'pending' : status]);
  const id = `ink-${status}`;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-label={WORLD.copy.stamps[status === 'recheck_requested' ? 'pending' : status]} style={{ opacity: 0.78, transform: 'rotate(-13deg)' }}>
      <defs>
        <filter id={`${id}-tex`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.9 1.35" />
          <feComposite in="SourceGraphic" operator="in" />
        </filter>
        <path id={`${id}-top`} d="M 22 60 A 38 38 0 0 1 98 60" />
        <path id={`${id}-bot`} d="M 20 60 A 40 40 0 0 0 100 60" />
      </defs>
      <g filter={`url(#${id}-tex)`} fill={spec.ink} stroke={spec.ink}>
        <circle cx="60" cy="60" r="55" fill="none" strokeWidth="4" />
        <circle cx="60" cy="60" r="48" fill="none" strokeWidth="1.5" />
        <circle cx="60" cy="60" r="27" fill="none" strokeWidth="1.5" />
        <text fontSize="10.5" fontWeight="900" stroke="none" letterSpacing="0.5">
          <textPath href={`#${id}-top`} startOffset="50%" textAnchor="middle" textLength={spec.top.length > 14 ? 110 : undefined}>
            {spec.top}
          </textPath>
        </text>
        <text fontSize="10.5" fontWeight="900" stroke="none" letterSpacing="0.5" dominantBaseline="hanging">
          <textPath href={`#${id}-bot`} startOffset="50%" textAnchor="middle" textLength={spec.bottom.length > 14 ? 112 : undefined}>
            {spec.bottom}
          </textPath>
        </text>
        <text x="60" y="64" fontSize={spec.center.length > 4 ? 10 : 17} fontWeight="900" textAnchor="middle" stroke="none">
          {spec.center}
        </text>
      </g>
    </svg>
  );
}

function Barcode({ code }: { code: string }) {
  const bars = barcodeBars(code);
  const total = bars.reduce((s, b) => s + b + 1.2, 0);
  let x = 0;
  return (
    <svg viewBox={`0 0 ${total} 10`} preserveAspectRatio="none" className="h-4 w-full" aria-hidden="true">
      {bars.map((b, i) => {
        const r = i % 2 === 0 ? <rect key={i} x={x} y={0} width={b} height={10} fill="#111827" /> : null;
        x += b + 1.2;
        return r;
      })}
    </svg>
  );
}

/** Kartu KTP virtual di modal — gaya identik dengan export PNG (lib/ktpCanvas.ts). */
export function KtpCardView({ me, ownedPlots }: { me: MyCitizen; ownedPlots: number }) {
  const p = ktpPalette(me.citizenNumber, me.followStatus);
  const tier = findTier(WORLD, me.tierId);
  const ring = Number(/Ring (\d+)/.exec(me.rtRwAddress)?.[1] ?? 1);
  const metal = `linear-gradient(135deg, ${p.metal[0]}, ${p.metal[1]} 35%, ${p.metal[2]} 60%, ${p.metal[3]})`;
  const pill = p.group === 'gold' ? metal : `linear-gradient(135deg, ${p.metal[1]}, ${p.metal[3]})`;
  const fields: Array<[string, string]> = [
    ['Alamat', me.rtRwAddress.replace(/\s*•\s*Ring \d+/, '')],
    ['Zona', `Ring ${ring} • ${ringName(WORLD, ring)}`],
    ['Warga sejak', `DAY ${me.joinedDay}`],
    ['Kekayaan', formatCoins(me.coins, WORLD.currency.code)],
    ['Properti', ktpPropertyLabel(me, ownedPlots)],
    ['Status', followStatusLabel(me.followStatus)],
  ];

  return (
    <div className="rounded-[26px] p-3" style={{ background: `radial-gradient(circle at 50% 30%, ${p.glow}55, transparent 70%), linear-gradient(${p.bgTop}, ${p.bgBottom})` }}>
      <div className="rounded-[22px] p-[7px] shadow-2xl" style={{ background: metal, boxShadow: `0 12px 40px ${p.glow}55` }}>
        <div
          className="relative overflow-hidden rounded-[16px] p-4 text-gray-900"
          style={{
            background: `repeating-radial-gradient(ellipse at 85% 30%, transparent 0 9px, ${p.accent}0f 9px 10px), linear-gradient(${p.cardTop}, ${p.cardBottom})`,
          }}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[10px] font-black tracking-[0.15em] uppercase" style={{ color: WORLD.theme.primary }}>
                {WORLD.copy.nationName}
              </div>
              <div className="text-[14px] leading-tight font-black">{WORLD.copy.ktpTitle}</div>
              <div className="line-clamp-2 text-[9px] leading-snug text-gray-500">{WORLD.copy.ktpDisclaimer}</div>
            </div>
            <div className="w-[92px] shrink-0">
              <div className="rounded-md bg-[#0b1220] px-1.5 py-1 text-center font-mono text-[12px] font-bold text-white">{me.ktpCode}</div>
              <div className="mt-1">
                <Barcode code={me.ktpCode} />
              </div>
            </div>
          </div>
          <div className="my-3 h-px" style={{ background: `${p.accent}40` }} />

          {/* Foto + identitas */}
          <div className="flex gap-3">
            <div className="relative w-[34%] shrink-0">
              <div className="mb-1.5 h-[26px] w-[34px] rounded-md border border-amber-700/50" style={{ background: 'linear-gradient(135deg,#fde68a,#d4a017,#fef3c7)' }} />
              <div className="relative aspect-[3/4] overflow-hidden rounded-xl border-2" style={{ background: p.photoBg, borderColor: `${p.metal[3]}aa` }}>
                <div className="absolute inset-x-[-12%] bottom-[-14%]">
                  <Avatar color={me.avatarColor} look={tier.look} accessory={me.avatarStyle.accessory} size={140} dim={me.followStatus === 'impeached'} />
                </div>
              </div>
              <div className="pointer-events-none absolute -right-3 -bottom-4">
                <InkStamp status={me.followStatus} size={86} />
              </div>
            </div>
            <div className="min-w-0 flex-1 pl-1">
              <div className="text-[9px] font-black tracking-widest uppercase" style={{ color: p.accent }}>
                Nomor {WORLD.copy.citizenNoun}
              </div>
              <div
                className="truncate text-[44px] leading-none font-black tracking-tight"
                style={{ background: `linear-gradient(${p.numberFrom}, ${p.numberTo})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}
              >
                #{formatCitizenNumber(me.citizenNumber)}
              </div>
              <div className="mt-1 truncate text-[22px] leading-tight font-black">{me.username}</div>
              <div className="mt-1 inline-block max-w-full truncate rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase" style={{ background: pill, color: p.group === 'gold' ? '#422006' : '#fff' }}>
                {tier.name}
              </div>
              <div className="mt-1.5 line-clamp-2 text-[12px] leading-snug font-bold text-gray-800">{me.roleTitle}</div>
              <div className="truncate text-[10px] text-gray-500">@{me.igUsername}</div>
            </div>
          </div>

          <div className="my-3 h-px" style={{ background: `${p.accent}40` }} />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            {fields.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-[9px] font-black tracking-wider text-gray-500 uppercase">{k}</dt>
                <dd className="line-clamp-2 text-[12px] leading-tight font-extrabold break-words">{v}</dd>
              </div>
            ))}
          </dl>
          {inaugurationBadge(me.citizenNumber, me.followStatus) && (
            <div className="mt-3">
              <InaugurationBadge citizenNumber={me.citizenNumber} followStatus={me.followStatus} />
            </div>
          )}
          <div className="mt-3 flex justify-between gap-2 border-t pt-2 text-[9px] font-bold text-gray-500" style={{ borderColor: `${p.accent}40` }}>
            <span className="truncate">@{WORLD.igAccountHandle}</span>
            <span className="truncate">{WORLD.domain}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
