// Run (dev server up, dev project seeded, test accounts reset):
//   node --env-file=.env.seed.local e2e/settings.cjs && npm run seed:dev     ← reseed: this test really deletes Ben
// Settings (§5 screen 9, §9): edit pet → visible in another user's deck; in-app
// notification prefs; block → unblock; report history; data export; and account
// deletion through the Edge Function, with the cascade + storage cleanup verified.
const { chromium } = require('playwright');
const lib = require('./lib.cjs');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const ORIGIN = 'http://localhost:5173';
const URL_ = process.env.SUPABASE_URL ?? '';
if (!/ooigdeefqwgzkpujvexu/.test(URL_)) { console.error('refused: SUPABASE_URL is not pawme-dev'); process.exit(1); }
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.development.local'), 'utf8');
const ANON = envFile.match(/^VITE_SUPABASE_ANON_KEY=(.+)$/m)[1].trim();

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const checks = [];
const check = (name, ok, extra = '') => { checks.push(!!ok); log(ok ? 'PASS' : 'FAIL', name, extra); };
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

const asUser = lib.apiAsUser;
/** Same, but riding on the session a browser page already has — avoids a second OTP request for that number (they are rate-limited). */
async function apiFromPage(page) {
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k)))).access_token);
  return { token, api: createClient(URL_, ANON, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } }) };
}
const usersByEmail = lib.usersByEmail;
async function listFiles(bucket, prefix) {
  const out = [];
  for (const item of (await admin.storage.from(bucket).list(prefix, { limit: 1000 })).data ?? []) {
    if (item.id === null) out.push(...(await listFiles(bucket, `${prefix}/${item.name}`))); else out.push(`${prefix}/${item.name}`);
  }
  return out;
}
const signIn = (page, email, waitFor = 'nav >> text=Discover') => lib.signIn(page, email, { waitFor });
const topCard = (page) => page.locator('[role=group][aria-label*="Swipe right"]');
const topName = async (page) => ((await topCard(page).getAttribute('aria-label', { timeout: 15000 })) ?? '').split('.')[0];
async function swipeUntil(page, target, like = true) {
  for (let i = 0; i < 40; i++) {
    if ((await topName(page)) === target) { if (like) await page.click('[aria-label="Like"]'); return true; }
    await page.click('[aria-label="Pass"]'); await page.waitForTimeout(650);
  }
  return false;
}

(async () => {
  const users = await usersByEmail();
  const anaId = users[lib.EMAILS.ana].id, benId = users[lib.EMAILS.ben].id;
  const photoNew = path.join(OUT, 'in-new-main-with-gps.jpg');
  await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="3000"><rect width="2400" height="3000" fill="#7b2cbf"/><circle cx="1200" cy="1400" r="700" fill="#f2e2c4"/><circle cx="980" cy="1250" r="80"/><circle cx="1420" cy="1250" r="80"/><ellipse cx="1200" cy="1560" rx="120" ry="80"/></svg>')).jpeg({ quality: 92 }).withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '14/1 33/1 3644/100', GPSLongitudeRef: 'E', GPSLongitude: '121/1 1/1 2084/100' } }).toFile(photoNew);

  const browser = await chromium.launch();
  const errors = [];
  const mk = async (tag, opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true, ...opts });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
    return page;
  };
  const ana = await mk('ana'), ben = await mk('ben');
  await signIn(ana, lib.EMAILS.ana); await signIn(ben, lib.EMAILS.ben);

  // set-up: Ana ↔ Ben match with a message each way (gives the deletion something real to cascade)
  await topCard(ana).waitFor(); await swipeUntil(ana, 'Bruno');
  await topCard(ben).waitFor(); await swipeUntil(ben, 'Mochi');
  await ben.waitForSelector('text=PAW-MATCH'); await ben.click('text=Say hi');
  await ben.waitForSelector('[aria-label="Message"]');
  await ben.fill('[aria-label="Message"]', 'Hi Ana! Park this weekend?'); await ben.click('[aria-label="Send"]');

  // ================================================================ 1. in-app notifications + the preference
  await ana.waitForSelector('[data-testid=inapp-banner]', { timeout: 15000 });
  const banner1 = await ana.locator('[data-testid=inapp-banner]').innerText();
  await shot(ana, 't1-inapp-banner');
  check('in-app alert: a banner announces the new match to Ana (she liked first, so she never saw the overlay)', /Paw-Match with Bruno/.test(banner1), banner1);
  await ana.waitForSelector('[data-testid=inapp-banner]:has-text("Park this weekend")', { timeout: 15000 });
  check('in-app alert: and another for the new message, while she is elsewhere in the app', true, await ana.locator('[data-testid=inapp-banner]').innerText());
  check('unread badge shows on the Matches tab', (await ana.locator('[data-testid=unread-badge]').innerText()) === '1');
  await ana.click('nav >> text=Settings');
  await ana.waitForSelector('text=Notifications');
  await ana.waitForTimeout(5500); // let the first banner time out
  await ana.click('label:has-text("In-app alerts")');
  await ana.waitForFunction(() => !document.querySelector('[role=switch][aria-label="In-app alerts"]').checked);
  check('toggle saved: owners.notify_in_app = false', (await admin.from('owners').select('notify_in_app').eq('id', anaId).single()).data.notify_in_app === false);
  await ben.fill('[aria-label="Message"]', 'Sunday 8am at Ayala Triangle?'); await ben.click('[aria-label="Send"]');
  await ana.waitForTimeout(4000);
  check('with in-app alerts OFF a new message raises NO banner', (await ana.locator('[data-testid=inapp-banner]').count()) === 0);
  await ana.click('label:has-text("In-app alerts")');
  await ana.waitForFunction(() => document.querySelector('[role=switch][aria-label="In-app alerts"]').checked);

  // the login email is prefilled, so the preference can be switched on straight away; the address can still be changed
  check('Settings prefills the login email as the notification address', (await ana.inputValue('[aria-label="Email address"]')) === lib.EMAILS.ana);
  await ana.click('label:has-text("Email alerts")');
  await ana.waitForFunction(() => document.querySelector('[role=switch][aria-label="Email alerts"]').checked);
  await ana.fill('[aria-label="Email address"]', 'ana@example.com');
  await ana.click('button:text-is("Save")');
  await ana.waitForSelector('text=Saved.');
  const prefs = (await admin.from('owners').select('email, notify_email, notify_in_app').eq('id', anaId).single()).data;
  check('email preference: switched on, and a different notification address saves', prefs.email === 'ana@example.com' && prefs.notify_email === true && prefs.notify_in_app === true, JSON.stringify(prefs));

  // ================================================================ 2. edit pet → changes show in ANOTHER user's deck
  const { api: benApi, token: benToken } = await apiFromPage(ben); // note: Ben and Ana are matched, so Ben's DECK won't deal Mochi — use a third viewer for the deck
  const before = await listFiles('pet-photos', anaId);
  await ana.click('text=Edit pet');
  await ana.waitForSelector('text=Edit Mochi');
  await ana.waitForSelector('img[alt="Photo 1"]');
  await ana.fill('#edit-name', 'Mochi Bear');
  await ana.fill('#edit-breed', 'Maltese');
  await ana.click('[aria-label="Personality tags"] button:text-is("loves fetch")'); // remove
  await ana.click('[aria-label="Personality tags"] button:text-is("cuddly")');      // add
  await ana.click('[aria-label="Looking for"] button:text-is("Walking Buddy")');
  await ana.setInputFiles('[data-testid=photo-input]', [photoNew]);
  await ana.waitForFunction(() => document.querySelectorAll('img[alt^="Photo "]').length === 2 && !document.querySelector('[aria-label="Uploading photo"]'), null, { timeout: 60000 });
  await ana.click('text=Make main');
  await ana.click('[aria-label="Remove photo 2"]'); // drop the old (seed) photo
  await shot(ana, 't2-edit-pet');
  await ana.click('text=Save changes');
  await ana.waitForSelector('text=Edit pet', { timeout: 20000 }); // back on Settings
  await shot(ana, 't3-settings');
  check('edit saved: Settings shows the new name and breed', (await ana.locator('text=Maltese').count()) > 0);

  const viewer = await mk('viewer'); // Trish? no — use the moderator-free seeded login we have: a fresh API client for a seed owner is not possible (no OTP), so view as Ben via profile + as a NEW deck viewer below
  const pet = (await admin.from('pets').select('id, name, breed, intents, pet_photos(storage_path, position), pet_tags(tag)').eq('owner_id', anaId).single()).data;
  const prof = (await benApi.rpc('get_pet_profile', { p_viewer_pet_id: (await admin.from('pets').select('id').eq('owner_id', benId).single()).data.id, p_pet_id: pet.id })).data?.[0];
  check("another user's view of the pet (get_pet_profile as Ben) shows every edit", prof?.name === 'Mochi Bear' && prof.breed === 'Maltese' && prof.tags.includes('cuddly') && !prof.tags.includes('loves_fetch') && prof.intents.includes('walking_buddy') && prof.photos.length === 1, JSON.stringify({ name: prof?.name, breed: prof?.breed, tags: prof?.tags, intents: prof?.intents }));
  const after = await listFiles('pet-photos', anaId);
  check('photos: new main saved, the removed photo\'s FILE is deleted from storage too', pet.pet_photos.length === 1 && after.length === 1 && after[0] === pet.pet_photos[0].storage_path && !after.includes(before[0]), `before ${before.length} file(s) → after ${after.length}`);
  const stored = Buffer.from(await (await fetch(`${URL_}/storage/v1/object/public/pet-photos/${after[0]}`)).arrayBuffer());
  check('the new photo was EXIF-stripped on the way in (same pipeline as onboarding)', !(await sharp(stored).metadata()).exif);

  // the DECK itself, in a browser, as someone who has not swiped on Mochi: the fresh number
  await lib.freeAccount(lib.EMAILS.fresh);
  await lib.stubOtpSend(viewer);
  await viewer.context().grantPermissions(['geolocation']); await viewer.context().setGeolocation({ latitude: 14.5601, longitude: 121.0224 });
  await viewer.goto(ORIGIN + '/'); await viewer.click('text=Get started');
  await viewer.fill('#email', lib.EMAILS.fresh); await viewer.click('text=Send code'); await viewer.waitForSelector('#otp'); await lib.ensureUser(lib.EMAILS.fresh); await viewer.fill('#otp', await lib.otpFor(lib.EMAILS.fresh)); await viewer.click('text=Verify');
  await viewer.waitForSelector('text=First, about you', { timeout: 20000 });
  await viewer.fill('#owner-name', 'Dana'); await viewer.check('input[type=checkbox]'); await viewer.click('button:has-text("Continue")');
  await viewer.click('text=Use my location'); await viewer.waitForSelector('text=Tell us about your pet', { timeout: 20000 });
  await viewer.fill('#pet-name', 'Biscuit'); await viewer.click('[role=radio]:has-text("Dog")'); await viewer.click('[role=radio]:has-text("Female")'); await viewer.click('[role=radio]:has-text("Small")');
  await viewer.selectOption('[aria-label="Years"]', '2'); await viewer.click('button:has-text("Continue")');
  await viewer.setInputFiles('[data-testid=photo-input]', [photoNew]);
  await viewer.waitForFunction(() => document.querySelectorAll('img[alt^="Photo "]').length === 1 && !document.querySelector('[aria-label="Uploading photo"]'), null, { timeout: 60000 });
  check('onboarding still works after the photo-picker refactor', true);
  await viewer.click('button:has-text("Continue")');
  await viewer.click('button:has-text("playful")'); await viewer.click('[aria-label="Personality tags"] button:text-is("friendly")'); await viewer.click('[aria-label="Looking for"] button:has-text("Playdate")');
  await viewer.click('button:has-text("Finish")');
  await topCard(viewer).waitFor({ timeout: 30000 });
  const found = await swipeUntil(viewer, 'Mochi Bear', false);
  const cardText = found ? await topCard(viewer).innerText() : '';
  if (found) { await viewer.waitForFunction(() => [...document.images].every((i) => i.complete)); await shot(viewer, 't4-edited-pet-in-deck'); }
  check('the edited pet appears in the DECK with the new name, breed, tag and intent', found && /Maltese/.test(cardText) && /cuddly/i.test(cardText) && /Walking Buddy/.test(cardText) && !/loves fetch/i.test(cardText), cardText.replace(/\s+/g, ' ').slice(0, 140));

  // ================================================================ 3. block → unblock
  const { api: anaApi } = await apiFromPage(ana);
  const anaPetId = pet.id;
  await ana.click('nav >> text=Discover'); await topCard(ana).waitFor({ timeout: 20000 });
  const blockedPet = await topName(ana);
  await ana.click(`[aria-label^="Report or block ${blockedPet}"]`);
  await ana.locator('[role=dialog] >> text=/^Block /').click();
  await ana.locator('[role=dialog] button:text-is("Block")').click();
  await ana.locator('[role=dialog] >> text=Done').click();
  const deckHas = async (name) => ((await anaApi.rpc('get_deck', { p_pet_id: anaPetId, p_limit: 50 })).data ?? []).some((c) => c.name === name);
  check(`blocked: ${blockedPet} is gone from Ana's deck`, !(await deckHas(blockedPet)));
  await ana.click('nav >> text=Settings');
  await ana.waitForSelector('[data-testid=blocked-row]');
  const blockedRow = await ana.locator('[data-testid=blocked-row]').first().innerText();
  await shot(ana, 't5-settings-blocked-and-reports');
  check('Settings lists the blocked owner (first name · pet)', blockedRow.includes(blockedPet), blockedRow.replace(/\s+/g, ' '));
  await ana.locator('[data-testid=blocked-row] >> text=Unblock').first().click();
  await ana.waitForSelector("text=You haven't blocked anyone", { timeout: 15000 });
  check(`unblocked: the block row is deleted and ${blockedPet} is back in Ana's deck`, (await admin.from('blocks').select('blocked_id').eq('blocker_id', anaId)).data.length === 0 && (await deckHas(blockedPet)));

  // ================================================================ 4. report history
  await ana.click('nav >> text=Discover'); await topCard(ana).waitFor({ timeout: 20000 });
  const reportedPet = await topName(ana);
  await ana.click(`[aria-label^="Report or block ${reportedPet}"]`);
  await ana.locator('[role=dialog] >> text=/^Report /').click();
  await ana.locator('[role=radio]:has-text("Impersonation")').click();
  await ana.locator('[aria-label="Details"]').fill('Photos look taken from a breeder site');
  await ana.locator('[role=dialog] >> text=Send report').click();
  await ana.locator('[role=dialog] >> text=Done').click();
  await ana.click('nav >> text=Settings');
  await ana.waitForSelector('[data-testid=report-row]');
  const row1 = await ana.locator('[data-testid=report-row]').first().innerText();
  check('report history shows the report as "Under review"', /Impersonation/.test(row1) && row1.includes(reportedPet) && /Under review/.test(row1), row1.replace(/\s+/g, ' '));
  const modApi = await asUser(lib.EMAILS.mod);
  const reportId = (await admin.from('reports').select('id').eq('reporter_id', anaId).single()).data.id;
  await modApi.rpc('resolve_report', { p_report_id: reportId, p_action: 'dismiss' });
  await ana.reload(); await ana.click('nav >> text=Settings'); await ana.waitForSelector('[data-testid=report-row]');
  const row2 = await ana.locator('[data-testid=report-row]').first().innerText();
  check('after a moderator handles it the status updates — and never says who or how', /Reviewed — no action/.test(row2) && !/Mod|moderator|resolved/i.test(row2), row2.replace(/\s+/g, ' '));

  // ================================================================ 5. data export
  const [dl] = await Promise.all([ana.waitForEvent('download'), ana.click('text=Export my data')]);
  const exportPath = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(exportPath);
  const raw = fs.readFileSync(exportPath, 'utf8');
  const data = JSON.parse(raw);
  check('export downloads a JSON file of everything held about the user', /^pawme-my-data-\d{4}-\d\d-\d\d\.json$/.test(dl.suggestedFilename()) && data.account.email === lib.EMAILS.ana && data.owner.display_name === 'Ana' && data.owner.email === 'ana@example.com' && data.pets[0].name === 'Mochi Bear' && data.pet_photos.length === 1 && data.reports_filed.length === 1 && data.matches.length === 1 && data.messages_sent.every((m) => m.sender_id === anaId), Object.keys(data).join(','));
  check("export contains nobody else's personal data (no other email, no Ben's messages, no role/moderation fields)", !raw.includes(lib.EMAILS.ben) && !raw.includes('Park this weekend') && !('role' in data.owner) && !/resolved_by|message_snapshot/.test(raw));

  // ================================================================ 6. account deletion (Ben) — Edge Function → cascade + storage cleanup
  const count = async () => {
    const q = async (t, col, extra) => { let r = admin.from(t).select('*', { count: 'exact', head: true }); r = extra ? r.or(extra) : r.eq(col, benId); return (await r).count; };
    const petIds = ((await admin.from('pets').select('id').eq('owner_id', benId)).data ?? []).map((p) => p.id);
    return {
      owners: await q('owners', 'id'), pets: await q('pets', 'owner_id'),
      pet_photos: petIds.length ? (await admin.from('pet_photos').select('*', { count: 'exact', head: true }).in('pet_id', petIds)).count : 0,
      pet_tags: petIds.length ? (await admin.from('pet_tags').select('*', { count: 'exact', head: true }).in('pet_id', petIds)).count : 0,
      likes: await q('likes', 'from_owner_id'), matches: await q('matches', null, `owner_a_id.eq.${benId},owner_b_id.eq.${benId}`),
      conversations: await q('conversations', null, `owner_a_id.eq.${benId},owner_b_id.eq.${benId}`), messages: await q('messages', 'sender_id'),
      files: (await listFiles('pet-photos', benId)).length,
    };
  };
  const pre = await count();
  check('before deletion Ben has real data everywhere', Object.values(pre).every((n) => n > 0), JSON.stringify(pre));
  await ana.click('nav >> text=Matches'); await ana.waitForSelector('text=Bruno');

  await ben.click('[aria-label="Back to matches"]'); await ben.click('nav >> text=Settings');
  await ben.click('text=Delete account…');
  check('"Delete forever" stays disabled until DELETE is typed', await ben.locator('text=Delete forever').isDisabled());
  await ben.fill('#confirm-delete', 'DELETE');
  await shot(ben, 't6-delete-confirm');
  await ben.click('text=Delete forever');
  await ben.waitForSelector('text=Get started', { timeout: 30000 });
  check('after deleting, Ben is signed out and back at the welcome screen', true);

  const post = await count();
  check('CASCADE: every row that belonged to Ben is gone', Object.entries(post).filter(([k]) => k !== 'files').every(([, n]) => n === 0), JSON.stringify(post));
  check('STORAGE: every photo file in Ben\'s folder is gone', post.files === 0, `${pre.files} file(s) → ${post.files}`);
  check('AUTH: the auth user no longer exists', !(await usersByEmail())[lib.EMAILS.ben]);
  const stale = createClient(URL_, ANON, { global: { headers: { Authorization: `Bearer ${benToken}` } }, auth: { persistSession: false } });
  const staleInbox = await stale.rpc('get_inbox');
  check("Ben's old access token reaches no data", (staleInbox.data ?? []).length === 0, staleInbox.error?.message ?? 'empty result');
  await ana.waitForSelector('text=No matches yet', { timeout: 15000 });
  check("Ana's inbox drops the match LIVE when Ben's account is deleted", true);
  const anaMsgs = (await admin.from('messages').select('id', { count: 'exact', head: true }).eq('sender_id', anaId)).count;
  check("the conversation (incl. Ana's side of it) is removed with the match; Ana's account is otherwise intact", anaMsgs === 0 && (await admin.from('pets').select('name').eq('owner_id', anaId).single()).data.name === 'Mochi Bear');
  check("Ana's report survives (it wasn't about Ben) — reports are kept as moderation evidence", (await admin.from('reports').select('id').eq('reporter_id', anaId)).data.length === 1);

  // signing in again with the same email is a brand-new account
  await lib.signIn(ben, lib.EMAILS.ben, { waitFor: 'text=First, about you', fresh: true });
  check('the same email now signs up as a brand-new, empty account (onboarding step 1)', true);

  check('no uncaught page or console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  await browser.close();

  // leave dev tidy: remove the two throwaway accounts (the caller re-runs the seed to restore Ben)
  for (const email of [lib.EMAILS.ben, lib.EMAILS.fresh]) await lib.freeAccount(email);
  const failed = checks.filter((c) => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('E2E ERROR:', e.message.split('\n').slice(0, 3).join(' | ')); process.exit(2); });
