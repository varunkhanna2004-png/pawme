import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import App from './App';
import './index.css';

// Invite links look like /?ref=<code>. Keep the code until sign-up completes, then claim_referral() credits the inviter.
const ref = new URLSearchParams(window.location.search).get('ref');
if (ref && /^[a-z0-9]{6,16}$/i.test(ref)) localStorage.setItem('pawme:ref', ref);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
