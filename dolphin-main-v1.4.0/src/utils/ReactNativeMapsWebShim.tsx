// Web replacement for `react-native-maps`, wired in via metro.config.js's
// resolver alias (web platform only — native iOS/Android still resolve the
// real `react-native-maps` package, untouched).
//
// `@teovilla/react-native-web-maps` is a close API-compatible drop-in (same
// MapView/Marker props, animateToRegion, onRegionChangeComplete with proper
// lat/lng deltas, showsUserLocation) built on `@react-google-maps/api`, so
// the four screens that import from 'react-native-maps' need no changes.
//
// Two gaps vs. the native library, both harmless no-ops here:
//   - PROVIDER_GOOGLE / PROVIDER_DEFAULT aren't exported by the web library
//     (there's only one provider on web) — stubbed as plain strings below.
//   - onPoiClick (tap any Google-rendered POI icon) has no web equivalent in
//     this library — the prop is simply never invoked, so that one feature
//     silently doesn't fire on web while everything else still works.
import React from 'react';
// @ts-ignore — no type declarations shipped for this package
import * as WebMaps from '@teovilla/react-native-web-maps';

// The package's shipped .d.ts resolves the default export as the whole
// module namespace rather than a component type, which trips
// `JSX element type ... does not have any construct or call signatures`
// at the usage site below even with @ts-ignore on the import. Cast to
// `any` here once instead of suppressing every downstream usage.
const WebMapView: any = (WebMaps as any).default ?? (WebMaps as any);
const WebMarker: any = (WebMaps as any).Marker;
const Callout: any = (WebMaps as any).Callout;
const Polyline: any = (WebMaps as any).Polyline;
const Circle: any = (WebMaps as any).Circle;
const Geojson: any = (WebMaps as any).Geojson;

export const PROVIDER_GOOGLE = 'google';
export const PROVIDER_DEFAULT = undefined as unknown as string;
export type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';

const MapView = React.forwardRef((props: any, ref: any) => (
    <WebMapView ref={ref} googleMapsApiKey={GOOGLE_MAPS_KEY} {...props} />
));

export const Marker = WebMarker;
export { Callout, Polyline, Circle, Geojson };
export default MapView;
