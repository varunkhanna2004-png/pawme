import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { normalizePhMobile } from '../lib/format';
import { OfflineBanner, Spinner } from '../components/States';

// Screens 1–2: welcome / value prop → phone → OTP. The flow is the real one: Supabase phone OTP. In dev the test numbers accept 123456; going
// live is an SMS-provider switch in the dashboard, not a code change.
export default function Login() {
  const [step, setStep] = useState<'welcome' | 'phone' | 'otp'>('welcome');
  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizePhMobile(phoneInput);
    if (!normalized) return setError('Enter a Philippine mobile number, like 0917 123 4567.');
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ phone: normalized });
    setBusy(false);
    if (error) return setError(friendly(error.message));
    setPhone(normalized);
    setStep('otp');
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ phone, token: otp.trim(), type: 'sms' });
    setBusy(false);
    if (error) setError(friendly(error.message));
    // on success the auth listener swaps this screen out
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      <OfflineBanner />
      <div className="flex flex-1 flex-col justify-center gap-6 px-8">
        <div>
          <div className="text-5xl" aria-hidden>🐾</div>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-brand">PAWME</h1>
          <p className="mt-2 text-lg text-muted">Playdates and friends for your pet, right in your neighborhood.</p>
        </div>

        {step === 'welcome' ? (
          <div className="flex flex-col gap-4">
            {localStorage.getItem('pawme:ref') && <p data-testid="invited" className="rounded-2xl bg-brand/10 px-4 py-3 text-sm font-semibold text-brand-dark">🎉 A friend invited you and your pet to PAWME.</p>}
            <ul className="flex flex-col gap-3 text-[15px]">
              <li className="flex gap-3"><span aria-hidden>🐶</span><span><b>Meet pets nearby.</b> Everyone you see lives close enough to actually meet up.</span></li>
              <li className="flex gap-3"><span aria-hidden>❤️</span><span><b>Match, then chat.</b> You only talk to owners who liked your pet back.</span></li>
              <li className="flex gap-3"><span aria-hidden>🛡️</span><span><b>Safe by design.</b> Verified phone numbers, approximate distance only, report and block everywhere.</span></li>
            </ul>
            <button onClick={() => setStep('phone')} className="rounded-full bg-brand py-3.5 text-lg font-bold text-white active:bg-brand-dark">Get started</button>
            <p className="text-center text-xs text-muted">Now in Makati · more areas soon</p>
          </div>
        ) : step === 'phone' ? (
          <form onSubmit={sendCode} className="flex flex-col gap-3">
            <label className="text-sm font-semibold" htmlFor="phone">Your mobile number</label>
            <div className="flex items-center gap-2 rounded-2xl border border-black/10 bg-white px-4 py-3 focus-within:border-brand">
              <span className="text-muted">🇵🇭 +63</span>
              <input id="phone" inputMode="tel" autoComplete="tel" autoFocus placeholder="917 123 4567" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} className="w-full bg-transparent text-lg outline-none" />
            </div>
            <button disabled={busy} className="flex items-center justify-center rounded-full bg-brand py-3.5 text-lg font-bold text-white active:bg-brand-dark disabled:opacity-60">
              {busy ? <Spinner /> : 'Send code'}
            </button>
            <p className="text-xs text-muted">For pet owners 18 and over. We'll text you a 6-digit code. Your number is never shown to other users.</p>
          </form>
        ) : (
          <form onSubmit={verify} className="flex flex-col gap-3">
            <label className="text-sm font-semibold" htmlFor="otp">Enter the code sent to {phone}</label>
            <input id="otp" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} placeholder="••••••" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-center text-2xl tracking-[0.5em] outline-none focus:border-brand" />
            <button disabled={busy || otp.length < 6} className="flex items-center justify-center rounded-full bg-brand py-3.5 text-lg font-bold text-white active:bg-brand-dark disabled:opacity-60">
              {busy ? <Spinner /> : 'Verify'}
            </button>
            <button type="button" onClick={() => { setStep('phone'); setOtp(''); setError(null); }} className="text-sm font-semibold text-muted">Use a different number</button>
          </form>
        )}

        {error && <p role="alert" className="rounded-xl bg-nope/10 px-4 py-3 text-sm text-nope">{error}</p>}
      </div>
    </div>
  );
}

function friendly(message: string) {
  if (/failed to fetch|network/i.test(message)) return "You're offline or the connection dropped. Try again.";
  if (/expired|invalid/i.test(message)) return "That code didn't work. Check it and try again.";
  if (/rate|too many|seconds/i.test(message)) return 'Too many attempts — wait a moment and try again.';
  return message;
}
