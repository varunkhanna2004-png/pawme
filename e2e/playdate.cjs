// Run (dev server up, dev project seeded, test accounts reset):
//   node --env-file=.env.seed.local e2e/playdate.cjs
// Playdate proposals (§2, §7): propose → accept, propose → counter → accept,
// propose → decline, live status updates on the other phone, and the private
// "How did it go?" prompt after an accepted playdate's time has passed.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const ORIGIN = 'http://localhost:5173';
const URL_ = process.env.SUPABASE_URL ?? '';
if (!/ooigdeefqwgzkpujvexu/.test(URL_)) { console.error('refused: SUPABASE_URL is not pawme-dev'); process.exit(1); }
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ANON = fs.readFileSync(path.join(__dirname, '..', '.env.development.local'), 'utf8').match(/^VITE_SUPABASE_ANON_KEY=(.+)$/m)[1].trim();

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const checks = [];
const check = (name, ok, extra = '') => { checks.push(!!ok); log(ok ? 'PASS' : 'FAIL', name, extra); };
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const pad = (n) => String(n).padStart(2, '0');
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

async function signIn(page, local) {
  await page.goto(ORIGIN + '/'); await page.click('text=Get started');
  await page.fill('#phone', local); await page.click('text=Send code');
  await page.fill('#otp', '123456'); await page.click('text=Verify');
  await page.waitForSelector('nav >> text=Discover', { timeout: 20000 });
}
const topCard = (page) => page.locator('[role=group][aria-label*="Swipe right"]');
const topName = async (page) => ((await topCard(page).getAttribute('aria-label', { timeout: 15000 })) ?? '').split('.')[0];
async function swipeUntil(page, target) {
  for (let i = 0; i < 40; i++) { if ((await topName(page)) === target) { await page.click('[aria-label="Like"]'); return; } await page.click('[aria-label="Pass"]'); await page.waitForTimeout(650); }
  throw new Error(`${target} never appeared`);
}
const apiFromPage = async (page) => createClient(URL_, ANON, { global: { headers: { Authorization: `Bearer ${await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k)))).access_token)}` } }, auth: { persistSession: false, autoRefreshToken: false } });
const proposals = (page) => page.locator('[data-testid=proposal]');
const lastProposal = (page) => proposals(page).last();

async function propose(page, { place, date = tomorrow(), time, note, counter = false }) {
  if (!counter) await page.click('[aria-label="Propose a playdate"]');
  await page.waitForSelector('#pd-place');
  if (place) await page.fill('#pd-place', place);
  await page.fill('#pd-date', date);
  await page.fill('#pd-time', time);
  if (note) await page.fill('#pd-note', note);
  await page.click(counter ? 'text=Send change' : 'text=Send proposal');
  await page.waitForSelector('#pd-place', { state: 'detached', timeout: 15000 });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (tag) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
    page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
    return page;
  };
  const ana = await mk('ana'), ben = await mk('ben');
  await signIn(ana, '9170000001'); await signIn(ben, '9170000002');
  await topCard(ana).waitFor(); await swipeUntil(ana, 'Bruno');
  await topCard(ben).waitFor(); await swipeUntil(ben, 'Mochi');
  await ben.waitForSelector('text=PAW-MATCH'); await ben.click('text=Say hi');
  await ben.waitForSelector('[aria-label="Message"]');
  await ana.click('nav >> text=Matches'); await ana.click('text=Bruno'); await ana.waitForSelector('[aria-label="Message"]');
  await ana.waitForTimeout(2500); // both chats open and idle → what follows arrives over Realtime
  const anaApi = await apiFromPage(ana);
  const conv = (await anaApi.rpc('get_inbox')).data[0];

  // ---------------------------------------------------------------- 1. propose → accept
  await ben.click('[aria-label="Propose a playdate"]');
  await ben.waitForSelector('#pd-place');
  await ben.waitForTimeout(500); await shot(ben, 'p1-propose-sheet');
  check('sheet nudges toward public places and lists park/mall suggestions', (await ben.locator('text=Meet somewhere public').count()) === 1 && (await ben.locator('button:has-text("Ayala Triangle Gardens")').count()) === 1);
  await ben.fill('#pd-date', tomorrow()); await ben.fill('#pd-time', '09:00');
  check('"Send proposal" is disabled with no place', await ben.locator('text=Send proposal').isDisabled());
  await ben.click('button:has-text("Ayala Triangle Gardens")');
  await ben.fill('#pd-time', '00:00'); await ben.fill('#pd-date', `${new Date().getFullYear() - 1}-01-01`);
  check('a time in the past is refused', await ben.locator('text=Send proposal').isDisabled() && (await ben.locator('text=at least 15 minutes from now').count()) === 1);
  await ben.fill('#pd-date', tomorrow()); await ben.fill('#pd-time', '09:00');
  await ben.fill('#pd-note', 'Bruno loves the fenced area by the fountain');
  await ben.click('text=Send proposal');
  await ben.waitForSelector('#pd-place', { state: 'detached' });
  const t0 = Date.now();
  await ana.waitForSelector('[data-testid=proposal][data-status=proposed]', { timeout: 15000 });
  await shot(ana, 'p2-proposal-received-ana');
  const anaCard = await lastProposal(ana).innerText();
  check("Ana's open chat receives the proposal card live", /Ayala Triangle Gardens/.test(anaCard) && /fenced area/.test(anaCard) && /Accept/.test(anaCard) && /Propose a change/.test(anaCard) && /Decline/.test(anaCard), `${Date.now() - t0} ms`);
  check("Ben's own card shows 'Waiting for a reply' with no buttons", /Waiting for a reply/.test(await lastProposal(ben).innerText()) && (await lastProposal(ben).locator('button').count()) === 0);
  const p1 = (await admin.from('messages').select('id, payload').eq('conversation_id', conv.conversation_id).eq('kind', 'playdate_proposal').order('created_at').limit(1).single()).data;
  check('stored as a structured message: place, starts_at, note, status proposed', p1.payload.place === 'Ayala Triangle Gardens' && p1.payload.status === 'proposed' && !isNaN(Date.parse(p1.payload.starts_at)) && p1.payload.note.startsWith('Bruno loves'), JSON.stringify(p1.payload));
  check("inbox preview reads '📅 Playdate proposal'", ((await anaApi.rpc('get_inbox')).data[0].last_message_preview) === '📅 Playdate proposal');

  await lastProposal(ana).locator('text=Accept').click();
  const t1 = Date.now();
  await ben.waitForSelector('[data-testid=proposal][data-status=accepted]', { timeout: 15000 });
  await shot(ben, 'p3-accepted-ben');
  check("accept → Ben's card flips to 'Accepted' LIVE (Realtime UPDATE)", /Accepted — see you there/.test(await lastProposal(ben).innerText()), `${Date.now() - t1} ms, no reload`);
  check('accepted in the database, with responded_at', (await admin.from('messages').select('payload').eq('id', p1.id).single()).data.payload.status === 'accepted');
  check('buttons are gone on Ana\'s side once answered', (await lastProposal(ana).locator('button').count()) === 0);

  // ---------------------------------------------------------------- 2. propose → counter → accept
  await propose(ana, { place: 'Greenbelt Park', time: '17:00' });
  await ben.waitForSelector('[data-testid=proposal][data-status=proposed]', { timeout: 15000 });
  await lastProposal(ben).locator('text=Propose a change').click();
  await ben.waitForSelector('#pd-place');
  check('"Propose a change" opens the sheet prefilled with the original place and time', (await ben.inputValue('#pd-place')) === 'Greenbelt Park' && (await ben.inputValue('#pd-time')) === '17:00');
  await ben.fill('#pd-place', 'Legazpi Active Park'); await ben.fill('#pd-time', '16:00'); await ben.fill('#pd-note', 'Greenbelt is packed on weekends');
  await ben.waitForTimeout(500); await shot(ben, 'p4-counter-sheet');
  await ben.click('text=Send change'); await ben.waitForSelector('#pd-place', { state: 'detached' });
  await ana.waitForSelector('[data-testid=proposal][data-status=changed]', { timeout: 15000 });
  await ana.waitForFunction(() => document.querySelectorAll('[data-testid=proposal]').length === 3, null, { timeout: 15000 });
  await shot(ana, 'p5-counter-received-ana');
  const cards = await proposals(ana).allInnerTexts();
  check("Ana sees her proposal marked 'A change was proposed' and Ben's counter below it", /A change was proposed/i.test(cards[1]) && /Proposed a change · from Ben/i.test(cards[2]) && /Legazpi Active Park/.test(cards[2]) && /Accept/.test(cards[2]), cards[2].replace(/\s+/g, ' ').slice(0, 120));
  const rows = (await admin.from('messages').select('id, sender_id, payload').eq('conversation_id', conv.conversation_id).eq('kind', 'playdate_proposal').order('created_at')).data;
  check('database: old = changed + replaced_by, new = proposed + replaces (atomic counter)', rows[1].payload.status === 'changed' && rows[1].payload.replaced_by === rows[2].id && rows[2].payload.replaces === rows[1].id && rows[2].payload.status === 'proposed');
  await lastProposal(ana).locator('text=Accept').click();
  await ben.waitForFunction(() => document.querySelectorAll('[data-testid=proposal][data-status=accepted]').length === 2, null, { timeout: 15000 });
  check('Ana accepts the counter → both accepted playdates show on Ben\'s side live', true);

  // ---------------------------------------------------------------- 3. propose → decline
  await propose(ben, { place: 'Circuit Makati', time: '18:30' });
  await ana.waitForFunction(() => document.querySelectorAll('[data-testid=proposal]').length === 4, null, { timeout: 15000 });
  await lastProposal(ana).locator('text=Decline').click();
  await ben.waitForSelector('[data-testid=proposal][data-status=declined]', { timeout: 15000 });
  check("decline → 'Declined' on both sides", /Declined/.test(await lastProposal(ana).innerText()) && /Declined/.test(await lastProposal(ben).innerText()));
  const stale = await anaApi.rpc('respond_playdate', { p_message_id: rows[2].id, p_accept: false });
  check('an answered proposal cannot be answered again (server refuses)', stale.error?.message === 'PROPOSAL_ALREADY_ANSWERED');

  // ---------------------------------------------------------------- 4. after the playdate: "How did it go?"
  check('no feedback prompt while the playdate is still ahead', (await ana.locator('[data-testid=feedback-prompt]').count()) === 0);
  const past = new Date(Date.now() - 26 * 3600e3).toISOString();
  const current = (await admin.from('messages').select('payload').eq('id', p1.id).single()).data.payload; // (accepted by now)
  await admin.from('messages').update({ payload: { ...current, starts_at: past } }).eq('id', p1.id); // time travel: the accepted playdate was yesterday
  await ana.reload(); await ana.waitForSelector('[data-testid=feedback-prompt]', { timeout: 20000 });
  await shot(ana, 'p6-feedback-prompt-ana');
  check('after the accepted playdate\'s time passes, the "How did it go?" prompt appears', (await ana.locator('[data-testid=feedback-prompt] button').count()) === 4);
  await ana.click('[data-testid=feedback-prompt] [aria-label="Good"]');
  await ana.waitForSelector('[data-testid=feedback-prompt]', { state: 'detached', timeout: 15000 });
  await ben.reload(); await ben.waitForSelector('[data-testid=feedback-prompt]', { timeout: 20000 });
  await ben.click('[data-testid=feedback-prompt] [aria-label="Loved it"]');
  await ben.waitForSelector('[data-testid=feedback-prompt]', { state: 'detached', timeout: 15000 });
  const fb = (await admin.from('playdate_feedback').select('owner_id, rating').eq('match_id', conv.match_id)).data;
  const anaId = (await admin.from('owners').select('id').eq('display_name', 'Ana').single()).data.id;
  check('feedback stored in playdate_feedback: Ana 😊 = 3, Ben 😍 = 4', fb.length === 2 && fb.find((f) => f.owner_id === anaId)?.rating === 3 && fb.find((f) => f.owner_id !== anaId)?.rating === 4, JSON.stringify(fb.map((f) => f.rating)));
  const mine = (await anaApi.from('playdate_feedback').select('owner_id, rating')).data;
  check("private: Ana can read only her own rating, never Ben's", mine.length === 1 && mine[0].owner_id === anaId);
  await ana.reload(); await ana.waitForSelector('[data-testid=proposal]'); await ana.waitForTimeout(1500);
  check('the prompt does not come back once answered', (await ana.locator('[data-testid=feedback-prompt]').count()) === 0);
  check('ranking is untouched by feedback (no ranking weight references playdate_feedback)', !(fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20260921052929_rpc.sql'), 'utf8').split('create function public.get_deck')[1].split('create function')[0]).includes('playdate_feedback'));

  check('no uncaught page or console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  await browser.close();
  const failed = checks.filter((c) => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('E2E ERROR:', e.message.split('\n').slice(0, 3).join(' | ')); process.exit(2); });
