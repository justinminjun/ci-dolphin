import React, { useState, useCallback, useEffect } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, TextInput, Image,
    ScrollView, Alert, ActivityIndicator, Dimensions, Platform,
    KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, PROVIDER_GOOGLE, PROVIDER_DEFAULT } from 'react-native-maps';
import { launchImageLibraryAsync, MediaTypeOptions } from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as Location from 'expo-location';

import { db, auth, storage } from '../config/firebase';
import { collection, addDoc, serverTimestamp, query, where, getDocs, limit } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { LOCAL_CATEGORIES } from '../components/LocalGuideCards';
import { classifyCuisine } from '../utils/gemini';
import { theme, r } from '../theme/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const DEFAULT_LAT = 37.3815;
const DEFAULT_LNG = 126.6565;
const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';

interface LinkedPlace {
    placeId: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    rating?: number;
    totalRatings?: number;
    types?: string[];
}

// Google Places (New) text search, biased to Songdo
async function searchGooglePlaces(text: string): Promise<LinkedPlace[]> {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_MAPS_KEY,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.location,places.types,places.primaryType',
        },
        body: JSON.stringify({
            textQuery: text,
            languageCode: 'en',
            pageSize: 6,
            locationBias: {
                circle: { center: { latitude: DEFAULT_LAT, longitude: DEFAULT_LNG }, radius: 15000 },
            },
        }),
    });
    const data = await res.json();
    return (data.places || []).map((p: any) => ({
        placeId: p.id,
        name: p.displayName?.text || '',
        address: p.formattedAddress || '',
        lat: p.location?.latitude,
        lng: p.location?.longitude,
        rating: p.rating,
        totalRatings: p.userRatingCount,
        types: [...(p.primaryType ? [p.primaryType] : []), ...(p.types || [])],
    }));
}

export function AddRecommendationScreen({ navigation, route }: any) {
    const [photos, setPhotos] = useState<string[]>([]);
    const [category, setCategory] = useState<string>(route.params?.category ?? '');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [latitude, setLatitude] = useState(DEFAULT_LAT);
    const [longitude, setLongitude] = useState(DEFAULT_LNG);
    const [address, setAddress] = useState('');
    const [detailAddress, setDetailAddress] = useState('');
    const [loading, setLoading] = useState(false);
    const mapRef = React.useRef<MapView>(null);

    // Keep the preview map glued to the active coordinate (place link,
    // POI prefill, MapPicker return, current-location fix all flow through here)
    useEffect(() => {
        mapRef.current?.animateToRegion(
            { latitude, longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 },
            350,
        );
    }, [latitude, longitude]);

    // ─── Google place linking ───
    const [linkedPlace, setLinkedPlace] = useState<LinkedPlace | null>(null);
    // Set when the linked place is already on the Local Guide — blocks a 2nd post.
    const [dupExisting, setDupExisting] = useState<{ id: string; authorName: string; category: string } | null>(null);
    const [placeQuery, setPlaceQuery] = useState('');
    const [placeResults, setPlaceResults] = useState<LinkedPlace[]>([]);
    const [searchingPlace, setSearchingPlace] = useState(false);
    const placeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const handlePlaceQueryChange = (text: string) => {
        setPlaceQuery(text);
        if (placeTimerRef.current) clearTimeout(placeTimerRef.current);
        if (text.trim().length < 2) {
            setPlaceResults([]);
            setSearchingPlace(false);
            return;
        }
        setSearchingPlace(true);
        placeTimerRef.current = setTimeout(async () => {
            try {
                const results = await searchGooglePlaces(text.trim());
                setPlaceResults(results);
            } catch {
                setPlaceResults([]);
            } finally {
                setSearchingPlace(false);
            }
        }, 350);
    };

    // ─── Duplicate guard ───
    // A place is uniquely identified by its Google placeId. If it has already
    // been recommended, we block a second post and point the user to the
    // existing one (they can like / comment there instead).
    const findExistingForPlace = async (placeId: string) => {
        const dup = await getDocs(query(
            collection(db, 'local_recommendations'),
            where('placeId', '==', placeId),
            limit(1),
        ));
        if (dup.empty) return null;
        const d = dup.docs[0];
        const data: any = d.data();
        return { id: d.id, authorName: data.authorName || 'someone', category: data.category || '' };
    };

    const goToExisting = (existing: { id: string; category: string }) => {
        const cat = LOCAL_CATEGORIES.find(c => c.key === existing.category);
        if (cat) navigation.navigate('LocalGuide', { category: cat, openItemId: existing.id });
    };

    // Runs when a place is linked / prefilled — surfaces the block early.
    const checkDuplicate = async (place: LinkedPlace) => {
        try {
            const existing = await findExistingForPlace(place.placeId);
            if (existing) {
                setDupExisting(existing);
                Alert.alert(
                    'Already recommended',
                    `"${place.name}" has already been recommended by ${existing.authorName}. Each place can only be added once — but you can add your own photos, like, or comment on it!`,
                    [
                        { text: 'Add your photos', onPress: () => goToExisting(existing) },
                        { text: 'Pick another place', style: 'cancel', onPress: unlinkPlace },
                    ],
                );
            } else {
                setDupExisting(null);
            }
        } catch {
            // network hiccup — the hard guard in handleSubmit still catches dupes
        }
    };

    const selectPlace = (place: LinkedPlace) => {
        setLinkedPlace(place);
        setPlaceQuery('');
        setPlaceResults([]);
        if (!title.trim()) setTitle(place.name);
        if (place.lat && place.lng) {
            locationPickedRef.current = true;
            setLatitude(place.lat);
            setLongitude(place.lng);
        }
        if (place.address) setAddress(place.address);
        checkDuplicate(place);
    };

    const unlinkPlace = () => {
        setLinkedPlace(null);
        setDupExisting(null);
    };

    // ─── Prefill from POI card ("Recommend" on the map) ───
    const prefillApplied = React.useRef(false);
    useEffect(() => {
        const prefill = route.params?.prefill;
        if (!prefill || prefillApplied.current) return;
        prefillApplied.current = true;
        const place: LinkedPlace = {
            placeId: prefill.placeId,
            name: prefill.name || '',
            address: prefill.address || '',
            lat: prefill.lat,
            lng: prefill.lng,
            rating: prefill.rating,
            totalRatings: prefill.totalRatings,
            types: prefill.types || [],
        };
        setLinkedPlace(place);
        setTitle(prefill.name || '');
        if (prefill.lat && prefill.lng) {
            locationPickedRef.current = true;
            setLatitude(prefill.lat);
            setLongitude(prefill.lng);
        }
        if (prefill.address) setAddress(prefill.address);
        checkDuplicate(place);
    }, [route.params?.prefill]);

    // ---------- Reverse geocode helper (Nominatim – no native module) ----------
    const geocode = useCallback(async (lat: number, lng: number) => {
        try {
            const res = await fetch(
                `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=en`,
                { headers: { 'User-Agent': 'DolphinApp/1.0' } },
            );
            const data = await res.json();
            if (data?.display_name) {
                setAddress(data.display_name);
            }
        } catch {
            // silently ignore geocoding errors
        }
    }, []);

    // ---------- Photo picker (up to 4) ----------
    const pickPhoto = async () => {
        const remaining = 4 - photos.length;
        if (remaining <= 0) {
            Alert.alert('Maximum 4 photos');
            return;
        }
        // Multi-select: pick several at once. (allowsEditing is incompatible with
        // multi-select on iOS; the upload step resizes to 1024w anyway, and the
        // carousel uses cover fit so mixed aspect ratios render fine.)
        const result = await launchImageLibraryAsync({
            mediaTypes: MediaTypeOptions.Images,
            quality: 0.8,
            allowsMultipleSelection: true,
            selectionLimit: remaining,
        });
        if (!result.canceled && result.assets.length > 0) {
            setPhotos(prev => [...prev, ...result.assets.map(a => a.uri)].slice(0, 4));
        }
    };

    const removePhoto = (index: number) => {
        setPhotos(prev => prev.filter((_, i) => i !== index));
    };

    // ---------- Start at the user's current location ----------
    const locationPickedRef = React.useRef(false);
    useEffect(() => {
        let cancelled = false;
        const apply = (lat: number, lng: number, withAddress: boolean) => {
            if (cancelled || locationPickedRef.current) return;
            setLatitude(lat);
            setLongitude(lng);
            if (withAddress) geocode(lat, lng);
        };
        (async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status !== 'granted') return;
                // Last known fix first — instant, avoids showing the Songdo
                // fallback while a fresh GPS fix is still warming up
                try {
                    const last = await Location.getLastKnownPositionAsync();
                    if (last) apply(last.coords.latitude, last.coords.longitude, false);
                } catch {}
                const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                apply(loc.coords.latitude, loc.coords.longitude, true);
            } catch {}
        })();
        return () => { cancelled = true; };
    }, []);

    // ---------- Receive location from MapPickerScreen ----------
    useEffect(() => {
        if (route.params?.selectedLat != null) {
            locationPickedRef.current = true;
            setLatitude(route.params.selectedLat);
            setLongitude(route.params.selectedLng);
            if (route.params.selectedAddress) {
                setAddress(route.params.selectedAddress);
            }
        }
    }, [route.params?.selectedLat, route.params?.selectedLng, route.params?.selectedNonce]);

    // ---------- Submit ----------
    const handleSubmit = async () => {
        if (!title.trim()) {
            Alert.alert('Missing Title', 'Please enter a place name.');
            return;
        }
        if (!category) {
            Alert.alert('Missing Category', 'Please select a category.');
            return;
        }

        const user = auth.currentUser;
        if (!user) {
            Alert.alert('Error', 'You must be logged in to post.');
            return;
        }

        setLoading(true);
        try {
            // Hard duplicate guard: re-check at submit so the same place can
            // never be posted twice (covers the race where two people add it
            // at once, or the early warning being dismissed). Fails open on a
            // transient query error — the link-time check already warned.
            if (linkedPlace?.placeId) {
                try {
                    const existing = await findExistingForPlace(linkedPlace.placeId);
                    if (existing) {
                        setDupExisting(existing);
                        Alert.alert(
                            'Already recommended',
                            `"${title.trim() || linkedPlace.name}" is already on the Local Guide — ${existing.authorName} beat you to it! Each place can only be recommended once, but you can add your own photos to theirs.`,
                            [
                                { text: 'Add your photos', onPress: () => goToExisting(existing) },
                                { text: 'OK', style: 'cancel' },
                            ],
                        );
                        return; // finally resets the loading spinner
                    }
                } catch {
                    // ignore — proceed with the post
                }
            }

            // AI cuisine detection runs while photos upload (restaurants only)
            const cuisinePromise: Promise<string | null> = category === 'restaurant'
                ? classifyCuisine({
                    name: title.trim(),
                    description: description.trim(),
                    address,
                    googleTypes: linkedPlace?.types,
                }).catch(() => null)
                : Promise.resolve(null);

            // Upload all selected photos
            const uploadedUrls: string[] = [];
            for (const p of photos) {
                const compressed = await manipulateAsync(
                    p,
                    [{ resize: { width: 1024 } }],
                    { compress: 0.7, format: SaveFormat.JPEG },
                );
                const response = await fetch(compressed.uri);
                const blob = await response.blob();
                const filename = `local_guide/${user.uid}/${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
                const storageRef = ref(storage, filename);
                await uploadBytes(storageRef, blob);
                uploadedUrls.push(await getDownloadURL(storageRef));
            }

            const detectedCuisine = await cuisinePromise;

            await addDoc(collection(db, 'local_recommendations'), {
                title: title.trim(),
                description: description.trim(),
                category,
                cuisine: detectedCuisine,
                placeId: linkedPlace?.placeId || null,
                photo: uploadedUrls[0] || '',
                photos: uploadedUrls,
                latitude,
                longitude,
                address: detailAddress.trim()
                    ? `${address}, ${detailAddress.trim()}`
                    : address || '',
                authorId: user.uid,
                authorName: user.displayName || 'Anonymous',
                authorPhoto: user.photoURL || '',
                likes: 0,
                createdAt: serverTimestamp(),
            });

            navigation.goBack();
        } catch (error: any) {
            Alert.alert('Error', error.message || 'Failed to post recommendation.');
        } finally {
            setLoading(false);
        }
    };

    // ---------- Helpers ----------
    const selectedCat = LOCAL_CATEGORIES.find(c => c.key === category);
    const canSubmit = title.trim().length > 0 && category.length > 0 && !loading && !dupExisting;

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            {/* ---- Header ---- */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeBtn}>
                    <Ionicons name="close" size={26} color={theme.colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Add Recommendation</Text>
                <TouchableOpacity
                    style={[styles.postBtn, !canSubmit && styles.postBtnDisabled]}
                    onPress={handleSubmit}
                    disabled={!canSubmit}
                    activeOpacity={0.8}
                >
                    {loading ? (
                        <ActivityIndicator size="small" color="#fff" />
                    ) : (
                        <Text style={styles.postBtnText}>Post</Text>
                    )}
                </TouchableOpacity>
            </View>

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                showsVerticalScrollIndicator={false}
            >
                {/* ---- Google Place Link ---- */}
                <Text style={styles.sectionLabel}>Place</Text>
                {linkedPlace ? (
                    <View style={styles.linkedCard}>
                        <View style={styles.linkedIcon}>
                            <Ionicons name="location" size={18} color="#fff" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.linkedName} numberOfLines={1}>{linkedPlace.name}</Text>
                            {linkedPlace.rating != null && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 }}>
                                    <Ionicons name="star" size={11} color="#F59E0B" />
                                    <Text style={styles.linkedRating}>
                                        {linkedPlace.rating}{linkedPlace.totalRatings != null ? ` (${linkedPlace.totalRatings.toLocaleString()})` : ''}
                                    </Text>
                                </View>
                            )}
                            {linkedPlace.address ? (
                                <Text style={styles.linkedAddress} numberOfLines={1}>{linkedPlace.address}</Text>
                            ) : null}
                            <View style={styles.linkedBadge}>
                                <Ionicons name="checkmark-circle" size={11} color="#10B981" />
                                <Text style={styles.linkedBadgeText}>Linked to Google Maps</Text>
                            </View>
                        </View>
                        <TouchableOpacity onPress={unlinkPlace} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                            <Ionicons name="close-circle" size={22} color="#94A3B8" />
                        </TouchableOpacity>
                    </View>
                ) : (
                    <View style={{ marginBottom: 20 }}>
                        <View style={styles.placeSearchBar}>
                            <Ionicons name="search" size={16} color="#94A3B8" />
                            <TextInput
                                value={placeQuery}
                                onChangeText={handlePlaceQueryChange}
                                placeholder="Search the place on Google Maps…"
                                placeholderTextColor="#94A3B8"
                                style={styles.placeSearchInput}
                            />
                            {searchingPlace && <ActivityIndicator size="small" color="#94A3B8" />}
                        </View>
                        {placeResults.length > 0 && (
                            <View style={styles.placeResultsBox}>
                                {placeResults.map((p, i) => (
                                    <TouchableOpacity
                                        key={p.placeId}
                                        style={[styles.placeResultItem, i > 0 && styles.placeResultBorder]}
                                        onPress={() => selectPlace(p)}
                                        activeOpacity={0.7}
                                    >
                                        <Ionicons name="location-outline" size={16} color={theme.colors.primary} />
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.placeResultName} numberOfLines={1}>{p.name}</Text>
                                            <Text style={styles.placeResultAddr} numberOfLines={1}>{p.address}</Text>
                                        </View>
                                        {p.rating != null && (
                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                                                <Ionicons name="star" size={11} color="#F59E0B" />
                                                <Text style={styles.placeResultRating}>{p.rating}</Text>
                                            </View>
                                        )}
                                    </TouchableOpacity>
                                ))}
                            </View>
                        )}
                        <Text style={styles.placeSearchHint}>
                            Link a Google Maps place to auto-fill name, address & location — and avoid duplicates
                        </Text>
                    </View>
                )}

                {/* ---- Duplicate block banner ---- */}
                {dupExisting && (
                    <TouchableOpacity
                        style={styles.dupBanner}
                        activeOpacity={0.85}
                        onPress={() => goToExisting(dupExisting)}
                    >
                        <Ionicons name="alert-circle" size={18} color="#B45309" />
                        <Text style={styles.dupBannerText}>
                            Already recommended by {dupExisting.authorName}. Each place can only be added once — tap to add your own photos, like, or comment.
                        </Text>
                        <Ionicons name="chevron-forward" size={16} color="#B45309" />
                    </TouchableOpacity>
                )}

                {/* ---- Photo Picker (up to 4) ---- */}
                {photos.length === 0 ? (
                    <TouchableOpacity style={styles.photoArea} onPress={pickPhoto} activeOpacity={0.7}>
                        <Ionicons name="camera-outline" size={36} color={theme.colors.textMuted} />
                        <Text style={styles.photoLabel}>Add Photos</Text>
                        <Text style={styles.photoHint}>Up to 4 · select several at once</Text>
                    </TouchableOpacity>
                ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
                        {photos.map((p, i) => (
                            <View key={i} style={styles.photoThumbWrap}>
                                <Image source={{ uri: p }} style={styles.photoThumb} resizeMode="cover" />
                                <TouchableOpacity style={styles.photoThumbRemove} onPress={() => removePhoto(i)}>
                                    <Ionicons name="close-circle" size={22} color="#fff" />
                                </TouchableOpacity>
                            </View>
                        ))}
                        {photos.length < 4 && (
                            <TouchableOpacity style={styles.photoAddMore} onPress={pickPhoto} activeOpacity={0.7}>
                                <Ionicons name="add" size={28} color={theme.colors.textMuted} />
                                <Text style={styles.photoAddMoreText}>{photos.length}/4</Text>
                            </TouchableOpacity>
                        )}
                    </ScrollView>
                )}

                {/* ---- Category Chips ---- */}
                <Text style={styles.sectionLabel}>Category</Text>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.categoryScroll}
                >
                    {LOCAL_CATEGORIES.map(cat => {
                        const isSelected = category === cat.key;
                        return (
                            <TouchableOpacity
                                key={cat.key}
                                style={[
                                    styles.categoryChip,
                                    isSelected && { backgroundColor: cat.gradient[0] },
                                ]}
                                onPress={() => setCategory(cat.key)}
                                activeOpacity={0.8}
                            >
                                <Ionicons
                                    name={cat.icon as any}
                                    size={16}
                                    color={isSelected ? '#fff' : theme.colors.textSecondary}
                                />
                                <Text
                                    style={[
                                        styles.categoryChipText,
                                        isSelected && styles.categoryChipTextActive,
                                    ]}
                                >
                                    {cat.label}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>

                {/* Cuisine is detected automatically by AI on post (Restaurants) */}
                {category === 'restaurant' && (
                    <View style={styles.aiCuisineHint}>
                        <Ionicons name="sparkles" size={13} color="#8B5CF6" />
                        <Text style={styles.aiCuisineHintText}>
                            Cuisine type (Korean, Japanese, Burgers…) is detected automatically when you post
                        </Text>
                    </View>
                )}

                {/* ---- Title Input ---- */}
                <TextInput
                    style={styles.input}
                    placeholder="Place name"
                    placeholderTextColor={theme.colors.textMuted}
                    value={title}
                    onChangeText={setTitle}
                    maxLength={100}
                    returnKeyType="next"
                />

                {/* ---- Description Input ---- */}
                <TextInput
                    style={[styles.input, styles.descInput]}
                    placeholder="Tell us about this place..."
                    placeholderTextColor={theme.colors.textMuted}
                    value={description}
                    onChangeText={setDescription}
                    multiline
                    textAlignVertical="top"
                    maxLength={1000}
                />

                {/* ---- Location Section ---- */}
                <Text style={styles.sectionLabel}>Location</Text>

                {/* Map preview + open picker */}
                <TouchableOpacity
                    style={styles.mapContainer}
                    activeOpacity={0.9}
                    onPress={() => navigation.navigate('MapPicker', {
                        initialLat: latitude,
                        initialLng: longitude,
                    })}
                >
                    <MapView
                        ref={mapRef}
                        style={styles.map}
                        provider={PROVIDER_GOOGLE}
                        initialRegion={{
                            latitude,
                            longitude,
                            latitudeDelta: 0.005,
                            longitudeDelta: 0.005,
                        }}
                        scrollEnabled={false}
                        zoomEnabled={false}
                        rotateEnabled={false}
                        pitchEnabled={false}
                    >
                        <Marker coordinate={{ latitude, longitude }} />
                    </MapView>
                    {/* Overlay tap hint */}
                    <View style={styles.mapOverlay}>
                        <Ionicons name="expand-outline" size={20} color="#fff" />
                        <Text style={styles.mapOverlayText}>Tap to select location</Text>
                    </View>
                </TouchableOpacity>

                {address.length > 0 && (
                    <View style={styles.addressRow}>
                        <Ionicons name="location" size={16} color={theme.colors.primary} />
                        <Text style={styles.addressText} numberOfLines={2}>
                            {address}
                        </Text>
                    </View>
                )}

                <TextInput
                    style={styles.input}
                    placeholder="Detail address (optional)"
                    placeholderTextColor={theme.colors.textMuted}
                    value={detailAddress}
                    onChangeText={setDetailAddress}
                    maxLength={200}
                />

                {/* Bottom spacer */}
                <View style={{ height: 40 }} />
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#FFFFFF',
    },
    // ---- Header ----
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: theme.spacing.md,
        paddingTop: Platform.OS === 'ios' ? 56 : 36,
        paddingBottom: 12,
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
    },
    closeBtn: {
        padding: 4,
    },
    headerTitle: {
        ...theme.typography.h3,
        color: theme.colors.textPrimary,
    },
    postBtn: {
        backgroundColor: '#10B981',
        paddingHorizontal: 22,
        paddingVertical: 9,
        borderRadius: 9999,
        minWidth: 72,
        alignItems: 'center',
        justifyContent: 'center',
    },
    postBtnDisabled: {
        opacity: 0.4,
    },
    postBtnText: {
        color: '#fff',
        fontWeight: '700',
        fontSize: 15,
    },

    // ---- Scroll ----
    scroll: {
        flex: 1,
    },
    scrollContent: {
        padding: theme.spacing.md,
    },

    // ---- Photo ----
    photoArea: {
        height: 120,
        borderRadius: r(14),
        borderWidth: 2,
        borderColor: theme.colors.border,
        borderStyle: 'dashed',
        backgroundColor: '#F8FAFC',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 20,
        gap: 4,
    },
    photoLabel: {
        fontSize: 15,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        marginTop: 4,
    },
    photoHint: {
        fontSize: 12,
        color: theme.colors.textMuted,
    },
    photoPreviewWrap: {
        position: 'relative',
        marginBottom: 20,
        borderRadius: r(14),
        overflow: 'hidden',
    },
    photoPreview: {
        width: '100%',
        height: 200,
        borderRadius: r(14),
    },
    photoRemoveBtn: {
        position: 'absolute',
        top: 8,
        right: 8,
        backgroundColor: 'rgba(0,0,0,0.45)',
        borderRadius: 14,
    },
    photoRow: {
        gap: 10,
        paddingBottom: 20,
    },
    photoThumbWrap: {
        position: 'relative',
        borderRadius: r(12),
        overflow: 'hidden',
    },
    photoThumb: {
        width: 110,
        height: 110,
        borderRadius: r(12),
    },
    photoThumbRemove: {
        position: 'absolute',
        top: 5,
        right: 5,
        backgroundColor: 'rgba(0,0,0,0.45)',
        borderRadius: 11,
    },
    photoAddMore: {
        width: 110,
        height: 110,
        borderRadius: r(12),
        borderWidth: 1.5,
        borderColor: '#E2E8F0',
        borderStyle: 'dashed',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 2,
    },
    photoAddMoreText: {
        fontSize: 11,
        fontWeight: '600',
        color: theme.colors.textMuted,
    },

    // ---- Google Place Link ----
    linkedCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: '#F0FDF4',
        borderWidth: 1.5,
        borderColor: '#BBF7D0',
        borderRadius: r(14),
        padding: 14,
        marginBottom: 20,
    },
    linkedIcon: {
        width: 38,
        height: 38,
        borderRadius: 12,
        backgroundColor: '#10B981',
        justifyContent: 'center',
        alignItems: 'center',
    },
    linkedName: {
        fontSize: 15,
        fontWeight: '800',
        color: '#0F172A',
    },
    linkedRating: {
        fontSize: 12,
        fontWeight: '600',
        color: '#92400E',
    },
    linkedAddress: {
        fontSize: 11,
        color: '#64748B',
        marginTop: 2,
    },
    linkedBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        marginTop: 4,
    },
    linkedBadgeText: {
        fontSize: 10,
        fontWeight: '700',
        color: '#10B981',
    },
    placeSearchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#F1F5F9',
        borderRadius: r(12),
        paddingHorizontal: 12,
        paddingVertical: 11,
    },
    placeSearchInput: {
        flex: 1,
        fontSize: 14,
        color: '#1E293B',
        padding: 0,
    },
    placeResultsBox: {
        backgroundColor: '#fff',
        borderRadius: r(12),
        borderWidth: 1,
        borderColor: '#E2E8F0',
        marginTop: 6,
        overflow: 'hidden',
    },
    placeResultItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    placeResultBorder: {
        borderTopWidth: 1,
        borderTopColor: '#F1F5F9',
    },
    placeResultName: {
        fontSize: 13,
        fontWeight: '700',
        color: '#1E293B',
    },
    placeResultAddr: {
        fontSize: 11,
        color: '#94A3B8',
        marginTop: 1,
    },
    placeResultRating: {
        fontSize: 12,
        fontWeight: '700',
        color: '#92400E',
    },
    placeSearchHint: {
        fontSize: 11,
        color: '#94A3B8',
        marginTop: 6,
        marginLeft: 2,
    },

    // ---- Duplicate block banner ----
    dupBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#FFFBEB',
        borderWidth: 1.5,
        borderColor: '#FDE68A',
        borderRadius: r(12),
        paddingHorizontal: 12,
        paddingVertical: 11,
        marginTop: -8,
        marginBottom: 20,
    },
    dupBannerText: {
        flex: 1,
        fontSize: 12,
        fontWeight: '600',
        color: '#92400E',
        lineHeight: 16,
    },

    // ---- Category ----
    sectionLabel: {
        ...theme.typography.caption,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        marginBottom: 10,
        marginTop: 4,
    },
    categoryScroll: {
        gap: 8,
        paddingBottom: 16,
    },
    categoryChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 9999,
        backgroundColor: '#F1F5F9',
    },
    aiCuisineHint: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#F5F3FF',
        borderRadius: r(10),
        paddingHorizontal: 12,
        paddingVertical: 9,
        marginBottom: 16,
    },
    aiCuisineHintText: {
        flex: 1,
        fontSize: 12,
        fontWeight: '500',
        color: '#6D28D9',
        lineHeight: 16,
    },
    categoryChipText: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textSecondary,
    },
    categoryChipTextActive: {
        color: '#fff',
    },

    // ---- Inputs ----
    input: {
        backgroundColor: '#F1F5F9',
        borderRadius: r(12),
        paddingHorizontal: 16,
        paddingVertical: 14,
        fontSize: 14,
        color: theme.colors.textPrimary,
        marginBottom: 14,
    },
    descInput: {
        minHeight: 100,
        textAlignVertical: 'top',
    },

    // ---- Map ----
    mapContainer: {
        height: 200,
        borderRadius: r(14),
        overflow: 'hidden',
        marginBottom: 10,
    },
    map: {
        flex: 1,
    },
    mapOverlay: {
        position: 'absolute',
        bottom: 12,
        right: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(0,0,0,0.55)',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
    },
    mapOverlayText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#fff',
    },

    // ---- Address ----
    addressRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 6,
        paddingHorizontal: 4,
        marginBottom: 12,
    },
    addressText: {
        flex: 1,
        fontSize: 13,
        color: theme.colors.textSecondary,
        lineHeight: 18,
    },
});
