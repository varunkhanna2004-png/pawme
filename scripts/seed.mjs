// PAWME — DEV-ONLY seed script (master prompt §3.5, §12.4).
//
//   npm run seed:dev          create/refresh seed data in the dev project
//   npm run seed:dev:reset    delete every seed account first, then seed
//
// Everything this script creates is flagged is_seed = true. It can only ever
// touch the dev project:
//   1. it must be run with --dev;
//   2. SUPABASE_URL must be on the allowlist below and must NOT be production;
//   3. the service key's own `ref` claim must match the URL;
//   4. the database itself refuses is_seed rows unless
//      ranking_config.allow_seed = true, which is set by hand in dev only —
//      this script never flips it.
// It reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from process.env
// (.env.seed.local, gitignored). The service key is never used by the client.

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const PRODUCTION_REF = 'tzifbmuuczogckruptap';
const ALLOWED_REFS = ['ooigdeefqwgzkpujvexu']; // pawme-dev

const args = new Set(process.argv.slice(2));
const die = (msg) => { console.error(`\n✋ seed refused: ${msg}\n`); process.exit(1); };

// ------------------------------------------------------------------ guards
if (!args.has('--dev')) die('run with --dev (npm run seed:dev). This script is for the dev project only.');
if (process.env.NODE_ENV === 'production') die('NODE_ENV is production.');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) die('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.seed.local).');
const ref = new URL(url).hostname.split('.')[0];
if (ref === PRODUCTION_REF || url.includes(PRODUCTION_REF)) die('SUPABASE_URL is the PRODUCTION project. Production is never seeded.');
if (!ALLOWED_REFS.includes(ref)) die(`project "${ref}" is not on the dev allowlist in scripts/seed.mjs.`);
if (key.startsWith('eyJ')) {
  const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
  if (claims.ref !== ref) die(`the service key belongs to project "${claims.ref}", not "${ref}".`);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const must = async (promise, what) => { const { data, error } = await promise; if (error) die(`${what}: ${error.message}`); return data; };

const cfg = await must(db.from('ranking_config').select('cluster_id, allow_seed, grid_m').eq('cluster_id', 'makati').single(), 'read ranking_config');
if (!cfg.allow_seed) die(`ranking_config.allow_seed is false in "${ref}".
   Seed rows are rejected by the database until you enable them BY HAND, in the dev project only:
     update public.ranking_config set allow_seed = true where cluster_id = 'makati';`);

// ------------------------------------------------------------------ data
// Same maths as private.snap() in the database.
const snap = (lat, lng, grid = cfg.grid_m) => {
  const latStep = grid / 111320;
  const sLat = Math.round(lat / latStep) * latStep;
  const lngStep = grid / (111320 * Math.cos((sLat * Math.PI) / 180));
  return [Number(sLat.toFixed(6)), Number((Math.round(lng / lngStep) * lngStep).toFixed(6))];
};

const AREAS = {
  poblacion: [14.5650, 121.0310], belair: [14.5610, 121.0260], salcedo: [14.5600, 121.0220], legazpi: [14.5545, 121.0175],
  rockwell: [14.5650, 121.0365], sanantonio: [14.5640, 121.0110], piodelpilar: [14.5520, 121.0110], bangkal: [14.5430, 121.0120],
  palanan: [14.5590, 121.0030], dasmarinas: [14.5400, 121.0290], urdaneta: [14.5560, 121.0300], magallanes: [14.5370, 121.0180],
  guadalupe: [14.5640, 121.0430], olympia: [14.5700, 121.0230], sanlorenzo: [14.5490, 121.0200], ayala: [14.5566, 121.0234],
};

// The four Supabase TEST phone numbers (OTP 123456) — accounts you sign in as.
const TEST_ACCOUNTS = [
  { phone: '639170000001', owner: 'Ana', area: 'ayala', pet: { name: 'Mochi', species: 'dog', breed: 'Shih Tzu', sex: 'female', born: '2023-02-01', size: 'small', intents: ['playdate', 'friendship'], tags: ['playful', 'friendly', 'loves_fetch'] } },
  { phone: '639170000002', owner: 'Ben', area: 'rockwell', pet: { name: 'Bruno', species: 'dog', breed: 'Aspin', mixed: true, sex: 'male', born: '2022-06-01', size: 'small', intents: ['playdate', 'walking_buddy'], tags: ['playful', 'energetic', 'friendly', 'loves_walks'] } },
  { phone: '639170000003', owner: 'Cara', area: 'legazpi', pet: { name: 'Miming', species: 'cat', breed: 'Puspin', mixed: true, sex: 'female', born: '2021-09-01', size: 'small', intents: ['friendship'], tags: ['calm', 'cuddly', 'curious'] } },
  { phone: '639170000009', owner: 'Mod (PAWME)', area: 'ayala', role: 'moderator' },
];

// Fictional owners on a reserved, non-dialable range: 63 999 000 0xxx.
const P = (name, species, breed, sex, born, size, intents, tags, mixed = false) => ({ name, species, breed, sex, born, size, intents, tags, mixed });
const SEED_ACCOUNTS = [
  ['Migs', 'poblacion', P('Bantay', 'dog', 'Aspin', 'male', '2021-03-01', 'medium', ['playdate', 'walking_buddy'], ['friendly', 'energetic', 'loves_walks'], true)],
  ['Trish', 'salcedo', P('Latte', 'dog', 'Pomeranian', 'female', '2023-05-01', 'small', ['playdate', 'friendship'], ['playful', 'vocal', 'cuddly'])],
  ['Paolo', 'legazpi', P('Thor', 'dog', 'Golden Retriever', 'male', '2020-11-01', 'large', ['playdate', 'walking_buddy', 'friendship'], ['friendly', 'gentle', 'loves_fetch', 'good_with_kids'])],
  ['Bea', 'rockwell', P('Kimchi', 'dog', 'Corgi', 'female', '2022-08-01', 'small', ['playdate'], ['playful', 'energetic', 'loves_fetch'])],
  ['Jolo', 'belair', P('Pandesal', 'dog', 'Pug', 'male', '2019-07-01', 'small', ['friendship', 'walking_buddy'], ['calm', 'cuddly', 'couch_potato'])],
  ['Isay', 'sanantonio', P('Tala', 'dog', 'Aspin', 'female', '2024-01-01', 'medium', ['playdate', 'friendship'], ['shy', 'gentle', 'curious'], true)],
  ['Carlo', 'urdaneta', P('Max', 'dog', 'Labrador Retriever', 'male', '2021-12-01', 'large', ['playdate', 'walking_buddy'], ['energetic', 'friendly', 'loves_walks', 'good_with_dogs'])],
  ['Nina', 'dasmarinas', P('Coco', 'dog', 'Toy Poodle', 'female', '2022-04-01', 'small', ['playdate', 'friendship'], ['playful', 'friendly', 'good_with_dogs'])],
  ['Enzo', 'guadalupe', P('Pogi', 'dog', 'Beagle', 'male', '2023-09-01', 'medium', ['playdate', 'walking_buddy'], ['curious', 'energetic', 'vocal'])],
  ['Kat', 'piodelpilar', P('Siopao', 'dog', 'Chow Chow', 'male', '2018-05-01', 'large', ['walking_buddy'], ['calm', 'independent', 'gentle'])],
  ['Rica', 'sanlorenzo', P('Luna', 'dog', 'Siberian Husky', 'female', '2022-01-01', 'large', ['playdate', 'walking_buddy'], ['energetic', 'vocal', 'playful', 'loves_walks'])],
  ['Dom', 'bangkal', P('Chichi', 'dog', 'Chihuahua', 'female', '2020-02-01', 'small', ['friendship'], ['shy', 'cuddly', 'vocal'])],
  ['Gab', 'olympia', P('Bogart', 'dog', 'French Bulldog', 'male', '2022-10-01', 'small', ['playdate', 'friendship'], ['playful', 'friendly', 'couch_potato'])],
  ['Mara', 'magallanes', P('Yuki', 'dog', 'Japanese Spitz', 'female', '2023-03-01', 'small', ['playdate', 'friendship', 'walking_buddy'], ['playful', 'friendly', 'loves_fetch', 'good_with_kids'])],
  ['Luis', 'palanan', P('Hotdog', 'dog', 'Dachshund', 'male', '2021-06-01', 'small', ['playdate', 'walking_buddy'], ['curious', 'playful', 'loves_walks'])],
  ['Pia', 'poblacion', P('Bibingka', 'dog', 'Aspin', 'female', '2025-04-01', 'small', ['playdate'], ['playful', 'energetic', 'curious'], true)],
  ['Andre', 'salcedo', P('Ming', 'cat', 'Puspin', 'male', '2022-02-01', 'small', ['friendship'], ['curious', 'independent', 'playful'], true)],
  ['Sofia', 'rockwell', P('Snow', 'cat', 'Persian', 'female', '2020-08-01', 'small', ['friendship'], ['calm', 'cuddly', 'gentle'])],
  ['Jet', 'legazpi', P('Sushi', 'cat', 'Siamese', 'female', '2023-06-01', 'small', ['friendship', 'playdate'], ['vocal', 'curious', 'playful'])],
  ['Lia', 'belair', P('Oreo', 'cat', 'British Shorthair', 'male', '2021-04-01', 'medium', ['friendship'], ['calm', 'independent', 'good_with_cats'])],
  ['Marco', 'urdaneta', P('Mango', 'cat', 'Puspin', 'male', '2024-07-01', 'small', ['playdate', 'friendship'], ['playful', 'energetic', 'good_with_cats'], true)],
  ['Yna', 'sanantonio', P('Ube', 'cat', 'Ragdoll', 'female', '2022-12-01', 'medium', ['friendship'], ['cuddly', 'gentle', 'calm', 'good_with_kids'])],
].map(([owner, area, pet], i) => ({ phone: `63999000${String(i + 1).padStart(4, '0')}`, owner, area, pet }));

// Seed pets that have ALREADY liked a test account's pet, so a right-swipe on
// them is an instant match and the spine can be exercised from one browser.
const PRE_LIKES = [['Thor', 'Mochi', 'like'], ['Kimchi', 'Mochi', 'super'], ['Coco', 'Mochi', 'like'], ['Yuki', 'Mochi', 'like'], ['Max', 'Bruno', 'like'], ['Pogi', 'Bruno', 'like'], ['Latte', 'Bruno', 'like'], ['Sushi', 'Miming', 'like'], ['Mango', 'Miming', 'like']];

// ------------------------------------------------------------------ images
// Drawn, not downloaded: no licensing questions, works offline, and every image
// carries a visible SEED ribbon so it can never be mistaken for a real pet.
const PALETTE = [['#F9C784', '#E8871E'], ['#B5E2FA', '#0FA3B1'], ['#F7A072', '#B23A48'], ['#CDE7BE', '#4F772D'], ['#E0BBE4', '#7B2CBF'], ['#FFE066', '#F25F5C'], ['#BDE0FE', '#3A86FF'], ['#FFD6A5', '#9C6644']];
const FUR = ['#8D5B3A', '#D9A066', '#F2E2C4', '#3D3D3D', '#B87333', '#FFFFFF', '#C9C9C9', '#5C4033'];
function petSvg(pet, idx, variant) {
  const [bg1, bg2] = PALETTE[(idx + variant * 3) % PALETTE.length];
  const fur = FUR[idx % FUR.length], dark = '#2B2B2B', inner = '#F4B6B6';
  const ears = pet.species === 'cat'
    ? `<polygon points="250,420 300,200 430,350" fill="${fur}"/><polygon points="550,420 500,200 370,350" fill="${fur}"/><polygon points="285,380 310,260 385,345" fill="${inner}"/><polygon points="515,380 490,260 415,345" fill="${inner}"/>`
    : `<ellipse cx="235" cy="450" rx="75" ry="150" fill="${dark}" opacity=".85" transform="rotate(18 235 450)"/><ellipse cx="565" cy="450" rx="75" ry="150" fill="${dark}" opacity=".85" transform="rotate(-18 565 450)"/>`;
  const whiskers = pet.species === 'cat' ? `<g stroke="${dark}" stroke-width="5" stroke-linecap="round"><path d="M300 585 L180 560M300 610 L175 615M500 585 L620 560M500 610 L625 615"/></g>` : '';
  const tilt = variant === 1 ? 'rotate(-8 400 520)' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${variant ? bg2 : bg1}"/><stop offset="1" stop-color="${variant ? bg1 : bg2}"/></linearGradient></defs>
  <rect width="800" height="1000" fill="url(#g)"/>
  <circle cx="${variant ? 660 : 130}" cy="160" r="90" fill="#fff" opacity=".18"/><circle cx="${variant ? 120 : 690}" cy="860" r="140" fill="#fff" opacity=".12"/>
  <g transform="${tilt}">${ears}
    <ellipse cx="400" cy="540" rx="200" ry="190" fill="${fur}"/>
    <ellipse cx="400" cy="610" rx="105" ry="85" fill="#fff" opacity=".85"/>
    <circle cx="325" cy="500" r="24" fill="${dark}"/><circle cx="475" cy="500" r="24" fill="${dark}"/><circle cx="333" cy="492" r="8" fill="#fff"/><circle cx="483" cy="492" r="8" fill="#fff"/>
    <ellipse cx="400" cy="580" rx="30" ry="21" fill="${dark}"/>
    <path d="M400 600 Q400 640 365 645 M400 600 Q400 640 435 645" stroke="${dark}" stroke-width="7" fill="none" stroke-linecap="round"/>
    ${variant ? `<ellipse cx="400" cy="668" rx="22" ry="30" fill="#F28B8B"/>` : ''}${whiskers}
  </g>
  <text x="400" y="880" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="72" fill="#fff" opacity=".95">${pet.name}</text>
  <g transform="rotate(35 660 110)"><rect x="480" y="78" width="420" height="64" fill="#111" opacity=".8"/><text x="690" y="123" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="40" fill="#fff" letter-spacing="8">SEED</text></g>
</svg>`;
}
const petJpeg = (pet, idx, variant) => sharp(Buffer.from(petSvg(pet, idx, variant))).jpeg({ quality: 82, mozjpeg: true }).toBuffer();

// ------------------------------------------------------------------ helpers
async function allUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const data = await must(db.auth.admin.listUsers({ page, perPage: 200 }), 'list users');
    users.push(...data.users);
    if (data.users.length < 200) return users;
  }
}

async function reset() {
  const seedOwners = await must(db.from('owners').select('id').eq('is_seed', true), 'list seed owners');
  for (const { id } of seedOwners) {
    const files = [];
    for (const folder of (await must(db.storage.from('pet-photos').list(id), 'list photos')) ?? []) {
      for (const f of (await must(db.storage.from('pet-photos').list(`${id}/${folder.name}`), 'list photos')) ?? []) files.push(`${id}/${folder.name}/${f.name}`);
    }
    if (files.length) await must(db.storage.from('pet-photos').remove(files), 'remove photos');
    await must(db.auth.admin.deleteUser(id), 'delete seed user'); // cascades owners → pets → everything
  }
  console.log(`reset: removed ${seedOwners.length} seed accounts`);
}

async function upsertAccount(acct, idx, existingByPhone) {
  let user = existingByPhone.get(acct.phone);
  if (!user) user = (await must(db.auth.admin.createUser({ phone: acct.phone, phone_confirm: true }), `create user ${acct.phone}`)).user;
  const [lat, lng] = snap(...AREAS[acct.area]);
  // Spread activity so recency ranking has something to do: most recent, a few stale.
  const lastActive = new Date(Date.now() - [0.2, 1, 3, 8, 26, 50, 100, 300][idx % 8] * 3600e3).toISOString();
  await must(db.from('owners').update({
    display_name: acct.owner, adult_confirmed_at: new Date().toISOString(), is_seed: true, role: acct.role ?? 'user',
    cluster_id: 'makati', loc_lat: lat, loc_lng: lng, location_updated_at: new Date().toISOString(), last_active_at: lastActive,
  }).eq('id', user.id), `update owner ${acct.owner}`);
  if (!acct.pet) return null;

  const p = acct.pet;
  const existing = await must(db.from('pets').select('id').eq('owner_id', user.id).eq('name', p.name).maybeSingle(), 'find pet');
  const row = { owner_id: user.id, name: p.name, species: p.species, breed: p.breed, is_mixed: !!p.mixed, sex: p.sex, birth_date: p.born, size: p.size, intents: p.intents, is_seed: true, last_active_at: lastActive };
  const pet = existing
    ? await must(db.from('pets').update(row).eq('id', existing.id).select('id').single(), `update pet ${p.name}`)
    : await must(db.from('pets').insert(row).select('id').single(), `insert pet ${p.name}`);

  await must(db.from('pet_tags').delete().eq('pet_id', pet.id), 'clear tags');
  await must(db.from('pet_tags').insert(p.tags.map((tag) => ({ pet_id: pet.id, tag }))), 'insert tags');

  const photoCount = 1 + (idx % 2);
  for (let v = 0; v < photoCount; v++) {
    const path = `${user.id}/${pet.id}/seed-${v + 1}.jpg`;
    await must(db.storage.from('pet-photos').upload(path, await petJpeg(p, idx, v), { contentType: 'image/jpeg', upsert: true }), `upload ${path}`);
    await must(db.from('pet_photos').upsert({ pet_id: pet.id, storage_path: path, position: v + 1 }, { onConflict: 'storage_path' }), 'photo row');
  }
  return { name: p.name, id: pet.id, owner_id: user.id };
}

// ------------------------------------------------------------------ run
console.log(`seeding DEV project ${ref} …`);
if (args.has('--reset')) await reset();

const existingByPhone = new Map((await allUsers()).filter((u) => u.phone).map((u) => [u.phone, u]));
const pets = new Map();
const accounts = [...TEST_ACCOUNTS, ...SEED_ACCOUNTS];
for (const [i, acct] of accounts.entries()) {
  const pet = await upsertAccount(acct, i, existingByPhone);
  if (pet) pets.set(pet.name, pet);
  process.stdout.write('.');
}

for (const [from, to, action] of PRE_LIKES) {
  const a = pets.get(from), b = pets.get(to);
  await must(db.from('likes').upsert({ from_pet_id: a.id, to_pet_id: b.id, from_owner_id: a.owner_id, action }, { onConflict: 'from_pet_id,to_pet_id', ignoreDuplicates: true }), `pre-like ${from}→${to}`);
}

const count = await must(db.from('pets').select('species', { count: 'exact', head: false }).eq('is_seed', true), 'count');
console.log(`\ndone: ${accounts.length} seed accounts, ${count.length} seed pets (${count.filter((p) => p.species === 'dog').length} dogs, ${count.filter((p) => p.species === 'cat').length} cats), ${PRE_LIKES.length} pre-likes.`);
console.log('sign in with 639170000001 / 2 / 3 (pets) or 9 (moderator), OTP 123456.');
