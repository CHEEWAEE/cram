// Phone photos are often 3-5 MB and 4000px wide, far more than a flashcard
// needs, and slow to upload on mobile data. This scales an image down to
// MAX_SIDE on its longest edge and re-encodes it before it goes to storage.
const MAX_SIDE = 1600;
const QUALITY = 0.85;
// Anything already this small is left alone; re-encoding it buys nothing.
const SMALL_ENOUGH_BYTES = 300 * 1024;

export async function shrinkImage(file) {
  // GIFs may be animated, and canvas keeps only the first frame.
  if (file.type === "image/gif" || file.size <= SMALL_ENOUGH_BYTES) return file;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // a format the browser can't decode; upload it as it is
  }

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // WebP keeps transparency (screenshots of diagrams) and is smaller than
  // JPEG; Safari before 17 can't encode it and hands back a PNG instead.
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", QUALITY));
  if (!blob || blob.type !== "image/webp" || blob.size >= file.size) return file;

  const name = file.name.replace(/\.[^.]*$/, "") + ".webp";
  return new File([blob], name, { type: "image/webp" });
}
