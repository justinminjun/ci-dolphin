// Coarse-grained campus zones for Lost & Found location tagging.
// Kept small and building-level on purpose: a full room-by-room list can't
// realistically cover a large campus, so zones exist only to make posts
// filterable/searchable, while free-text "detail" (see AddPostScreen) carries
// the specifics. Edit this list to match the school's actual building names
// (and the matching Korean labels in ../i18n.ts).
export const LOSTFOUND_ZONES = [
    'Lower School',
    'Middle School',
    'Upper School',
    'Library',
    'Cafeteria',
    'Gym / Athletic Center',
    'Auditorium',
    'Main Office',
    'Bus / Pick-up Area',
    'Outdoor / Field',
    'Parking Lot',
    'Other',
] as const;

// Stored values are always these English keys; ../i18n.ts translates for display.
export const LOSTFOUND_CATEGORIES = [
    'Electronics', 'Clothing', 'Accessories', 'Stationery', 'Bag',
    'Sports', 'Books', 'Water Bottle', 'Keys', 'ID Card', 'Other',
] as const;

// Active posts not created/bumped within this window are tucked behind
// "Show older posts" in the feed, and their owners are nudged to bump or resolve.
export const STALE_DAYS = 30;

export function lastActiveMs(post: any): number {
    const ts = post.bumpedAt || post.createdAt;
    if (!ts) return Date.now();
    if (ts.toDate) return ts.toDate().getTime();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    const d = new Date(ts).getTime();
    return isNaN(d) ? Date.now() : d;
}

export function isStale(post: any): boolean {
    if ((post.status || 'active') !== 'active') return false;
    return Date.now() - lastActiveMs(post) > STALE_DAYS * 86400000;
}
