import { useEffect, useRef, useState } from 'react';
import { Dimensions, Platform } from 'react-native';

// Width at which the web layout switches from the mobile shell (bottom tabs,
// narrow reading column) to the desktop shell (sidebar nav, wider grids).
export const WEB_DESKTOP_BREAKPOINT = 900;

// Reads window.innerWidth/innerHeight directly on web rather than going
// through Dimensions.get('window') — sidesteps a react-native-web quirk
// where Dimensions.get('window') can report 0x0 if read at module-evaluation
// time before the window has been measured. Reading directly off `window`
// in a hook is always live.
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

// Mouse hover has no native-app equivalent — RN's touch responder system
// doesn't expose it — so this reads the DOM events directly and is a no-op
// on native (always false, ref still returned for API symmetry). Used to
// give web cards/buttons a hover affordance, since a total lack of hover
// feedback is one of the biggest tells that a page is an app shell rather
// than an actual website.
export function useHover<T extends HTMLElement = any>() {
    const [hovered, setHovered] = useState(false);
    const ref = useRef<T>(null);

    useEffect(() => {
        if (Platform.OS !== 'web' || !ref.current) return;
        const el = ref.current;
        const onEnter = () => setHovered(true);
        const onLeave = () => setHovered(false);
        el.addEventListener('mouseenter', onEnter);
        el.addEventListener('mouseleave', onLeave);
        return () => {
            el.removeEventListener('mouseenter', onEnter);
            el.removeEventListener('mouseleave', onLeave);
        };
    }, []);

    return { ref, hovered: Platform.OS === 'web' && hovered };
}
