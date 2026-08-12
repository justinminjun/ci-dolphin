export const theme = {
    colors: {
        primary: '#0C2340',       // Chadwick Navy Blue
        primaryLight: '#1A3A5C',  // Navy lighter
        primaryDark: '#061729',   // Navy darker
        accent: '#C9A96E',        // Gold accent (classic school pairing)
        success: '#10B981',       // Emerald 500
        danger: '#EF4444',        // Red 500
        warning: '#F97316',       // Orange 500

        background: '#F5F7FA',    // Cool light gray
        surface: '#FFFFFF',
        surfaceAlt: '#EDF1F7',    // Navy-tinted light gray
        textPrimary: '#0C2340',   // Navy for headings
        textSecondary: '#4A5E78', // Slate navy
        textMuted: '#8A9BB5',     // Muted blue-gray
        border: '#D8DFE9',        // Soft blue border
        borderLight: '#EDF1F7',   // Very light

        // Tag colors
        tagBg: '#E8EDF4',        // Navy tint 50
        tagText: '#0C2340',      // Navy
        lostBg: '#FEF2F2',
        lostText: '#DC2626',
        foundBg: '#ECFDF5',
        foundText: '#059669',

        // Gradient
        gradientStart: '#0C2340',
        gradientEnd: '#1A3A5C',

        // Chat
        chatMe: '#0C2340',
        chatThem: '#EDF1F7',
    },
    typography: {
        h1: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.5 },
        h2: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
        h3: { fontSize: 17, fontWeight: '600' as const },
        body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 22 },
        bodySecondary: { fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
        caption: { fontSize: 12, fontWeight: '400' as const },
        tag: { fontSize: 12, fontWeight: '500' as const },
        button: { fontSize: 16, fontWeight: '600' as const },
    },
    spacing: {
        xs: 4,
        sm: 8,
        md: 16,
        lg: 24,
        xl: 32,
        xxl: 48,
    },
    radius: {
        sm: 6,
        md: 10,
        lg: 14,
        xl: 20,
        full: 999,
    },
    shadows: {
        sm: {
            shadowColor: '#0C2340',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.06,
            shadowRadius: 3,
            elevation: 1,
        },
        md: {
            shadowColor: '#0C2340',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.1,
            shadowRadius: 12,
            elevation: 3,
        },
        lg: {
            shadowColor: '#0C2340',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.14,
            shadowRadius: 24,
            elevation: 8,
        },
    }
};
