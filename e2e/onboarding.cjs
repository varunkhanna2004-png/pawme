// Run (dev server up, dev project seeded):
//   npm run dev:free-number && node --env-file=.env.seed.local e2e/onboarding.cjs
// Proves a BRAND-NEW user (0917 000 0003 — a Supabase test number with no account)
// can get from zero to swiping, and checks what actually landed in the database
// and in storage (dev project only; the service key is used for verification only).
const { chromium } = require('playwright');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const URL_ = 'http://localhost:5173/';
const PHONE = '639170000003';
if (!/ooigdeefqwgzkpujvexu/.test(process.env.SUPABASE_URL ?? '')) { console.error('refused: SUPABASE_URL is not pawme-dev'); process.exit(1); }
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const checks = [];
const check = (name, ok, extra = '') => { checks.push(!!ok); log(ok ? 'PASS' : 'FAIL', name, extra); };
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

const BGC = { latitude: 14.5507, longitude: 121.0509 };         // BGC High Street — inside the 3.5 km circle, outside Makati
const SALCEDO = { latitude: 14.560123, longitude: 121.022456 }; // Salcedo Village, Makati

async function findUser() {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  return data.users.find((u) => u.phone === PHONE);
}
async function freeNumber() {
  const u = await findUser();
  if (!u) return;
  const files = [];
  for (const folder of (await admin.storage.from('pet-photos').list(u.id)).data ?? []) for (const f of (await admin.storage.from('pet-photos').list(`${u.id}/${folder.name}`)).data ?? []) files.push(`${u.id}/${folder.name}/${f.name}`);
  if (files.length) await admin.storage.from('pet-photos').remove(files);
  await admin.auth.admin.deleteUser(u.id);
}

async function signUp(page) {
  await page.goto(URL_);
  await page.waitForSelector('text=Get started');
  return page;
}
async function throughOtpAndAbout(page, name) {
  await page.click('text=Get started');
  await page.fill('#phone', '0917 000 0003');
  await page.click('text=Send code');
  await page.fill('#otp', '123456');
  await page.click('text=Verify');
  await page.waitForSelector('text=First, about you', { timeout: 20000 });
  await page.fill('#owner-name', name);
  await page.check('input[type=checkbox]');
  await page.click('button:has-text("Continue")');
  await page.waitForSelector('text=Where do you and your pet live?', { timeout: 15000 });
}

(async () => {
  // Two test photos: a 12 MP "phone camera" JPEG carrying a GPS position in its EXIF, and a PNG.
  const photoA = path.join(OUT, 'in-phone-photo-with-gps.jpg');
  const photoB = path.join(OUT, 'in-second.png');
  const art = (c1, c2) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="4000"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="3000" height="4000" fill="url(#g)"/><circle cx="1500" cy="1900" r="800" fill="#c68642"/><circle cx="1230" cy="1700" r="90"/><circle cx="1770" cy="1700" r="90"/><ellipse cx="1500" cy="2050" rx="130" ry="90"/></svg>`);
  await sharp(art('#ffd6a5', '#ff6b4a')).jpeg({ quality: 95 }).withExif({ IFD0: { Make: 'TestPhone', Model: 'Cam 1' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '14/1 33/1 3644/100', GPSLongitudeRef: 'E', GPSLongitude: '121/1 1/1 2084/100' } }).toFile(photoA);
  await sharp(art('#bde0fe', '#3a86ff')).resize(1200, 1600).png().toFile(photoB);
  const inMeta = await sharp(photoA).metadata();
  check('test input really carries EXIF GPS', !!inMeta.exif && inMeta.exif.length > 50, `${inMeta.width}x${inMeta.height}, ${(fs.statSync(photoA).size / 1024) | 0} KB, exif ${inMeta.exif?.length} bytes`);

  const browser = await chromium.launch();
  const errors = [];
  const mk = async (opts) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...opts });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    return { ctx, page };
  };

  // ============ PASS 1 — location permission DENIED → barangay picker (waitlist, then admitted)
  await freeNumber();
  {
    const { ctx, page } = await mk({ permissions: [] });
    await signUp(page);
    await throughOtpAndAbout(page, 'Dana');
    await page.click('text=Use my location');
    await page.waitForSelector('text=Pick your barangay instead', { timeout: 20000 });
    check('location denied → friendly fallback to the barangay picker', (await page.locator('#area option').count()) === 23 + 9 + 1, `${await page.locator('#area option').count()} options`);
    await page.selectOption('#area', 'Taguig / BGC');
    await page.click('button:has-text("Continue")');
    await page.waitForSelector("text=PAWME isn't in your area yet", { timeout: 15000 });
    check('picker: Taguig / BGC → waitlist', true);
    await page.click('text=check my location again');
    await page.click('text=Choose my barangay instead');
    await page.selectOption('#area', 'Poblacion');
    await page.click('button:has-text("Continue")');
    await page.waitForSelector('text=Tell us about your pet', { timeout: 15000 });
    check('picker: Poblacion → admitted, on to the pet step', true);
    await ctx.close();
  }

  // ============ PASS 2 — the full path with device location, from zero
  await freeNumber();
  check('0917 000 0003 has no account before we start', !(await findUser()));
  const { ctx, page } = await mk({ permissions: ['geolocation'], geolocation: BGC });
  await signUp(page);
  await shot(page, 'o1-welcome');
  await throughOtpAndAbout(page, 'Dana');
  check('step 1 of 5 done: name + 18+ confirmation saved', true);
  await shot(page, 'o2-location');

  // --- outside the cluster → waitlist
  await page.click('text=Use my location');
  await page.waitForSelector("text=PAWME isn't in your area yet", { timeout: 20000 });
  await shot(page, 'o3-waitlist');
  check('device in BGC (3.0 km from the centroid, inside the circle) → WAITLIST', true);
  await page.fill('#wl-email', 'dana@example.com');
  await page.click('text=Notify me');
  await page.waitForSelector("text=we'll email you", { timeout: 15000 });
  const user = await findUser();
  const wl = (await admin.from('waitlist').select('*').eq('owner_id', user.id).maybeSingle()).data;
  check('waitlist row saved with email + snapped (not raw) location', wl?.email === 'dana@example.com' && wl.loc_lat !== BGC.latitude && wl.loc_lng !== BGC.longitude, JSON.stringify({ lat: wl?.loc_lat, lng: wl?.loc_lng }));
  await page.reload();
  await page.waitForSelector("text=PAWME isn't in your area yet", { timeout: 20000 });
  check('waitlisted user who reopens the app lands back on the waitlist screen', true);

  // --- they are actually in Makati → admitted
  await ctx.setGeolocation(SALCEDO);
  await page.click('text=check my location again');
  await page.click('text=Use my location');
  await page.waitForSelector('text=Tell us about your pet', { timeout: 20000 });
  check('device in Salcedo Village → admitted, waitlist left behind', true);
  const owner1 = (await admin.from('owners').select('cluster_id, loc_lat, loc_lng').eq('id', user.id).single()).data;
  const wlGone = (await admin.from('waitlist').select('owner_id').eq('owner_id', user.id)).data.length === 0;
  check('owner: cluster = makati, location stored SNAPPED, waitlist row removed', owner1.cluster_id === 'makati' && owner1.loc_lat !== SALCEDO.latitude && owner1.loc_lng !== SALCEDO.longitude && wlGone, JSON.stringify(owner1));

  // --- pet basics (breed deliberately left empty: non-essential, can be added later)
  check('Continue is disabled until the essentials are filled', await page.locator('button:has-text("Continue")').isDisabled());
  await page.fill('#pet-name', 'Biscuit');
  await page.click('[role=radio]:has-text("Dog")');
  await page.click('[role=radio]:has-text("Female")');
  await page.click('[role=radio]:has-text("Small")');
  await page.selectOption('[aria-label="Years"]', '2');
  await page.selectOption('[aria-label="Months"]', '3');
  await shot(page, 'o4-pet-basics');
  check('breed is optional: Continue enabled without it', await page.locator('button:has-text("Continue")').isEnabled());
  await page.click('button:has-text("Continue")');

  // --- photos
  await page.waitForSelector('text=Show off Biscuit');
  check('Continue is disabled with zero photos', await page.locator('button:has-text("Continue")').isDisabled());
  await page.setInputFiles('[data-testid=photo-input]', [photoA, photoB]);
  await page.waitForFunction(() => document.querySelectorAll('img[alt^="Photo "]').length === 2 && !document.querySelector('[aria-label="Uploading photo"]'), null, { timeout: 60000 });
  await shot(page, 'o5-photos');
  check('two photos processed + uploaded', true);
  await page.reload(); // a refresh / dropped connection mid-onboarding must lose nothing
  await page.waitForSelector('text=Show off Biscuit', { timeout: 20000 });
  check('refresh mid-wizard resumes on the same step with both photos', (await page.locator('img[alt^="Photo "]').count()) === 2 && (await page.locator('[role=progressbar]').getAttribute('aria-valuenow')) === '4');
  await page.click('button:has-text("Continue")');

  // --- personality + intent
  await page.waitForSelector("text=What's Biscuit like?");
  await page.click('button:has-text("playful")');
  check('one tag is not enough: Finish disabled', await page.locator('button:has-text("Finish")').isDisabled());
  for (const t of ['friendly', 'loves fetch', 'curious']) await page.click(`[aria-label="Personality tags"] button:text-is("${t}")`);
  await page.click('[aria-label="Personality tags"] button:text-is("vocal")'); // a 5th: must be ignored
  check('a fifth tag is refused (max 4)', (await page.locator('[aria-label="Personality tags"] [aria-pressed=true]').count()) === 4);
  await page.click('[aria-label="Looking for"] button:has-text("Playdate")');
  await page.click('[aria-label="Looking for"] button:has-text("Walking Buddy")');
  await shot(page, 'o6-personality');
  await page.click('button:has-text("Finish")');

  // --- Discover
  await page.waitForSelector('[role=group][aria-label*="Swipe right"]', { timeout: 30000 });
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
  await shot(page, 'o7-discover-as-new-user');
  const top = ((await page.locator('[role=group][aria-label*="Swipe right"]').getAttribute('aria-label')) ?? '').split('.')[0];
  check('FINISH → lands in Discover with a live deck', !!top, `top card: ${top}`);

  // --- what actually got saved
  const pet = (await admin.from('pets').select('*, pet_photos(storage_path, position), pet_tags(tag)').eq('owner_id', user.id).single()).data;
  const months = Math.round((Date.now() - Date.parse(pet.birth_date)) / (30.44 * 864e5));
  check('pet row: Biscuit, dog, female, small, ~27 months, no breed, cluster makati, NOT seed', pet.name === 'Biscuit' && pet.species === 'dog' && pet.sex === 'female' && pet.size === 'small' && Math.abs(months - 27) <= 1 && pet.breed === null && pet.cluster_id === 'makati' && pet.is_seed === false, `${months} months`);
  check('intents + 4 tags saved', pet.intents.join() === 'playdate,walking_buddy' && pet.pet_tags.length === 4, pet.pet_tags.map((t) => t.tag).join(','));
  check('photo rows: positions 1,2 inside the owner\'s own folder', pet.pet_photos.length === 2 && pet.pet_photos.map((p) => p.position).sort().join() === '1,2' && pet.pet_photos.every((p) => p.storage_path.startsWith(`${user.id}/${pet.id}/`)));
  const ownerRow = (await admin.from('owners').select('display_name, adult_confirmed_at, phone_verified_at, is_seed').eq('id', user.id).single()).data;
  check('owner: name, 18+ timestamp, phone verified, NOT seed', ownerRow.display_name === 'Dana' && !!ownerRow.adult_confirmed_at && !!ownerRow.phone_verified_at && ownerRow.is_seed === false);

  // --- the stored photo: EXIF gone, resized, compressed
  const first = pet.pet_photos.find((p) => p.position === 1).storage_path;
  const stored = Buffer.from(await (await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/public/pet-photos/${first}`)).arrayBuffer());
  const outMeta = await sharp(stored).metadata();
  fs.writeFileSync(path.join(OUT, 'out-stored-photo.jpg'), stored);
  check('STORED photo has NO EXIF at all (GPS stripped)', !outMeta.exif && !stored.includes(Buffer.from('TestPhone')) && !stored.includes(Buffer.from('GPS')), `exif: ${outMeta.exif ? outMeta.exif.length + ' bytes' : 'none'}`);
  check('stored photo resized to ≤1600 px and compressed', Math.max(outMeta.width, outMeta.height) <= 1600 && outMeta.format === 'jpeg' && stored.length < fs.statSync(photoA).size, `${inMeta.width}x${inMeta.height} ${(fs.statSync(photoA).size / 1024) | 0} KB → ${outMeta.width}x${outMeta.height} ${(stored.length / 1024) | 0} KB`);

  // --- zero to SWIPING
  const box = await page.locator('[role=group][aria-label*="Swipe right"]').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(x + 22 * i, y + i); await page.waitForTimeout(12); }
  await page.mouse.up(); await page.waitForTimeout(1500);
  const likes = (await admin.from('likes').select('action, to_pet_id').eq('from_owner_id', user.id)).data;
  check('the new user swiped right and the like was recorded', likes.length === 1 && likes[0].action === 'like', `liked ${top}`);

  // --- the other side: a seeded account now sees the new pet in ITS deck
  const ana = (await mk({})).page;
  await ana.goto(URL_); await ana.click('text=Get started'); await ana.fill('#phone', '9170000001'); await ana.click('text=Send code'); await ana.fill('#otp', '123456'); await ana.click('text=Verify');
  await ana.waitForSelector('[role=group][aria-label*="Swipe right"]', { timeout: 20000 });
  let seen = false;
  for (let i = 0; i < 30 && !seen; i++) {
    const name = ((await ana.locator('[role=group][aria-label*="Swipe right"]').getAttribute('aria-label')) ?? '').split('.')[0];
    if (name === 'Biscuit') { seen = true; await shot(ana, 'o8-biscuit-in-anas-deck'); break; }
    await ana.click('[aria-label="Pass"]'); await ana.waitForTimeout(650);
  }
  check("Biscuit shows up in an existing user's deck (liquidity works both ways)", seen);

  check('no uncaught page or console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  await browser.close();
  const failed = checks.filter((c) => !c).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('E2E ERROR:', e.message.split('\n').slice(0, 3).join(' | ')); process.exit(2); });
