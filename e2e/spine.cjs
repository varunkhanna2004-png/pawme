// Run (dev server must be up: npm run dev):  npm i --no-save playwright && npx playwright install chromium && node --env-file=.env.seed.local e2e/spine.cjs
// Needs the seeded dev project (npm run seed:dev). Signs in as the test accounts with email OTP (see e2e/lib.cjs).
// End-to-end proof of the spine, in two real (headless) browsers against pawme-dev:
// Ana+Mochi and Ben+Bruno sign in with test OTPs, swipe each other, match, and chat in realtime.
const { chromium } = require('playwright');
const lib = require('./lib.cjs');
const OUT = require('path').join(__dirname, 'shots');
require('fs').mkdirSync(OUT, { recursive: true });
const URL = 'http://localhost:5173/';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const checks = [];
const check = (name, ok, extra = '') => { checks.push(ok); log(ok ? 'PASS' : 'FAIL', name, extra); };

async function signIn(page, email, shot) {
  await lib.stubOtpSend(page);
  await page.goto(URL);
  await page.click('text=Get started');
  await page.fill('#email', email);
  if (shot) await page.screenshot({ path: `${OUT}/${shot}` });
  await page.click('text=Send code');
  await page.waitForSelector('#otp');
  await page.fill('#otp', await lib.otpFor(email));
  await page.click('text=Verify');
  await page.waitForSelector('text=Discover', { timeout: 25000 });
}
const topCard = (page) => page.locator('[role=group][aria-label*="Swipe right"]');
const topName = async (page) => ((await topCard(page).getAttribute('aria-label', { timeout: 15000 })) ?? '').split('.')[0];

async function drag(page, dir) {
  const box = await topCard(page).boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const dx = dir === 'right' ? 220 : -220;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(x + (dx * i) / 12, y + i, { steps: 1 }); await page.waitForTimeout(12); }
  if (dir === 'right') await page.screenshot({ path: `${OUT}/03-mid-drag-like.png` }).catch(() => {});
  await page.mouse.up();
  await page.waitForTimeout(550);
}

async function swipeUntil(page, who, target) {
  for (let i = 0; i < 30; i++) {
    const name = await topName(page);
    if (name === target) { log(`${who}: ${target} is on top after ${i} passes → swiping RIGHT`); await drag(page, 'right'); return i; }
    await drag(page, 'left');
  }
  throw new Error(`${target} never appeared in ${who}'s deck`);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (tag) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on('websocket', (ws) => ws.on('framereceived', (f) => { const s = String(f.payload); if (/"status":"error"/.test(s)) errors.push(`${tag} realtime: ${s.slice(0, 200)}`); }));
    page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
    return page;
  };
  const ana = await mk('ana'), ben = await mk('ben');

  await signIn(ana, lib.EMAILS.ana, '01-login.png');
  await signIn(ben, lib.EMAILS.ben);
  check('both test accounts signed in through real email-OTP auth (code verified by Supabase Auth)', true);

  await topCard(ana).waitFor({ timeout: 20000 });
  await ana.waitForTimeout(800);
  await ana.screenshot({ path: `${OUT}/02-discover.png` });
  const first = await topName(ana);
  check('Discover shows a ranked seeded deck', !!first, `top card: ${first}`);

  // rewind: pass the top card (unless it is Bruno), take it back
  if (first !== 'Bruno') {
    await drag(ana, 'left');
    const second = await topName(ana);
    await ana.click('[aria-label="Rewind last swipe"]');
    await ana.waitForTimeout(900);
    check('rewind brings the last card back', (await topName(ana)) === first && second !== first, `${first} → ${second} → ${await topName(ana)}`);
  }

  await swipeUntil(ana, 'Ana', 'Bruno');
  check("Ana's like alone does not match", (await ana.locator('text=PAW-MATCH').count()) === 0);

  await ana.click('nav >> text=Matches');
  await ana.waitForSelector('text=No matches yet', { timeout: 15000 });
  await ana.waitForTimeout(3000); // initial loads are long finished
  await topCard(ben).waitFor({ timeout: 20000 });
  await swipeUntil(ben, 'Ben', 'Mochi');
  await ben.waitForSelector('text=PAW-MATCH', { timeout: 15000 });
  await ben.waitForTimeout(700);
  await ben.screenshot({ path: `${OUT}/04-match-overlay-ben.png` });
  check("mutual like → IT'S A PAW-MATCH overlay", true, (await ben.locator('[role=dialog] p').first().innerText()).replace(/\s+/g, ' '));

  // Ana is sitting on her Matches tab: the new match must arrive live (Realtime), no reload.
  const tm = Date.now();
  await ana.waitForSelector('text=Bruno', { timeout: 15000 });
  await ana.screenshot({ path: `${OUT}/05-matches-ana.png` });
  check("match appears LIVE in Ana's already-open inbox (private inbox channel)", true, `${Date.now() - tm} ms after Ben's overlay, no reload`);

  await ben.click('text=Say hi');
  await ben.waitForSelector('text=Break the ice', { timeout: 15000 });
  await ben.screenshot({ path: `${OUT}/06-chat-empty-openers-ben.png` });
  await ana.click('text=Bruno');
  await ana.waitForSelector('text=Break the ice', { timeout: 15000 });

  await ana.waitForTimeout(3000); // both chats idle: any delivery from here on is Realtime, not a load()
  const hello = `Hi Ana! Bruno says woof 🐶 (${Date.now() % 100000})`;
  await ben.fill('[aria-label="Message"]', hello);
  await ben.click('[aria-label="Send"]');
  const t0 = Date.now();
  await ana.waitForSelector(`text=${hello}`, { timeout: 15000 });
  check("Ben's message reaches Ana's open chat in realtime", true, `${Date.now() - t0} ms, no reload`);

  await ana.locator('[aria-label="Message"]').pressSequentially('Mochi is free Sat', { delay: 40 });
  const typingSeen = await ben.waitForSelector('text=is typing', { timeout: 8000 }).then(() => true).catch(() => false);
  if (typingSeen) await ben.screenshot({ path: `${OUT}/07-typing-indicator-ben.png` });
  check('typing indicator crosses the private Realtime channel', typingSeen);
  await ana.locator('[aria-label="Message"]').pressSequentially('urday morning at Ayala Triangle!', { delay: 10 });
  await ana.click('[aria-label="Send"]');
  await ben.waitForSelector('text=Saturday morning at Ayala Triangle', { timeout: 15000 });
  check("Ana's reply reaches Ben in realtime", true);
  const seen = await ana.waitForSelector('text=Seen', { timeout: 10000 }).then(() => true).catch(() => false);
  check('"Seen" read status updates live', seen);
  await ana.waitForTimeout(500);
  await ana.screenshot({ path: `${OUT}/08-chat-ana.png` });
  await ben.screenshot({ path: `${OUT}/09-chat-ben.png` });

  // persistence: reload and the conversation is still there
  await ben.reload();
  await ben.waitForSelector(`text=${hello}`, { timeout: 15000 });
  check('messages persist across a reload (session + data)', true);
  await ben.click('[aria-label="Back to matches"]');
  await ben.waitForSelector('text=Messages', { timeout: 10000 });
  await ben.screenshot({ path: `${OUT}/10-inbox-ben.png` });

  check('no uncaught page or console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  const failed = checks.filter((c) => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('E2E ERROR:', e.message.split('\n')[0]); process.exit(2); });
