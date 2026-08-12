import { Linking } from 'react-native';

/**
 * Open Google Maps directions to a destination.
 *
 * When a Google placeId is available we use a Maps URL with the place name +
 * destination_place_id, so Google Maps shows the actual place ("Toulon French
 * Restaurant") instead of raw coordinates. Without a placeId we fall back to
 * the coordinate-based deep link.
 */
export function openDirections(opts: {
    lat: number;
    lng: number;
    name?: string;
    placeId?: string | null;
    travelmode?: 'driving' | 'walking' | 'transit';
}) {
    const { lat, lng, name, placeId, travelmode = 'driving' } = opts;

    if (placeId && name) {
        const url =
            `https://www.google.com/maps/dir/?api=1` +
            `&destination=${encodeURIComponent(name)}` +
            `&destination_place_id=${placeId}` +
            `&travelmode=${travelmode}`;
        Linking.openURL(url).catch(() => {});
        return;
    }

    const appUrl = `comgooglemaps://?daddr=${lat},${lng}&directionsmode=${travelmode}`;
    const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=${travelmode}`;
    Linking.canOpenURL('comgooglemaps://')
        .then(supported => Linking.openURL(supported ? appUrl : webUrl))
        .catch(() => Linking.openURL(webUrl).catch(() => {}));
}

/**
 * Open a place's own page in Google Maps (name, photos, reviews — not directions).
 */
export function openPlaceInGoogleMaps(opts: { name: string; placeId?: string | null; lat?: number; lng?: number }) {
    const { name, placeId, lat, lng } = opts;
    let url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;
    if (placeId) {
        url += `&query_place_id=${placeId}`;
    } else if (lat != null && lng != null) {
        url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    }
    Linking.openURL(url).catch(() => {});
}
