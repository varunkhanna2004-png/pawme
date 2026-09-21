// PAWME — account deletion (master prompt §9: Philippine Data Privacy Act —
// "build these; don't stub them").
//
// Deleting an auth user needs the service key, which must never reach the
// browser — so this runs here, server-side, where Supabase injects it.
//
// What it does, in this order:
//   1. identifies the caller from their own access token (never from the body);
//   2. removes their stored files: every pet photo under pet-photos/{uid}/ and the
//      chat photos of every conversation they are part of (those conversations
//      are about to be deleted, so the files would otherwise be orphaned);
//   3. revokes all their sessions;
//   4. deletes the auth user — the database cascades from there:
//      owners → pets → photos rows, tags, swipes, matches → conversations → messages,
//      blocks, playdate feedback, waitlist. Reports they FILED stay (with the
//      reporter blanked) so moderation evidence isn't lost, and a suspended
//      owner's banned-phone hash stays so deletion can't be used to dodge a ban.
// If step 2 fails nothing else happens, so the user can simply try again.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Every object path under `prefix` in a bucket (folders are walked, max depth 4). */
async function listAll(admin: SupabaseClient, bucket: string, prefix: string, depth = 0): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    for (const item of data ?? []) {
      const path = `${prefix}/${item.name}`;
      if (item.id === null) { if (depth < 4) out.push(...(await listAll(admin, bucket, path, depth + 1))); } // a folder
      else out.push(path);
    }
    if (!data || data.length < 1000) return out;
  }
}

async function removeAll(admin: SupabaseClient, bucket: string, paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
    if (error) throw new Error(`remove from ${bucket}: ${error.message}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'NOT_AUTHENTICATED' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await admin.auth.getUser(token); // validated by the auth server
  if (authError || !auth.user) return json(401, { error: 'NOT_AUTHENTICATED' });
  const uid = auth.user.id;

  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== 'DELETE') return json(400, { error: 'CONFIRMATION_REQUIRED' });

  try {
    const petPhotos = await listAll(admin, 'pet-photos', uid);
    const { data: conversations, error: convError } = await admin.from('conversations').select('id').or(`owner_a_id.eq.${uid},owner_b_id.eq.${uid}`);
    if (convError) throw new Error(convError.message);
    const chatPhotos = (await Promise.all((conversations ?? []).map((c) => listAll(admin, 'chat-photos', c.id)))).flat();

    await removeAll(admin, 'pet-photos', petPhotos);
    await removeAll(admin, 'chat-photos', chatPhotos);

    await admin.auth.admin.signOut(token, 'global').catch(() => undefined); // best effort; the user row is about to go
    const { error: deleteError } = await admin.auth.admin.deleteUser(uid);
    if (deleteError) throw new Error(deleteError.message);

    return json(200, { deleted: true, files_removed: petPhotos.length + chatPhotos.length });
  } catch (e) {
    console.error('delete-account failed', uid, e);
    return json(500, { error: 'DELETE_FAILED' });
  }
});
