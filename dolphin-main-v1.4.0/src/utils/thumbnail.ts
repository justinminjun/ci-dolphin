/**
 * Thumbnail utility for Firebase Storage images.
 * 
 * If using Firebase "Resize Images" extension, thumbnails are auto-generated
 * at path: {original}_200x200.jpg
 * 
 * For now, this utility provides a simple in-memory cache key hint
 * and can be expanded later when the extension is enabled.
 */

/**
 * Generate a thumbnail-hint URL for feed images.
 * Currently returns the original URL (Firebase Storage doesn't support
 * on-the-fly resizing without extensions), but:
 * 1. Provides a centralized place to swap in CDN logic later
 * 2. Can append cache-control hints
 * 
 * When Firebase "Resize Images" extension is set up, change this to
 * return the `_200x200` variant path.
 */
export function getThumbnailUrl(originalUrl: string | undefined, _size: number = 200): string {
    if (!originalUrl) return '';
    // If the extension generates thumbnails like: {path}_200x200.{ext}
    // Uncomment and adapt the following:
    // const parts = originalUrl.split('?');
    // const base = parts[0].replace(/\.(jpg|jpeg|png|webp)$/i, `_${size}x${size}.$1`);
    // return parts.length > 1 ? `${base}?${parts[1]}` : base;
    
    return originalUrl;
}
