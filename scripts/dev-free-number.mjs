// PAWME — DEV ONLY. Frees a test phone number so it behaves like a brand-new user:
// deletes the auth user registered to it, everything they own, and their photos.
//
//   npm run dev:free-number            frees 639170000003 (the onboarding test number)
//   npm run dev:free-number -- 63917…  frees another number
//
// Same guards as the seed script (scripts/lib/dev-guard.mjs): dev project only.
import { allUsers, connectDev, deleteUserCompletely } from './lib/dev-guard.mjs';

const argv = process.argv.slice(2);
const { db, ref, must } = connectDev(new Set(argv));
const phone = (argv.find((a) => /^\+?\d{10,15}$/.test(a)) ?? '639170000003').replace(/^\+/, '');

const user = (await allUsers(db, must)).find((u) => u.phone === phone);
if (!user) console.log(`${phone} is already free in ${ref}.`);
else console.log(`freed ${phone} in ${ref}: deleted the account and ${await deleteUserCompletely(db, must, user.id)} photo(s).`);
