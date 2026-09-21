import './lib/install'; // first: `beforeinstallprompt` fires early and only once
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import App from './App';
import { isProductionProject } from './lib/supabase';
import './index.css';

// Invite links look like /?ref=<code>. Keep the code until sign-up completes, then claim_referral() credits the inviter.
const ref = new URLSearchParams(window.location.search).get('ref');
if (ref && /^[a-z0-9]{6,16}$/i.test(ref)) localStorage.setItem('pawme:ref', ref);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        {/* A deployed build that talks to the DEV database must never be mistaken for the real thing. */}
        {!isProductionProject && !import.meta.env.DEV && (
          <div data-testid="test-build" className="pointer-events-none fixed bottom-[4.2rem] left-2 z-[80] rounded-full bg-ink/85 px-2.5 py-1 text-[10px] font-bold tracking-wide text-white">TEST BUILD · sample data</div>
        )}
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
