import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { OfflineBanner, Spinner } from '../components/States';
import WhatsOn from '../components/WhatsOn';
import { HeroArt, PawPrint } from '../components/PetArt';

// Screens 1–2: welcome / value prop → email → 6-digit code. Supabase email OTP:
// no SMS provider, no sender-ID registration. (Phone stays available in the
// schema as a possible extra verification badge later; it is not a login.)
export default function Login() {
  const [step, setStep] = useState<'welcome' | 'email' | 'otp'>('welcome');
  const [emailInput, setEmailInput] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The welcome screen scrolls (it lists what's on PAWME). "Get started" sits
  // above the fold; once it scrolls out of view a compact copy docks to the bottom.
  const cta = useRef<HTMLButtonElement>(null);
  const [ctaOffscreen, setCtaOffscreen] = useState(false);
  useEffect(() => {
    if (step !== 'welcome' || !cta.current) return;
    const io = new IntersectionObserver(([entry]) => setCtaOffscreen(!entry.isIntersecting), { threshold: 0.5 });
    io.observe(cta.current);
    return () => io.disconnect();
  }, [step]);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    const normalized = emailInput.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) return setError('Enter a valid email address, like you@example.com.');
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email: normalized, options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) return setError(friendly(error.message));
    setEmail(normalized);
    setStep('otp');
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ email, token: otp.trim(), type: 'email' });
    setBusy(false);
    if (error) setError(friendly(error.message));
    // on success the auth listener swaps this screen out
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      <OfflineBanner />
      <div className={`flex flex-1 flex-col gap-6 px-8 ${step === 'welcome' ? 'min-h-0 overflow-y-auto bg-[radial-gradient(120%_60%_at_100%_0%,#ffe4d9_0%,transparent_55%)] pb-8 pt-8' : 'justify-center'}`}>
        {step === 'welcome' ? (
          <div className="relative flex items-center gap-2">
            <div className="pointer-events-none absolute -left-6 -top-8 rotate-[-20deg]"><PawPrint size={34} opacity={0.12} /></div>
            <div className="min-w-0 flex-1">
              <h1 className="text-4xl font-extrabold tracking-tight text-brand">PAWME</h1>
              <p className="mt-2 text-lg leading-snug text-muted">Playdates and friends for your pet, right in your neighborhood.</p>
            </div>
            <HeroArt />
          </div>
        ) : (
          <div>
            <div className="text-5xl" aria-hidden>🐾</div>
            <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-brand">PAWME</h1>
            <p className="mt-2 text-lg text-muted">Playdates and friends for your pet, right in your neighborhood.</p>
          </div>
        )}

        {step === 'welcome' ? (
          <div className="flex flex-col gap-4">
            {localStorage.getItem('pawme:ref') && <p data-testid="invited" className="rounded-2xl bg-brand/10 px-4 py-3 text-sm font-semibold text-brand-dark">🎉 A friend invited you and your pet to PAWME.</p>}
            <ul className="flex flex-col gap-3 text-[15px]">
              <li className="flex gap-3"><span aria-hidden>🐶</span><span><b>Meet pets nearby.</b> Everyone you see lives close enough to actually meet up.</span></li>
              <li className="flex gap-3"><span aria-hidden>❤️</span><span><b>Match, then chat.</b> You only talk to owners who liked your pet back.</span></li>
              <li className="flex gap-3"><span aria-hidden>🛡️</span><span><b>Safe by design.</b> Verified owners, approximate distance only, report and block everywhere.</span></li>
            </ul>
            <button ref={cta} data-testid="cta" onClick={() => setStep('email')} className="rounded-full bg-brand py-3.5 text-lg font-bold text-white active:bg-brand-dark">Get started</button>
            <p className="text-center text-xs text-muted">Now in Makati</p>
            <WhatsOn />
          </div>
        ) : step === 'email' ? (
          <form onSubmit={sendCode} className="flex flex-col gap-3">
            <label className="text-sm font-semibold" htmlFor="email">Your email</label>
            <input id="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoFocus placeholder="you@example.com" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-lg outline-none focus:border-brand" />
            <button disabled={busy} className="flex items-center justify-center rounded-full bg-brand py-3.5 text-lg font-bold text-white active:bg-brand-dark disabled:opacity-60">
              {busy ? <Spinner /> : 'Send code'}
            </button>
            <p className="text-xs text-muted">For pet owners 18 and over. We'll email you a 6-digit code — no password to remember. Your email is never shown to other users.</p>
          </form>
        ) : (
          <form onSubmit={verify} className="flex flex-col gap-3">
            <label className="text-sm font-semibold" htmlFor="otp">Enter the 6-digit code we emailed to {email}</label>
            <input id="otp" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={8} placeholder="••••••" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-center text-2xl tracking-[0.5em] outline-none focus:border-brand" />
            <button disabled={busy || otp.length < 6} className="flex items-center justify-center rounded-full bg-brand py-3.5 text-lg font-bold text-white active:bg-brand-dark disabled:opacity-60">
              {busy ? <Spinner /> : 'Verify'}
            </button>
            <button type="button" onClick={() => { setStep('email'); setOtp(''); setError(null); }} className="text-sm font-semibold text-muted">Use a different email</button>
            <p className="text-center text-xs text-muted">Not there? Check spam, or wait a minute and go back to resend.</p>
          </form>
        )}

        {error && <p role="alert" className="rounded-xl bg-nope/10 px-4 py-3 text-sm text-nope">{error}</p>}
      </div>
      {step === 'welcome' && ctaOffscreen && (
        <div className="border-t border-black/5 bg-white/95 px-5 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] backdrop-blur">
          <button data-testid="cta-docked" onClick={() => setStep('email')} className="w-full rounded-full bg-brand py-3 font-bold text-white active:bg-brand-dark">Get started</button>
        </div>
      )}
    </div>
  );
}

function friendly(message: string) {
  if (/failed to fetch|network/i.test(message)) return "You're offline or the connection dropped. Try again.";
  if (/expired|invalid/i.test(message)) return "That code didn't work. Check it and try again.";
  if (/rate|too many|seconds/i.test(message)) return 'Too many attempts — wait a minute and try again.';
  if (/signups? not allowed/i.test(message)) return "Sign-ups are paused right now. If you already have an account, check the address you typed.";
  return message;
}
