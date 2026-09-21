import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { projectRef } from './lib/supabase';
import { FullScreenMessage, OfflineBanner, Spinner } from './components/States';
import TabBar from './components/TabBar';
import Login from './screens/Login';
import Discover from './screens/Discover';
import Matches from './screens/Matches';
import Chat from './screens/Chat';
import Moderation from './screens/Moderation';

export default function App() {
  const { session, owner, pet, profileLoading, profileError, reloadProfile, signOut } = useAuth();

  if (session === undefined || (session && profileLoading && !owner)) {
    return <FullScreenMessage><Spinner /></FullScreenMessage>;
  }
  if (!session) return <Login />;

  if (profileError) {
    return <FullScreenMessage title="Couldn't load your profile" body="Check your connection and try again." action={{ label: 'Retry', onClick: () => void reloadProfile() }} />;
  }
  if (owner?.status === 'suspended') {
    return <FullScreenMessage title="Account suspended" body="This account has been suspended for breaking PAWME's community rules." action={{ label: 'Sign out', onClick: () => void signOut() }} />;
  }
  const isModerator = owner?.role === 'moderator';
  // A moderator account without a pet is just the queue.
  if (isModerator && (!owner?.cluster_id || !pet)) {
    return (
      <div className="mx-auto flex h-full max-w-md flex-col bg-cream">
        <OfflineBanner />
        <div className="bg-ink px-3 py-0.5 text-center text-[10px] tracking-wide text-white/80">
          MODERATOR · {owner.display_name} · <button className="underline" onClick={() => void signOut()}>sign out</button>
        </div>
        <main className="relative min-h-0 flex-1"><Moderation /></main>
      </div>
    );
  }

  // The spine assumes an admitted owner with a pet. Screens 3 (location / waitlist)
  // and 4 (add pet) come next; until then, say so plainly instead of breaking.
  if (!owner?.cluster_id || !pet) {
    return (
      <FullScreenMessage
        title="Onboarding isn't built yet"
        body={`This account has ${!owner?.cluster_id ? 'no cluster' : 'no pet'} yet. For now, sign in with a seeded test number (0917 000 0001, 0002 or 0003).`}
        action={{ label: 'Sign out', onClick: () => void signOut() }}
      />
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-md flex-col bg-cream">
      <OfflineBanner />
      {import.meta.env.DEV && (
        <div className="bg-ink px-3 py-0.5 text-center text-[10px] tracking-wide text-white/80">
          DEV · {projectRef} · {owner.display_name} + {pet.name} · <button className="underline" onClick={() => void signOut()}>sign out</button>
        </div>
      )}
      <main className="relative min-h-0 flex-1">
        <Routes>
          <Route path="/" element={<Discover />} />
          <Route path="/matches" element={<Matches />} />
          <Route path="/chat/:conversationId" element={<Chat />} />
          {isModerator && <Route path="/moderation" element={<Moderation />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <TabBar showModeration={isModerator} />
    </div>
  );
}
