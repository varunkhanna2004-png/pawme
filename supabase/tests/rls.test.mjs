// Applies the PAWME migrations to an in-memory Postgres (PGlite) behind minimal
// Supabase shims (auth, storage, realtime, roles) and attacks the access rules.
// Run: npm i -D @electric-sql/pglite && node supabase/tests/rls.test.mjs   (no Docker needed)
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

const MIG = new URL('../migrations', import.meta.url).pathname;
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

const SHIMS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create schema auth; grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz, phone text, phone_confirmed_at timestamptz, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage; grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text);
alter table storage.objects enable row level security;
grant all on storage.objects to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
create schema realtime; grant usage on schema realtime to authenticated;
create table realtime.messages (id bigserial primary key, topic text, extension text);
alter table realtime.messages enable row level security;
grant all on realtime.messages to authenticated; grant usage on sequence realtime.messages_id_seq to authenticated;
create function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '') $$;
create publication supabase_realtime;
-- Supabase's default privileges hand new public functions/tables to the API roles; mimic that so our REVOKEs are really tested.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

async function asRole(role, uid, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
}
const asUser = (uid, fn) => asRole('authenticated', uid, fn);
const q = async (sql, params) => (await db.query(sql, params)).rows;
async function denied(name, fn, expect) {
  try { const r = await fn(); ok(name, false, `expected failure, got ${JSON.stringify(r)?.slice(0, 120)}`); }
  catch (e) { ok(name, !expect || String(e.message).includes(expect), expect && !String(e.message).includes(expect) ? `got: ${e.message}` : e.message.slice(0, 70)); }
}

await db.exec(SHIMS);
for (const f of fs.readdirSync(MIG).sort()) {
  try { await db.exec(fs.readFileSync(path.join(MIG, f), 'utf8')); ok(`apply ${f}`, true); }
  catch (e) { ok(`apply ${f}`, false, e.message); console.error(e); process.exit(1); }
}

// ---------- users ----------
const mk = async (email) => (await q(`insert into auth.users (email) values ($1) returning id`, [email]))[0].id;
const [A, B, C, D, MOD] = await Promise.all(['ana@pawme.test', 'ben@pawme.test', 'cara@pawme.test', 'dan@pawme.test', 'mod@pawme.test'].map(mk));
ok('signup trigger creates owners rows', (await q(`select count(*)::int n from public.owners`))[0].n === 5);
ok('sign-up copies the login email into owners.email (lower-cased)', (await q(`select email from public.owners where id=$1`, [A]))[0].email === 'ana@pawme.test');
await db.exec(`update auth.users set email_confirmed_at = now() where id = '${A}'`);
ok('email confirm sets the Verified badge (email_verified_at)', (await q(`select email_verified_at, phone_verified_at from public.owners where id=$1`, [A]))[0].email_verified_at !== null);
await db.exec(`update auth.users set phone = '+639170000001', phone_confirmed_at = now() where id = '${A}'`);
ok('dormant: a confirmed phone still stamps phone_verified_at (future optional badge)', (await q(`select phone_verified_at from public.owners where id=$1`, [A]))[0].phone_verified_at !== null);
await db.exec(`update public.owners set role='moderator' where id='${MOD}'`);

// ---------- cluster gate ----------
const enter = (uid, lat, lng) => asUser(uid, async () => (await q(`select public.enter_cluster($1,$2) r`, [lat, lng]))[0].r);
const places = [
  ['Ayala Triangle', 14.5566, 121.0234, true], ['Rockwell', 14.5650, 121.0365, true], ['Poblacion', 14.5650, 121.0310, true],
  ['Dasmarinas Village', 14.5400, 121.0290, true], ['Guadalupe Nuevo', 14.5610, 121.0460, true],
  ['BGC High Street', 14.5507, 121.0509, false], ['BGC Burgos Circle', 14.5520, 121.0450, false], ['Market! Market!', 14.5496, 121.0560, false],
  ['100 m inside Makati at the BGC border', 14.5490, 121.04282, true], ['100 m inside BGC at the Makati border', 14.5490, 121.04468, false],
  ['Cembo (now Taguig)', 14.5640, 121.0530, false], ['Mandaluyong', 14.5800, 121.0350, false], ['Pasay MOA', 14.5350, 120.9830, false], ['Cebu', 10.3157, 123.8854, false],
];
for (const [name, lat, lng, want] of places) {
  const r = await enter(D, lat, lng);
  // D becomes sticky once admitted, so reset between probes
  await db.exec(`update public.owners set cluster_id=null where id='${D}'`);
  ok(`cluster gate: ${name} → ${want ? 'admitted' : 'waitlist'}`, r.admitted === want);
}
await enter(D, 14.5507, 121.0509);
ok('outsider lands on waitlist', (await q(`select count(*)::int n from public.waitlist where owner_id=$1`, [D]))[0].n === 1);

await enter(A, 14.556612345, 121.023498765);  // Ayala
await enter(B, 14.5650, 121.0365);            // Rockwell
await enter(C, 14.5400, 121.0290);            // Dasmarinas
const aLoc = (await q(`select loc_lat, loc_lng from public.owners where id=$1`, [A]))[0];
ok('raw coordinates are not stored (snapped)', aLoc.loc_lat !== 14.556612345 && aLoc.loc_lng !== 121.023498765, JSON.stringify(aLoc));
const resnap = (await q(`select * from private.snap($1,$2,500)`, [aLoc.loc_lat, aLoc.loc_lng]))[0];
ok('snap is idempotent', Math.abs(resnap.snapped_lat - aLoc.loc_lat) < 1e-5 && Math.abs(resnap.snapped_lng - aLoc.loc_lng) < 1e-5);
const snapErr = (await q(`select private.distance_m(14.556612345,121.023498765,$1,$2) d`, [aLoc.loc_lat, aLoc.loc_lng]))[0].d;
ok('snap error within one cell (<= ~354 m)', snapErr <= 354, `${Math.round(snapErr)} m`);
const away = await enter(A, 10.3157, 123.8854);
ok('admitted owner is not evicted when travelling', away.admitted === true && away.location_unchanged === true);

// ---------- owners RLS / column grants ----------
await asUser(A, async () => {
  ok('owner sees only own row', (await q(`select id from public.owners`)).length === 1);
  await q(`update public.owners set display_name='Ana', adult_confirmed_at=now() where id=$1`, [A]);
  ok('owner can edit display_name', (await q(`select display_name from public.owners`))[0].display_name === 'Ana');
});
for (const col of [`role='moderator'`, `status='active'`, `subscription_tier='gold'`, `cluster_id='makati'`, `loc_lat=1`, `is_seed=true`, `phone_verified_at=now()`, `email_verified_at=now()`])
  await denied(`owner cannot set ${col.split('=')[0]}`, () => asUser(A, () => q(`update public.owners set ${col} where id=$1`, [A])), 'permission denied');
await asUser(A, async () => ok("cannot update someone else's owner row", (await db.query(`update public.owners set display_name='x' where id=$1`, [B])).affectedRows === 0));
await denied('authenticated cannot read ranking_config', () => asUser(A, () => q(`select * from public.ranking_config`)), 'permission denied');
await asUser(B, () => q(`update public.owners set display_name='Ben' where id=$1`, [B]));
await asUser(C, () => q(`update public.owners set display_name='Cara' where id=$1`, [C]));

// ---------- pets ----------
const mkPet = (uid, name, species = 'dog', size = 'medium', tags = ['playful', 'friendly', 'loves_fetch']) => asUser(uid, async () => {
  const id = (await q(`insert into public.pets (owner_id,name,species,breed,sex,birth_date,size,intents) values ($1,$2,$3,'Aspin','male','2022-05-01',$4,'{playdate,playdate,friendship}') returning id`, [uid, name, species, size]))[0].id;
  await q(`select public.set_pet_tags($1,$2::public.pet_tag[])`, [id, `{${tags.join(',')}}`]);
  await q(`insert into public.pet_photos (pet_id, storage_path, position) values ($1,$2,1)`, [id, `${uid}/${id}/1.jpg`]);
  return id;
});
const pA = await mkPet(A, 'Mochi'), pB = await mkPet(B, 'Bruno'), pC = await mkPet(C, 'Coco', 'dog', 'large', ['calm', 'shy']);
const pCat = await mkPet(C, 'Miming', 'cat');
const petRow = (await q(`select cluster_id, intents from public.pets where id=$1`, [pA]))[0];
ok('pet inherits cluster; intents de-duplicated', petRow.cluster_id === 'makati' && String(petRow.intents) === '{playdate,friendship}', JSON.stringify(petRow));
await denied('cannot create a pet for someone else', () => asUser(A, () => q(`insert into public.pets (owner_id,name,species,sex,birth_date,size,intents) values ($1,'x','dog','male','2022-01-01','small','{playdate}')`, [B])), 'row-level security');
await denied('cannot set pet.cluster_id', () => asUser(A, () => q(`update public.pets set cluster_id='makati' where id=$1`, [pA])), 'permission denied');
await denied('tags must be 2–4', () => asUser(A, () => q(`select public.set_pet_tags($1,'{playful}')`, [pA])), 'TAGS_MUST_BE_2_TO_4');
await denied("cannot set tags on someone else's pet", () => asUser(A, () => q(`select public.set_pet_tags($1,'{playful,calm}')`, [pB])), 'NOT_YOUR_PET');
await denied("photo row cannot point into someone else's folder", () => asUser(A, () => q(`insert into public.pet_photos (pet_id,storage_path,position) values ($1,$2,2)`, [pA, `${B}/x/1.jpg`])), 'row-level security');
await asUser(A, async () => {
  ok('unmatched: other pets not readable from base table', (await q(`select id from public.pets`)).length === 1);
  ok('unmatched: other photos/tags not readable', (await q(`select 1 from public.pet_photos`)).length === 1 && (await q(`select distinct pet_id from public.pet_tags`)).length === 1);
});

// ---------- deck ----------
const deck = (uid, pet) => asUser(uid, () => q(`select * from public.get_deck($1)`, [pet]));
let dA = await deck(A, pA);
ok('deck: shows other dogs in cluster, not own pet, not cats', dA.length === 2 && dA.every(r => [pB, pC].includes(r.pet_id)), dA.map(r => r.name).join(','));
const keys = Object.keys(dA[0]);
ok('deck: no coordinates / scores / contact fields in output', !keys.some(k => /lat|lng|loc|score|phone|email|weight/.test(k)), keys.join(','));
ok('deck: distance rounded to 0.1 km or 0 (<1km)', dA.every(r => r.distance_km === null || Number(r.distance_km) === 0 || Number.isInteger(Math.round(Number(r.distance_km) * 10))), dA.map(r => r.distance_km).join(','));
ok('deck: why codes present', dA.find(r => r.pet_id === pB).why.includes('similar_size_and_energy'), JSON.stringify(dA.map(r => r.why)));
ok('deck: similar pet ranks above dissimilar (run 5x)', (await Promise.all([1, 2, 3, 4, 5].map(async () => (await deck(A, pA))[0].pet_id))).every(id => id === pB));
ok('deck: verified flag = email confirmed (A yes, B not yet)', (await deck(B, pB)).find(r => r.pet_id === pA).verified === true && (await deck(A, pA)).find(r => r.pet_id === pB).verified === false);
await denied("deck: cannot fetch with someone else's pet", () => deck(A, pB), 'NOT_YOUR_PET');
await denied('deck: waitlisted owner refused', async () => { const p = await asRole('service_role', null, () => q(`insert into public.pets (owner_id,name,species,sex,birth_date,size,intents) values ($1,'Out','dog','male','2022-01-01','small','{playdate}') returning id`, [D])); return deck(D, p[0].id); }, 'NOT_IN_CLUSTER');
await asUser(B, () => q(`update public.owners set show_distance=false where id=$1`, [B]));
ok('deck: hidden distance is null', (await deck(A, pA)).find(r => r.pet_id === pB).distance_km === null);
await asUser(B, () => q(`update public.owners set discoverable=false where id=$1`, [B]));
ok('deck: paused profile disappears', !(await deck(A, pA)).some(r => r.pet_id === pB));
await asUser(B, () => q(`update public.owners set discoverable=true, show_distance=true where id=$1`, [B]));

// ---------- swipe / match ----------
const swipe = (uid, from, to, action) => asUser(uid, async () => (await q(`select public.swipe($1,$2,$3) r`, [from, to, action]))[0].r);
await denied('cannot insert likes directly', () => asUser(A, () => q(`insert into public.likes (from_pet_id,to_pet_id,from_owner_id,action) values ($1,$2,$3,'like')`, [pA, pB, A])), 'permission denied');
await denied('cannot insert matches directly', () => asUser(A, () => q(`insert into public.matches (pet_a_id,pet_b_id,owner_a_id,owner_b_id) values (least($1::uuid,$2::uuid),greatest($1::uuid,$2::uuid),$3,$4)`, [pA, pB, A, B])), 'permission denied');
await denied("cannot swipe with someone else's pet", () => swipe(A, pB, pC, 'like'), 'NOT_YOUR_PET');
await denied('cannot swipe across species', () => swipe(A, pA, pCat, 'like'), 'TARGET_UNAVAILABLE');
ok('first like: no match yet', (await swipe(A, pA, pB, 'super')).matched === false);
await denied('second Super Paw same day refused', () => swipe(A, pA, pC, 'super'), 'SUPER_PAW_LIMIT');
ok('super_pawed_you flag reaches the other side', (await deck(B, pB)).find(r => r.pet_id === pA).super_pawed_you === true);
await asUser(B, async () => ok("B cannot see A's like", (await q(`select 1 from public.likes`)).length === 0));
ok('liked card leaves the deck', !(await deck(A, pA)).some(r => r.pet_id === pB));
// rewind rules
await swipe(A, pA, pC, 'pass');
let st = await asUser(A, async () => (await q(`select public.get_swipe_state($1) r`, [pA]))[0].r);
ok('swipe state: 0 supers left, can rewind', st.super_paws_left === 0 && st.can_rewind === true, JSON.stringify(st));
const rw = await asUser(A, async () => (await q(`select public.rewind_last_swipe($1) r`, [pA]))[0].r);
ok('rewind returns last card', rw.rewound && rw.pet_id === pC);
await denied('cannot rewind twice in a row', () => asUser(A, () => q(`select public.rewind_last_swipe($1)`, [pA])), 'REWIND_UNAVAILABLE');
ok('rewound card is back in the deck', (await deck(A, pA)).some(r => r.pet_id === pC));
// mutual
const m = await swipe(B, pB, pA, 'like');
ok('mutual like → match + conversation', m.matched === true && m.match_id && m.conversation_id);
await denied('cannot rewind a swipe that matched', () => asUser(B, () => q(`select public.rewind_last_swipe($1)`, [pB])), 'REWIND_MATCHED');
await asUser(A, async () => {
  ok('matched: other pet, photos and tags now readable', (await q(`select id from public.pets`)).length === 2 && (await q(`select 1 from public.pet_photos`)).length === 2);
  ok("matched: other owner's row still NOT readable", (await q(`select id from public.owners`)).length === 1);
});
const inbox = await asUser(A, () => q(`select * from public.get_inbox()`));
ok('inbox: one row with other pet + owner first name', inbox.length === 1 && inbox[0].other_pet_name === 'Bruno' && inbox[0].other_owner_name === 'Ben' && inbox[0].unread === false);
ok('matched pair never reappears in deck', !(await deck(A, pA)).some(r => r.pet_id === pB));

// ---------- chat ----------
const conv = m.conversation_id;
await asUser(A, () => q(`insert into public.messages (conversation_id, body) values ($1,'Hi! What''s Bruno''s favorite park?')`, [conv]));
await denied('cannot spoof sender_id', () => asUser(A, () => q(`insert into public.messages (conversation_id, sender_id, body) values ($1,$2,'fake')`, [conv, B])), 'permission denied');
await denied('cannot backdate created_at', () => asUser(A, () => q(`insert into public.messages (conversation_id, created_at, body) values ($1,'2020-01-01','old')`, [conv])), 'permission denied');
await denied('third party cannot post into the conversation', () => asUser(C, () => q(`insert into public.messages (conversation_id, body) values ($1,'hello')`, [conv])), 'row-level security');
await asUser(C, async () => ok('third party cannot read messages / conversation / match', (await q(`select 1 from public.messages`)).length + (await q(`select 1 from public.conversations`)).length + (await q(`select 1 from public.matches`)).length === 0));
await denied('no client UPDATE on messages', () => asUser(A, () => q(`update public.messages set body='edited'`)), 'permission denied');
await denied('empty text message refused', () => asUser(A, () => q(`insert into public.messages (conversation_id, body) values ($1,'   ')`, [conv])), 'messages_shape');
await denied("chat photo must be under the conversation's folder", () => asUser(A, () => q(`insert into public.messages (conversation_id, kind, photo_path) values ($1,'photo','other/1.jpg')`, [conv])), 'row-level security');
ok('inbox: unread for recipient, preview set', await asUser(B, async () => { const r = (await q(`select * from public.get_inbox()`))[0]; return r.unread === true && r.last_message_preview.startsWith('Hi!'); }));
await asUser(B, () => q(`select public.mark_conversation_read($1)`, [conv]));
ok('mark read clears unread', await asUser(B, async () => (await q(`select * from public.get_inbox()`))[0].unread === false));
// playdate
const prop = await asUser(A, async () => (await q(`insert into public.messages (conversation_id, kind, payload) values ($1,'playdate_proposal',$2) returning id, payload`, [conv, JSON.stringify({ place: 'Ayala Triangle Gardens', starts_at: '2026-10-03T16:00:00+08:00', status: 'accepted' })]))[0]);
ok('proposal status is forced to proposed', prop.payload.status === 'proposed');
await denied('cannot accept your own proposal', () => asUser(A, () => q(`select public.respond_playdate($1,true)`, [prop.id])), 'CANNOT_ANSWER_OWN_PROPOSAL');
await denied('third party cannot answer a proposal', () => asUser(C, () => q(`select public.respond_playdate($1,true)`, [prop.id])), 'PROPOSAL_NOT_FOUND');
ok('recipient accepts proposal', (await asUser(B, async () => (await q(`select public.respond_playdate($1,true) r`, [prop.id]))[0].r)).status === 'accepted');
await denied('proposal cannot be answered twice', () => asUser(B, () => q(`select public.respond_playdate($1,false)`, [prop.id])), 'PROPOSAL_ALREADY_ANSWERED');
// counter-proposal
const prop2 = await asUser(B, async () => (await q(`insert into public.messages (conversation_id, kind, payload) values ($1,'playdate_proposal',$2) returning id`, [conv, JSON.stringify({ place: 'Legazpi Active Park', starts_at: '2026-10-04T09:00:00+08:00' })]))[0].id);
await denied('counter: the sender cannot counter their own proposal', () => asUser(B, () => q(`select public.counter_playdate($1,'Salcedo Park','2026-10-04T10:00:00+08:00')`, [prop2])), 'CANNOT_ANSWER_OWN_PROPOSAL');
await denied('counter: a third party cannot counter', () => asUser(C, () => q(`select public.counter_playdate($1,'Salcedo Park','2026-10-04T10:00:00+08:00')`, [prop2])), 'PROPOSAL_NOT_FOUND');
const counterId = await asUser(A, async () => (await q(`select public.counter_playdate($1,'Salcedo Park','2026-10-04T10:00:00+08:00','Closer to us') r`, [prop2]))[0].r);
const [oldP, newP] = await Promise.all([q(`select payload, sender_id from public.messages where id=$1`, [prop2]), q(`select payload, sender_id from public.messages where id=$1`, [counterId])]);
ok('counter: old proposal → changed + replaced_by; new proposal by the recipient, proposed, replaces old', oldP[0].payload.status === 'changed' && oldP[0].payload.replaced_by === counterId && newP[0].sender_id === A && newP[0].payload.status === 'proposed' && newP[0].payload.replaces === prop2 && newP[0].payload.place === 'Salcedo Park', JSON.stringify(newP[0].payload));
await denied('counter: a changed proposal cannot be accepted any more', () => asUser(A, () => q(`select public.respond_playdate($1,true)`, [prop2])), 'PROPOSAL_ALREADY_ANSWERED');
ok('counter: the original sender can accept the counter-proposal', (await asUser(B, async () => (await q(`select public.respond_playdate($1,true) r`, [counterId]))[0].r)).status === 'accepted');
ok('a client cannot forge a replaces pointer at another conversation\'s message', await asUser(A, async () => (await q(`insert into public.messages (conversation_id, kind, payload) values ($1,'playdate_proposal',$2) returning payload`, [conv, JSON.stringify({ place: 'x', starts_at: '2026-10-05T09:00:00+08:00', replaces: '00000000-0000-0000-0000-000000000000' })]))[0].payload.replaces === undefined));
await denied('anon cannot call counter_playdate', () => asRole('anon', null, () => q(`select public.counter_playdate($1,'x','2026-10-04T10:00:00+08:00')`, [prop2])), 'permission denied');
// feedback
await asUser(A, () => q(`insert into public.playdate_feedback (match_id, owner_id, rating) values ($1,$2,4)`, [m.match_id, A]));
await asUser(B, async () => ok("playdate feedback is private to its author", (await q(`select 1 from public.playdate_feedback`)).length === 0));
await denied('cannot leave feedback on a match you are not in', () => asUser(C, () => q(`insert into public.playdate_feedback (match_id, owner_id, rating) values ($1,$2,1)`, [m.match_id, C])), 'row-level security');

// ---------- storage + realtime policies ----------
await asUser(A, () => q(`insert into storage.objects (bucket_id,name) values ('pet-photos',$1)`, [`${A}/${pA}/2.jpg`]));
await denied("storage: cannot upload into someone else's folder", () => asUser(A, () => q(`insert into storage.objects (bucket_id,name) values ('pet-photos',$1)`, [`${B}/${pB}/9.jpg`])), 'row-level security');
await asUser(A, () => q(`insert into storage.objects (bucket_id,name) values ('chat-photos',$1)`, [`${conv}/1.jpg`]));
await denied('storage: third party cannot upload a chat photo', () => asUser(C, () => q(`insert into storage.objects (bucket_id,name) values ('chat-photos',$1)`, [`${conv}/2.jpg`])), 'row-level security');
await denied('storage: malformed chat folder is denied, not an error leak', () => asUser(C, () => q(`insert into storage.objects (bucket_id,name) values ('chat-photos','not-a-uuid/2.jpg')`)), 'row-level security');
await asUser(C, async () => ok('storage: third party cannot list chat photos', (await q(`select 1 from storage.objects where bucket_id='chat-photos'`)).length === 0));
await asUser(B, async () => ok('storage: participant can read chat photos', (await q(`select 1 from storage.objects where bucket_id='chat-photos'`)).length === 1));
const joinChannel = (uid, topic) => asUser(uid, async () => { await db.exec(`select set_config('realtime.topic','${topic}',false)`); return q(`insert into realtime.messages (topic, extension) values ($1,'broadcast') returning id`, [topic]); });
ok('realtime: participant may broadcast typing', (await joinChannel(A, `conversation:${conv}`)).length === 1);
await denied('realtime: outsider may not join the conversation channel', () => joinChannel(C, `conversation:${conv}`), 'row-level security');

// Joining a private channel = being able to SELECT from realtime.messages for that topic.
await db.exec(`insert into realtime.messages (topic, extension) values ('probe','broadcast')`);
const canJoin = (uid, topic) => asUser(uid, async () => { await db.exec(`select set_config('realtime.topic','${topic}',false)`); return (await q(`select 1 from realtime.messages limit 1`)).length > 0; });
ok('realtime: participant may join conversation:<id>', await canJoin(B, `conversation:${conv}`));
ok('realtime: outsider may NOT join conversation:<id>', !(await canJoin(C, `conversation:${conv}`)));
ok('realtime: owner may join their own inbox:<owner_id>', await canJoin(A, `inbox:${A}`));
ok("realtime: nobody may join someone else's inbox", !(await canJoin(C, `inbox:${A}`)));
ok('realtime: arbitrary topics are closed', !(await canJoin(A, 'lobby')) && !(await canJoin(A, 'conversation:not-a-uuid')));
await denied('realtime: nobody can broadcast on an inbox channel', () => joinChannel(A, `inbox:${A}`), 'row-level security');

// ---------- reports / moderation ----------
const msgB = await asUser(B, async () => (await q(`insert into public.messages (conversation_id, body) values ($1,'send me money first') returning id`, [conv]))[0].id);
await asUser(A, () => q(`insert into public.reports (target_owner_id, target_pet_id, message_id, reason, details) values ($1,$2,$3,'scam','asked for money')`, [B, pB, msgB]));
const rep = (await q(`select * from public.reports`))[0];
ok('report: reporter stamped server-side, message snapshotted', rep.reporter_id === A && rep.message_snapshot === 'send me money first' && rep.status === 'open');
await denied('report: cannot forge reporter_id', () => asUser(A, () => q(`insert into public.reports (reporter_id, target_owner_id, reason) values ($1,$2,'spam')`, [C, B])), 'permission denied');
await denied('report: cannot pre-resolve', () => asUser(A, () => q(`insert into public.reports (target_owner_id, reason, status) values ($1,'spam','dismissed')`, [B])), 'permission denied');
await denied("report: cannot cite a message from a conversation you're not in", () => asUser(C, () => q(`insert into public.reports (target_owner_id, message_id, reason) values ($1,$2,'spam')`, [B, msgB])), 'REPORT_MESSAGE_MISMATCH');
await denied('report: cannot report yourself', () => asUser(A, () => q(`insert into public.reports (target_owner_id, reason) values ($1,'spam')`, [A])), 'row-level security');
await asUser(B, async () => ok('reported user cannot see the report', (await q(`select 1 from public.reports`)).length === 0));
await asUser(A, async () => ok('reporter sees own report history', (await q(`select 1 from public.reports`)).length === 1));
await denied('non-moderator cannot open the queue', () => asUser(A, () => q(`select * from public.get_moderation_queue()`)), 'NOT_A_MODERATOR');
await denied('non-moderator cannot resolve', () => asUser(A, () => q(`select public.resolve_report($1,'suspend')`, [rep.id])), 'NOT_A_MODERATOR');
const queue = await asUser(MOD, () => q(`select * from public.get_moderation_queue()`));
ok('moderator sees the queue with context', queue.length === 1 && queue[0].target_owner_name === 'Ben' && queue[0].target_pet_name === 'Bruno' && queue[0].message_snapshot);
await asUser(MOD, () => q(`select public.resolve_report($1,'suspend')`, [rep.id]));
ok('one-click suspend', (await q(`select status from public.owners where id=$1`, [B]))[0].status === 'suspended' && (await q(`select status from public.reports`))[0].status === 'actioned');
await denied('suspended: cannot post', () => asUser(B, () => q(`insert into public.messages (conversation_id, body) values ($1,'still here')`, [conv])), 'row-level security');
await denied('suspended: cannot swipe', () => swipe(B, pB, pC, 'like'), 'SUSPENDED');
await denied('suspended: cannot load deck', () => deck(B, pB), 'SUSPENDED');
ok('suspended pets vanish from decks', !(await deck(C, pC)).some(r => r.pet_id === pB));
await asUser(MOD, () => q(`select public.unsuspend_owner($1)`, [B]));

// ---------- blocks ----------
await asUser(A, () => q(`insert into public.blocks (blocker_id, blocked_id) values ($1,$2)`, [A, B]));
ok('block ends the match', (await q(`select status, unmatched_by from public.matches where id=$1`, [m.match_id]))[0].status === 'unmatched');
await denied('blocked: cannot post', () => asUser(B, () => q(`insert into public.messages (conversation_id, body) values ($1,'why?')`, [conv])), 'row-level security');
await asUser(B, async () => ok('blocked party cannot see the block row', (await q(`select 1 from public.blocks`)).length === 0));
ok('blocked: inbox empties on both sides', (await asUser(A, () => q(`select * from public.get_inbox()`))).length === 0 && (await asUser(B, () => q(`select * from public.get_inbox()`))).length === 0);
await asUser(B, async () => ok("blocked: other side's pet no longer readable", (await q(`select id from public.pets`)).length === 1));
await denied('blocked: get_pet_profile refuses', async () => { const r = await asUser(B, () => q(`select * from public.get_pet_profile($1,$2)`, [pB, pA])); if (r.length === 0) throw new Error('empty'); return r; });
await denied("cannot create a block on someone else's behalf", () => asUser(C, () => q(`insert into public.blocks (blocker_id, blocked_id) values ($1,$2)`, [A, C])), 'row-level security');

// ---------- profile / referral / export / anon / seed ----------
const prof = await asUser(C, () => q(`select * from public.get_pet_profile($1,$2)`, [pC, pA]));
ok('full profile: public-safe fields only', prof.length === 1 && !Object.keys(prof[0]).some(k => /lat|lng|loc|phone|email/.test(k)));
const codeA = (await q(`select referral_code from public.owners where id=$1`, [A]))[0].referral_code;
ok('referral: credited once', (await asUser(C, async () => (await q(`select public.claim_referral($1) r`, [codeA.toUpperCase()]))[0].r)) === true && (await asUser(C, async () => (await q(`select public.claim_referral($1) r`, [codeA]))[0].r)) === false);
ok('referral: cannot refer yourself', (await asUser(A, async () => (await q(`select public.claim_referral($1) r`, [codeA]))[0].r)) === false);
const exp = await asUser(A, async () => (await q(`select public.export_my_data() r`))[0].r);
ok('export: contains own data only', exp.account.email === 'ana@pawme.test' && exp.account.phone === '+639170000001' && exp.pets.length === 1 && exp.messages_sent.every(x => x.sender_id === A) && !('role' in exp.owner), Object.keys(exp).join(','));
for (const t of ['owners', 'pets', 'pet_photos', 'pet_tags', 'likes', 'matches', 'conversations', 'messages', 'reports', 'blocks', 'playdate_feedback', 'waitlist', 'ranking_config'])
  await denied(`anon cannot read ${t}`, () => asRole('anon', null, () => q(`select * from public.${t} limit 1`)), 'permission denied');
for (const f of [`get_deck('${pA}')`, `get_inbox()`, `export_my_data()`, `enter_cluster(14.55,121.02)`, `get_moderation_queue()`])
  await denied(`anon cannot call ${f.split('(')[0]}`, () => asRole('anon', null, () => q(`select public.${f}`)), 'permission denied');
await denied('authenticated cannot call private definer helpers it was not granted', () => asUser(A, () => q(`select private.is_blocked_between($1,$2)`, [A, B])), 'permission denied');
await denied('seed rows refused while allow_seed=false (production default)', () => asRole('service_role', null, () => q(`update public.owners set is_seed=true where id=$1`, [C])), 'SEED_NOT_ALLOWED');
await db.exec(`update public.ranking_config set allow_seed=true`);
await asRole('service_role', null, () => q(`update public.owners set is_seed=true where id=$1`, [C]));
ok('seed rows allowed once allow_seed=true (dev)', true);
const rlsOff = await q(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`);
ok('RLS enabled on every public table', rlsOff.length === 0, rlsOff.map(r => r.relname).join(','));
const tables = await q(`select count(*)::int n from pg_tables where schemaname='public'`);
ok('exactly 14 tables: the 13 from §10 + banned_identities', tables[0].n === 14);
const fkNoIdx = await q(`
  select c.conrelid::regclass::text as tbl, a.attname from pg_constraint c
  join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  where c.contype='f' and c.connamespace='public'::regnamespace
    and not exists (select 1 from pg_index i where i.indrelid=c.conrelid and i.indkey[0]=c.conkey[1])`);
ok('every foreign key has a leading index', fkNoIdx.length === 0, fkNoIdx.map(r => `${r.tbl}.${r.attname}`).join(', '));
// account deletion cascade
await db.exec(`delete from auth.users where id='${A}'`);
ok('deleting the auth user cascades all owner data', (await q(`select (select count(*) from public.pets where owner_id=$1)+(select count(*) from public.messages where sender_id=$1)+(select count(*) from public.matches where $1 in (owner_a_id,owner_b_id))+(select count(*) from public.likes where from_owner_id=$1) n`, [A]))[0].n == 0);
ok('report survives reporter deletion (evidence kept)', (await q(`select count(*)::int n from public.reports`))[0].n === 1);

// ---------- settings functions ----------
{
  const [S1, S2] = await Promise.all(['+639175550001', '+639175550002'].map(mk));
  await enter(S1, 14.5566, 121.0234); await enter(S2, 14.5650, 121.0365);
  await asUser(S1, () => q(`update public.owners set display_name='Sam' where id=$1`, [S1]));
  await asUser(S2, () => q(`update public.owners set display_name='Tess' where id=$1`, [S2]));
  const p1 = await mkPet(S1, 'Pepper'), p2 = await mkPet(S2, 'Tofu');
  const setPhotos = (uid, pet, paths) => asUser(uid, async () => (await q(`select public.set_pet_photos($1,$2::text[]) r`, [pet, `{${paths.join(',')}}`]))[0].r);
  const a = `${S1}/${p1}/a.jpg`, b = `${S1}/${p1}/b.jpg`, first = `${S1}/${p1}/1.jpg`;
  const removed = await setPhotos(S1, p1, [b, a, b]);
  const rows = await q(`select storage_path, position from public.pet_photos where pet_id=$1 order by position`, [p1]);
  ok('set_pet_photos: replaces atomically, keeps order, de-duplicates, returns dropped paths', rows.map((r) => r.storage_path).join() === [b, a].join() && rows.map((r) => r.position).join() === '1,2' && String(removed) === first, JSON.stringify(removed));
  await denied('set_pet_photos: zero photos refused (a pet must stay visible)', () => setPhotos(S1, p1, []), 'PHOTOS_MUST_BE_1_TO_5');
  await denied('set_pet_photos: more than five refused', () => setPhotos(S1, p1, [1, 2, 3, 4, 5, 6].map((n) => `${S1}/${p1}/${n}.jpg`)), 'PHOTOS_MUST_BE_1_TO_5');
  await denied("set_pet_photos: cannot point at someone else's folder", () => setPhotos(S1, p1, [`${S2}/${p2}/1.jpg`]), 'PHOTO_PATH_NOT_YOURS');
  await denied("set_pet_photos: cannot edit someone else's pet", () => setPhotos(S1, p2, [a]), 'NOT_YOUR_PET');
  ok('set_pet_photos: a refused call changed nothing', (await q(`select count(*)::int n from public.pet_photos where pet_id=$1`, [p1]))[0].n === 2);
  await denied('anon cannot call set_pet_photos', () => asRole('anon', null, () => q(`select public.set_pet_photos($1,'{x}')`, [p1])), 'permission denied');

  await asUser(S1, () => q(`insert into public.blocks (blocker_id, blocked_id) values ($1,$2)`, [S1, S2]));
  await asUser(S1, () => q(`insert into public.reports (target_owner_id, target_pet_id, reason, details) values ($1,$2,'spam','ads')`, [S2, p2]));
  const myBlocks = await asUser(S1, () => q(`select * from public.get_my_blocks()`));
  ok('get_my_blocks: first name + pet name only', myBlocks.length === 1 && myBlocks[0].owner_name === 'Tess' && myBlocks[0].pet_name === 'Tofu' && !Object.keys(myBlocks[0]).some((k) => /phone|email|lat$|lng$|^loc_/.test(k)), Object.keys(myBlocks[0]).join(','));
  ok('get_my_blocks: the blocked person sees nothing', (await asUser(S2, () => q(`select * from public.get_my_blocks()`))).length === 0);
  const myReports = await asUser(S1, () => q(`select * from public.get_my_reports()`));
  ok('get_my_reports: reason, status, names — no moderator fields', myReports.length === 1 && myReports[0].status === 'open' && myReports[0].owner_name === 'Tess' && !Object.keys(myReports[0]).some((k) => /resolved|snapshot|reporter/.test(k)), Object.keys(myReports[0]).join(','));
  ok('get_my_reports: the reported person sees nothing', (await asUser(S2, () => q(`select * from public.get_my_reports()`))).length === 0);
  await asUser(S1, () => q(`delete from public.blocks where blocker_id=$1 and blocked_id=$2`, [S1, S2]));
  ok('unblock: the pair can see each other in the deck again', (await deck(S1, p1)).some((r) => r.pet_id === p2) && (await deck(S2, p2)).some((r) => r.pet_id === p1));
  await denied("unblock: cannot remove someone else's block", async () => { await asUser(S1, () => q(`insert into public.blocks (blocker_id, blocked_id) values ($1,$2)`, [S1, S2])); const r = await asUser(S2, () => db.query(`delete from public.blocks where blocker_id=$1`, [S1])); if (r.affectedRows === 0) throw new Error('0 rows'); return r; }, '0 rows');
  await db.exec(`delete from public.reports where reporter_id='${S1}'; delete from auth.users where id in ('${S1}','${S2}')`);
}

// ---------- banned identities (email): suspension survives delete + re-signup ----------
ok('earlier suspend→unsuspend of B left no ban behind', (await q(`select count(*)::int n from public.banned_identities`))[0].n === 0);
await asUser(C, () => q(`insert into public.reports (target_owner_id, reason) values ($1,'harassment')`, [B]));
const rep2 = (await q(`select id from public.reports where status='open' and target_owner_id=$1`, [B]))[0];
await asUser(MOD, () => q(`select public.resolve_report($1,'suspend')`, [rep2.id]));
const bans = await q(`select * from public.banned_identities`);
ok('suspend records an EMAIL ban: hash only, never the address', bans.length === 1 && bans[0].kind === 'email' && /^[0-9a-f]{64}$/.test(bans[0].identity_hash) && !JSON.stringify(bans[0]).includes('ben@') && bans[0].reason === 'harassment' && bans[0].banned_by === MOD, JSON.stringify(bans.map((b) => b.kind)));
await denied('authenticated cannot read banned_identities', () => asUser(C, () => q(`select * from public.banned_identities`)), 'permission denied');
await denied('anon cannot read banned_identities', () => asRole('anon', null, () => q(`select * from public.banned_identities`)), 'permission denied');
await denied('authenticated cannot write banned_identities', () => asUser(C, () => q(`delete from public.banned_identities`)), 'permission denied');
await denied('authenticated cannot call the ban helpers', () => asUser(C, () => q(`select private.is_identity_banned('ben@pawme.test', null)`)), 'permission denied');
await denied('replaced resolve_report is still moderator-only', () => asUser(C, () => q(`select public.resolve_report($1,'dismiss')`, [rep2.id])), 'NOT_A_MODERATOR');
await denied('replaced resolve_report is still closed to anon', () => asRole('anon', null, () => q(`select public.resolve_report($1,'dismiss')`, [rep2.id])), 'permission denied');
const h = async (x) => (await q(`select private.email_hash($1) h`, [x]))[0].h;
ok('email normalisation: case, spaces and +tags collapse; gmail dots collapse; other domains keep dots', (await h('Ben@Pawme.Test ')) === (await h('ben+again@pawme.test')) && (await h('b.e.n@gmail.com')) === (await h('ben@googlemail.com')) && (await h('b.en@pawme.test')) !== (await h('ben@pawme.test')));

await db.exec(`delete from auth.users where id='${B}'`);   // the evasion attempt: delete account…
ok('ban survives account deletion', (await q(`select count(*)::int n from public.banned_identities`))[0].n === 1);
const B2 = await mk('Ben+new@Pawme.test');                    // …and sign up again with an alias of the banned address
const b2 = (await q(`select status, suspended_at from public.owners where id=$1`, [B2]))[0];
ok('re-signup with a banned email (even as an alias) → owner starts suspended', b2.status === 'suspended' && b2.suspended_at !== null);
await enter(B2, 14.5650, 121.0365);
await denied('evader cannot create a pet', () => asUser(B2, () => q(`insert into public.pets (owner_id,name,species,sex,birth_date,size,intents) values ($1,'Bruno2','dog','male','2022-01-01','medium','{playdate}')`, [B2])), 'row-level security');
await denied('evader cannot lift their own suspension', () => asUser(B2, () => q(`update public.owners set status='active' where id=$1`, [B2])), 'permission denied');

const E = await mk('eve@pawme.test');                          // clean address, then changes it to the banned one
ok('clean email → active owner', (await q(`select status from public.owners where id=$1`, [E]))[0].status === 'active');
await db.exec(`update auth.users set email='ben@pawme.test' where id='${E}'`);
ok('changing the login email to a banned one suspends the account', (await q(`select status from public.owners where id=$1`, [E]))[0].status === 'suspended');

await asUser(MOD, () => q(`select public.unsuspend_owner($1)`, [B2]));
ok('unsuspend lifts the ban', (await q(`select count(*)::int n from public.banned_identities`))[0].n === 0 && (await q(`select status from public.owners where id=$1`, [B2]))[0].status === 'active');
const F = await mk('ben@pawme.test');
ok('after the ban is lifted the address signs up normally', (await q(`select status from public.owners where id=$1`, [F]))[0].status === 'active');

// dormant phone path: an account that also has a phone gets both hashes banned
await db.exec(`update auth.users set phone='+639170000077' where id='${F}'`);
await asUser(C, () => q(`insert into public.reports (target_owner_id, reason) values ($1,'spam')`, [F]));
await asUser(MOD, async () => q(`select public.resolve_report((select id from public.reports where target_owner_id=$1 and status='open' limit 1),'suspend')`, [F]));
ok('suspending an account with a phone bans BOTH the email and the phone hash', (await q(`select string_agg(kind, ',' order by kind) k from public.banned_identities`))[0].k === 'email,phone');
ok('re-signup by that phone alone starts suspended (dormant phone ban still works)', (await q(`select status from public.owners where id=$1`, [await (async () => (await q(`insert into auth.users (phone) values ('+639170000077') returning id`))[0].id)()]))[0].status === 'suspended');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
