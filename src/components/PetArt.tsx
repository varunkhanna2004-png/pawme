// Original vector illustrations for PAWME (drawn in code, © PAWME — no stock,
// no scraped photos; see docs/IMAGE-CREDITS.md). The same shapes are used to
// generate the Open Graph image (scripts/build-og.mjs).

const DARK = '#2b2320';

export function DogFace({ fur = '#c98a5b', ear = '#7a4a2b', size = 120, tilt = 0, tongue = true }: { fur?: string; ear?: string; size?: number; tilt?: number; tongue?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden style={{ transform: `rotate(${tilt}deg)` }}>
      <ellipse cx="44" cy="96" rx="24" ry="48" fill={ear} transform="rotate(18 44 96)" />
      <ellipse cx="156" cy="96" rx="24" ry="48" fill={ear} transform="rotate(-18 156 96)" />
      <circle cx="100" cy="106" r="66" fill={fur} />
      <ellipse cx="100" cy="132" rx="36" ry="28" fill="#fff7ef" />
      <circle cx="76" cy="94" r="8" fill={DARK} /><circle cx="124" cy="94" r="8" fill={DARK} />
      <circle cx="79" cy="91" r="2.6" fill="#fff" /><circle cx="127" cy="91" r="2.6" fill="#fff" />
      <ellipse cx="100" cy="120" rx="10" ry="7" fill={DARK} />
      <path d="M100 127 q0 12 -11 14 M100 127 q0 12 11 14" stroke={DARK} strokeWidth="3.5" fill="none" strokeLinecap="round" />
      {tongue && <ellipse cx="100" cy="148" rx="8" ry="10" fill="#f28b8b" />}
      <ellipse cx="60" cy="118" rx="9" ry="5" fill="#f5b7a5" opacity=".6" /><ellipse cx="140" cy="118" rx="9" ry="5" fill="#f5b7a5" opacity=".6" />
    </svg>
  );
}

export function CatFace({ fur = '#9a9a9a', size = 120, tilt = 0 }: { fur?: string; size?: number; tilt?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden style={{ transform: `rotate(${tilt}deg)` }}>
      <polygon points="46,96 60,34 104,78" fill={fur} /><polygon points="154,96 140,34 96,78" fill={fur} />
      <polygon points="56,86 64,52 92,78" fill="#f4b6b6" /><polygon points="144,86 136,52 108,78" fill="#f4b6b6" />
      <circle cx="100" cy="108" r="62" fill={fur} />
      <ellipse cx="100" cy="132" rx="30" ry="22" fill="#fff7ef" />
      <ellipse cx="76" cy="98" rx="8" ry="9" fill={DARK} /><ellipse cx="124" cy="98" rx="8" ry="9" fill={DARK} />
      <circle cx="79" cy="94" r="2.6" fill="#fff" /><circle cx="127" cy="94" r="2.6" fill="#fff" />
      <path d="M94 120 l6 6 l6 -6 z" fill="#f28b8b" />
      <path d="M100 126 q0 8 -8 10 M100 126 q0 8 8 10" stroke={DARK} strokeWidth="3" fill="none" strokeLinecap="round" />
      <g stroke={DARK} strokeWidth="2.5" strokeLinecap="round" opacity=".7">
        <path d="M70 124 L36 116 M70 130 L34 132 M130 124 L164 116 M130 130 L166 132" />
      </g>
    </svg>
  );
}

export function PawPrint({ size = 40, color = '#ff6b4a', opacity = 1 }: { size?: number; color?: string; opacity?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden style={{ opacity }}>
      <ellipse cx="50" cy="66" rx="21" ry="17" fill={color} />
      <ellipse cx="24" cy="44" rx="9" ry="12" fill={color} transform="rotate(-20 24 44)" />
      <ellipse cx="76" cy="44" rx="9" ry="12" fill={color} transform="rotate(20 76 44)" />
      <ellipse cx="39" cy="26" rx="9" ry="12" fill={color} transform="rotate(-6 39 26)" />
      <ellipse cx="61" cy="26" rx="9" ry="12" fill={color} transform="rotate(6 61 26)" />
    </svg>
  );
}

/** The welcome-screen hero: a dog and a cat, cheek to cheek, on a warm blob. */
export function HeroArt() {
  return (
    <div className="relative h-36 w-40 shrink-0" data-testid="hero-art">
      <svg className="absolute inset-0" viewBox="0 0 160 144" aria-hidden>
        <path d="M18 80 C 6 40, 50 4, 92 14 C 140 24, 162 70, 140 112 C 122 146, 44 150, 22 118 C 12 104, 22 96, 18 80 Z" fill="#ffd9cf" />
      </svg>
      <div className="absolute left-1 top-3"><DogFace size={92} tilt={-8} /></div>
      <div className="absolute right-0 top-9"><CatFace size={84} tilt={8} /></div>
      <div className="absolute left-[64px] top-[4px]"><HeartBadge /></div>
      <div className="absolute -right-1 bottom-0"><PawPrint size={22} opacity={0.35} /></div>
    </div>
  );
}

function HeartBadge() {
  return (
    <svg width="34" height="34" viewBox="0 0 100 100" aria-hidden>
      <path d="M50 88 C 20 66, 6 48, 10 30 C 14 12, 38 8, 50 26 C 62 8, 86 12, 90 30 C 94 48, 80 66, 50 88 Z" fill="#ff6b4a" />
    </svg>
  );
}
