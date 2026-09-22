import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { errorCopy } from '../lib/format';
import { Spinner } from './States';

type Stats = Record<string, number> & { as_of: string };

// Headline counts for the pilot (moderator-only; get_owner_stats() refuses
// everyone else). Read-only — no funnel, no retention.
export default function StatsPanel() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_owner_stats');
    if (error) return setError(error.message === 'NOT_A_MODERATOR' ? 'This account is not a moderator.' : errorCopy(error.message));
    setError(null);
    setStats(data as Stats);
  }, []);
  useEffect(() => void load(), [load]);

  if (error) return <p role="alert" className="rounded-xl bg-nope/10 px-4 py-3 text-sm text-nope">{error}</p>;
  if (!stats) return <div className="flex justify-center pt-16"><Spinner /></div>;

  const groups: [string, [string, string, string?][]][] = [
    ['People', [['owners_total', 'Owners'], ['signups_7d', 'New in last 7 days'], ['owners_active', 'In Makati, active'], ['waitlisted', 'Waitlisted (outside)'], ['owners_suspended', 'Suspended']]],
    ['Pets', [['pets', 'Pets'], ['pets_discoverable', 'Showing in Discover']]],
    ['Activity', [['swipes', 'Swipes'], ['matches_total', 'Matches'], ['matches_active', 'Still active'], ['messages', 'Messages'], ['playdates_proposed', 'Playdates proposed'], ['playdates_accepted', 'Playdates accepted']]],
    ['Safety', [['reports_open', 'Open reports']]],
  ];

  return (
    <div data-testid="stats">
      {stats.owners_seed > 0 && <p className="mb-3 rounded-xl bg-amber-100 px-4 py-2 text-xs font-semibold text-amber-800">{stats.owners_seed} of these owners are seed accounts (dev data).</p>}
      {groups.map(([title, items]) => (
        <section key={title} className="mb-4">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">{title}</h2>
          <div className="grid grid-cols-2 gap-2">
            {items.map(([key, label]) => (
              <div key={key} data-stat={key} className="rounded-2xl bg-white p-3 shadow-sm">
                <div className="text-2xl font-extrabold tabular-nums">{stats[key].toLocaleString()}</div>
                <div className="text-xs text-muted">{label}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <p className="text-center text-xs text-muted">As of {new Date(stats.as_of).toLocaleString()} · <button onClick={() => void load()} className="font-semibold underline">refresh</button></p>
    </div>
  );
}
