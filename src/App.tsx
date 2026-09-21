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
import Onboarding from './screens/onboarding/Onboarding';
import Settings from './screens/Settings';
import PetEditor from './screens/PetEditor';
import { InboxProvider } from './lib/inbox';

export default function App() {
  const { session, owner, pet, petReady, profileLoading, profileError, reloadProfile, signOut } = useAuth();

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

  // New (or half-finished) accounts go through onboarding until the owner has a
  // name + 18+ confirmation, a cluster, and a pet with a photo and tags.
  if (!owner?.display_name || !owner.adult_confirmed_at || !owner.cluster_id || !pet || !petReady) return <Onboarding />;

  return (
    <InboxProvider>
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
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/pet" element={<PetEditor />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <TabBar showModeration={isModerator} />
    </div>
    </InboxProvider>
  );
}
