import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { renderMatchCard, type SharePet } from '../lib/shareCard';
import { canShareFiles, copyText, downloadBlob, inviteUrl, shareImage } from '../lib/share';
import { Spinner } from './States';

interface Props {
  mine: SharePet;
  theirs: SharePet;
  onClose: () => void;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pet';

/**
 * The growth loop (§11): a public-safe match card — both pets' names and one
 * photo each, nothing about either owner or where they live — shared through the
 * phone's own share sheet, with download and copy-link as fallbacks. The link
 * carries the sharer's referral code.
 */
export default function ShareCardSheet({ mine, theirs, onClose }: Props) {
  const { owner } = useAuth();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const url = inviteUrl(owner?.referral_code);
  const text = `${mine.name} ♥ ${theirs.name} — a Paw Match on PAWME 🐾 Find your pet's new best friend:`;

  useEffect(() => {
    let cancelled = false;
    renderMatchCard(mine, theirs, window.location.host)
      .then((b) => !cancelled && setBlob(b))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [mine, theirs]);

  const preview = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const file = useMemo(() => (blob ? new File([blob], `pawme-match-${slug(mine.name)}-${slug(theirs.name)}.jpg`, { type: 'image/jpeg' }) : null), [blob, mine.name, theirs.name]);
  const nativeShare = !!file && canShareFiles(file);

  async function share() {
    if (!file) return;
    const result = await shareImage(file, text, url);
    if (result === 'unavailable') setNote("Sharing isn't available here — download the image or copy the link instead.");
  }

  return (
    <div className="fixed inset-0 z-[60] mx-auto flex max-w-md flex-col justify-end" role="dialog" aria-modal="true" aria-label="Share this match">
      <button aria-label="Close" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="animate-float-up relative max-h-[94%] overflow-y-auto rounded-t-3xl bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 text-ink shadow-2xl">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-black/10" />
        <h2 className="text-lg font-bold">Share this match</h2>
        <p className="text-sm text-muted">Only the pets' names and photos are on the card — nothing about you, the other owner, or where you live.</p>

        <div className="mx-auto mt-3 aspect-[4/5] w-[62%] overflow-hidden rounded-2xl bg-black/5 shadow-md">
          {preview ? <img src={preview} alt={`Share card: ${mine.name} and ${theirs.name}, a Paw Match on PAWME`} data-testid="share-card" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center">{failed ? <span className="px-4 text-center text-sm text-muted">Couldn't create the card. You can still copy your invite link.</span> : <Spinner />}</div>}
        </div>

        <div className="mt-4 flex flex-col gap-2">
          {nativeShare && <button onClick={() => void share()} className="rounded-full bg-brand py-3.5 text-lg font-bold text-white active:bg-brand-dark">Share…</button>}
          <div className="flex gap-2">
            <button disabled={!blob} onClick={() => { downloadBlob(blob!, file!.name); setNote('Image saved — post it anywhere, and paste your link with it.'); }} className={`flex-1 rounded-full py-3 font-bold disabled:opacity-40 ${nativeShare ? 'border border-black/10' : 'bg-brand text-white'}`}>Download image</button>
            <button onClick={async () => setNote((await copyText(url)) ? 'Link copied!' : url)} className="flex-1 rounded-full border border-black/10 py-3 font-bold">Copy link</button>
          </div>
        </div>
        {note && <p role="status" className="mt-2 break-all text-center text-sm font-semibold text-like">{note}</p>}
        <button onClick={onClose} className="mt-1 w-full py-2.5 text-sm font-semibold text-muted">Not now</button>
      </div>
    </div>
  );
}
