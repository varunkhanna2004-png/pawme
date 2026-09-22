// PAWME — DEV ONLY. Frees a test email so it behaves like a brand-new user:
// deletes the auth user registered to it, everything they own, and their photos.
//
//   npm run dev:free-account                      frees dana@pawme.test (the onboarding test address)
//   npm run dev:free-account -- you@example.com   frees another address
//
// Same guards as the seed script (scripts/lib/dev-guard.mjs): dev project only.
import { allUsers, connectDev, deleteUserCompletely } from './lib/dev-guard.mjs';

const argv = process.argv.slice(2);
const { db, ref, must } = connectDev(new Set(argv));
const email = (argv.find((a) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a)) ?? 'dana@pawme.test').toLowerCase();

const user = (await allUsers(db, must)).find((u) => u.email?.toLowerCase() === email);
if (!user) console.log(`${email} is already free in ${ref}.`);
else console.log(`freed ${email} in ${ref}: deleted the account and ${await deleteUserCompletely(db, must, user.id)} photo(s).`);
