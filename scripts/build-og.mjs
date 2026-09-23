// Generates public/og.png (1200×630) — the link preview card for WhatsApp,
// Telegram, Messenger, Facebook and X. Original vector art, same shapes as
// src/components/PetArt.tsx. Run: node scripts/build-og.mjs
import sharp from 'sharp';

const DARK = '#2b2320';
const dog = (x, y, s, rot, fur = '#c98a5b', ear = '#7a4a2b') => `<g transform="translate(${x} ${y}) scale(${s}) rotate(${rot} 100 100)">
  <ellipse cx="44" cy="96" rx="24" ry="48" fill="${ear}" transform="rotate(18 44 96)"/><ellipse cx="156" cy="96" rx="24" ry="48" fill="${ear}" transform="rotate(-18 156 96)"/>
  <circle cx="100" cy="106" r="66" fill="${fur}"/><ellipse cx="100" cy="132" rx="36" ry="28" fill="#fff7ef"/>
  <circle cx="76" cy="94" r="8" fill="${DARK}"/><circle cx="124" cy="94" r="8" fill="${DARK}"/><circle cx="79" cy="91" r="2.6" fill="#fff"/><circle cx="127" cy="91" r="2.6" fill="#fff"/>
  <ellipse cx="100" cy="120" rx="10" ry="7" fill="${DARK}"/><path d="M100 127 q0 12 -11 14 M100 127 q0 12 11 14" stroke="${DARK}" stroke-width="3.5" fill="none" stroke-linecap="round"/>
  <ellipse cx="100" cy="148" rx="8" ry="10" fill="#f28b8b"/><ellipse cx="60" cy="118" rx="9" ry="5" fill="#f5b7a5" opacity=".6"/><ellipse cx="140" cy="118" rx="9" ry="5" fill="#f5b7a5" opacity=".6"/></g>`;
const cat = (x, y, s, rot, fur = '#9a9a9a') => `<g transform="translate(${x} ${y}) scale(${s}) rotate(${rot} 100 100)">
  <polygon points="46,96 60,34 104,78" fill="${fur}"/><polygon points="154,96 140,34 96,78" fill="${fur}"/><polygon points="56,86 64,52 92,78" fill="#f4b6b6"/><polygon points="144,86 136,52 108,78" fill="#f4b6b6"/>
  <circle cx="100" cy="108" r="62" fill="${fur}"/><ellipse cx="100" cy="132" rx="30" ry="22" fill="#fff7ef"/>
  <ellipse cx="76" cy="98" rx="8" ry="9" fill="${DARK}"/><ellipse cx="124" cy="98" rx="8" ry="9" fill="${DARK}"/><circle cx="79" cy="94" r="2.6" fill="#fff"/><circle cx="127" cy="94" r="2.6" fill="#fff"/>
  <path d="M94 120 l6 6 l6 -6 z" fill="#f28b8b"/><path d="M100 126 q0 8 -8 10 M100 126 q0 8 8 10" stroke="${DARK}" stroke-width="3" fill="none" stroke-linecap="round"/>
  <g stroke="${DARK}" stroke-width="2.5" stroke-linecap="round" opacity=".7"><path d="M70 124 L36 116 M70 130 L34 132 M130 124 L164 116 M130 130 L166 132"/></g></g>`;
const paw = (x, y, s, color, op) => `<g transform="translate(${x} ${y}) scale(${s})" opacity="${op}"><ellipse cx="50" cy="66" rx="21" ry="17" fill="${color}"/><ellipse cx="24" cy="44" rx="9" ry="12" fill="${color}" transform="rotate(-20 24 44)"/><ellipse cx="76" cy="44" rx="9" ry="12" fill="${color}" transform="rotate(20 76 44)"/><ellipse cx="39" cy="26" rx="9" ry="12" fill="${color}" transform="rotate(-6 39 26)"/><ellipse cx="61" cy="26" rx="9" ry="12" fill="${color}" transform="rotate(6 61 26)"/></g>`;
const heart = (x, y, s) => `<path transform="translate(${x} ${y}) scale(${s})" d="M50 88 C 20 66, 6 48, 10 30 C 14 12, 38 8, 50 26 C 62 8, 86 12, 90 30 C 94 48, 80 66, 50 88 Z" fill="#ff6b4a"/>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3ea"/><stop offset="1" stop-color="#ffd9cf"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  ${paw(40, 470, 1.4, '#ff6b4a', 0.10)}${paw(1040, 40, 1.1, '#ff6b4a', 0.10)}${paw(560, 20, 0.7, '#ff6b4a', 0.08)}
  <path d="M760 90 C 700 40, 1010 10, 1120 90 C 1200 160, 1170 380, 1080 470 C 990 560, 780 560, 740 440 C 700 330, 800 300, 760 90 Z" fill="#ffc7b8"/>
  ${dog(720, 130, 1.95, -8)}${cat(880, 150, 1.85, 8)}${heart(905, 120, 0.9)}
  <text x="72" y="215" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="104" fill="#ff6b4a" letter-spacing="-2">PAWME</text>
  <text x="76" y="300" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="46" fill="#2b2320">Playdates for your pet</text>
  <text x="76" y="360" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="46" fill="#2b2320">— now in Makati</text>
  <text x="76" y="425" font-family="DejaVu Sans, sans-serif" font-size="28" fill="#8a7f78">Swipe, match and chat with pet owners nearby.</text>
  <rect x="76" y="482" width="270" height="72" rx="36" fill="#ff6b4a"/>
  <text x="211" y="530" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="30" fill="#fff">Get started</text>
  <text x="76" y="596" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="24" fill="#8a7f78">www.pawme.biz</text>
</svg>`;

await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toFile('public/og.png');
const { width, height, size } = await sharp('public/og.png').metadata().then(async (m) => ({ ...m, size: (await import('node:fs')).statSync('public/og.png').size }));
console.log(`public/og.png ${width}×${height}, ${(size / 1024) | 0} KB`);
