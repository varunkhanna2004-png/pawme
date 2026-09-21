// Every photo is re-encoded in the browser before upload. Drawing the decoded
// pixels onto a canvas and exporting a fresh JPEG means NOTHING from the original
// file survives except the picture itself: EXIF — including the GPS position a
// phone camera embeds (master prompt §3.3: never expose exact location) — is
// gone, and the file is small enough for a poor connection.

const MAX_EDGE = 1600; // px, long edge
const QUALITY = 0.82;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

export class PhotoError extends Error {}

export async function processPhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new PhotoError("That file isn't a photo.");
  if (file.size > MAX_INPUT_BYTES) throw new PhotoError('That photo is too large (25 MB max).');

  let bitmap: ImageBitmap;
  try {
    // 'from-image' applies the EXIF rotation before we throw the EXIF away,
    // so portrait photos don't end up sideways.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoError("We couldn't read that photo. Try a JPG or PNG.");
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PhotoError("We couldn't process that photo on this device.");
  ctx.fillStyle = '#fff'; // transparent PNGs would otherwise turn black as JPEG
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
  if (!blob) throw new PhotoError("We couldn't process that photo on this device.");
  return blob;
}
