import type { Enums } from './supabase';

export function formatAge(months: number): string {
  if (months < 1) return 'under 1 mo';
  if (months < 12) return `${months} mo`;
  const years = Math.floor(months / 12);
  return `${years} yr${years === 1 ? '' : 's'}`;
}

/** §3.3: approximate only. 0 means "under 1 km"; null means the owner hides distance. */
export function formatDistance(km: number | null): string | null {
  if (km === null) return null;
  return km === 0 ? 'under 1 km away' : `${km.toFixed(1)} km away`;
}

const INTENT_LABEL: Record<Enums<'pet_intent'>, string> = {
  playdate: 'Playdate',
  walking_buddy: 'Walking Buddy',
  friendship: 'Friendship',
};
export const intentLabel = (i: Enums<'pet_intent'>) => INTENT_LABEL[i];

export const tagLabel = (t: string) => t.replace(/_/g, ' ');

/**
 * §7 "Why this match": the server sends reason codes (never scores or weights);
 * the words live here so they can be edited or translated without a migration.
 */
export function whyThisMatch(codes: string[]): string | null {
  const phrases: string[] = [];
  for (const code of codes) {
    const [kind, value] = code.split(':');
    if (kind === 'similar_size_and_energy') phrases.push('similar size and energy');
    else if (kind === 'similar_energy') phrases.push('similar energy');
    else if (kind === 'similar_size') phrases.push('similar size');
    else if (kind === 'shared_intent' && value) phrases.push(`both looking for a ${INTENT_LABEL[value as Enums<'pet_intent'>]?.toLowerCase() ?? value}`);
    else if (kind === 'shared_tag' && value) phrases.push(`both ${tagLabel(value)}`);
    else if (kind === 'similar_age') phrases.push('close in age');
    else if (kind === 'very_close') phrases.push('lives very close by');
    if (phrases.length === 2) break;
  }
  if (!phrases.length) return null;
  const text = phrases.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Database functions raise short codes; turn them into copy. */
const ERROR_COPY: Record<string, string> = {
  SUPER_PAW_LIMIT: "You've used today's Super Paw. It refills at midnight.",
  TARGET_UNAVAILABLE: "That pet isn't available any more.",
  ALREADY_MATCHED: "You've already matched with this pet.",
  REWIND_UNAVAILABLE: 'Nothing to rewind — you can only take back your last swipe.',
  REWIND_MATCHED: "That swipe became a match, so it can't be rewound.",
  SUSPENDED: 'Your account is suspended.',
  NOT_IN_CLUSTER: "PAWME isn't in your area yet.",
  NOT_AUTHENTICATED: 'Please sign in again.',
};
export function errorCopy(message: string | undefined): string {
  if (!message) return 'Something went wrong. Please try again.';
  if (/failed to fetch|network|load failed/i.test(message)) return "You're offline or the connection dropped. Try again.";
  return ERROR_COPY[message] ?? 'Something went wrong. Please try again.';
}

export function timeShort(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Accepts 0917…, 917…, 63917…, +63917… → E.164 (+63917…). Returns null if it is not a PH mobile number. */
export function normalizePhMobile(input: string): string | null {
  let d = input.replace(/\D/g, '');
  if (d.startsWith('63')) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  return /^9\d{9}$/.test(d) ? `+63${d}` : null;
}
