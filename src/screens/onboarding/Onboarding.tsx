import { useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { errorCopy } from '../../lib/format';
import { MAKATI_BARANGAYS, OTHER_AREAS } from '../../lib/makati';
import { inviteUrl, shareLink } from '../../lib/share';
import { OfflineBanner, Spinner } from '../../components/States';
import PetWizard from './PetWizard';

export const TOTAL_STEPS = 5; // you → location → pet → photos → personality

/**
 * Onboarding (screens 3–4 of §5, plus the owner basics the schema needs).
 * The step is derived from what the SERVER already has, so closing the app
 * half-way and coming back — on any device — resumes in the right place:
 *   no name / 18+ yet → About you
 *   no cluster        → Location (or the waitlist if they were outside)
 *   no ready pet      → the pet wizard (basics → photos → personality)
 */
export default function Onboarding() {
  const { owner, waitlisted, signOut } = useAuth();
  const [recheckLocation, setRecheckLocation] = useState(false);
  if (!owner) return null;

  let body: ReactNode;
  if (!owner.display_name || !owner.adult_confirmed_at) body = <StepAbout />;
  else if (!owner.cluster_id) body = waitlisted && !recheckLocation ? <Waitlist onRecheck={() => setRecheckLocation(true)} /> : <StepLocation onOutside={() => setRecheckLocation(false)} />;
  else body = <PetWizard />;

  return (
    <div className="mx-auto flex h-full max-w-md flex-col bg-cream">
      <OfflineBanner />
      <div className="flex items-center justify-between px-5 pt-3">
        <span className="text-xl font-extrabold tracking-tight text-brand">PAWME</span>
        <button onClick={() => void signOut()} className="text-xs font-semibold text-muted">Sign out</button>
      </div>
      {body}
    </div>
  );
}

export function StepShell({ step, title, subtitle, children, footer }: { step: number; title: string; subtitle?: string; children: ReactNode; footer: ReactNode }) {
  return (
    <>
      <div className="px-5 pt-3" role="progressbar" aria-valuemin={1} aria-valuemax={TOTAL_STEPS} aria-valuenow={step} aria-label={`Step ${step} of ${TOTAL_STEPS}`}>
        <div className="flex gap-1.5">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div key={i} className={`h-1.5 flex-1 rounded-full ${i < step ? 'bg-brand' : 'bg-black/10'}`} />
          ))}
        </div>
        <p className="mt-1.5 text-xs font-semibold text-muted">Step {step} of {TOTAL_STEPS}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-3">
        <h1 className="text-2xl font-extrabold leading-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
      <div className="border-t border-black/5 bg-white px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>
    </>
  );
}

export function PrimaryButton({ busy, children, ...rest }: { busy?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} disabled={rest.disabled || busy} className="flex w-full items-center justify-center rounded-full bg-brand py-3.5 text-lg font-bold text-white active:bg-brand-dark disabled:opacity-40">
      {busy ? <Spinner /> : children}
    </button>
  );
}

export function ErrorNote({ text }: { text: string | null }) {
  return text ? <p role="alert" className="mt-3 rounded-xl bg-nope/10 px-4 py-3 text-sm text-nope">{text}</p> : null;
}

// ---------------------------------------------------------------- 1. About you
// The OWNER operates the account (§3.2): a first name for "with Ana" on cards
// and chats, and an 18+ confirmation. Nothing else is asked for.
function StepAbout() {
  const { owner, reloadProfile } = useAuth();
  const [name, setName] = useState(owner?.display_name ?? '');
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.from('owners').update({ display_name: name.trim(), adult_confirmed_at: new Date().toISOString() }).eq('id', owner!.id);
    if (error) {
      setBusy(false);
      return setError(errorCopy(error.message));
    }
    // Credit whoever invited them (§11). Best-effort; never blocks sign-up.
    const ref = localStorage.getItem('pawme:ref');
    if (ref) {
      await supabase.rpc('claim_referral', { p_code: ref });
      localStorage.removeItem('pawme:ref');
    }
    await reloadProfile();
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <StepShell step={1} title="First, about you" subtitle="You run this account for your pet. Other owners see your first name — never your email." footer={<PrimaryButton busy={busy} disabled={name.trim().length < 1 || !adult}>Continue</PrimaryButton>}>
        <label className="text-sm font-semibold" htmlFor="owner-name">Your first name</label>
        <input id="owner-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="given-name" autoFocus placeholder="e.g. Ana" className="mt-1 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-lg outline-none focus:border-brand" />
        <label className="mt-5 flex items-start gap-3 rounded-2xl border border-black/10 bg-white p-4 text-sm">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#ff6b4a]" />
          <span><span className="font-semibold">I'm 18 or older</span> and I'm the pet's owner or guardian. I'll only arrange meetups in safe, public places.</span>
        </label>
        <ErrorNote text={error} />
      </StepShell>
    </form>
  );
}

// ---------------------------------------------------------------- 2. Location
function StepLocation({ onOutside }: { onOutside: () => void }) {
  const { reloadProfile } = useAuth();
  const [mode, setMode] = useState<'ask' | 'pick'>('ask');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState('');

  async function submit(lat: number, lng: number, label?: string) {
    const { data, error } = await supabase.rpc('enter_cluster', { p_lat: lat, p_lng: lng, p_area_label: label });
    if (error) {
      setBusy(false);
      return setError(errorCopy(error.message));
    }
    if (!(data as { admitted: boolean }).admitted) onOutside();
    await reloadProfile(); // admitted → the pet wizard; outside → the waitlist
    setBusy(false);
  }

  function requestDeviceLocation() {
    if (!('geolocation' in navigator)) {
      setMode('pick');
      return setError("This device can't share its location. Pick your barangay instead.");
    }
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => void submit(pos.coords.latitude, pos.coords.longitude),
      (err) => {
        setBusy(false);
        setMode('pick');
        setError(err.code === err.PERMISSION_DENIED ? 'No problem — location access is off. Pick your barangay instead.' : "We couldn't get your location. Pick your barangay instead.");
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 },
    );
  }

  function submitPicked() {
    const area = [...MAKATI_BARANGAYS, ...OTHER_AREAS].find((a) => a.name === picked);
    if (!area) return;
    setBusy(true);
    setError(null);
    void submit(area.lat, area.lng, area.name);
  }

  return (
    <StepShell
      step={2}
      title="Where do you and your pet live?"
      subtitle="PAWME is launching in Makati first, so every pet you see is close enough to actually meet."
      footer={mode === 'ask' ? <PrimaryButton busy={busy} onClick={requestDeviceLocation}>Use my location</PrimaryButton> : <PrimaryButton busy={busy} disabled={!picked} onClick={submitPicked}>Continue</PrimaryButton>}
    >
      <div className="rounded-2xl bg-white p-4 text-sm shadow-sm">
        <p className="font-semibold">🔒 Your exact location is never stored or shown.</p>
        <p className="mt-1 text-muted">We keep only an approximate area (about 500 m), and other owners just see a distance like "1.8 km away".</p>
      </div>

      {mode === 'pick' && (
        <div className="mt-5">
          <label className="text-sm font-semibold" htmlFor="area">Your barangay</label>
          <select id="area" value={picked} onChange={(e) => setPicked(e.target.value)} className="mt-1 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-lg outline-none focus:border-brand">
            <option value="">Choose…</option>
            <optgroup label="Makati">{MAKATI_BARANGAYS.map((b) => <option key={b.name}>{b.name}</option>)}</optgroup>
            <optgroup label="Not in Makati">{OTHER_AREAS.map((b) => <option key={b.name}>{b.name}</option>)}</optgroup>
          </select>
        </div>
      )}
      <ErrorNote text={error} />
      <button type="button" onClick={() => { setMode(mode === 'ask' ? 'pick' : 'ask'); setError(null); }} className="mt-5 text-sm font-semibold text-brand">
        {mode === 'ask' ? 'Choose my barangay instead' : 'Use my device location instead'}
      </button>
    </StepShell>
  );
}

// ---------------------------------------------------------------- waitlist (§3.1)
function Waitlist({ onRecheck }: { onRecheck: () => void }) {
  const { owner } = useAuth();
  const [email, setEmail] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.from('waitlist').update({ email: email.trim() }).eq('owner_id', owner!.id);
    setBusy(false);
    if (error) return setError(error.code === '23514' ? "That doesn't look like an email address." : errorCopy(error.message));
    setSaved(true);
  }

  const [inviteNote, setInviteNote] = useState<string | null>(null);
  async function invite() {
    const result = await shareLink("I'm on the PAWME waitlist — playdates and friends for our pets. Join so it opens in our area sooner 🐾", inviteUrl(owner?.referral_code));
    if (result === 'copied') setInviteNote('Invite link copied!');
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6 pt-8 text-center">
      <div className="text-6xl" aria-hidden>📍</div>
      <h1 className="mt-3 text-2xl font-extrabold leading-tight">PAWME isn't in your area yet — we'll tell you when it is.</h1>
      <p className="mt-2 text-muted">We're starting in Makati so there are always pets nearby to meet. You're on the waitlist, {owner?.display_name}, and your spot is saved.</p>

      {saved ? (
        <p role="status" className="mt-6 rounded-2xl bg-like/10 px-4 py-3 font-semibold text-like">Got it — we'll email you the moment PAWME opens near you.</p>
      ) : (
        <form onSubmit={save} className="mt-6 text-left">
          <label className="text-sm font-semibold" htmlFor="wl-email">Email me when you launch here (optional)</label>
          <div className="mt-1 flex gap-2">
            <input id="wl-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="min-w-0 flex-1 rounded-2xl border border-black/10 bg-white px-4 py-3 outline-none focus:border-brand" />
            <button disabled={busy || !email.trim()} className="rounded-2xl bg-brand px-5 font-bold text-white disabled:opacity-40">Notify me</button>
          </div>
          <ErrorNote text={error} />
        </form>
      )}

      <button onClick={() => void invite()} className="mt-4 rounded-full border-2 border-brand py-3 font-bold text-brand active:bg-brand/10">Invite friends — open your area sooner</button>
      {inviteNote && <p role="status" className="mt-2 text-sm font-semibold text-like">{inviteNote}</p>}
      <button onClick={onRecheck} className="mt-4 text-sm font-semibold text-muted">I live in Makati — check my location again</button>
    </div>
  );
}
