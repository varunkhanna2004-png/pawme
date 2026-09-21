// Shared by every dev-only script. Nothing that imports this can touch production:
//   1. the script must be run with --dev;
//   2. SUPABASE_URL must be on the allowlist below and must NOT be production;
//   3. the service key's own `ref` claim must match the URL.
// Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from process.env (.env.seed.local,
// gitignored). The service key is never used by the client.
import { createClient } from '@supabase/supabase-js';

const PRODUCTION_REF = 'tzifbmuuczogckruptap';
const ALLOWED_REFS = ['ooigdeefqwgzkpujvexu']; // pawme-dev

export const die = (msg) => { console.error(`\n✋ refused: ${msg}\n`); process.exit(1); };

export function connectDev(args) {
  if (!args.has('--dev')) die('run with --dev. This script is for the dev project only.');
  if (process.env.NODE_ENV === 'production') die('NODE_ENV is production.');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) die('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.seed.local).');
  const ref = new URL(url).hostname.split('.')[0];
  if (ref === PRODUCTION_REF || url.includes(PRODUCTION_REF)) die('SUPABASE_URL is the PRODUCTION project. Production is never seeded or reset.');
  if (!ALLOWED_REFS.includes(ref)) die(`project "${ref}" is not on the dev allowlist in scripts/lib/dev-guard.mjs.`);
  if (key.startsWith('eyJ')) {
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    if (claims.ref !== ref) die(`the service key belongs to project "${claims.ref}", not "${ref}".`);
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const must = async (promise, what) => { const { data, error } = await promise; if (error) die(`${what}: ${error.message}`); return data; };
  return { db, ref, must };
}

export async function allUsers(db, must) {
  const users = [];
  for (let page = 1; ; page++) {
    const data = await must(db.auth.admin.listUsers({ page, perPage: 200 }), 'list users');
    users.push(...data.users);
    if (data.users.length < 200) return users;
  }
}

/** Delete an auth user and everything they own, including their stored photos. */
export async function deleteUserCompletely(db, must, id) {
  const files = [];
  for (const folder of (await must(db.storage.from('pet-photos').list(id), 'list photos')) ?? []) {
    for (const f of (await must(db.storage.from('pet-photos').list(`${id}/${folder.name}`), 'list photos')) ?? []) files.push(`${id}/${folder.name}/${f.name}`);
  }
  if (files.length) await must(db.storage.from('pet-photos').remove(files), 'remove photos');
  await must(db.auth.admin.deleteUser(id), 'delete user'); // cascades owners → pets → everything
  return files.length;
}
