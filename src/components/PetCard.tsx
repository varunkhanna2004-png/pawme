import { memo } from 'react';
import { petPhotoUrl, type DeckCard } from '../lib/supabase';
import { formatAge, formatDistance, intentLabel, tagLabel, whyThisMatch } from '../lib/format';

interface Props {
  card: DeckCard;
  photoIndex: number;
  dimmed?: boolean;
}

// §6: photo, name, age, breed, distance, 2–4 tags, intent, verified badge — plus
// the one honest "Why this match" line (§7). Never an owner surname, never a map.
function PetCard({ card, photoIndex, dimmed }: Props) {
  const photo = petPhotoUrl(card.photos[Math.min(photoIndex, card.photos.length - 1)]);
  const distance = formatDistance(card.distance_km);
  const why = whyThisMatch(card.why);

  return (
    <article className={`relative h-full w-full overflow-hidden rounded-3xl bg-ink shadow-xl ${dimmed ? 'opacity-70' : ''}`}>
      {photo ? (
        <img src={photo} alt="" draggable={false} decoding="async" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-7xl">🐾</div>
      )}

      {card.photos.length > 1 && (
        <div className="absolute inset-x-3 top-3 flex gap-1">
          {card.photos.map((p, i) => (
            <div key={p} className={`h-1 flex-1 rounded-full ${i === photoIndex ? 'bg-white' : 'bg-white/40'}`} />
          ))}
        </div>
      )}

      {card.super_pawed_you && (
        <div className="absolute left-3 top-7 rounded-full bg-super px-3 py-1 text-xs font-bold text-white shadow">⭐ Super Pawed you</div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-5 pb-5 pt-24 text-white">
        <h2 className="flex items-center gap-2 text-3xl font-extrabold leading-tight">
          <span className="truncate">{card.name}</span>
          <span className="shrink-0 text-xl font-semibold text-white/85">{formatAge(card.age_months)}</span>
          {card.verified && (
            <span className="shrink-0 rounded-full bg-sky-500 px-1.5 text-sm" title="Verified owner — email confirmed" aria-label="Verified owner">✓</span>
          )}
        </h2>
        <p className="mt-0.5 text-sm text-white/85">
          {[card.breed ? `${card.breed}${card.is_mixed ? ' mix' : ''}` : card.is_mixed ? 'Mixed breed' : null, card.sex, card.size].filter(Boolean).join(' · ')}
        </p>
        <p className="mt-0.5 text-sm text-white/85">
          {[distance ? `📍 ${distance}` : null, card.owner_name ? `with ${card.owner_name}` : null].filter(Boolean).join(' · ')}
        </p>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {card.intents.map((i) => (
            <span key={i} className="rounded-full bg-brand px-2.5 py-0.5 text-xs font-bold">{intentLabel(i)}</span>
          ))}
          {card.tags.map((t) => (
            <span key={t} className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold capitalize backdrop-blur-sm">{tagLabel(t)}</span>
          ))}
        </div>

        {why && <p className="mt-2.5 rounded-xl bg-white/15 px-3 py-1.5 text-sm backdrop-blur-sm">✨ <span className="font-semibold">Why this match:</span> {why}</p>}
      </div>
    </article>
  );
}

export default memo(PetCard);
