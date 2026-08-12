import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, StatusBar,
    Platform, ActivityIndicator, TextInput, Keyboard, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { PROVIDER_GOOGLE, PROVIDER_DEFAULT, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { CommonActions } from '@react-navigation/native';
import { theme, r } from '../theme/theme';

const DEFAULT_LAT = 37.3815;
const DEFAULT_LNG = 126.6565;

interface PlaceResult {
    id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
}

export function MapPickerScreen({ navigation, route }: any) {
    const initialLat = route.params?.initialLat || DEFAULT_LAT;
    const initialLng = route.params?.initialLng || DEFAULT_LNG;

    const mapRef = useRef<MapView>(null);
    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [region, setRegion] = useState<Region>({
        latitude: initialLat,
        longitude: initialLng,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
    });
    const [address, setAddress] = useState('Finding address…');
    const [isMoving, setIsMoving] = useState(false);
    const [searchMode, setSearchMode] = useState(false);
    const [searchText, setSearchText] = useState('');
    const [placeResults, setPlaceResults] = useState<PlaceResult[]>([]);
    const [searching, setSearching] = useState(false);

    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ─── Start at the user's current location (unless a location was passed in) ───
    const hasInitial = route.params?.initialLat != null;
    useEffect(() => {
        if (hasInitial) return;
        let cancelled = false;
        (async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status !== 'granted') return;
                const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
                if (cancelled) return;
                const newRegion = {
                    latitude: loc.coords.latitude,
                    longitude: loc.coords.longitude,
                    latitudeDelta: 0.005,
                    longitudeDelta: 0.005,
                };
                setRegion(newRegion);
                mapRef.current?.animateToRegion(newRegion, 400);
                geocode(loc.coords.latitude, loc.coords.longitude);
            } catch {}
        })();
        return () => { cancelled = true; };
    }, []);

    // ─── Debounced reverse geocode via Nominatim ───
    const geocode = useCallback((lat: number, lng: number) => {
        if (timerRef.current) clearTimeout(timerRef.current);

        timerRef.current = setTimeout(async () => {
            try {
                const res = await fetch(
                    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=en`,
                    { headers: { 'User-Agent': 'DolphinApp/1.0' } },
                );
                const data = await res.json();
                if (data?.display_name) {
                    setAddress(data.display_name);
                } else {
                    setAddress('Unknown location');
                }
            } catch {
                setAddress('Unable to fetch address');
            }
        }, 500);
    }, []);

    // ─── Map event handlers ───
    const handleRegionChange = useCallback(() => {
        setIsMoving(true);
    }, []);

    const handleRegionChangeComplete = useCallback((newRegion: Region) => {
        setRegion(newRegion);
        setIsMoving(false);
        geocode(newRegion.latitude, newRegion.longitude);
    }, [geocode]);

    // ─── Place Search (Nominatim) ───
    const doSearch = useCallback(async (text: string) => {
        if (text.trim().length < 2) {
            setPlaceResults([]);
            return;
        }
        setSearching(true);
        try {
            const encoded = encodeURIComponent(text + ' Songdo Incheon');
            const res = await fetch(
                `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=6&addressdetails=1&accept-language=en,ko`,
                { headers: { 'User-Agent': 'DolphinApp/1.0' } }
            );
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                setPlaceResults(data.map((item: any) => ({
                    id: item.place_id?.toString() || `${item.lat}_${item.lon}`,
                    name: item.name || item.display_name?.split(',')[0] || text,
                    address: item.display_name || '',
                    lat: parseFloat(item.lat),
                    lng: parseFloat(item.lon),
                })));
            } else {
                // Fallback without location bias
                const res2 = await fetch(
                    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&limit=6&addressdetails=1&accept-language=en,ko`,
                    { headers: { 'User-Agent': 'DolphinApp/1.0' } }
                );
                const data2 = await res2.json();
                if (Array.isArray(data2) && data2.length > 0) {
                    setPlaceResults(data2.map((item: any) => ({
                        id: item.place_id?.toString() || `${item.lat}_${item.lon}`,
                        name: item.name || item.display_name?.split(',')[0] || text,
                        address: item.display_name || '',
                        lat: parseFloat(item.lat),
                        lng: parseFloat(item.lon),
                    })));
                } else {
                    setPlaceResults([]);
                }
            }
        } catch {
            setPlaceResults([]);
        }
        setSearching(false);
    }, []);

    const handleSearchChange = (text: string) => {
        setSearchText(text);
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        if (text.trim().length < 2) {
            setPlaceResults([]);
            return;
        }
        searchTimerRef.current = setTimeout(() => doSearch(text), 500);
    };

    const handleSearchSubmit = () => {
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        if (searchText.trim().length >= 2) {
            doSearch(searchText);
        }
    };

    const handlePlaceSelect = (place: PlaceResult) => {
        setSearchMode(false);
        setSearchText('');
        setPlaceResults([]);
        Keyboard.dismiss();
        const newRegion: Region = {
            latitude: place.lat,
            longitude: place.lng,
            latitudeDelta: 0.003,
            longitudeDelta: 0.003,
        };
        setRegion(newRegion);
        mapRef.current?.animateToRegion(newRegion, 500);
        geocode(place.lat, place.lng);
    };

    // ─── Confirm selection ───
    // Pop back to the EXACT screen that opened the picker and hand it the result,
    // instead of navigate('AddRecommendation') by name. Navigating by name pushes
    // a brand-new (blank) AddRecommendation whenever another screen sits between
    // the picker and the in-progress post — that was the "taken to a new post" bug.
    const handleConfirm = useCallback(() => {
        const routes = navigation.getState().routes;
        const prevKey = routes[routes.length - 2]?.key;
        if (prevKey) {
            navigation.dispatch({
                ...CommonActions.setParams({
                    selectedLat: region.latitude,
                    selectedLng: region.longitude,
                    selectedAddress: address,
                    // nonce so the receiver's effect re-fires even if the same
                    // pin is picked twice (deps are [selectedLat, selectedLng])
                    selectedNonce: Date.now(),
                }),
                source: prevKey,
            });
        }
        navigation.goBack();
    }, [navigation, region, address]);

    return (
        <View style={styles.container}>
            <StatusBar barStyle="dark-content" />

            {/* ─── Full-screen Map ─── */}
            <MapView
                ref={mapRef}
                style={styles.map}
                provider={PROVIDER_GOOGLE}
                initialRegion={{
                    latitude: initialLat,
                    longitude: initialLng,
                    latitudeDelta: 0.005,
                    longitudeDelta: 0.005,
                }}
                showsUserLocation
                showsMyLocationButton={false}
                showsCompass={false}
                onRegionChange={handleRegionChange}
                onRegionChangeComplete={handleRegionChangeComplete}
            />

            {/* ─── Fixed Center Pin (overlay) ─── */}
            <View style={styles.pinOverlay} pointerEvents="none">
                <View style={styles.pinShadow}>
                    <Ionicons name="location" size={40} color="#EF4444" />
                </View>
                <View style={styles.pinDot} />
            </View>

            {/* ─── Top Bar ─── */}
            <View style={styles.topBar}>
                <TouchableOpacity
                    style={styles.closeBtn}
                    onPress={() => {
                        if (searchMode) {
                            setSearchMode(false);
                            setSearchText('');
                            setPlaceResults([]);
                            Keyboard.dismiss();
                        } else {
                            navigation.goBack();
                        }
                    }}
                    activeOpacity={0.7}
                >
                    <Ionicons name={searchMode ? 'arrow-back' : 'close'} size={24} color={theme.colors.textPrimary} />
                </TouchableOpacity>

                {searchMode ? (
                    <View style={styles.searchInputWrap}>
                        <Ionicons name="search" size={16} color="#94A3B8" />
                        <TextInput
                            style={styles.searchInput}
                            placeholder="Search for a place..."
                            placeholderTextColor="#94A3B8"
                            value={searchText}
                            onChangeText={handleSearchChange}
                            onSubmitEditing={handleSearchSubmit}
                            returnKeyType="search"
                            autoFocus
                        />
                        {searching && (
                            <ActivityIndicator size="small" color="#94A3B8" />
                        )}
                        {searchText.length > 0 && !searching && (
                            <TouchableOpacity onPress={() => { setSearchText(''); setPlaceResults([]); }}>
                                <Ionicons name="close-circle" size={18} color="#94A3B8" />
                            </TouchableOpacity>
                        )}
                    </View>
                ) : (
                    <TouchableOpacity
                        style={styles.topAddressWrap}
                        onPress={() => setSearchMode(true)}
                        activeOpacity={0.7}
                    >
                        <Ionicons name="search" size={16} color="#94A3B8" style={styles.topAddressIcon} />
                        <Text style={styles.topAddressText} numberOfLines={1}>
                            {isMoving ? 'Moving map…' : address}
                        </Text>
                        {isMoving && (
                            <ActivityIndicator
                                size="small"
                                color={theme.colors.textMuted}
                                style={styles.topAddressSpinner}
                            />
                        )}
                    </TouchableOpacity>
                )}
            </View>

            {/* ─── Search Results Dropdown ─── */}
            {searchMode && placeResults.length > 0 && (
                <View style={styles.searchDropdown}>
                    <FlatList
                        data={placeResults}
                        keyExtractor={(item, idx) => item.id + idx}
                        keyboardShouldPersistTaps="handled"
                        renderItem={({ item, index }) => (
                            <TouchableOpacity
                                style={[styles.placeItem, index < placeResults.length - 1 && styles.placeItemBorder]}
                                onPress={() => handlePlaceSelect(item)}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="location-outline" size={20} color="#94A3B8" style={{ marginRight: 12 }} />
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.placeName} numberOfLines={1}>{item.name}</Text>
                                    <Text style={styles.placeAddress} numberOfLines={2}>{item.address}</Text>
                                </View>
                            </TouchableOpacity>
                        )}
                    />
                </View>
            )}

            {/* ─── Bottom Panel ─── */}
            {!searchMode && (
                <View style={styles.bottomPanel}>
                    <View style={styles.bottomContent}>
                        <View style={styles.bottomHandle} />
                        <Text style={styles.bottomAddress} numberOfLines={2}>
                            {address}
                        </Text>
                        <Text style={styles.bottomSubtitle}>
                            Drag the map to adjust pin location
                        </Text>
                        <TouchableOpacity
                            style={styles.confirmBtn}
                            onPress={handleConfirm}
                            activeOpacity={0.85}
                        >
                            <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
                            <Text style={styles.confirmBtnText}>Confirm Location</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#FFFFFF',
    },
    map: {
        ...StyleSheet.absoluteFillObject,
    },

    // ─── Fixed Center Pin ───
    pinOverlay: {
        position: 'absolute',
        left: '50%',
        top: '50%',
        alignItems: 'center',
        zIndex: 10,
        transform: [{ translateX: -20 }, { translateY: -40 }],
    },
    pinShadow: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 8,
    },
    pinDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: 'rgba(0, 0, 0, 0.2)',
        marginTop: -4,
        alignSelf: 'center',
        transform: [{ translateX: 20 }],
    },

    // ─── Top Bar ───
    topBar: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: Platform.OS === 'ios' ? 56 : 36,
        paddingBottom: 14,
        paddingHorizontal: 16,
        backgroundColor: '#FFFFFF',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 4,
        zIndex: 20,
    },
    closeBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#F1F5F9',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    topAddressWrap: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F8FAFC',
        borderRadius: r(10),
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    topAddressIcon: {
        marginRight: 8,
    },
    topAddressText: {
        flex: 1,
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.textPrimary,
    },
    topAddressSpinner: {
        marginLeft: 8,
    },

    // ─── Search Input ───
    searchInputWrap: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F8FAFC',
        borderRadius: r(10),
        paddingHorizontal: 12,
        paddingVertical: Platform.OS === 'ios' ? 10 : 4,
        gap: 8,
    },
    searchInput: {
        flex: 1,
        fontSize: 15,
        color: '#1E293B',
        padding: 0,
    },

    // ─── Search Dropdown ───
    searchDropdown: {
        position: 'absolute',
        top: Platform.OS === 'ios' ? 110 : 90,
        left: 16,
        right: 16,
        maxHeight: 300,
        backgroundColor: '#FFFFFF',
        borderRadius: r(14),
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
        elevation: 10,
        zIndex: 30,
        overflow: 'hidden',
    },
    placeItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    placeItemBorder: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#E2E8F0',
    },
    placeName: {
        fontSize: 15,
        fontWeight: '600',
        color: '#1E293B',
    },
    placeAddress: {
        fontSize: 12,
        color: '#94A3B8',
        marginTop: 2,
        lineHeight: 16,
    },

    // ─── Bottom Panel ───
    bottomPanel: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 20,
    },
    bottomContent: {
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 34,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 10,
    },
    bottomHandle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#E2E8F0',
        alignSelf: 'center',
        marginBottom: 16,
    },
    bottomAddress: {
        fontSize: 15,
        fontWeight: '600',
        color: '#1A202C',
        lineHeight: 22,
        marginBottom: 4,
    },
    bottomSubtitle: {
        fontSize: 12,
        color: '#94A3B8',
        marginBottom: 20,
    },

    // ─── Confirm Button ───
    confirmBtn: {
        backgroundColor: '#10B981',
        borderRadius: r(14),
        paddingVertical: 16,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
        shadowColor: '#10B981',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    confirmBtnText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '700',
        letterSpacing: 0.3,
    },
});
