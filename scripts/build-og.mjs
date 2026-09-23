// Generates public/og.png (1200×630) — the link preview card for WhatsApp,
// Telegram, Messenger, Facebook and X. Original vector art, same shapes as
// src/components/PetArt.tsx. Run: node scripts/build-og.mjs
import sharp from 'sharp';

const DARK = '#2b2320';
const dog = (x, y, s, rot, fur = '#c98a5b', ear = '#7a4a2b', bandana = '') => `<g transform="translate(${x} ${y}) scale(${s}) rotate(${rot} 100 100)">
  <ellipse cx="44" cy="96" rx="24" ry="48" fill="${ear}" transform="rotate(18 44 96)"/><ellipse cx="156" cy="96" rx="24" ry="48" fill="${ear}" transform="rotate(-18 156 96)"/>
  <circle cx="100" cy="106" r="66" fill="${fur}"/><ellipse cx="100" cy="132" rx="36" ry="28" fill="#fff7ef"/>
  <circle cx="76" cy="94" r="8" fill="${DARK}"/><circle cx="124" cy="94" r="8" fill="${DARK}"/><circle cx="79" cy="91" r="2.6" fill="#fff"/><circle cx="127" cy="91" r="2.6" fill="#fff"/>
  <ellipse cx="100" cy="120" rx="10" ry="7" fill="${DARK}"/><path d="M100 127 q0 12 -11 14 M100 127 q0 12 11 14" stroke="${DARK}" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  <ellipse cx="100" cy="148" rx="8" ry="10" fill="#f28b8b"/><ellipse cx="60" cy="118" rx="9" ry="5" fill="#f5b7a5" opacity=".6"/><ellipse cx="140" cy="118" rx="9" ry="5" fill="#f5b7a5" opacity=".6"/>${bandana ? `<path d="M52 160 q48 26 96 0 l-10 22 q-38 14 -76 0 z" fill="${bandana}"/>` : ''}</g>`;
const cat = (x, y, s, rot, fur = '#9a9a9a', stripes = '') => `<g transform="translate(${x} ${y}) scale(${s}) rotate(${rot} 100 100)">
  <polygon points="46,96 60,34 104,78" fill="${fur}"/><polygon points="154,96 140,34 96,78" fill="${fur}"/><polygon points="56,86 64,52 92,78" fill="#f4b6b6"/><polygon points="144,86 136,52 108,78" fill="#f4b6b6"/>
  <circle cx="100" cy="108" r="62" fill="${fur}"/>${stripes ? `<g fill="${stripes}" opacity=".8"><path d="M84 52 q16 10 32 0 l-4 16 q-12 -6 -24 0 z"/><path d="M44 90 q8 -14 20 -18 l-2 14 q-8 4 -12 12 z"/><path d="M156 90 q-8 -14 -20 -18 l2 14 q8 4 12 12 z"/></g>` : ''}<ellipse cx="100" cy="132" rx="30" ry="22" fill="#fff7ef"/>
  <ellipse cx="76" cy="98" rx="8" ry="9" fill="${DARK}"/><ellipse cx="124" cy="98" rx="8" ry="9" fill="${DARK}"/><circle cx="79" cy="94" r="2.6" fill="#fff"/><circle cx="127" cy="94" r="2.6" fill="#fff"/>
  <path d="M94 120 l6 6 l6 -6 z" fill="#f28b8b"/><path d="M100 126 q0 8 -8 10 M100 126 q0 8 8 10" stroke="${DARK}" stroke-width="3" fill="none" stroke-linecap="round"/>
  <g stroke="${DARK}" stroke-width="2.5" stroke-linecap="round" opacity=".7"><path d="M70 124 L36 116 M70 130 L34 132 M130 124 L164 116 M130 130 L166 132"/></g></g>`;
const paw = (x, y, s, color, op) => `<g transform="translate(${x} ${y}) scale(${s})" opacity="${op}"><ellipse cx="50" cy="66" rx="21" ry="17" fill="${color}"/><ellipse cx="24" cy="44" rx="9" ry="12" fill="${color}" transform="rotate(-20 24 44)"/><ellipse cx="76" cy="44" rx="9" ry="12" fill="${color}" transform="rotate(20 76 44)"/><ellipse cx="39" cy="26" rx="9" ry="12" fill="${color}" transform="rotate(-6 39 26)"/><ellipse cx="61" cy="26" rx="9" ry="12" fill="${color}" transform="rotate(6 61 26)"/></g>`;
const heart = (x, y, s) => `<path transform="translate(${x} ${y}) scale(${s})" d="M50 88 C 20 66, 6 48, 10 30 C 14 12, 38 8, 50 26 C 62 8, 86 12, 90 30 C 94 48, 80 66, 50 88 Z" fill="#ff6b4a"/>`;

const ball = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})"><circle cx="50" cy="50" r="46" fill="#c6e35b"/><path d="M18 22 q32 28 0 56 M82 22 q-32 28 0 56" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round"/></g>`;
const bone = (x, y, s, rot) => `<g transform="translate(${x} ${y}) scale(${s}) rotate(${rot} 50 25)" fill="#fff"><rect x="22" y="17" width="56" height="16" rx="8"/><circle cx="18" cy="14" r="11"/><circle cx="18" cy="36" r="11"/><circle cx="82" cy="14" r="11"/><circle cx="82" cy="36" r="11"/></g>`;
const confetti = () => {
  const pts = [[740,40,'#ffe08a'],[700,140,'#3ec5b7'],[800,24,'#fff'],[1150,80,'#ffe08a'],[1100,300,'#c6e35b'],[1160,480,'#fff'],[660,560,'#ffe08a'],[560,600,'#3ec5b7'],[980,596,'#ff8fb1'],[820,590,'#fff'],[1060,20,'#ff8fb1'],[700,470,'#fff']];
  return pts.map(([x,y,c],i)=> i%2 ? `<circle cx="${x}" cy="${y}" r="${6+(i%3)*2}" fill="${c}" opacity=".9"/>` : `<rect x="${x}" y="${y}" width="14" height="14" rx="3" fill="${c}" opacity=".9" transform="rotate(${i*23} ${x} ${y})"/>`).join('');
};

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6b4a"/><stop offset="1" stop-color="#ff9a3c"/></linearGradient>
    <linearGradient id="blob" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3d6"/><stop offset="1" stop-color="#ffe08a"/></linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  ${paw(-10, 440, 2.2, '#fff', 0.10)}${paw(1010, -30, 1.6, '#fff', 0.12)}${paw(470, 500, 1.1, '#fff', 0.10)}
  ${confetti()}
  <path d="M700 130 C 660 50, 930 0, 1080 50 C 1200 100, 1220 330, 1160 470 C 1100 590, 830 610, 750 520 C 690 450, 760 330, 700 130 Z" fill="url(#blob)"/>
  ${dog(690, 300, 1.5, -10)}
  ${dog(820, 120, 1.4, 8, '#e8b35a', '#c98a3a', '#3ec5b7')}
  ${cat(950, 285, 1.55, 10, '#f0a35e', '#c9702b')}
  ${cat(1010, 90, 1.15, -8, '#9a9a9a')}
  ${heart(900, 60, 1.1)}${heart(1120, 330, 0.55)}
  ${ball(735, 485, 0.9)}${bone(1040, 500, 1.1, -18)}
  <text x="72" y="200" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="112" fill="#fff" letter-spacing="-2">PAWME</text>
  <text x="76" y="290" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="48" fill="#fff">Playdates for your pet</text>
  <text x="76" y="352" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="48" fill="#fff">— now in Makati</text>
  <text x="76" y="418" font-family="DejaVu Sans, sans-serif" font-size="27" fill="#fff" opacity=".92">Swipe, match and chat with owners nearby.</text>
  <rect x="76" y="476" width="270" height="72" rx="36" fill="#fff"/>
  <text x="211" y="524" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="30" fill="#e2502f">Get started</text>
  <text x="76" y="592" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="24" fill="#fff" opacity=".85">www.pawme.biz</text>
</svg>`;

await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toFile('public/og.png');
const { width, height, size } = await sharp('public/og.png').metadata().then(async (m) => ({ ...m, size: (await import('node:fs')).statSync('public/og.png').size }));
console.log(`public/og.png ${width}×${height}, ${(size / 1024) | 0} KB`);
