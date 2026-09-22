// Run (dev server up, dev project seeded, test accounts reset):
//   node --env-file=.env.seed.local e2e/pilot.cjs
// Profile preview (your card exactly as others see it, public-safe only) and the
// moderator-only stats tab (correct counts; refused for everyone else).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const lib = require('./lib.cjs');
const { admin } = lib;
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const checks = [];
const check = (n, ok, x = '') => { checks.push(!!ok); log(ok ? 'PASS' : 'FAIL', n, x); };
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const count = async (table, filter) => { let q = admin.from(table).select('*', { count: 'exact', head: true }); if (filter) q = filter(q); return (await q).count; };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (tag) => {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
    page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
    return page;
  };

  // ---------------------------------------------------------------- 1. profile preview
  const ana = await mk('ana');
  await lib.signIn(ana, lib.EMAILS.ana);
  const { api: anaApi } = await lib.apiFromPage(ana);
  await ana.click('nav >> text=Settings');
  await ana.click('[data-testid=preview-link]');
  await ana.waitForSelector('[data-testid=card-preview] article', { timeout: 20000 });
  await ana.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
  await shot(ana, 'q1-card-preview');
  const cardText = (await ana.locator('[data-testid=card-preview] article').innerText()).replace(/\s+/g, ' ');
  check('preview renders Ana\'s own card with the deck card component', /Mochi/.test(cardText) && /with Ana/.test(cardText) && /Shih Tzu/.test(cardText) && /Playdate/.test(cardText) && /Playful/i.test(cardText), cardText.slice(0, 140));
  check('the card uses the same fields as the public deck: photo, name, age, breed, sex, size, tags, intent, verified tick, approximate distance', /✓/.test(cardText) && /km away/.test(cardText) && (await ana.locator('[data-testid=card-preview] img').count()) >= 1);
  const pageText = await ana.locator('body').innerText();
  const ownerRow = (await admin.from('owners').select('loc_lat, loc_lng, email').eq('display_name', 'Ana').single()).data;
  check('nothing private on the page: no email, no coordinates, no barangay', !pageText.includes(ownerRow.email) && !pageText.includes(String(ownerRow.loc_lat)) && !pageText.includes(String(ownerRow.loc_lng)) && !/Ayala|Salcedo|barangay/i.test(cardText));
  const myPet = (await admin.from('pets').select('id').eq('owner_id', (await admin.from('owners').select('id').eq('display_name', 'Ana').single()).data.id).single()).data.id;
  const rpc = (await anaApi.rpc('get_pet_profile', { p_viewer_pet_id: myPet, p_pet_id: myPet })).data[0];
  check('the preview comes from get_pet_profile (public-safe fields only — no lat/lng/email keys at all)', !Object.keys(rpc).some((k) => /lat|lng|loc|email|phone/.test(k)), Object.keys(rpc).join(','));
  check('the page explains what others can and can never see', /What other owners can see/.test(pageText) && /Never/.test(pageText) && /exact location/.test(pageText));

  // ---------------------------------------------------------------- 2. stats — refused for a normal owner
  const refused = await anaApi.rpc('get_owner_stats');
  check('get_owner_stats is refused for a non-moderator (server)', refused.error?.message === 'NOT_A_MODERATOR', refused.error?.message);
  await ana.goto(lib.ORIGIN + '/moderation'); await ana.waitForTimeout(1500);
  check('/moderation is not reachable for a non-moderator (client)', (await ana.locator('text=Pilot stats').count()) === 0 && (await ana.locator('text=Moderation queue').count()) === 0);

  // ---------------------------------------------------------------- 3. stats — moderator
  const mod = await mk('mod');
  await lib.signIn(mod, lib.EMAILS.mod, { waitFor: 'text=Moderation queue' });
  await mod.click('[role=tab]:has-text("Stats")');
  await mod.waitForSelector('[data-testid=stats] [data-stat=owners_total]', { timeout: 20000 });
  await shot(mod, 'q2-stats');
  const shown = {};
  for (const key of ['owners_total', 'signups_7d', 'waitlisted', 'pets', 'matches_total', 'messages', 'playdates_proposed', 'reports_open']) shown[key] = Number((await mod.locator(`[data-stat=${key}] div`).first().innerText()).replace(/,/g, ''));
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const truth = {
    owners_total: await count('owners'), signups_7d: await count('owners', (q) => q.gte('created_at', weekAgo)), waitlisted: await count('waitlist'), pets: await count('pets'),
    matches_total: await count('matches'), messages: await count('messages'), playdates_proposed: await count('messages', (q) => q.eq('kind', 'playdate_proposal')), reports_open: await count('reports', (q) => q.eq('status', 'open')),
  };
  check('stats tab shows counts that match the tables exactly', Object.keys(truth).every((k) => shown[k] === truth[k]), `shown ${JSON.stringify(shown)} vs truth ${JSON.stringify(truth)}`);
  check('the seed-data note is shown in dev', /seed accounts/.test(await mod.locator('[data-testid=stats]').innerText()));

  // counts move when the world moves: a match + a message, then refresh
  const ben = await mk('ben');
  await lib.signIn(ben, lib.EMAILS.ben);
  const topName = async (p) => ((await p.locator('[role=group][aria-label*="Swipe right"]').getAttribute('aria-label', { timeout: 15000 })) ?? '').split('.')[0];
  const swipeUntil = async (p, target) => { for (let i = 0; i < 40; i++) { if ((await topName(p)) === target) { await p.click('[aria-label="Like"]'); return; } await p.click('[aria-label="Pass"]'); await p.waitForTimeout(650); } };
  await ana.goto(lib.ORIGIN + '/'); await ana.locator('[role=group][aria-label*="Swipe right"]').waitFor({ timeout: 20000 }); await swipeUntil(ana, 'Bruno');
  await ben.locator('[role=group][aria-label*="Swipe right"]').waitFor({ timeout: 20000 }); await swipeUntil(ben, 'Mochi');
  await ben.waitForSelector('text=PAW-MATCH'); await ben.click('text=Say hi'); await ben.waitForSelector('[aria-label="Message"]');
  await ben.fill('[aria-label="Message"]', 'stats ping'); await ben.click('[aria-label="Send"]'); await ben.waitForSelector('text=stats ping'); await ben.waitForFunction(() => !document.body.innerText.includes('Sending…'), null, { timeout: 15000 });
  await mod.click('text=refresh'); await mod.waitForTimeout(1500);
  const after = { matches: Number(await mod.locator('[data-stat=matches_total] div').first().innerText()), messages: Number(await mod.locator('[data-stat=messages] div').first().innerText()) };
  check('after a new match + message, refresh shows +1 match and +1 message', after.matches === truth.matches_total + 1 && after.messages === truth.messages + 1, JSON.stringify(after));

  check('no uncaught page or console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  await browser.close();
  const failed = checks.filter((c) => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('E2E ERROR:', e.message.split('\n').slice(0, 3).join(' | ')); process.exit(2); });
