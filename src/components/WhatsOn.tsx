// Static "What's on PAWME" for the welcome screen. Two groups only:
//   LIVE NOW    — things that actually work today, as present-tense benefits.
//   COMING SOON — momentum, not gaps. No dates. No Phase 3 commercial items
//                 (marketplace, ads, insurance) anywhere.
const LIVE: [string, string, string][] = [
  ['🐾', 'Swipe to discover', 'Pets near you, ranked by who your pet would actually get along with.'],
  ['❤️', 'Mutual matches', "It's a Paw-Match only when you both like each other."],
  ['💬', 'Realtime chat', 'Typing, seen, and starters to break the ice.'],
  ['📅', 'Playdate proposals', 'Pick a public place, a date and a time — accept or suggest a change.'],
  ['🛡️', 'Report & block, everywhere', 'Verified owners, approximate distance only, and a moderation team.'],
  ['🎉', 'Share & invite', 'A match card for your stories, and invite links that grow your pack.'],
  ['⚙️', 'Your profile, your rules', 'Edit your pet, pause discovery, export or delete your data any time.'],
];
const SOON: [string, string][] = [
  ['🐕', 'Paw Friends'],
  ['🏘️', 'Communities'],
  ['🎪', 'Events & meetups'],
  ['🚨', 'Lost-pet alerts'],
  ['🔔', 'Push notifications'],
  ['📍', 'More areas beyond Makati'],
];

export default function WhatsOn() {
  return (
    <section aria-labelledby="whats-on" data-testid="whats-on" className="mt-2">
      <h2 id="whats-on" className="text-xl font-extrabold tracking-tight">What's on PAWME</h2>

      <h3 className="mt-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-like">
        <span className="h-2 w-2 rounded-full bg-like" aria-hidden />Live now
      </h3>
      <ul className="mt-2 divide-y divide-black/5 rounded-2xl bg-white shadow-sm">
        {LIVE.map(([icon, title, blurb]) => (
          <li key={title} className="flex gap-3 px-4 py-3">
            <span className="mt-0.5 text-xl" aria-hidden>{icon}</span>
            <span><span className="block font-semibold">{title}</span><span className="block text-sm text-muted">{blurb}</span></span>
          </li>
        ))}
      </ul>

      <h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-brand-dark">Coming soon</h3>
      <ul className="mt-2 flex flex-wrap gap-2">
        {SOON.map(([icon, title]) => (
          <li key={title} className="rounded-full border border-brand/30 bg-brand/5 px-3 py-1.5 text-sm font-semibold text-brand-dark">
            <span aria-hidden>{icon}</span> {title}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">We're starting small so every match is close enough to meet. More on the way.</p>
    </section>
  );
}
