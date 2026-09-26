import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../config/firebase';

// Heuristic lost↔found matcher. Deliberately simple and explainable (no ML):
// shared category, AI tags, title words, color and campus zone each add points,
// and a found-date clearly before the lost-date rules a pair out.

const STOP_WORDS = new Set([
    'the', 'and', 'with', 'for', 'from', 'this', 'that', 'item', 'small', 'large',
    'big', 'new', 'old', 'lost', 'found', 'near', 'some',
]);

function words(...parts: (string | undefined)[]): Set<string> {
    const out = new Set<string>();
    parts.filter(Boolean).join(' ').toLowerCase().split(/[^a-z0-9가-힣]+/).forEach(w => {
        if (w.length >= 3 && !STOP_WORDS.has(w)) out.add(w);
    });
    return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
    let n = 0;
    a.forEach(w => { if (b.has(w)) n++; });
    return n;
}

function eventMs(p: any): number | null {
    if (!p.eventDate) return null;
    const ms = new Date(p.eventDate).getTime();
    return isNaN(ms) ? null : ms;
}

export const MATCH_THRESHOLD = 5;

export function matchScore(a: any, b: any): number {
    if (!a || !b || a.id === b.id) return 0;
    if (a.postType === b.postType) return 0;
    if (a.authorId && a.authorId === b.authorId) return 0;
    if ((b.status || 'active') !== 'active') return 0;

    const lost = a.postType === 'lost' ? a : b;
    const found = a.postType === 'lost' ? b : a;
    const lostMs = eventMs(lost);
    const foundMs = eventMs(found);
    // An item can't be found more than a day before it was lost.
    if (lostMs && foundMs && foundMs < lostMs - 86400000) return 0;

    let score = 0;
    if (a.category && a.category === b.category && a.category !== 'Other') score += 3;

    const tagsA = words(...(a.tags || []));
    const tagsB = words(...(b.tags || []));
    score += Math.min(4, overlap(tagsA, tagsB) * 2);

    const titleA = words(a.title);
    const titleB = words(b.title);
    score += Math.min(4, overlap(titleA, titleB) * 2);
    // Cross-check: a title word appearing in the other post's tags/description.
    const richA = words(a.title, a.description, ...(a.tags || []));
    const richB = words(b.title, b.description, ...(b.tags || []));
    if (overlap(titleA, richB) + overlap(titleB, richA) > 0) score += 1;

    if (a.color && b.color && overlap(words(a.color), words(b.color)) > 0) score += 2;
    if (a.locationZone && a.locationZone === b.locationZone && a.locationZone !== 'Other') score += 1;
    if (lostMs && foundMs && Math.abs(foundMs - lostMs) <= 3 * 86400000) score += 1;

    return score;
}

export function rankMatches(post: any, candidates: any[], limit = 6): { post: any; score: number }[] {
    return candidates
        .map(c => ({ post: c, score: matchScore(post, c) }))
        .filter(m => m.score >= MATCH_THRESHOLD)
        .sort((x, y) => y.score - x.score)
        .slice(0, limit);
}

export async function fetchMatchesFor(post: any, limit = 6) {
    const opposite = post.postType === 'lost' ? 'found' : 'lost';
    const snap = await getDocs(query(
        collection(db, 'posts'),
        where('postType', '==', opposite),
        where('status', '==', 'active'),
    ));
    const candidates = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return rankMatches(post, candidates, limit);
}
