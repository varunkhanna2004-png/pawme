import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase, type DeckCard } from '../lib/supabase';
import { errorCopy } from '../lib/format';
import PetCard from '../components/PetCard';
import { Spinner } from '../components/States';

// "See my card as others see it." The card comes from get_pet_profile() on your
// OWN pet — the same public-safe function other people's decks are built from —
// so what you see here is exactly what they can see, and nothing else.
export default function CardPreview() {
  const { pet } = useAuth();
  const [card, setCard] = useState<DeckCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pet) return;
    supabase.rpc('get_pet_profile', { p_viewer_pet_id: pet.id, p_pet_id: pet.id }).then(({ data, error }) => {
      if (error || !data?.[0]) return setError(errorCopy(error?.message));
      const p = data[0];
      // Distance is whatever the viewer's own snapped location gives — for a self
      // view that is 0. Show a typical value instead, labelled as an example.
      setCard({ ...p, distance_km: 1.8, super_pawed_you: false, why: [] });
    });
  }, [pet]);

  return (
    <div className="flex h-full flex-col bg-cream">
      <header className="flex items-center gap-2 border-b border-black/5 bg-white px-3 py-2.5">
        <Link to="/settings" aria-label="Back to settings" className="px-2 text-2xl text-muted">‹</Link>
        <h1 className="text-lg font-bold">How others see {pet?.name ?? 'your pet'}</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3">
        <div className="mx-auto aspect-[3/4] w-full max-w-[340px]" data-testid="card-preview">
          {card ? <PetCard card={card} photoIndex={0} /> : <div className="flex h-full items-center justify-center rounded-3xl bg-white">{error ? <p className="px-6 text-center text-muted">{error}</p> : <Spinner />}</div>}
        </div>
        <p className="mt-2 text-center text-xs text-muted">The distance is an example — each person sees their own.</p>

        <div className="mt-5 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="font-bold">🔒 What other owners can see</h2>
          <ul className="mt-1 list-disc pl-5 text-sm text-muted">
            <li>{pet?.name}'s photos, name, age, breed, sex, size, personality and what you're looking for</li>
            <li>Your first name and the verified tick</li>
            <li>An approximate distance (rounded to 100 m, never under 1 km)</li>
          </ul>
          <h2 className="mt-3 font-bold">Never</h2>
          <ul className="mt-1 list-disc pl-5 text-sm text-muted">
            <li>Your exact location, address or barangay — PAWME doesn't even store it</li>
            <li>Your email, surname, or anything from Settings</li>
            <li>Who you've liked, matched or chatted with</li>
          </ul>
        </div>
        <Link to="/settings/pet" className="mt-4 block rounded-full bg-brand py-3 text-center font-bold text-white">Edit my pet</Link>
      </div>
    </div>
  );
}
