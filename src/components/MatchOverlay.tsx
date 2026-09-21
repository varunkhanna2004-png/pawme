import { petPhotoUrl, type DeckCard } from '../lib/supabase';

interface Props {
  myPetName: string;
  myPhoto?: string;
  card: DeckCard;
  onChat: () => void;
  onClose: () => void;
}

// §7. Copy speaks to the owners ("You and Mochi…") — pets don't operate accounts (§3.2).
// TODO(next step, §11): "Share this match" → the public-safe share card.
export default function MatchOverlay({ myPetName, myPhoto, card, onChat, onClose }: Props) {
  const theirPhoto = petPhotoUrl(card.photos[0]);
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-brand to-brand-dark px-8 text-center text-white" role="dialog" aria-modal="true" aria-label="It's a Paw-Match">
      <h2 className="animate-pop text-4xl font-extrabold leading-tight tracking-tight drop-shadow">IT'S A<br />PAW-MATCH!</h2>
      <div className="flex items-center">
        <Avatar src={myPhoto} className="animate-float-up -rotate-6" />
        <span className="animate-pop z-10 -mx-3 text-4xl" aria-hidden>❤️</span>
        <Avatar src={theirPhoto} className="animate-float-up rotate-6" />
      </div>
      <p className="text-lg text-white/95">
        You and {myPetName} matched with {card.owner_name ? `${card.owner_name} and ` : ''}{card.name}.
      </p>
      <div className="flex w-full flex-col gap-3">
        <button onClick={onChat} className="rounded-full bg-white py-3.5 text-lg font-bold text-brand shadow-lg active:scale-95">Say hi 👋</button>
        <button onClick={onClose} className="rounded-full border-2 border-white/70 py-3 font-semibold active:scale-95">Keep swiping</button>
      </div>
    </div>
  );
}

function Avatar({ src, className }: { src?: string; className: string }) {
  return (
    <div className={`h-32 w-32 overflow-hidden rounded-full border-4 border-white bg-white/30 shadow-xl ${className}`}>
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-5xl">🐾</div>}
    </div>
  );
}
