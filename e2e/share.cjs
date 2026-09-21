// Run (dev server up, dev project seeded, test accounts reset, 0003 free):
//   node --env-file=.env.seed.local e2e/share.cjs
// The growth loop (§11): the match share card renders, is public-safe (no owner
// name, no location — on the image, in the share text, or in the file), shares
// through the native sheet with download + copy-link fallbacks, and the ?ref=
// link it carries credits the sharer when a new person signs up.
const { chromium } = require('playwright');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const ORIGIN = 'http://localhost:5173';
if (!/ooigdeefqwgzkpujvexu/.test(process.env.SUPABASE_URL ?? '')) { console.error('refused: SUPABASE_URL is not pawme-dev'); process.exit(1); }
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const checks = [];
const check = (name, ok, extra = '') => { checks.push(!!ok); log(ok ? 'PASS' : 'FAIL', name, extra); };
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

// Anything that would identify an owner or a place. Pet names and the app's own host are fine.
const FORBIDDEN = [/\b(ana|ben|dana)\b/i, /makati|taguig|bgc|barangay|salcedo|rockwell|ayala|poblacion|legazpi/i, /\bkm\b|\baway\b|nearby|near you/i, /\d{1,3}\.\d{3,}/, /\+?63\d{6,}|09\d{9}/];
const leaks = (s) => FORBIDDEN.filter((re) => re.test(s)).map(String);

// Records every string drawn onto any canvas, and (optionally) fakes a native share sheet.
const HOOKS = (withNativeShare) => `
  window.__drawn = [];
  for (const fn of ['fillText', 'strokeText']) {
    const orig = CanvasRenderingContext2D.prototype[fn];
    CanvasRenderingContext2D.prototype[fn] = function (text, ...rest) { window.__drawn.push(String(text)); return orig.call(this, text, ...rest); };
  }
  ${withNativeShare ? `
  window.__shared = [];
  navigator.canShare = (d) => !d.files || d.files.every((f) => f instanceof File);
  navigator.share = async (d) => { window.__shared.push({ text: d.text ?? null, url: d.url ?? null, title: d.title ?? null, files: (d.files ?? []).map((f) => ({ name: f.name, type: f.type, size: f.size })) }); };` : ''}
`;

async function usersByPhone() {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  return Object.fromEntries(data.users.filter((u) => u.phone).map((u) => [u.phone, u]));
}
async function freeFreshNumber() {
  const u = (await usersByPhone())['639170000003'];
  if (u) await admin.auth.admin.deleteUser(u.id);
}
async function signIn(page, local) {
  await page.goto(ORIGIN + '/');
  await page.click('text=Get started');
  await page.fill('#phone', local); await page.click('text=Send code');
  await page.fill('#otp', '123456'); await page.click('text=Verify');
}
const topCard = (page) => page.locator('[role=group][aria-label*="Swipe right"]');
const topName = async (page) => ((await topCard(page).getAttribute('aria-label', { timeout: 15000 })) ?? '').split('.')[0];
async function swipeUntil(page, target) {
  for (let i = 0; i < 40; i++) {
    if ((await topName(page)) === target) { await page.click('[aria-label="Like"]'); return; }
    await page.click('[aria-label="Pass"]'); await page.waitForTimeout(650);
  }
  throw new Error(`${target} never appeared`);
}
const cardBytes = (page) => page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.querySelector('[data-testid=share-card]').src)).arrayBuffer()))).then((a) => Buffer.from(a));
async function regionMean(buf, cx, cy) {
  const { data, info } = await sharp(buf).extract({ left: cx - 40, top: cy - 40, width: 80, height: 80 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += info.channels) for (let c = 0; c < 3; c++) sum[c] += data[i + c];
  return sum.map((s) => Math.round(s / (data.length / info.channels)));
}

(async () => {
  await freeFreshNumber();
  const users = await usersByPhone();
  const codes = Object.fromEntries((await admin.from('owners').select('id, referral_code').in('id', [users['639170000001'].id, users['639170000002'].id])).data.map((o) => [o.id, o.referral_code]));
  const anaCode = codes[users['639170000001'].id], benCode = codes[users['639170000002'].id];

  const browser = await chromium.launch();
  const errors = [];
  const mk = async (tag, opts, init) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...opts });
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
    return { ctx, page };
  };
  const { page: ben } = await mk('ben', {}, HOOKS(true));                                                   // a phone WITH a native share sheet
  const { ctx: anaCtx, page: ana } = await mk('ana', { acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] }, HOOKS(false)); // a browser WITHOUT one

  await signIn(ana, '9170000001'); await topCard(ana).waitFor({ timeout: 20000 }); await swipeUntil(ana, 'Bruno');
  await signIn(ben, '9170000002'); await topCard(ben).waitFor({ timeout: 20000 }); await swipeUntil(ben, 'Mochi');
  await ben.waitForSelector('text=PAW-MATCH', { timeout: 15000 });

  // ---------------------------------------------------------------- 1. the card renders
  await ben.click('text=Share this match');
  await ben.waitForSelector('[data-testid=share-card]', { timeout: 20000 });
  await ben.waitForTimeout(500);
  await shot(ben, 'h1-share-sheet-native');
  const card = await cardBytes(ben);
  fs.writeFileSync(path.join(OUT, 'h2-share-card-bruno-mochi.jpg'), card);
  const meta = await sharp(card).metadata();
  check('share card renders: 1080×1350 JPEG', meta.format === 'jpeg' && meta.width === 1080 && meta.height === 1350, `${meta.width}x${meta.height}, ${(card.length / 1024) | 0} KB`);
  const PLACEHOLDER = [255, 217, 207];
  const far = (rgb) => Math.hypot(...rgb.map((v, i) => v - PLACEHOLDER[i])) > 40;
  const [left, right] = [await regionMean(card, 235, 410), await regionMean(card, 845, 410)];
  const differ = Math.hypot(...left.map((v, i) => v - right[i])) > 40;
  check('both pet PHOTOS are drawn — two different photos, neither the paw placeholder', far(left) && far(right) && differ, `avatar backdrops rgb ${left} vs ${right}`);

  // ---------------------------------------------------------------- 2. public-safe
  const drawn = await ben.evaluate(() => window.__drawn);
  check('text on the card: both pet names + "a Paw Match on PAWME"', drawn.some((t) => t.includes('Bruno') && t.includes('Mochi')) && drawn.includes('a Paw Match on PAWME'), JSON.stringify(drawn));
  const drawnLeaks = drawn.flatMap(leaks);
  check('NO owner name and NO location anywhere in the text drawn on the card', drawnLeaks.length === 0, drawnLeaks.join(' ') || `checked ${drawn.length} strings against ${FORBIDDEN.length} patterns`);
  check('the image file carries no metadata (no EXIF/XMP/ICC comments to leak anything)', !meta.exif && !meta.xmp && !meta.iptc);
  const overlayText = await ben.locator('[aria-label="It\'s a Paw-Match"] p').first().innerText();
  check('control: the in-app overlay DOES know the owner name — the card simply is not given it', /Ana/.test(overlayText), overlayText.replace(/\s+/g, ' '));

  // long names must shrink/trim to fit rather than run off the card
  const longDrawn = await ben.evaluate(async () => {
    const { renderMatchCard } = await import('/src/lib/shareCard.ts');
    window.__drawn = [];
    const blob = await renderMatchCard({ name: 'Sir Barksalot the Magnificent III' }, { name: 'Princess Fluffington von Whiskers' }, 'pawme.app');
    return { size: blob.size, names: window.__drawn.find((s) => s.includes('♥')) };
  });
  check('very long names: each name is trimmed, the heart and BOTH pets stay (missing photos fall back to a paw)', longDrawn.size > 20000 && /^Sir .+…\s+♥\s+Princess .+…$/.test(longDrawn.names ?? ''), longDrawn.names);

  // ---------------------------------------------------------------- 3. native share
  await ben.click('button:text-is("Share…")');
  const shared = (await ben.evaluate(() => window.__shared))[0];
  check('native share sheet receives the image file', shared?.files.length === 1 && shared.files[0].type === 'image/jpeg' && shared.files[0].size === card.length, JSON.stringify(shared?.files));
  check('share link is the sharer\'s ?ref= deep link', shared?.url === `${ORIGIN}/?ref=${benCode}`, shared?.url);
  check('share text is public-safe and also carries the link', leaks(shared.text.replace(ORIGIN, '')).length === 0 && shared.text.includes(`?ref=${benCode}`), shared.text);
  await ben.click('text=Not now');

  // ---------------------------------------------------------------- 4. fallbacks (no native share): download + copy link
  await ana.click('nav >> text=Matches'); await ana.click('text=Bruno');
  await ana.click('text=Share this match');
  await ana.waitForSelector('[data-testid=share-card]', { timeout: 20000 });
  await ana.waitForTimeout(500);
  await shot(ana, 'h3-share-sheet-fallback');
  check('without a native share sheet there is no "Share…" button — download + copy link instead', (await ana.locator('button:text-is("Share…")').count()) === 0 && (await ana.locator('text=Download image').count()) === 1);
  const anaDrawn = await ana.evaluate(() => window.__drawn);
  check("Ana's card leads with HER pet and is just as clean", anaDrawn.some((t) => /^Mochi\s+♥\s+Bruno$/.test(t)) && anaDrawn.flatMap(leaks).length === 0, JSON.stringify(anaDrawn.filter((t) => t.includes('♥'))));
  const [download] = await Promise.all([ana.waitForEvent('download'), ana.click('text=Download image')]);
  const saved = path.join(OUT, download.suggestedFilename());
  await download.saveAs(saved);
  const dl = await sharp(saved).metadata();
  check('download fallback saves the card', download.suggestedFilename() === 'pawme-match-mochi-bruno.jpg' && dl.width === 1080 && dl.height === 1350, download.suggestedFilename());
  await ana.click('text=Copy link');
  await ana.waitForSelector('text=Link copied!');
  const clip = await ana.evaluate(() => navigator.clipboard.readText());
  check("copy-link fallback copies Ana's ?ref= link", clip === `${ORIGIN}/?ref=${anaCode}`, clip);
  await anaCtx.close();

  // ---------------------------------------------------------------- 5. the ref link resolves → install/create-a-pet → inviter credited
  const { page: friend } = await mk('friend', { permissions: [] });
  await friend.goto(shared.url);
  await friend.waitForSelector('[data-testid=invited]', { timeout: 15000 });
  await shot(friend, 'h4-invited-welcome');
  check('tapping the link opens PAWME\'s welcome with the invite acknowledged + "Get started"', (await friend.locator('text=Get started').count()) === 1 && (await friend.evaluate(() => localStorage.getItem('pawme:ref'))) === benCode);
  await friend.click('text=Get started');
  await friend.fill('#phone', '0917 000 0003'); await friend.click('text=Send code');
  await friend.fill('#otp', '123456'); await friend.click('text=Verify');
  await friend.waitForSelector('text=First, about you', { timeout: 20000 });
  await friend.fill('#owner-name', 'Dana'); await friend.check('input[type=checkbox]'); await friend.click('button:has-text("Continue")');
  await friend.waitForSelector('text=Where do you and your pet live?', { timeout: 15000 });
  const dana = (await usersByPhone())['639170000003'];
  const referred = (await admin.from('owners').select('referred_by').eq('id', dana.id).single()).data.referred_by;
  check('the new sign-up is credited to the sharer (owners.referred_by = Ben)', referred === users['639170000002'].id);
  const { page: junk } = await mk('junk', {});
  await junk.goto(`${ORIGIN}/?ref=%3Cscript%3Ealert(1)%3C%2Fscript%3E`);
  await junk.waitForSelector('text=Get started');
  check('a malformed ?ref= is ignored', (await junk.evaluate(() => localStorage.getItem('pawme:ref'))) === null && (await junk.locator('[data-testid=invited]').count()) === 0);

  // ---------------------------------------------------------------- 6. empty Discover → invite
  await ben.click('text=Keep swiping');
  for (let i = 0; i < 40 && !(await ben.locator("text=You've met everyone nearby for now").count()); i++) { await ben.click('[aria-label="Pass"]').catch(() => {}); await ben.waitForTimeout(650); }
  await ben.waitForSelector("text=You've met everyone nearby for now", { timeout: 15000 });
  await shot(ben, 'h5-empty-discover-invite');
  await ben.click('button:has-text("Invite a friend")');
  const invite = (await ben.evaluate(() => window.__shared)).at(-1);
  check('empty Discover → "Invite a friend" opens the share sheet with the ?ref= link', invite?.url === `${ORIGIN}/?ref=${benCode}` && invite.files.length === 0, invite?.url);

  check('no uncaught page or console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  await browser.close();
  await freeFreshNumber();
  const failed = checks.filter((c) => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('E2E ERROR:', e.message.split('\n').slice(0, 3).join(' | ')); process.exit(2); });
