import { Dimensions, Platform } from 'react-native';

// The app used to cap its visual root to a phone-width column on web, so every
// full-bleed-element size (banners, cards, image viewers) computed off
// Dimensions.get('window').width was clamped the same way to match. The web
// root is no longer boxed (App.tsx renders full-bleed with a sidebar), so that
// clamp is stale — worse, it only ever touched `width`, leaving `height` at
// its real (tall desktop) value, which silently broke anything doing
// width/height-relative geometry (e.g. the splash screen's jump arc).
//
// Read the real window size directly instead. This also sidesteps a
// react-native-web quirk where Dimensions.get('window') can report 0x0 if
// read at module-evaluation time before the window has been measured.
if (Platform.OS === 'web') {
    const nativeGet = Dimensions.get.bind(Dimensions);

    Dimensions.get = (dim: 'window' | 'screen') => {
        if (dim === 'window' && typeof window !== 'undefined') {
            return { width: window.innerWidth, height: window.innerHeight, scale: 1, fontScale: 1 };
        }
        return nativeGet(dim);
    };
}
