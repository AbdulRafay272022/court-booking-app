/** Section 32 Part 6: resize a picked image to a sensible max dimension (~1600px) and
 * re-encode as JPEG in the browser BEFORE upload, so we don't ship a 12MP phone photo
 * over patchy 4G and the server's 5MB cap is comfortably met. Falls back to the original
 * File if anything about the canvas path fails (never blocks the upload). */
export async function compressImage(file: File, maxDim = 1600, quality = 0.82): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    return blob ?? file;
  } catch {
    return file; // e.g. a format createImageBitmap can't decode — let the server validate it
  }
}
