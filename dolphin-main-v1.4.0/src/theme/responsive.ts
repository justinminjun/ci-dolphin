/**
 * Responsive helpers for tablet (iPad) layouts.
 *
 * Phone layouts stay untouched — every helper degrades to the phone value
 * when `isTablet` is false, so screens can adopt these incrementally.
 *
 * Design language on tablet:
 *  - Content is constrained to a readable max width and centered, instead of
 *    stretching edge-to-edge (that's what made the iPad build feel "blown up").
 *  - Card lists become multi-column grids.
 *  - Horizontal padding scales up.
 */
import { Dimensions, Platform } from 'react-native';

// webDimensionsPolyfill.ts clamps Dimensions.get('window') to 480px for the
// mobile-scale pixel math scattered across the app (card widths, image
// galleries, etc.) — but that clamp defeats tablet/desktop detection here,
// pinning isTablet/gridColumns to phone values forever regardless of actual
// browser width. Read the real width directly on web, same as useResponsive.ts.
function rawWidth(): number {
    if (Platform.OS === 'web' && typeof window !== 'undefined') return window.innerWidth;
    return Dimensions.get('window').width;
}

const SCREEN_W = rawWidth();
// Platform.isPad is the reliable signal on iOS; the width check covers
// Android tablets, windowed multitasking edge cases, and web desktop widths.
export const isTablet: boolean =
    (Platform.OS === 'ios' && (Platform as any).isPad === true) || SCREEN_W >= 768;

/** Max width for primary reading/feed content on tablet. */
export const CONTENT_MAX_WIDTH = 720;

/** Max width for wide dashboard-style content (Home). */
export const WIDE_MAX_WIDTH = 1024;

/** Screen-edge horizontal padding. */
export const screenPadding = isTablet ? 32 : 16;

/**
 * Column count for card grids (Market, Lost & Found, media lists).
 * Recomputed per call so orientation/window changes are picked up on
 * re-render (Dimensions.get is cheap).
 */
export function gridColumns(phoneCols = 2): number {
    if (!isTablet) return phoneCols;
    const w = rawWidth();
    if (w >= 1180) return 4;
    if (w >= 900) return 3;
    return 3;
}

/**
 * Style fragment that centers a content block at the given max width.
 * Spread into a container's style: `{...centerContent()}`.
 */
export function centerContent(maxWidth: number = CONTENT_MAX_WIDTH) {
    if (!isTablet) return {};
    return { width: '100%' as const, maxWidth, alignSelf: 'center' as const };
}
