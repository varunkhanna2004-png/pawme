// Run (dev server up, dev project seeded, test accounts reset):  node e2e/safety.cjs
// Trust & safety (§9) end to end in three headless browsers: Ana, Ben and the moderator.
const { chromium } = require('playwright');
const OUT = require('path').join(__dirname, 'shots');
require('fs').mkdirSync(OUT, { recursive: true });
const URL = 'http://localhost:5173/';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const checks = [];
const check = (name, ok, extra = '') => { checks.push(ok); log(ok ? 'PASS' : 'FAIL', name, extra); };
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

async function signIn(page, local, waitFor = 'nav >> text=Discover') {
  await page.goto(URL);
  await page.click('text=Get started');
  await page.fill('#phone', local);
  await page.click('text=Send code');
  await page.fill('#otp', '123456');
  await page.click('text=Verify');
  await page.waitForSelector(waitFor, { timeout: 20000 });
}
const topCard = (page) => page.locator('[role=group][aria-label*="Swipe right"]');
const topName = async (page) => ((await topCard(page).getAttribute('aria-label', { timeout: 15000 })) ?? '').split('.')[0];
async function drag(page, dir) {
  const box = await topCard(page).boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2, dx = dir === 'right' ? 220 : -220;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(x + (dx * i) / 10, y + i); await page.waitForTimeout(12); }
  await page.mouse.up(); await page.waitForTimeout(550);
}
async function swipeUntil(page, target) {
  for (let i = 0; i < 30; i++) { if ((await topName(page)) === target) return drag(page, 'right'); await drag(page, 'left'); }
  throw new Error(`${target} never appeared`);
}
const sheet = (page) => page.locator('[role=dialog][aria-label="Safety options"]');

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (tag) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
    page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
    return page;
  };
  const ana = await mk('ana'), ben = await mk('ben'), mod = await mk('mod');
  await signIn(ana, '9170000001'); await signIn(ben, '9170000002');

  // --- set-up: Ana ↔ Ben match, Ana ↔ Thor match (Thor's owner pre-liked Mochi)
  await topCard(ana).waitFor(); await swipeUntil(ana, 'Bruno');
  await topCard(ben).waitFor(); await swipeUntil(ben, 'Mochi');
  await ben.waitForSelector('text=PAW-MATCH'); await ben.click('text=Say hi');
  await ben.waitForSelector('text=Break the ice');
  await swipeUntil(ana, 'Thor');
  await ana.waitForSelector('text=PAW-MATCH'); await ana.click('text=Keep swiping');
  check('set-up: Ana matched with Bruno (Ben) and Thor (Paolo)', true);

  // --- 1. DISCOVER: report (+block) from a pet card
  const reported = await topName(ana);
  await ana.click(`[aria-label^="Report or block ${reported}"]`);
  await sheet(ana).waitFor();
  await shot(ana, 's1-discover-menu');
  check('Discover card menu offers Block + Report but not Unmatch', (await sheet(ana).locator('text=/^Block /').count()) === 1 && (await sheet(ana).locator('text=/^Report /').count()) === 1 && (await sheet(ana).locator('text=Unmatch').count()) === 0);
  await sheet(ana).locator('text=/^Report /').click();
  const reasons = await sheet(ana).locator('[role=radio]').allInnerTexts();
  check('report form lists the six §9 reasons', reasons.length === 6, reasons.map((r) => r.split('\n')[0]).join(' | '));
  check('"Send report" is disabled until a reason is picked', await sheet(ana).locator('button:has-text("Send report")').isDisabled());
  await sheet(ana).locator('[role=radio]:has-text("Spam")').click();
  await sheet(ana).locator('[aria-label="Details"]').fill('Profile is an ad for a pet shop');
  await shot(ana, 's2-report-form');
  await sheet(ana).locator('text=Send report').click();
  await sheet(ana).locator('text=/Report sent/').waitFor({ timeout: 15000 });
  await sheet(ana).locator('text=Done').click();
  await ana.waitForTimeout(600);
  check('reported + blocked card leaves the deck', (await topName(ana)) !== reported, `${reported} → ${await topName(ana)}`);

  // --- 2. DISCOVER: block only
  const blocked = await topName(ana);
  await ana.click(`[aria-label^="Report or block ${blocked}"]`);
  await sheet(ana).locator('text=/^Block /').click();
  await sheet(ana).locator('button:text-is("Block")').click();
  await sheet(ana).locator('text=/ blocked$/').waitFor({ timeout: 15000 });
  await sheet(ana).locator('text=Done').click();
  await ana.waitForTimeout(600);
  check('blocked card leaves the deck', (await topName(ana)) !== blocked, `${blocked} → ${await topName(ana)}`);
  await ana.reload(); await topCard(ana).waitFor({ timeout: 20000 });
  const deckAfter = [];
  for (let i = 0; i < 3; i++) deckAfter.push(await topName(ana));
  check('after a reload the server no longer deals either pet', !deckAfter.includes(reported) && !deckAfter.includes(blocked), `top: ${deckAfter[0]}`);

  // --- 3. MATCHES INBOX: unmatch
  await ana.click('nav >> text=Matches');
  await ana.waitForSelector('text=Thor');
  await shot(ana, 's3-inbox-with-menus');
  await ana.click('[aria-label^="Options for Thor"]');
  await sheet(ana).locator('text=Unmatch').first().click();
  await sheet(ana).locator('button:text-is("Unmatch")').click();
  await sheet(ana).locator('text=/^Unmatched Thor/').waitFor({ timeout: 15000 });
  await sheet(ana).locator('text=Done').click();
  await ana.waitForTimeout(800);
  check('unmatch from the inbox removes Thor and keeps Bruno', (await ana.locator('text=Thor').count()) === 0 && (await ana.locator('text=Bruno').count()) > 0);

  // --- 4. CHAT: report + block closes the conversation for BOTH, live
  await ana.click('text=Bruno'); await ana.waitForSelector('[aria-label="Message"]');
  await ana.waitForTimeout(2500);
  const scam = 'Send a P5000 deposit to my GCash first, then we can meet';
  await ben.fill('[aria-label="Message"]', scam); await ben.click('[aria-label="Send"]');
  await ana.waitForSelector(`text=${scam}`, { timeout: 15000 });
  await ana.click('[aria-label^="Safety options"]');
  await sheet(ana).waitFor();
  await shot(ana, 's4-chat-menu');
  check('Chat menu offers Unmatch + Block + Report', (await sheet(ana).locator('li').count()) === 3);
  await sheet(ana).locator('text=/^Report /').click();
  await sheet(ana).locator('[role=radio]:has-text("Scam")').click();
  await sheet(ana).locator('[aria-label="Details"]').fill('Asked for money before meeting');
  check('chat report says the last message will be attached', (await sheet(ana).locator('text=most recent message will be attached').count()) === 1);
  await sheet(ana).locator('text=Send report').click();
  await sheet(ana).locator('text=/Report sent · Ben blocked/').waitFor({ timeout: 15000 });
  await shot(ana, 's5-report-done');
  const t0 = Date.now();
  await ben.waitForSelector("text=This chat isn't available", { timeout: 15000 });
  check("Ben's OPEN chat closes live (he is not told why)", true, `${Date.now() - t0} ms, no reload`);
  await shot(ben, 's6-ben-chat-closed');
  await sheet(ana).locator('text=Done').click();
  await ana.waitForSelector('text=No matches yet', { timeout: 15000 });
  check("Ana lands on her inbox and the conversation is gone", true);
  await ben.click('text=Back to matches');
  await ben.waitForSelector('text=No matches yet', { timeout: 15000 });
  check("Ben's inbox no longer shows Mochi", true);
  await ben.click('nav >> text=Discover'); await ben.waitForTimeout(2500);
  const benDeck = await ben.locator('[role=group][aria-label*="Swipe right"]').count() ? await topName(ben) : '(empty)';
  check("Ben's deck does not deal Mochi again", benDeck !== 'Mochi', `top: ${benDeck}`);

  // --- 5. MODERATION QUEUE
  await signIn(mod, '9170000009', 'text=Moderation queue');
  await mod.waitForSelector('[data-testid=report]', { timeout: 15000 });
  await shot(mod, 's7-moderation-queue');
  const cards = await mod.locator('[data-testid=report]').allInnerTexts();
  const scamCard = mod.locator('[data-testid=report]', { hasText: 'Scam' });
  check('both reports reached the moderation queue', cards.length === 2, cards.map((c) => c.split('\n')[0]).join(' | '));
  check('the scam report carries reporter, target, pet, details and the message snapshot', ['Ben', 'Bruno', 'reported by Ana', 'Asked for money', scam].every((s) => cards.find((c) => c.includes('Scam')).includes(s)));
  await scamCard.locator('button:text-is("Suspend")').click();
  await shot(mod, 's8-suspend-confirm');
  await scamCard.locator('text=Confirm suspend').click();
  await mod.waitForFunction(() => document.querySelectorAll('[data-testid=report]').length === 1, null, { timeout: 15000 });
  check('suspend closes the report', true);
  await mod.locator('[data-testid=report] >> text=Dismiss').click();
  await mod.waitForSelector('text=Queue is clear', { timeout: 15000 });
  check('dismiss clears the other report', true);

  // --- 6. the suspended user
  await ben.reload();
  await ben.waitForSelector('text=Account suspended', { timeout: 15000 });
  await shot(ben, 's9-ben-suspended');
  check('suspended owner is locked out on next load', true);
  // a non-moderator cannot reach the queue
  await ana.goto(URL + 'moderation'); await ana.waitForTimeout(1500);
  check('non-moderator cannot open /moderation', (await ana.locator('text=Moderation queue').count()) === 0);

  check('no uncaught page or console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  await browser.close();
  const failed = checks.filter((c) => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('E2E ERROR:', e.message.split('\n').slice(0, 3).join(' | ')); process.exit(2); });
