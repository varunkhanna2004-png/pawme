import { useEffect, useState } from 'react';

// "Add to Home Screen". Android/Chrome fires `beforeinstallprompt` once the app is
// installable (manifest + service worker + HTTPS); we keep the event so Settings
// can offer a real Install button. iOS Safari has no such event — people install
// from the Share menu — so there we can only show the steps.
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

// Registered at import time (main.tsx imports this first): the event fires early and only once.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallPromptEvent;
  notify();
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  notify();
});

export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function useInstall() {
  const [, rerender] = useState(0);
  useEffect(() => {
    const fn = () => rerender((n) => n + 1);
    listeners.add(fn);
    return () => void listeners.delete(fn);
  }, []);
  return {
    installed: isStandalone(),
    canPrompt: !!deferred,
    ios: isIos(),
    async prompt() {
      if (!deferred) return 'unavailable' as const;
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      notify();
      return outcome;
    },
  };
}
