// Shared helpers for the end-to-end suites (dev project only).
//
// Sign-in is email OTP. The suites must not depend on an email provider or its
// rate limit, so signIn() stubs the browser's "send code" request (the app
// believes the email went out) and fetches a real one-time code through the
// admin API (generateLink → email_otp). The code is then typed into the real UI
// and verified by real Supabase Auth — only the delivery step is skipped.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const ORIGIN = 'http://localhost:5173';
const URL_ = process.env.SUPABASE_URL ?? '';
if (!/ooigdeefqwgzkpujvexu/.test(URL_)) { console.error('refused: SUPABASE_URL is not pawme-dev (run with --env-file=.env.seed.local)'); process.exit(1); }
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ANON = fs.readFileSync(path.join(__dirname, '..', '.env.development.local'), 'utf8').match(/^VITE_SUPABASE_ANON_KEY=(.+)$/m)[1].trim();

const EMAILS = { ana: 'ana@pawme.test', ben: 'ben@pawme.test', mod: 'mod@pawme.test', fresh: 'dana@pawme.test' };

async function usersByEmail() {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  return Object.fromEntries(data.users.filter((u) => u.email).map((u) => [u.email.toLowerCase(), u]));
}
const findUser = async (email) => (await usersByEmail())[email.toLowerCase()];

/** The app creates the auth user on "send code"; with the send stubbed, a brand-new address is created here instead. */
async function ensureUser(email) {
  const existing = await findUser(email);
  if (existing) return existing;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user;
}

async function otpFor(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`generateLink ${email}: ${error.message}`);
  return data.properties.email_otp;
}

async function stubOtpSend(page) {
  await page.route('**/auth/v1/otp*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
}

/** Full sign-in through the UI: welcome → email → code → verified. */
async function signIn(page, email, { waitFor = 'nav >> text=Discover', fresh = false } = {}) {
  await stubOtpSend(page);
  await page.goto(ORIGIN + '/');
  await page.click('text=Get started');
  await page.fill('#email', email);
  await page.click('text=Send code');
  await page.waitForSelector('#otp');
  if (fresh) await ensureUser(email);
  await page.fill('#otp', await otpFor(email));
  await page.click('text=Verify');
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 25000 });
}

/** A signed-in API client for a test account (RLS applies), without a browser. */
async function apiAsUser(email) {
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const v = await c.auth.verifyOtp({ email, token: await otpFor(email), type: 'email' });
  if (v.error) throw new Error(`verify ${email}: ${v.error.message}`);
  return c;
}

/** Same, riding on the session a browser page already holds. */
async function apiFromPage(page) {
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k)))).access_token);
  return { token, api: createClient(URL_, ANON, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } }) };
}

async function listFiles(bucket, prefix) {
  const out = [];
  for (const item of (await admin.storage.from(bucket).list(prefix, { limit: 1000 })).data ?? []) {
    if (item.id === null) out.push(...(await listFiles(bucket, `${prefix}/${item.name}`))); else out.push(`${prefix}/${item.name}`);
  }
  return out;
}

/** Delete a test account and its photos so the address is brand-new again. */
async function freeAccount(email) {
  const u = await findUser(email);
  if (!u) return;
  const files = await listFiles('pet-photos', u.id);
  if (files.length) await admin.storage.from('pet-photos').remove(files);
  await admin.auth.admin.deleteUser(u.id);
}

module.exports = { ORIGIN, URL_, ANON, admin, EMAILS, usersByEmail, findUser, ensureUser, otpFor, stubOtpSend, signIn, apiAsUser, apiFromPage, listFiles, freeAccount };
