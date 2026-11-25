import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { isSfxMuted, onSfxMuteChange, playClick, setSfxMuted, unlockAudio } from '../lib/fx';
import { formatNumber } from '../lib/format';

/** Tombol HUD taktil ala mobile game (crimson + aksen emas, press scale 0.95 + spring). */
export function HudButton({
  icon,
  label,
  onClick,
  badge,
  badgeTone = 'green',
  variant = 'crimson',
  size = 'md',
  active = false,
  disabled = false,
  children,
  style,
}: {
  icon: ReactNode;
  label?: string;
  onClick: () => void;
  badge?: number | boolean;
  badgeTone?: 'green' | 'red';
  variant?: 'crimson' | 'gold';
  size?: 'sm' | 'md' | 'lg';
  active?: boolean;
  disabled?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  const cls = ['hud-btn', variant === 'gold' ? 'hud-gold' : '', size === 'lg' ? 'hud-lg' : size === 'sm' ? 'hud-sm' : '', active ? 'ring-4 ring-amber-300/70' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={cls}
      style={style}
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={() => {
        unlockAudio();
        playClick();
        onClick();
      }}
    >
      <span className="hud-ico">{icon}</span>
      {label && size !== 'sm' && <span className="hud-lbl">{label}</span>}
      {badge !== undefined && badge !== false && badge !== 0 && (
        <span className={`hud-badge ${badgeTone === 'red' ? 'hud-badge-red' : ''}`}>{badge === true ? '' : badge > 99 ? '99+' : badge}</span>
      )}
      {children}
    </button>
  );
}

export function useSfxMuted(): [boolean, (m: boolean) => void] {
  const [muted, setMuted] = useState(isSfxMuted);
  useEffect(() => onSfxMuteChange(setMuted), []);
  return [muted, setSfxMuted];
}

/** Toggle Mute/Unmute SFX (tersimpan di localStorage). */
export function MuteToggle() {
  const [muted, setMuted] = useSfxMuted();
  return (
    <HudButton
      size="sm"
      icon={muted ? '🔇' : '🔊'}
      label={muted ? 'Suara mati' : 'Suara hidup'}
      onClick={() => setMuted(!muted)}
      active={!muted}
    />
  );
}

/** Indikator live online (Realtime Presence). */
export function OnlinePill({ online, onClick }: { online: number; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="hud-panel tactile flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
      </span>
      {formatNumber(online)} online
    </button>
  );
}
