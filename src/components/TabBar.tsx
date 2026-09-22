import { NavLink, useLocation } from 'react-router-dom';
import { useInbox } from '../lib/inbox';

const tab = ({ isActive }: { isActive: boolean }) =>
  `relative flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-semibold ${isActive ? 'text-brand' : 'text-muted'}`;

export default function TabBar({ showModeration }: { showModeration?: boolean }) {
  const { pathname } = useLocation();
  const { unreadCount } = useInbox();
  if (pathname.startsWith('/chat/') || pathname === '/settings/pet' || pathname === '/settings/preview') return null; // full-height screens
  return (
    <nav className="flex border-t border-black/5 bg-white pb-[env(safe-area-inset-bottom)]">
      <NavLink to="/" end className={tab}><span className="text-xl" aria-hidden>🐾</span>Discover</NavLink>
      <NavLink to="/matches" className={tab}>
        <span className="text-xl" aria-hidden>💬</span>Matches
        {unreadCount > 0 && <span data-testid="unread-badge" aria-label={`${unreadCount} unread`} className="absolute right-[calc(50%-1.6rem)] top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">{unreadCount}</span>}
      </NavLink>
      {showModeration && <NavLink to="/moderation" className={tab}><span className="text-xl" aria-hidden>🛡️</span>Moderation</NavLink>}
      <NavLink to="/settings" className={tab}><span className="text-xl" aria-hidden>⚙️</span>Settings</NavLink>
    </nav>
  );
}
