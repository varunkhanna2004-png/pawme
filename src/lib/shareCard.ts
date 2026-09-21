// The shareable match card (master prompt §11) — drawn on a canvas in the browser.
//
// PUBLIC-SAFE BY CONSTRUCTION: this module's only inputs are two pet names and
// two pet photos. It is never handed an owner name, a distance, a barangay or a
// coordinate, so none of them can end up on an image that leaves the app.

export interface SharePet {
  name: string;
  photoUrl?: string;
}

const W = 1080;
const H = 1350; // 4:5 — shows uncropped in Instagram/Facebook feeds and fine in stories/chats
const BRAND = '#ff6b4a';
const BRAND_DARK = '#e2502f';
const CREAM = '#fff8f1';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

async function loadPhoto(url?: string): Promise<ImageBitmap | null> {
  if (!url) return null;
  try {
    // fetch (not <img>) so the pixels are CORS-clean and the canvas stays exportable.
    // The query string keeps us off any copy the browser cached from a plain <img> load.
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}share=1`, { mode: 'cors' });
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null; // the card still renders, with a paw in place of the photo
  }
}

function paw(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string) {
  ctx.fillStyle = color;
  const dot = (dx: number, dy: number, rx: number, ry: number, rot = 0) => {
    ctx.beginPath();
    ctx.ellipse(cx + dx * size, cy + dy * size, rx * size, ry * size, rot, 0, Math.PI * 2);
    ctx.fill();
  };
  dot(0, 0.28, 0.42, 0.34);
  dot(-0.5, -0.12, 0.17, 0.23, -0.35);
  dot(0.5, -0.12, 0.17, 0.23, 0.35);
  dot(-0.2, -0.48, 0.17, 0.24, -0.1);
  dot(0.2, -0.48, 0.17, 0.24, 0.1);
}

function heart(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(0, size * 0.35);
  ctx.bezierCurveTo(-size * 1.1, -size * 0.35, -size * 0.45, -size * 1.05, 0, -size * 0.4);
  ctx.bezierCurveTo(size * 0.45, -size * 1.05, size * 1.1, -size * 0.35, 0, size * 0.35);
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,.25)';
  ctx.shadowBlur = 24;
  ctx.fill();
  ctx.restore();
}

function avatar(ctx: CanvasRenderingContext2D, img: ImageBitmap | null, cx: number, cy: number, r: number, tilt: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  ctx.shadowColor = 'rgba(0,0,0,.28)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 12;
  ctx.beginPath();
  ctx.arc(0, 0, r + 14, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();
  if (img) {
    const scale = Math.max((2 * r) / img.width, (2 * r) / img.height); // cover
    ctx.drawImage(img, (-img.width * scale) / 2, (-img.height * scale) / 2, img.width * scale, img.height * scale);
  } else {
    ctx.fillStyle = '#ffd9cf';
    ctx.fillRect(-r, -r, 2 * r, 2 * r);
    paw(ctx, 0, 10, r * 0.75, BRAND);
  }
  ctx.restore();
}

/**
 * "A ♥ B", centred. Shrinks the font first; if the names still don't fit, trims
 * whichever NAME is longer — never the line as a whole, which would cut off the
 * heart and the second pet.
 */
function fitNames(ctx: CanvasRenderingContext2D, a: string, b: string, cx: number, y: number, maxWidth: number, startPx: number, minPx: number) {
  let px = startPx;
  const line = () => `${a}  ♥  ${b}`;
  ctx.font = `800 ${px}px ${FONT}`;
  while (ctx.measureText(line()).width > maxWidth && px > minPx) ctx.font = `800 ${(px -= 4)}px ${FONT}`;
  const trim = (s: string) => `${s.replace(/…$/, '').slice(0, -1).trimEnd()}…`;
  while (ctx.measureText(line()).width > maxWidth && Math.max(a.length, b.length) > 4) {
    if (a.length >= b.length) a = trim(a);
    else b = trim(b);
  }
  ctx.fillText(line(), cx, y);
}

export async function renderMatchCard(a: SharePet, b: SharePet, host: string): Promise<Blob> {
  const [imgA, imgB] = await Promise.all([loadPhoto(a.photoUrl), loadPhoto(b.photoUrl)]);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, BRAND);
  bg.addColorStop(1, BRAND_DARK);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.1;
  paw(ctx, 140, 170, 120, '#fff');
  paw(ctx, 960, 1190, 150, '#fff');
  paw(ctx, 930, 250, 70, '#fff');
  ctx.globalAlpha = 1;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.font = `800 64px ${FONT}`;
  ctx.fillText("IT'S A PAW-MATCH!", W / 2, 190);

  avatar(ctx, imgA, 340, 520, 215, -0.07);
  avatar(ctx, imgB, 740, 520, 215, 0.07);
  heart(ctx, W / 2, 545, 92);

  ctx.fillStyle = '#fff';
  fitNames(ctx, a.name, b.name, W / 2, 900, W - 140, 96, 52);
  ctx.font = `600 50px ${FONT}`;
  ctx.globalAlpha = 0.95;
  ctx.fillText('a Paw Match on PAWME', W / 2, 985);
  ctx.globalAlpha = 1;

  // footer: brand + where to get it. No owner, no place.
  ctx.fillStyle = CREAM;
  ctx.beginPath();
  ctx.roundRect(90, 1105, W - 180, 150, 75);
  ctx.fill();
  paw(ctx, 190, 1178, 46, BRAND);
  ctx.fillStyle = BRAND_DARK;
  ctx.textAlign = 'left';
  const footerWidth = W - 180 - (262 - 90) - 60; // inside the pill, right of the paw
  fitLeft(ctx, "Find your pet's new best friend", 262, 1172, footerWidth, 46, 30, 800);
  ctx.fillStyle = '#8a7f78';
  fitLeft(ctx, host, 262, 1224, footerWidth, 38, 26, 600);

  imgA?.close();
  imgB?.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('could not export the card');
  return blob;
}

/** Left-aligned version of fitText: shrink, then trim, until the text fits. */
function fitLeft(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, startPx: number, minPx: number, weight: number) {
  let px = startPx;
  let out = text;
  ctx.font = `${weight} ${px}px ${FONT}`;
  while (ctx.measureText(out).width > maxWidth && px > minPx) ctx.font = `${weight} ${(px -= 2)}px ${FONT}`;
  while (ctx.measureText(out).width > maxWidth && out.length > 4) out = `${out.slice(0, -2)}…`;
  ctx.fillText(out, x, y);
}

export const CARD_SIZE = { width: W, height: H };
