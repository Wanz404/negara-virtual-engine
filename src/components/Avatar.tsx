import type { Accessory, CharacterLook } from '../configs/types';

/** Karakter chibi SVG ringan (dipakai di KTP & pratinjau). Renderer kanvas peta dibangun di Fase 3. */
export function Avatar({
  color,
  look,
  accessory,
  size = 64,
  dim = false,
}: {
  color: string;
  look: CharacterLook;
  accessory?: Accessory;
  size?: number;
  dim?: boolean;
}) {
  const acc = look.accessory !== 'none' ? look.accessory : (accessory ?? 'none');
  const suit = look.outfit === 'suit' || look.outfit === 'formal';
  const bodyColor = suit ? '#1f2937' : look.outfit === 'ghost' ? '#f8fafc' : color;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ opacity: dim ? 0.55 : 1 }} aria-hidden="true">
      <ellipse cx="32" cy="60" rx="16" ry="3" fill="black" opacity="0.15" />
      {/* badan */}
      <path d="M14 58c0-13 8-20 18-20s18 7 18 20z" fill={bodyColor} />
      {suit && (
        <>
          <path d="M27 39l5 9 5-9z" fill="#fff" />
          <path d="M31 41h2l1 10-2 3-2-3z" fill={look.accentColor} />
        </>
      )}
      {look.outfit === 'jacket' && <rect x="18" y="44" width="28" height="4" rx="2" fill={look.accentColor} />}
      {look.outfit === 'prison' && <path d="M16 48h32M15 53h34" stroke="#1f2937" strokeWidth="2.5" />}
      {(look.outfit === 'robe' || look.outfit === 'fur') && <path d="M18 58l4-18h20l4 18z" fill={look.accentColor} opacity="0.6" />}
      {look.outfit === 'spacesuit' && <circle cx="32" cy="24" r="17" fill="none" stroke="#bae6fd" strokeWidth="2" opacity="0.8" />}
      {/* kepala */}
      <circle cx="32" cy="24" r="13" fill={look.outfit === 'ghost' ? '#f8fafc' : '#fcd9b6'} />
      <path d="M19 22c0-9 6-13 13-13s13 4 13 13c-3-4-8-6-13-6s-10 2-13 6z" fill={look.outfit === 'ghost' ? '#e2e8f0' : '#3f2a1d'} />
      {/* wajah */}
      {acc === 'sunglasses' ? (
        <path d="M23 24h7v3a3 3 0 0 1-7 0zM34 24h7v3a3 3 0 0 1-7 0zM30 25h4" fill="#111827" stroke="#111827" strokeWidth="1" />
      ) : (
        <>
          <circle cx="27" cy="25.5" r="1.7" fill="#1f2937" />
          <circle cx="37" cy="25.5" r="1.7" fill="#1f2937" />
        </>
      )}
      <path d="M29 30c1.5 1.4 4.5 1.4 6 0" stroke="#7c2d12" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <circle cx="24" cy="29" r="2" fill="#fb7185" opacity="0.35" />
      <circle cx="40" cy="29" r="2" fill="#fb7185" opacity="0.35" />
      {/* aksesoris */}
      {acc === 'crown' && <path d="M22 13l4-7 6 5 6-5 4 7z" fill="#facc15" stroke="#b45309" strokeWidth="1" />}
      {acc === 'star' && <path d="M32 2l2.6 5.4 5.9.8-4.3 4.1 1 5.8L32 15.3l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" fill="#facc15" stroke="#b45309" strokeWidth="0.8" />}
      {acc === 'helmet' && <path d="M18 22a14 14 0 0 1 28 0v2H18z" fill={look.accentColor} />}
      {acc === 'cap' && <path d="M19 18a13 9 0 0 1 26 0zM40 17h9v3h-9z" fill={look.accentColor} />}
      {acc === 'hat' && <path d="M16 15h32v3H16zM22 15V7h20v8z" fill="#1f2937" />}
      {acc === 'horns' && <path d="M21 12l-3-8 7 6zM43 12l3-8-7 6z" fill="#7f1d1d" />}
      {acc === 'ears' && <path d="M20 15l2-11 8 7zM44 15l-2-11-8 7z" fill={look.accentColor} />}
      {acc === 'antenna' && <path d="M32 11V3" stroke="#64748b" strokeWidth="2" />}
      {acc === 'antenna' && <circle cx="32" cy="3" r="2.5" fill="#22d3ee" />}
      {acc === 'halo' && <ellipse cx="32" cy="7" rx="10" ry="3" fill="none" stroke="#facc15" strokeWidth="2" />}
      {acc === 'sparkle' && <path d="M50 10l1.5 3.5L55 15l-3.5 1.5L50 20l-1.5-3.5L45 15l3.5-1.5z" fill="#fde047" />}
      {acc === 'nametag' && <rect x="36" y="46" width="9" height="5" rx="1" fill="#facc15" />}
      {acc === 'pin' && <circle cx="40" cy="47" r="2.5" fill={look.accentColor} stroke="#fff" strokeWidth="1" />}
      {acc === 'whistle' && <circle cx="38" cy="47" r="2" fill="#e5e7eb" />}
    </svg>
  );
}
