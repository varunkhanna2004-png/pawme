import { useEffect, useRef, useState } from 'react';
import { petPhotoUrl, supabase } from '../lib/supabase';
import { errorCopy } from '../lib/format';
import { PhotoError, processPhoto } from '../lib/image';

export const MAX_PHOTOS = 5;

interface Props {
  userId: string;
  petId: string;
  /** Storage paths in display order; [0] is the main photo. */
  paths: string[];
  onChange: (paths: string[]) => void;
  /** Called when the user removes a photo. The parent decides when the stored file is deleted. */
  onRemove?: (path: string) => void;
  onBusyChange?: (uploading: boolean) => void;
}

/**
 * 1–5 pet photos: pick, preview, make main, remove. Used by onboarding and by
 * Edit pet. Every file is re-encoded in the browser first (lib/image.ts), which
 * strips EXIF — including GPS — and compresses it, then uploaded into the
 * owner's own storage folder.
 */
export default function PhotoPicker({ userId, petId, paths, onChange, onRemove, onBusyChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const previews = useRef(new Map<string, string>()); // path → local object URL, for an instant preview
  const latest = useRef(paths);
  latest.current = paths;
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const bump = (delta: number) => setUploading((n) => n + delta);
  const busy = uploading > 0;
  useEffect(() => onBusyChange?.(busy), [busy]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const room = MAX_PHOTOS - latest.current.length;
    if (files.length > room) setError(`You can add up to ${MAX_PHOTOS} photos.`);
    for (const file of Array.from(files).slice(0, room)) {
      bump(1);
      try {
        const blob = await processPhoto(file);
        const path = `${userId}/${petId}/${crypto.randomUUID()}.jpg`;
        const { error } = await supabase.storage.from('pet-photos').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
        if (error) throw new Error(error.message);
        previews.current.set(path, URL.createObjectURL(blob));
        onChange([...latest.current, path].slice(0, MAX_PHOTOS));
      } catch (e) {
        setError(e instanceof PhotoError ? e.message : errorCopy(e instanceof Error ? e.message : undefined));
      } finally {
        bump(-1);
      }
    }
    if (input.current) input.current.value = '';
  }

  return (
    <div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => void add(e.target.files)} data-testid="photo-input" />
      <div className="grid grid-cols-3 gap-2.5">
        {paths.map((path, i) => (
          <div key={path} className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-black/5">
            <img src={previews.current.get(path) ?? petPhotoUrl(path)} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
            {i === 0 ? (
              <span className="absolute bottom-1.5 left-1.5 rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold text-white">Main</span>
            ) : (
              <button type="button" onClick={() => onChange([path, ...paths.filter((p) => p !== path)])} className="absolute bottom-1.5 left-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold text-white">Make main</button>
            )}
            <button
              type="button"
              onClick={() => { onChange(paths.filter((p) => p !== path)); onRemove?.(path); }}
              aria-label={`Remove photo ${i + 1}`}
              className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white"
            >
              ✕
            </button>
          </div>
        ))}
        {Array.from({ length: uploading }, (_, i) => <div key={`u${i}`} className="skeleton aspect-[4/5] rounded-2xl" aria-label="Uploading photo" />)}
        {paths.length + uploading < MAX_PHOTOS && (
          <button type="button" onClick={() => input.current?.click()} className="flex aspect-[4/5] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-brand/50 bg-white text-brand active:bg-brand/10">
            <span className="text-3xl leading-none">＋</span>
            <span className="text-xs font-bold">Add photo</span>
          </button>
        )}
      </div>
      <p className="mt-3 text-xs text-muted">🔒 Photos are resized and any location data your camera saved inside them is removed before upload.</p>
      {error && <p role="alert" className="mt-3 rounded-xl bg-nope/10 px-4 py-3 text-sm text-nope">{error}</p>}
    </div>
  );
}
