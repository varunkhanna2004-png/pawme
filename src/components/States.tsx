import { useEffect, useState, type ReactNode } from 'react';

export function Spinner() {
  return <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand/25 border-t-brand" role="status" aria-label="Loading" />;
}

export function FullScreenMessage({ title, body, action, children }: { title?: string; body?: string; action?: { label: string; onClick: () => void }; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      {children}
      {title && <h1 className="text-xl font-bold">{title}</h1>}
      {body && <p className="text-muted">{body}</p>}
      {action && (
        <button onClick={action.onClick} className="mt-2 rounded-full bg-brand px-6 py-3 font-semibold text-white active:bg-brand-dark">
          {action.label}
        </button>
      )}
    </div>
  );
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return <div className="bg-ink px-4 py-2 text-center text-sm text-white" role="status">You're offline — we'll reconnect automatically.</div>;
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-40 flex justify-center px-4" role="status">
      <div className="animate-float-up rounded-full bg-ink px-4 py-2 text-sm text-white shadow-lg">{message}</div>
    </div>
  );
}
