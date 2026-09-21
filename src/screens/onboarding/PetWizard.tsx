import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { petPhotoUrl, supabase, type Enums } from '../../lib/supabase';
import { errorCopy, intentLabel, tagLabel } from '../../lib/format';
import { PhotoError, processPhoto } from '../../lib/image';
import { CAT_BREEDS, DOG_BREEDS } from '../../lib/makati';
import { ErrorNote, PrimaryButton, StepShell } from './Onboarding';

type Species = Enums<'pet_species'>;
type Tag = Enums<'pet_tag'>;
type Intent = Enums<'pet_intent'>;

const MAX_PHOTOS = 5;
const TAGS: Tag[] = ['playful', 'energetic', 'calm', 'couch_potato', 'friendly', 'shy', 'gentle', 'curious', 'cuddly', 'independent', 'vocal', 'loves_walks', 'loves_fetch', 'good_with_dogs', 'good_with_cats', 'good_with_kids'];
const INTENTS: { value: Intent; hint: string }[] = [
  { value: 'playdate', hint: 'Meet up so the pets can play' },
  { value: 'walking_buddy', hint: 'Regular walks together' },
  { value: 'friendship', hint: 'A longer-term pet pal' },
];

interface Draft {
  petId: string;
  sub: 0 | 1 | 2;
  name: string;
  species: Species | '';
  sex: Enums<'pet_sex'> | '';
  size: Enums<'pet_size'> | '';
  years: string;
  months: string;
  breed: string;
  mixed: boolean;
  photos: string[]; // storage paths, in display order; [0] is the main photo
  tags: Tag[];
  intents: Intent[];
}

/**
 * Steps 3–5: pet basics → photos → personality. One pet per owner in V1.
 *
 * The draft lives in localStorage (so a refresh or a dropped connection loses
 * nothing) and photos upload as they are picked. Only the final tap writes the
 * pet, its tags and its photo rows — every write there is safe to repeat, so a
 * failure half-way is fixed by tapping "Finish" again.
 */
export default function PetWizard() {
  const { session, pet, reloadProfile } = useAuth();
  const userId = session!.user.id;
  const storageKey = `pawme:pet-draft:${userId}`;

  const [draft, setDraft] = useState<Draft>(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const d = JSON.parse(saved) as Draft;
        if (!pet || pet.id === d.petId) return d;
      } catch {
        /* corrupt draft: start again */
      }
    }
    // A pet row already exists but isn't ready (an earlier finish was interrupted): carry it forward.
    const ageMonths = pet ? Math.max(0, (Date.now() - Date.parse(pet.birth_date)) / (30.44 * 864e5)) : 0;
    return {
      petId: pet?.id ?? crypto.randomUUID(), sub: pet ? 1 : 0,
      name: pet?.name ?? '', species: pet?.species ?? '', sex: pet?.sex ?? '', size: pet?.size ?? '',
      years: pet ? String(Math.floor(ageMonths / 12)) : '', months: pet ? String(Math.round(ageMonths % 12)) : '0',
      breed: pet?.breed ?? '', mixed: pet?.is_mixed ?? false, photos: [], tags: [], intents: pet?.intents ?? [],
    };
  });
  useEffect(() => localStorage.setItem(storageKey, JSON.stringify(draft)), [draft, storageKey]);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ------------------------------------------------------------ photos
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const previews = useRef(new Map<string, string>()); // path → local object URL (instant preview)

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const room = MAX_PHOTOS - draft.photos.length;
    const chosen = Array.from(files).slice(0, room);
    if (files.length > room) setError(`You can add up to ${MAX_PHOTOS} photos.`);
    for (const file of chosen) {
      setUploading((n) => n + 1);
      try {
        const blob = await processPhoto(file); // strips EXIF (GPS) + compresses
        const path = `${userId}/${draft.petId}/${crypto.randomUUID()}.jpg`;
        const { error } = await supabase.storage.from('pet-photos').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
        if (error) throw new Error(error.message);
        previews.current.set(path, URL.createObjectURL(blob));
        setDraft((d) => ({ ...d, photos: [...d.photos, path].slice(0, MAX_PHOTOS) }));
      } catch (e) {
        setError(e instanceof PhotoError ? e.message : errorCopy(e instanceof Error ? e.message : undefined));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileInput.current) fileInput.current.value = '';
  }

  function removePhoto(path: string) {
    set({ photos: draft.photos.filter((p) => p !== path) });
    void supabase.storage.from('pet-photos').remove([path]).then(() => undefined);
  }
  const makeMain = (path: string) => set({ photos: [path, ...draft.photos.filter((p) => p !== path)] });

  // ------------------------------------------------------------ finish
  const birthDate = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - (Number(draft.years || 0) * 12 + Number(draft.months || 0)));
    return d.toISOString().slice(0, 10);
  }, [draft.years, draft.months]);

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const row = { name: draft.name.trim(), species: draft.species as Species, breed: draft.breed.trim() || null, is_mixed: draft.mixed, sex: draft.sex as Enums<'pet_sex'>, birth_date: birthDate, size: draft.size as Enums<'pet_size'>, intents: draft.intents };
      const created = await supabase.from('pets').insert({ id: draft.petId, owner_id: userId, ...row });
      if (created.error?.code === '23505') {
        const updated = await supabase.from('pets').update(row).eq('id', draft.petId); // retry after an interrupted finish
        if (updated.error) throw new Error(updated.error.message);
      } else if (created.error) throw new Error(created.error.message);

      const tagged = await supabase.rpc('set_pet_tags', { p_pet_id: draft.petId, p_tags: draft.tags });
      if (tagged.error) throw new Error(tagged.error.message);

      const existing = await supabase.from('pet_photos').select('storage_path').eq('pet_id', draft.petId);
      if (existing.error) throw new Error(existing.error.message);
      const have = new Set(existing.data.map((p) => p.storage_path));
      const missing = draft.photos.filter((path) => !have.has(path)).map((storage_path, i) => ({ pet_id: draft.petId, storage_path, position: have.size + i + 1 }));
      if (missing.length) {
        const photos = await supabase.from('pet_photos').insert(missing);
        if (photos.error) throw new Error(photos.error.message);
      }

      localStorage.removeItem(storageKey);
      await reloadProfile(); // pet is ready → the app swaps onboarding for Discover
    } catch (e) {
      setError(errorCopy(e instanceof Error ? e.message : undefined));
      setBusy(false);
    }
  }

  // ------------------------------------------------------------ render
  const basicsOk = draft.name.trim().length > 0 && !!draft.species && !!draft.sex && !!draft.size && draft.years !== '';
  const photosOk = draft.photos.length >= 1 && uploading === 0;
  const personalityOk = draft.tags.length >= 2 && draft.tags.length <= 4 && draft.intents.length >= 1;
  const petName = draft.name.trim() || 'your pet';
  const toggle = <T,>(list: T[], item: T, max: number) => (list.includes(item) ? list.filter((x) => x !== item) : list.length < max ? [...list, item] : list);
  const Back = ({ to }: { to: 0 | 1 }) => <button type="button" onClick={() => { set({ sub: to }); setError(null); }} className="mt-2 w-full py-2 text-sm font-semibold text-muted">Back</button>;

  if (draft.sub === 0) {
    const breeds = draft.species === 'cat' ? CAT_BREEDS : DOG_BREEDS;
    return (
      <StepShell step={3} title="Tell us about your pet" subtitle="The basics other owners look for. You can edit everything later." footer={<PrimaryButton disabled={!basicsOk} onClick={() => set({ sub: 1 })}>Continue</PrimaryButton>}>
        <Label htmlFor="pet-name">Pet's name</Label>
        <input id="pet-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={40} autoFocus placeholder="e.g. Mochi" className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-lg outline-none focus:border-brand" />

        <Label>Dog or cat?</Label>
        <Choice value={draft.species} onChange={(v) => set({ species: v, breed: '' })} options={[['dog', '🐶 Dog'], ['cat', '🐱 Cat']]} name="Species" />

        <Label>Sex</Label>
        <Choice value={draft.sex} onChange={(v) => set({ sex: v })} options={[['female', 'Female'], ['male', 'Male']]} name="Sex" />

        <Label>Size</Label>
        <Choice value={draft.size} onChange={(v) => set({ size: v })} options={[['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]} name="Size" />

        <Label>Age <span className="font-normal text-muted">(a good guess is fine)</span></Label>
        <div className="flex gap-2">
          <select aria-label="Years" value={draft.years} onChange={(e) => set({ years: e.target.value })} className="flex-1 rounded-2xl border border-black/10 bg-white px-4 py-3 outline-none focus:border-brand">
            <option value="">Years…</option>
            {Array.from({ length: 26 }, (_, y) => <option key={y} value={y}>{y} {y === 1 ? 'year' : 'years'}</option>)}
          </select>
          <select aria-label="Months" value={draft.months} onChange={(e) => set({ months: e.target.value })} className="flex-1 rounded-2xl border border-black/10 bg-white px-4 py-3 outline-none focus:border-brand">
            {Array.from({ length: 12 }, (_, m) => <option key={m} value={m}>{m} {m === 1 ? 'month' : 'months'}</option>)}
          </select>
        </div>

        <Label htmlFor="breed">Breed <span className="font-normal text-muted">(optional — add it later if you're not sure)</span></Label>
        <input id="breed" list="breeds" value={draft.breed} onChange={(e) => set({ breed: e.target.value })} maxLength={60} placeholder={draft.species === 'cat' ? 'e.g. Puspin' : 'e.g. Aspin'} className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 outline-none focus:border-brand" />
        <datalist id="breeds">{breeds.map((b) => <option key={b} value={b} />)}</datalist>
        <label className="mt-3 flex items-center gap-3 text-sm font-medium">
          <input type="checkbox" checked={draft.mixed} onChange={(e) => set({ mixed: e.target.checked })} className="h-5 w-5 accent-[#ff6b4a]" />
          Mixed breed
        </label>
      </StepShell>
    );
  }

  if (draft.sub === 1) {
    return (
      <StepShell
        step={4}
        title={`Show off ${petName}`}
        subtitle={`Add 1 to ${MAX_PHOTOS} photos. Clear, well-lit photos of just ${petName} get the most likes.`}
        footer={<><PrimaryButton disabled={!photosOk} onClick={() => set({ sub: 2 })}>{uploading ? 'Uploading…' : 'Continue'}</PrimaryButton><Back to={0} /></>}
      >
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => void addPhotos(e.target.files)} data-testid="photo-input" />
        <div className="grid grid-cols-3 gap-2.5">
          {draft.photos.map((path, i) => (
            <div key={path} className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-black/5">
              <img src={previews.current.get(path) ?? petPhotoUrl(path)} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
              {i === 0 ? <span className="absolute bottom-1.5 left-1.5 rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold text-white">Main</span> : <button type="button" onClick={() => makeMain(path)} className="absolute bottom-1.5 left-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold text-white">Make main</button>}
              <button type="button" onClick={() => removePhoto(path)} aria-label={`Remove photo ${i + 1}`} className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white">✕</button>
            </div>
          ))}
          {Array.from({ length: uploading }, (_, i) => <div key={`u${i}`} className="skeleton aspect-[4/5] rounded-2xl" aria-label="Uploading photo" />)}
          {draft.photos.length + uploading < MAX_PHOTOS && (
            <button type="button" onClick={() => fileInput.current?.click()} className="flex aspect-[4/5] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-brand/50 bg-white text-brand active:bg-brand/10">
              <span className="text-3xl leading-none">＋</span>
              <span className="text-xs font-bold">Add photo</span>
            </button>
          )}
        </div>
        <p className="mt-3 text-xs text-muted">🔒 Photos are resized and any location data your camera saved inside them is removed before upload.</p>
        <ErrorNote text={error} />
      </StepShell>
    );
  }

  return (
    <StepShell
      step={5}
      title={`What's ${petName} like?`}
      subtitle="This is how we find pets that will actually get along."
      footer={<><PrimaryButton busy={busy} disabled={!personalityOk} onClick={() => void finish()}>Finish — start swiping 🐾</PrimaryButton><Back to={1} /></>}
    >
      <Label>Personality <span className="font-normal text-muted">(pick 2 to 4) · {draft.tags.length}/4</span></Label>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Personality tags">
        {TAGS.map((t) => {
          const on = draft.tags.includes(t);
          return <button key={t} type="button" aria-pressed={on} onClick={() => set({ tags: toggle(draft.tags, t, 4) })} className={`rounded-full border px-3.5 py-2 text-sm font-semibold capitalize ${on ? 'border-brand bg-brand text-white' : 'border-black/10 bg-white'} ${!on && draft.tags.length >= 4 ? 'opacity-40' : ''}`}>{tagLabel(t)}</button>;
        })}
      </div>

      <Label>Looking for <span className="font-normal text-muted">(pick at least one)</span></Label>
      <div className="flex flex-col gap-2" role="group" aria-label="Looking for">
        {INTENTS.map(({ value, hint }) => {
          const on = draft.intents.includes(value);
          return (
            <button key={value} type="button" aria-pressed={on} onClick={() => set({ intents: toggle(draft.intents, value, 3) })} className={`rounded-2xl border px-4 py-2.5 text-left ${on ? 'border-brand bg-brand/10' : 'border-black/10 bg-white'}`}>
              <span className="block font-semibold">{intentLabel(value)}</span>
              <span className="block text-xs text-muted">{hint}</span>
            </button>
          );
        })}
      </div>
      <ErrorNote text={error} />
    </StepShell>
  );
}

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="mb-1 mt-5 block text-sm font-semibold first:mt-0">{children}</label>;
}

function Choice<T extends string>({ value, onChange, options, name }: { value: T | ''; onChange: (v: T) => void; options: [T, string][]; name: string }) {
  return (
    <div className="flex gap-2" role="radiogroup" aria-label={name}>
      {options.map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={`flex-1 rounded-2xl border py-3 font-semibold ${value === v ? 'border-brand bg-brand/10 text-brand' : 'border-black/10 bg-white'}`}>{label}</button>
      ))}
    </div>
  );
}
