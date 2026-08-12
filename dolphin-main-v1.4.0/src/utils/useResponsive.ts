import { useEffect, useState } from 'react';
import { Dimensions, Platform } from 'react-native';

// Width at which the web layout switches from the mobile shell (bottom tabs,
// narrow reading column) to the desktop shell (sidebar nav, wider grids).
export const WEB_DESKTOP_BREAKPOINT = 900;

// webDimensionsPolyfill.ts clamps Dimensions.get('window') to 480px so the
// (still-mobile) phone-frame column math elsewhere doesn't overflow — but this
// hook needs the *real* browser width to decide whether to switch layouts at
// all, so it reads window.innerWidth/innerHeight directly on web instead.
// This also sidesteps a separate quirk where Dimensions.get('window') can
// report 0x0 if read at module-evaluation time before the window has been
// measured — reading directly off `window` in a hook is always live.
function rawWindowSize(): { width: number; height: number } {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
        return { width: window.innerWidth, height: window.innerHeight };
    }
    const { width, height } = Dimensions.get('window');
    return { width, height };
}

// Reactive on web (listens to window resize); on native this is effectively
// static, matching how the rest of the app already treats Dimensions.
export function useWindowWidth(): number {
    const [size, setSize] = useState(rawWindowSize);

    useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined') return;
        const onResize = () => setSize(rawWindowSize());
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    return size.width;
}

export function useWindowHeight(): number {
    const [size, setSize] = useState(rawWindowSize);

    useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined') return;
        const onResize = () => setSize(rawWindowSize());
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    return size.height;
}

export function useIsWebDesktop(): boolean {
    const width = useWindowWidth();
    return Platform.OS === 'web' && width >= WEB_DESKTOP_BREAKPOINT;
}
