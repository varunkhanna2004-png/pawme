import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase, type Enums } from '../lib/supabase';
import { errorCopy, intentLabel, tagLabel } from '../lib/format';
import { CAT_BREEDS, DOG_BREEDS } from '../lib/makati';
import PhotoPicker from '../components/PhotoPicker';
import { Spinner } from '../components/States';

type Tag = Enums<'pet_tag'>;
type Intent = Enums<'pet_intent'>;
const TAGS: Tag[] = ['playful', 'energetic', 'calm', 'couch_potato', 'friendly', 'shy', 'gentle', 'curious', 'cuddly', 'independent', 'vocal', 'loves_walks', 'loves_fetch', 'good_with_dogs', 'good_with_cats', 'good_with_kids'];
const INTENTS: Intent[] = ['playdate', 'walking_buddy', 'friendship'];

// Edit pet: the fields onboarding let people skip or rush — name, breed, photos,
// personality tags and what they're looking for. Nothing is written until Save,
// and Save is three idempotent calls (pet row, set_pet_tags, set_pet_photos), so
// a dropped connection never leaves a half-edited pet: just tap Save again.
export default function PetEditor() {
  const { session, pet, reloadProfile } = useAuth();
  const navigate = useNavigate();
  const userId = session!.user.id;

  const [name, setName] = useState(pet?.name ?? '');
  const [breed, setBreed] = useState(pet?.breed ?? '');
  const [mixed, setMixed] = useState(pet?.is_mixed ?? false);
  const [intents, setIntents] = useState<Intent[]>(pet?.intents ?? []);
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [photos, setPhotos] = useState<string[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pet) return;
    void Promise.all([
      supabase.from('pet_tags').select('tag').eq('pet_id', pet.id),
      supabase.from('pet_photos').select('storage_path').eq('pet_id', pet.id).order('position'),
    ]).then(([t, p]) => {
      if (t.error || p.error) return setError(errorCopy((t.error ?? p.error)!.message));
      setTags(t.data.map((r) => r.tag));
      setPhotos(p.data.map((r) => r.storage_path));
    });
  }, [pet]);

  if (!pet) return null;
  const ready = tags !== null && photos !== null;
  const valid = name.trim().length > 0 && intents.length >= 1 && (tags?.length ?? 0) >= 2 && (tags?.length ?? 0) <= 4 && (photos?.length ?? 0) >= 1 && !uploading;
  const toggle = <T,>(list: T[], item: T, max: number) => (list.includes(item) ? list.filter((x) => x !== item) : list.length < max ? [...list, item] : list);

  async function save() {
    if (!pet || !tags || !photos) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await supabase.from('pets').update({ name: name.trim(), breed: breed.trim() || null, is_mixed: mixed, intents }).eq('id', pet.id);
      if (updated.error) throw new Error(updated.error.message);
      const tagged = await supabase.rpc('set_pet_tags', { p_pet_id: pet.id, p_tags: tags });
      if (tagged.error) throw new Error(tagged.error.message);
      const pics = await supabase.rpc('set_pet_photos', { p_pet_id: pet.id, p_paths: photos });
      if (pics.error) throw new Error(pics.error.message);
      // Only now that the database no longer points at them: delete the files that were dropped.
      if (pics.data?.length) await supabase.storage.from('pet-photos').remove(pics.data);
      await reloadProfile();
      navigate('/settings', { replace: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : undefined;
      setError(message === 'PHOTOS_MUST_BE_1_TO_5' ? 'Keep at least one photo.' : message === 'TAGS_MUST_BE_2_TO_4' ? 'Pick 2 to 4 personality tags.' : errorCopy(message));
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-cream">
      <header className="flex items-center gap-2 border-b border-black/5 bg-white px-3 py-2.5">
        <Link to="/settings" aria-label="Back to settings" className="px-2 text-2xl text-muted">‹</Link>
        <h1 className="text-lg font-bold">Edit {pet.name}</h1>
      </header>

      {!ready ? (
        <div className="flex flex-1 items-center justify-center">{error ? <p className="px-8 text-center text-muted">{error}</p> : <Spinner />}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
          <Label htmlFor="edit-name">Name</Label>
          <input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-lg outline-none focus:border-brand" />

          <Label htmlFor="edit-breed">Breed</Label>
          <input id="edit-breed" list="edit-breeds" value={breed} onChange={(e) => setBreed(e.target.value)} maxLength={60} placeholder={pet.species === 'cat' ? 'e.g. Puspin' : 'e.g. Aspin'} className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 outline-none focus:border-brand" />
          <datalist id="edit-breeds">{(pet.species === 'cat' ? CAT_BREEDS : DOG_BREEDS).map((b) => <option key={b} value={b} />)}</datalist>
          <label className="mt-3 flex items-center gap-3 text-sm font-medium">
            <input type="checkbox" checked={mixed} onChange={(e) => setMixed(e.target.checked)} className="h-5 w-5 accent-[#ff6b4a]" />
            Mixed breed
          </label>

          <Label>Photos <span className="font-normal text-muted">(1 to 5 — the first is your main photo)</span></Label>
          <PhotoPicker userId={userId} petId={pet.id} paths={photos} onChange={setPhotos} onBusyChange={setUploading} />

          <Label>Personality <span className="font-normal text-muted">(pick 2 to 4) · {tags.length}/4</span></Label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Personality tags">
            {TAGS.map((t) => {
              const on = tags.includes(t);
              return <button key={t} type="button" aria-pressed={on} onClick={() => setTags(toggle(tags, t, 4))} className={`rounded-full border px-3.5 py-2 text-sm font-semibold capitalize ${on ? 'border-brand bg-brand text-white' : 'border-black/10 bg-white'} ${!on && tags.length >= 4 ? 'opacity-40' : ''}`}>{tagLabel(t)}</button>;
            })}
          </div>

          <Label>Looking for</Label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Looking for">
            {INTENTS.map((i) => {
              const on = intents.includes(i);
              return <button key={i} type="button" aria-pressed={on} onClick={() => setIntents(toggle(intents, i, 3))} className={`rounded-full border px-4 py-2 text-sm font-semibold ${on ? 'border-brand bg-brand/10 text-brand' : 'border-black/10 bg-white'}`}>{intentLabel(i)}</button>;
            })}
          </div>
          {error && <p role="alert" className="mt-4 rounded-xl bg-nope/10 px-4 py-3 text-sm text-nope">{error}</p>}
        </div>
      )}

      <div className="border-t border-black/5 bg-white px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button onClick={() => void save()} disabled={!ready || !valid || busy} className="flex w-full items-center justify-center rounded-full bg-brand py-3.5 text-lg font-bold text-white active:bg-brand-dark disabled:opacity-40">{busy ? <Spinner /> : uploading ? 'Uploading…' : 'Save changes'}</button>
      </div>
    </div>
  );
}

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="mb-1 mt-5 block text-sm font-semibold first:mt-0">{children}</label>;
}
