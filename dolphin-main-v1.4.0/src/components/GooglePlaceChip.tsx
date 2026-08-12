import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { openPlaceInGoogleMaps } from '../utils/maps';

const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';

interface PlaceInfo {
    name: string;
    rating?: number;
    totalRatings?: number;
}

// Module-level cache — Places API charges per request
const placeInfoCache = new Map<string, PlaceInfo>();

/**
 * Small tappable chip showing the linked Google Maps place
 * (official name + rating). Tapping opens the place in Google Maps.
 */
export function GooglePlaceChip({ placeId }: { placeId?: string | null }) {
    const [info, setInfo] = useState<PlaceInfo | null>(placeId ? placeInfoCache.get(placeId) || null : null);

    useEffect(() => {
        if (!placeId) { setInfo(null); return; }
        const cached = placeInfoCache.get(placeId);
        if (cached) { setInfo(cached); return; }
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(
                    `https://places.googleapis.com/v1/places/${placeId}?fields=displayName,rating,userRatingCount&languageCode=en&key=${GOOGLE_MAPS_KEY}`
                );
                const r = await res.json();
                if (r && !r.error && r.displayName?.text) {
                    const next: PlaceInfo = {
                        name: r.displayName.text,
                        rating: r.rating,
                        totalRatings: r.userRatingCount,
                    };
                    placeInfoCache.set(placeId, next);
                    if (!cancelled) setInfo(next);
                }
            } catch {}
        })();
        return () => { cancelled = true; };
    }, [placeId]);

    if (!placeId || !info) return null;

    return (
        <TouchableOpacity
            style={styles.chip}
            activeOpacity={0.8}
            onPress={() => openPlaceInGoogleMaps({ name: info.name, placeId })}
        >
            <View style={styles.gIcon}>
                <Ionicons name="location" size={12} color="#fff" />
            </View>
            <Text style={styles.name} numberOfLines={1}>{info.name}</Text>
            {info.rating != null && (
                <View style={styles.ratingWrap}>
                    <Ionicons name="star" size={11} color="#F59E0B" />
                    <Text style={styles.rating}>
                        {info.rating}{info.totalRatings != null ? ` (${info.totalRatings.toLocaleString()})` : ''}
                    </Text>
                </View>
            )}
            <Ionicons name="chevron-forward" size={13} color="#94A3B8" />
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        alignSelf: 'flex-start',
        maxWidth: '100%',
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderRadius: 9999,
        paddingLeft: 5,
        paddingRight: 9,
        paddingVertical: 5,
        marginTop: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 3,
        elevation: 2,
    },
    gIcon: {
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: '#4285F4',
        justifyContent: 'center',
        alignItems: 'center',
    },
    name: {
        fontSize: 12.5,
        fontWeight: '700',
        color: '#1E293B',
        flexShrink: 1,
    },
    ratingWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
    rating: {
        fontSize: 11.5,
        fontWeight: '600',
        color: '#92400E',
    },
});
