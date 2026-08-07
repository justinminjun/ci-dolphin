/**
 * Check if a photo URI is a valid remote URL (not a local file path).
 * Local file:// URIs only work on the device that created them.
 */
export function isValidPhotoUrl(uri: string | undefined | null): boolean {
    if (!uri) return false;
    return uri.startsWith('http://') || uri.startsWith('https://');
}

/**
 * Get the first valid (remote) photo URL from an array.
 * Returns undefined if none are valid.
 */
export function getFirstValidPhoto(photos: string[] | undefined | null): string | undefined {
    if (!photos || photos.length === 0) return undefined;
    return photos.find(p => isValidPhotoUrl(p));
}
