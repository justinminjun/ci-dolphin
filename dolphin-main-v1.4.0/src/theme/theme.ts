/**
 * Dolphin Design System
 * A warm, vibrant theme inspired by ocean and dolphin aesthetics.
 * Platform-adaptive: iOS uses rounded corners, Android uses Material Design.
 */

import { Platform } from 'react-native';

const isAndroid = Platform.OS === 'android';

const colors = {
    // Primary palette — ocean blue
    primary: '#0EA5E9',
    primaryDark: '#0284C7',
    primaryLight: '#38BDF8',
    primaryGhost: 'rgba(14, 165, 233, 0.08)',

    // Accent — coral / warm
    accent: '#F97316',
    accentLight: '#FB923C',

    // Surfaces
    background: '#F7F8FA',
    surface: '#FFFFFF',
    surfaceAlt: '#F0F1F5',
    surfaceElevated: '#FFFFFF',

    // Text
    textPrimary: '#0F172A',
    textSecondary: '#475569',
    textMuted: '#94A3B8',
    textInverse: '#FFFFFF',

    // Semantic
    success: '#10B981',
    successBg: '#ECFDF5',
    warning: '#F59E0B',
    warningBg: '#FFFBEB',
    danger: '#EF4444',
    dangerBg: '#FEF2F2',

    // Borders
    border: '#E2E8F0',
    borderLight: '#F1F5F9',

    // Categories
    lostBg: '#FEF2F2',
    lostText: '#DC2626',
    foundBg: '#ECFDF5',
    foundText: '#059669',
    sellBg: '#FFF7ED',
    sellText: '#EA580C',

    // Missing colors from Lost & Found
    tagBg: '#F1F5F9',
    tagText: '#475569',
    chatMe: '#0EA5E9',
    chatThem: '#F1F5F9',
    errorBg: '#FEF2F2',

    // Gradients
    gradientStart: '#0EA5E9',
    gradientEnd: '#0284C7',
};

const spacing = {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
};

// Android: Square corners (no rounding)
// iOS: Keep the existing rounded style
const radius = {
    sm: isAndroid ? 0 : 6,
    md: isAndroid ? 0 : 10,
    lg: isAndroid ? 0 : 16,
    xl: isAndroid ? 0 : 24,
    full: 9999,
};

const typography = {
    h1: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.5 },
    h2: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
    h3: { fontSize: 18, fontWeight: '700' as const },
    body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 22 },
    bodyBold: { fontSize: 15, fontWeight: '600' as const, lineHeight: 22 },
    caption: { fontSize: 13, fontWeight: '400' as const },
    tag: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.3 },
    tiny: { fontSize: 10, fontWeight: '500' as const },

    // Missing typography from Lost & Found
    bodySecondary: { fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
    button: { fontSize: 16, fontWeight: '600' as const },
};

const shadows = {
    sm: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
        elevation: 1,
    },
    md: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 3,
    },
    lg: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
        elevation: 6,
    },
};

export const theme = { colors, spacing, radius, typography, shadows, isAndroid };

/**
 * Platform-adaptive border radius helper.
 * On Android returns 0 (square), on iOS returns the given value.
 * Usage: borderRadius: r(14)
 */
export const r = (iosValue: number): number => isAndroid ? 0 : iosValue;

