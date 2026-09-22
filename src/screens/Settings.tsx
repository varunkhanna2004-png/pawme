import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { petPhotoUrl, supabase } from '../lib/supabase';
import type { Database } from '../types/database.types';
import { errorCopy, timeShort } from '../lib/format';
import { downloadBlob } from '../lib/share';
import { useInstall } from '../lib/install';
import { Spinner } from '../components/States';

type BlockRow = Database['public']['Functions']['get_my_blocks']['Returns'][number];
type ReportRow = Database['public']['Functions']['get_my_reports']['Returns'][number];

const REASON: Record<ReportRow['reason'], string> = { harassment: 'Harassment', scam: 'Scam', animal_welfare: 'Animal welfare', sexual_content_involving_animals: 'Sexual content involving animals', impersonation: 'Impersonation', spam: 'Spam' };
const STATUS: Record<ReportRow['status'], { label: string; tone: string }> = {
  open: { label: 'Under review', tone: 'bg-amber-100 text-amber-800' },
  actioned: { label: 'Action taken', tone: 'bg-like/15 text-like' },
  dismissed: { label: 'Reviewed — no action', tone: 'bg-black/5 text-muted' },
};

// Screen 9 (§5): edit pet, notifications, privacy, blocked owners, report history,
// data export and account deletion (§9, Philippine Data Privacy Act).
export default function Settings() {
  const { owner, pet, reloadProfile, signOut } = useAuth();
  const [photo, setPhoto] = useState<string>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pet) return;
    supabase.from('pet_photos').select('storage_path').eq('pet_id', pet.id).order('position').limit(1).maybeSingle().then(({ data }) => setPhoto(petPhotoUrl(data?.storage_path)));
  }, [pet]);

  // Owner preference toggles save immediately; the UI follows the saved value.
  async function savePref(patch: Database['public']['Tables']['owners']['Update']) {
    setError(null);
    const { error } = await supabase.from('owners').update(patch).eq('id', owner!.id);
    if (error) return setError(errorCopy(error.message));
    await reloadProfile();
  }

  if (!owner) return null;
  return (
    <div className="flex h-full flex-col">
      <header className="px-5 pb-2 pt-3"><h1 className="text-2xl font-extrabold tracking-tight">Settings</h1></header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
        {error && <p role="alert" className="mb-3 rounded-xl bg-nope/10 px-4 py-3 text-sm text-nope">{error}</p>}

        {pet && (
          <Link to="/settings/pet" className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm active:bg-black/5">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-black/5">{photo && <img src={photo} alt="" className="h-full w-full object-cover" />}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-bold">{pet.name}</div>
              <div className="truncate text-sm text-muted">{pet.breed ? `${pet.breed}${pet.is_mixed ? ' mix' : ''}` : 'Add a breed'} · with {owner.display_name}</div>
            </div>
            <span className="rounded-full bg-brand px-4 py-2 text-sm font-bold text-white">Edit pet</span>
          </Link>
        )}
        {pet && (
          <Link to="/settings/preview" data-testid="preview-link" className="mt-2 flex items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-sm active:bg-black/5">
            <span><span className="block font-semibold">Preview my card</span><span className="block text-xs text-muted">See exactly what other owners see — and what they never do</span></span>
            <span className="text-xl text-muted" aria-hidden>›</span>
          </Link>
        )}

        <Section title="Notifications">
          <Toggle label="In-app alerts" hint="A banner when you get a new match or message" checked={owner.notify_in_app} onChange={(v) => void savePref({ notify_in_app: v })} />
          <EmailPrefs onSave={savePref} />
        </Section>

        <Section title="Privacy">
          <Toggle label="Show my distance" hint="Others see an approximate distance like “1.8 km away” — never your location" checked={owner.show_distance} onChange={(v) => void savePref({ show_distance: v })} />
          <Toggle label="Show me in Discover" hint="Turn off to pause: nobody new sees your pet; your matches and chats stay" checked={owner.discoverable} onChange={(v) => void savePref({ discoverable: v })} />
        </Section>

        <InstallApp />
        <BlockedOwners />
        <ReportHistory />
        <YourData />

        <button onClick={() => void signOut()} className="mt-6 w-full rounded-full border border-black/10 bg-white py-3 font-bold">Sign out</button>
        <p className="mt-4 text-center text-xs text-muted">PAWME · Makati pilot</p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">{title}</h2>
      <div className="divide-y divide-black/5 rounded-2xl bg-white shadow-sm">{children}</div>
    </section>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span aria-hidden className="relative h-7 w-12 shrink-0 rounded-full bg-black/15 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-6 after:w-6 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-brand peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-brand/50" />
    </label>
  );
}

function EmailPrefs({ onSave }: { onSave: (patch: Database['public']['Tables']['owners']['Update']) => Promise<void> }) {
  const { owner } = useAuth();
  const [email, setEmail] = useState(owner?.email ?? '');
  const [note, setNote] = useState<string | null>(null);
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  async function save(e: FormEvent) {
    e.preventDefault();
    await onSave({ email: email.trim(), notify_email: true });
    setNote('Saved.');
  }

  return (
    <div>
      <Toggle
        label="Email alerts"
        hint="New matches and messages, by email. Coming soon — save your address now and we'll switch it on."
        checked={owner!.notify_email}
        onChange={(v) => { setNote(null); if (!v) void onSave({ notify_email: false }); else if (owner!.email) void onSave({ notify_email: true }); else setNote('Add your email below to turn this on.'); }}
      />
      <form onSubmit={save} className="flex gap-2 px-4 pb-3">
        <input type="email" inputMode="email" autoComplete="email" aria-label="Email address" value={email} onChange={(e) => { setEmail(e.target.value); setNote(null); }} placeholder="you@example.com" className="min-w-0 flex-1 rounded-xl border border-black/10 px-3 py-2 text-sm outline-none focus:border-brand" />
        <button disabled={!valid || email.trim() === owner!.email} className="rounded-xl bg-brand px-4 text-sm font-bold text-white disabled:opacity-40">Save</button>
      </form>
      {note && <p role="status" className="px-4 pb-3 text-xs font-semibold text-muted">{note}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- install (PWA)
function InstallApp() {
  const install = useInstall();
  const [note, setNote] = useState<string | null>(null);
  if (install.installed) return null; // already running from the home screen
  return (
    <Section title="Get the app">
      <div className="px-4 py-3">
        <div className="font-semibold">Add PAWME to your home screen</div>
        {install.canPrompt ? (
          <>
            <p className="text-xs text-muted">Opens full-screen like any other app, with no app store needed.</p>
            <button onClick={async () => setNote((await install.prompt()) === 'accepted' ? 'Installed — look for PAWME on your home screen.' : null)} className="mt-2 rounded-full bg-brand px-5 py-2 text-sm font-bold text-white">Install PAWME</button>
          </>
        ) : install.ios ? (
          <p className="text-xs text-muted">In Safari, tap the <b>Share</b> button (the square with an arrow), then <b>Add to Home Screen</b>.</p>
        ) : (
          <p className="text-xs text-muted">Open your browser's menu (⋮) and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>
        )}
        {note && <p role="status" className="mt-2 text-xs font-semibold text-like">{note}</p>}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- blocked owners
function BlockedOwners() {
  const [rows, setRows] = useState<BlockRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { session } = useAuth();

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('get_my_blocks');
    setRows(data ?? []);
  }, []);
  useEffect(() => void load(), [load]);

  async function unblock(row: BlockRow) {
    setBusy(row.blocked_id);
    await supabase.from('blocks').delete().eq('blocker_id', session!.user.id).eq('blocked_id', row.blocked_id);
    setBusy(null);
    await load();
  }

  return (
    <Section title="Blocked owners">
      {rows === null && <div className="flex justify-center py-4"><Spinner /></div>}
      {rows?.length === 0 && <p className="px-4 py-3 text-sm text-muted">You haven't blocked anyone.</p>}
      {rows?.map((r) => (
        <div key={r.blocked_id} className="flex items-center gap-3 px-4 py-3" data-testid="blocked-row">
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{r.owner_name ?? 'Owner'}{r.pet_name ? ` · ${r.pet_name}` : ''}</div>
            <div className="text-xs text-muted">Blocked {timeShort(r.blocked_at)}</div>
          </div>
          <button onClick={() => void unblock(r)} disabled={busy === r.blocked_id} className="rounded-full border border-black/10 px-4 py-1.5 text-sm font-bold disabled:opacity-40">Unblock</button>
        </div>
      ))}
      {!!rows?.length && <p className="px-4 py-2 text-xs text-muted">Unblocking lets you see each other in Discover again. It doesn't bring back a match that ended.</p>}
    </Section>
  );
}

// ---------------------------------------------------------------- report history
function ReportHistory() {
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  useEffect(() => {
    supabase.rpc('get_my_reports').then(({ data }) => setRows(data ?? []));
  }, []);
  return (
    <Section title="Reports you've filed">
      {rows === null && <div className="flex justify-center py-4"><Spinner /></div>}
      {rows?.length === 0 && <p className="px-4 py-3 text-sm text-muted">You haven't reported anyone. You can report from any pet card or chat.</p>}
      {rows?.map((r) => (
        <div key={r.report_id} className="px-4 py-3" data-testid="report-row">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-semibold">{REASON[r.reason]} · {r.owner_name ?? 'Deleted account'}{r.pet_name ? ` (${r.pet_name})` : ''}</span>
            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS[r.status].tone}`}>{STATUS[r.status].label}</span>
          </div>
          <div className="text-xs text-muted">{timeShort(r.created_at)}{r.details ? ` · “${r.details}”` : ''}</div>
        </div>
      ))}
    </Section>
  );
}

// ---------------------------------------------------------------- your data (Data Privacy Act)
function YourData() {
  const { signOut } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function exportData() {
    setExporting(true);
    setError(null);
    const { data, error } = await supabase.rpc('export_my_data');
    setExporting(false);
    if (error) return setError(errorCopy(error.message));
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `pawme-my-data-${new Date().toISOString().slice(0, 10)}.json`);
    setNote('Your data was downloaded as a JSON file.');
  }

  async function deleteAccount() {
    setDeleting(true);
    setError(null);
    // Server-side (Edge Function): removes stored photos, then the auth user; the database cascades the rest.
    const { data, error } = await supabase.functions.invoke('delete-account', { body: { confirm: 'DELETE' } });
    if (error || !(data as { deleted?: boolean })?.deleted) {
      setDeleting(false);
      return setError("We couldn't delete your account just now. Nothing was removed — please try again.");
    }
    for (const key of Object.keys(localStorage)) if (key.startsWith('pawme:')) localStorage.removeItem(key);
    await signOut().catch(() => undefined); // the session is already revoked server-side; this clears it locally
    window.location.assign('/');
  }

  return (
    <Section title="Your data">
      <div className="px-4 py-3">
        <div className="font-semibold">Download my data</div>
        <p className="text-xs text-muted">Everything PAWME holds about you and your pet, as a file.</p>
        <button onClick={() => void exportData()} disabled={exporting} className="mt-2 rounded-full border border-black/10 px-4 py-2 text-sm font-bold disabled:opacity-40">{exporting ? 'Preparing…' : 'Export my data'}</button>
        {note && <p role="status" className="mt-2 text-xs font-semibold text-like">{note}</p>}
      </div>
      <div className="px-4 py-3">
        <div className="font-semibold text-nope">Delete my account</div>
        <p className="text-xs text-muted">Permanently removes your account, your pet, photos, matches and messages. This can't be undone.</p>
        {!confirming ? (
          <button onClick={() => setConfirming(true)} className="mt-2 rounded-full border border-nope/40 px-4 py-2 text-sm font-bold text-nope">Delete account…</button>
        ) : (
          <div className="mt-2 rounded-xl bg-nope/10 p-3">
            <label className="text-sm font-semibold" htmlFor="confirm-delete">Type DELETE to confirm</label>
            <input id="confirm-delete" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off" className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 outline-none focus:border-nope" />
            <div className="mt-2 flex gap-2">
              <button onClick={() => { setConfirming(false); setTyped(''); }} disabled={deleting} className="flex-1 rounded-full border border-black/10 bg-white py-2 text-sm font-semibold">Cancel</button>
              <button onClick={() => void deleteAccount()} disabled={typed.trim() !== 'DELETE' || deleting} className="flex flex-1 items-center justify-center rounded-full bg-nope py-2 text-sm font-bold text-white disabled:opacity-40">{deleting ? <Spinner /> : 'Delete forever'}</button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="mt-2 text-xs font-semibold text-nope">{error}</p>}
      </div>
    </Section>
  );
}
