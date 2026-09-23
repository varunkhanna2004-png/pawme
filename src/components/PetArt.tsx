// Original vector illustrations for PAWME (drawn in code, © PAWME — no stock,
// no scraped photos; see docs/IMAGE-CREDITS.md). The same shapes are used to
// generate the Open Graph image (scripts/build-og.mjs).

const DARK = '#2b2320';

export function DogFace({ fur = '#c98a5b', ear = '#7a4a2b', bandana, size = 120, tilt = 0, tongue = true }: { fur?: string; ear?: string; bandana?: string; size?: number; tilt?: number; tongue?: boolean }) {
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
      {bandana && <path d="M52 160 q48 26 96 0 l-10 22 q-38 14 -76 0 z" fill={bandana} />}
    </svg>
  );
}

export function CatFace({ fur = '#9a9a9a', stripes, size = 120, tilt = 0 }: { fur?: string; stripes?: string; size?: number; tilt?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden style={{ transform: `rotate(${tilt}deg)` }}>
      <polygon points="46,96 60,34 104,78" fill={fur} /><polygon points="154,96 140,34 96,78" fill={fur} />
      <polygon points="56,86 64,52 92,78" fill="#f4b6b6" /><polygon points="144,86 136,52 108,78" fill="#f4b6b6" />
      <circle cx="100" cy="108" r="62" fill={fur} />
      {stripes && <g fill={stripes} opacity=".8"><path d="M84 52 q16 10 32 0 l-4 16 q-12 -6 -24 0 z" /><path d="M44 90 q8 -14 20 -18 l-2 14 q-8 4 -12 12 z" /><path d="M156 90 q-8 -14 -20 -18 l2 14 q8 4 12 12 z" /></g>}
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

/** The welcome-screen hero: a small pack — two dogs, two cats, a ball — on a sunny blob. */
export function HeroArt() {
  return (
    <div className="relative h-40 w-44 shrink-0" data-testid="hero-art">
      <svg className="absolute inset-0" viewBox="0 0 176 160" aria-hidden>
        <defs><linearGradient id="hero-blob" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe08a" /><stop offset="1" stop-color="#ffb3a0" /></linearGradient></defs>
        <path d="M22 84 C 6 44, 54 6, 100 14 C 152 22, 178 72, 156 118 C 136 154, 52 162, 26 126 C 14 110, 26 100, 22 84 Z" fill="url(#hero-blob)" />
      </svg>
      <Confetti className="absolute inset-x-2 top-0 h-8 w-40" />
      <div className="absolute left-[54px] top-[10px]"><DogFace size={74} tilt={6} fur="#e8b35a" ear="#c98a3a" bandana="#3ec5b7" /></div>
      <div className="absolute left-0 top-[48px]"><DogFace size={92} tilt={-10} /></div>
      <div className="absolute right-0 top-[52px]"><CatFace size={86} tilt={10} fur="#f0a35e" stripes="#c9702b" /></div>
      <div className="absolute left-[108px] top-[6px]"><CatFace size={52} tilt={-6} fur="#9a9a9a" /></div>
      <div className="absolute left-[76px] top-[118px]"><Ball size={26} /></div>
      <div className="absolute left-[60px] top-[42px]"><HeartBadge /></div>
      <div className="absolute -right-1 bottom-1"><PawPrint size={20} opacity={0.4} /></div>
    </div>
  );
}

export function Ball({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <circle cx="50" cy="50" r="46" fill="#c6e35b" />
      <path d="M18 22 q32 28 0 56 M82 22 q-32 28 0 56" stroke="#fff" strokeWidth="7" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Confetti({ className = '' }: { className?: string }) {
  const dots: [number, number, number, string][] = [[6, 12, 3, '#ffb347'], [22, 4, 2.5, '#3ec5b7'], [38, 16, 2, '#ff6b4a'], [58, 6, 3, '#c6e35b'], [78, 14, 2.5, '#ff8fb1'], [92, 5, 2, '#ffb347'], [14, 30, 2, '#ff8fb1'], [88, 30, 3, '#3ec5b7']];
  return (
    <svg className={className} viewBox="0 0 100 40" aria-hidden>
      {dots.map(([x, y, r, c], i) => (i % 2 ? <circle key={i} cx={x} cy={y} r={r} fill={c} /> : <rect key={i} x={x - r} y={y - r} width={r * 2} height={r * 2} rx="1" fill={c} transform={`rotate(${20 * i} ${x} ${y})`} />))}
    </svg>
  );
}

function HeartBadge() {
  return (
    <svg width="34" height="34" viewBox="0 0 100 100" aria-hidden>
      <path d="M50 88 C 20 66, 6 48, 10 30 C 14 12, 38 8, 50 26 C 62 8, 86 12, 90 30 C 94 48, 80 66, 50 88 Z" fill="#ff6b4a" />
    </svg>
  );
}
