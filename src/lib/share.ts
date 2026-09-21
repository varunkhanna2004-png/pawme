// Sharing + invite links (master prompt §11). Every link carries the sharer's
// referral code: /?ref=<code>. main.tsx remembers it for the visitor, and
// claim_referral() credits the inviter once they finish signing up.

export const inviteUrl = (referralCode: string | null | undefined) =>
  `${window.location.origin}/${referralCode ? `?ref=${referralCode}` : ''}`;

export type ShareResult = 'shared' | 'copied' | 'dismissed' | 'unavailable';

/** Native share sheet if the device has one (Messenger, Instagram, Viber, TikTok, WhatsApp…), else copy. */
export async function shareLink(text: string, url: string): Promise<ShareResult> {
  try {
    if (navigator.share) {
      await navigator.share({ title: 'PAWME', text, url });
      return 'shared';
    }
    await navigator.clipboard.writeText(`${text} ${url}`);
    return 'copied';
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? 'dismissed' : 'unavailable';
  }
}

export const canShareFiles = (file: File) => typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [file] });

export async function shareImage(file: File, text: string, url: string): Promise<ShareResult> {
  try {
    // Some share targets keep only the image, others only the text — so the link rides in both.
    await navigator.share({ files: [file], title: 'PAWME', text: `${text} ${url}`, url });
    return 'shared';
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? 'dismissed' : 'unavailable';
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
