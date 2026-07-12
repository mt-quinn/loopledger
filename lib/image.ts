const MAX_PHOTO_DIM = 1600;
const JPEG_QUALITY = 0.82;

/**
 * Downscales a photo to a web-friendly JPEG before upload. Finished-object
 * photos come straight off phone cameras (often 10MB+); this brings them to
 * a few hundred KB without visible loss at card/gallery sizes.
 */
export async function resizePhotoForUpload(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    // Unsupported format for decode — upload as-is and let the browser render it.
    return file;
  }

  const scale = Math.min(1, MAX_PHOTO_DIM / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return file;
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
  });
  return blob ?? file;
}
