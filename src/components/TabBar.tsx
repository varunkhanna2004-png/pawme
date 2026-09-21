import { NavLink, useLocation } from 'react-router-dom';

const tab = ({ isActive }: { isActive: boolean }) =>
  `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-semibold ${isActive ? 'text-brand' : 'text-muted'}`;

export default function TabBar() {
  const { pathname } = useLocation();
  if (pathname.startsWith('/chat/')) return null; // chat is full-height
  return (
    <nav className="flex border-t border-black/5 bg-white pb-[env(safe-area-inset-bottom)]">
      <NavLink to="/" end className={tab}><span className="text-xl" aria-hidden>🐾</span>Discover</NavLink>
      <NavLink to="/matches" className={tab}><span className="text-xl" aria-hidden>💬</span>Matches</NavLink>
    </nav>
  );
}
