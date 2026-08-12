import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, TextInput, Image,
    Dimensions, Platform, Animated, PanResponder, ScrollView, StatusBar, Modal, Keyboard, ActivityIndicator, Linking, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { theme, r } from '../theme/theme';
import { db, auth } from '../config/firebase';
import {
    collection, query, onSnapshot, doc, setDoc, deleteDoc,
    updateDoc, increment, getDoc, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { sendPushToUser } from '../utils/notifications';
import { LOCAL_CATEGORIES, CUISINES, cuisineLabel } from '../components/LocalGuideCards';
import { RecommendationComments } from '../components/RecommendationComments';
import { openDirections } from '../utils/maps';
import { GooglePlaceChip } from '../components/GooglePlaceChip';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const DEFAULT_LAT = 37.3815;
const DEFAULT_LNG = 126.6565;

// Fixed "home" view of Songdo. The Local Guide map ALWAYS opens here (once per
// open) and the Local tab double-tap recenters here — so a tip posted in another
// part of Korea never zooms the initial view out to the whole country.
const SONGDO_REGION = {
    latitude: 37.3885,
    longitude: 126.6495,
    latitudeDelta: 0.036,
    longitudeDelta: 0.028,
};
const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';

const SHEET_PEEK = 160;
const SHEET_MID = SCREEN_H * 0.55;
const SHEET_FULL = SCREEN_H - 110;
const SAFE_TOP = Platform.OS === 'ios' ? 56 : 36;

interface GuideItem {
    id: string;
    title: string;
    description: string;
    category: string;
    cuisine?: string | null;
    photo?: string;
    photos?: string[];
    latitude?: number;
    longitude?: number;
    address?: string;
    placeId?: string | null;
    authorId?: string;
    authorName: string;
    likes: number;
    createdAt: any;
}

interface PlaceResult {
    id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
}

const MARKER_STYLE: Record<string, { bg: string; icon: string }> = {
    restaurant: { bg: '#F43F5E', icon: 'restaurant' },
    cafe:       { bg: '#D97706', icon: 'cafe' },
    shops:      { bg: '#8B5CF6', icon: 'storefront' },
    hospital:   { bg: '#10B981', icon: 'medkit' },
    vet:        { bg: '#06B6D4', icon: 'paw' },
    kids:       { bg: '#EC4899', icon: 'people' },
    tips:       { bg: '#F59E0B', icon: 'bulb' },
    shopping:   { bg: '#6366F1', icon: 'bag-handle' },
    hiking:     { bg: '#65A30D', icon: 'walk' },
    fitness:    { bg: '#0EA5E9', icon: 'barbell' },
    learning:   { bg: '#0D9488', icon: 'book' },
    selfcare:   { bg: '#C026D3', icon: 'water' },
};
const DEFAULT_MARKER = { bg: '#6366F1', icon: 'location' };

interface PoiReview {
    author: string;
    authorPhoto?: string;
    rating: number;
    text: string;
    when: string;
}

interface PoiDetails {
    rating?: number;
    totalRatings?: number;
    address?: string;
    photoUrl?: string;
    openNow?: boolean;
    types?: string[];
    phone?: string;
    website?: string;
    reviews?: PoiReview[];
}

// Module-level cache: Places API charges per request, so reuse details across taps & remounts
const placeDetailsCache = new Map<string, PoiDetails>();

export function LocalMapScreen({ navigation, route }: any) {
    const [guides, setGuides] = useState<GuideItem[]>([]);
    const [search, setSearch] = useState('');
    const [selectedGuide, setSelectedGuide] = useState<GuideItem | null>(null);
    const [showFavorites, setShowFavorites] = useState(false);
    const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
    const [activeCategory, setActiveCategory] = useState<string | null>('all');
    const [showPicks, setShowPicks] = useState(false);
    const [picksCuisine, setPicksCuisine] = useState<string | null>(null);

    // First-visit onboarding popup
    const [showOnboarding, setShowOnboarding] = useState(false);
    useEffect(() => {
        AsyncStorage.getItem('@local_guide_onboarded').then(v => {
            if (!v) setShowOnboarding(true);
        }).catch(() => {});
    }, []);
    const dismissOnboarding = () => {
        setShowOnboarding(false);
        AsyncStorage.setItem('@local_guide_onboarded', 'true').catch(() => {});
    };
    // Android: custom marker views must keep "tracking" until their Ionicons glyph
    // + layout have painted, otherwise tracksViewChanges=false freezes a half-drawn
    // bitmap (icon/pin head missing → only the CSS arrow shows). Track for a moment
    // after the marker set changes, then freeze for performance.
    const [tracksMarkers, setTracksMarkers] = useState(true);

    const [sheetPosition, setSheetPosition] = useState<'peek' | 'mid' | 'full'>('peek');
    const [sheetDetail, setSheetDetail] = useState<GuideItem | null>(null);
    const [photoViewerUri, setPhotoViewerUri] = useState<string | null>(null);
    const [visibleRegion, setVisibleRegion] = useState<{ lat: number; lng: number; latD: number; lngD: number } | null>(null);
    const [placeResults, setPlaceResults] = useState<PlaceResult[]>([]);
    const [showPlaceResults, setShowPlaceResults] = useState(false);
    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mapRef = useRef<MapView>(null);
    const popupScale = useRef(new Animated.Value(0)).current;
    const popupOpacity = useRef(new Animated.Value(0)).current;

    // ─── StatusBar: dark on this screen (white bg) ───
    useFocusEffect(
        useCallback(() => {
            StatusBar.setBarStyle('dark-content', true);
            return () => StatusBar.setBarStyle('dark-content', true);
        }, [])
    );

    // ─── Real GPS Location ───
    const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') return;
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
            if (cancelled) return;
            const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
            setUserLocation(coords);
        })();
        return () => { cancelled = true; };
    }, []);

    // ─── POI (Google Maps built-in places) ───
    const [selectedPoi, setSelectedPoi] = useState<({
        name: string;
        coordinate: { latitude: number; longitude: number };
        placeId: string;
    } & PoiDetails) | null>(null);

    const fetchPlaceDetails = async (placeId: string, name: string, coordinate: { latitude: number; longitude: number }) => {
        // Show basic info immediately; reuse cached details to skip a paid API call
        const cached = placeDetailsCache.get(placeId);
        setSelectedPoi({ name, coordinate, placeId, ...cached });
        if (cached) return;
        try {
            // Places API (New) — the legacy Place Details API is disabled on this project
            const fields = 'rating,userRatingCount,formattedAddress,currentOpeningHours.openNow,photos,types,internationalPhoneNumber,websiteUri,reviews';
            const res = await fetch(
                `https://places.googleapis.com/v1/places/${placeId}?fields=${fields}&languageCode=en&key=${GOOGLE_MAPS_KEY}`
            );
            const r = await res.json();
            if (r && !r.error) {
                const photoUrl = r.photos?.[0]?.name
                    ? `https://places.googleapis.com/v1/${r.photos[0].name}/media?maxWidthPx=800&key=${GOOGLE_MAPS_KEY}`
                    : '';
                const details: PoiDetails = {
                    rating: r.rating,
                    totalRatings: r.userRatingCount,
                    address: r.formattedAddress,
                    photoUrl,
                    openNow: r.currentOpeningHours?.openNow,
                    types: r.types,
                    phone: r.internationalPhoneNumber,
                    website: r.websiteUri,
                    reviews: (r.reviews || []).slice(0, 3).map((rv: any) => ({
                        author: rv.authorAttribution?.displayName || 'Google user',
                        authorPhoto: rv.authorAttribution?.photoUri,
                        rating: rv.rating || 0,
                        text: rv.text?.text || '',
                        when: rv.relativePublishTimeDescription || '',
                    })),
                };
                placeDetailsCache.set(placeId, details);
                // Only merge into the card if the user is still looking at this place
                setSelectedPoi(prev => prev && prev.placeId === placeId ? { ...prev, ...details } : prev);
            }
        } catch {}
    };

    // ─── Bottom Sheet ───
    const sheetY = useRef(new Animated.Value(SCREEN_H - SHEET_PEEK)).current;
    const lastSnap = useRef(SCREEN_H - SHEET_PEEK);
    const sheetScrollRef = useRef<ScrollView>(null);

    // Keyboard padding so the comment input stays visible above the keyboard
    const [kbPad, setKbPad] = useState(0);
    useEffect(() => {
        const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
        const s = Keyboard.addListener(showEvt, e => setKbPad(e.endCoordinates.height));
        const h = Keyboard.addListener(hideEvt, () => setKbPad(0));
        return () => { s.remove(); h.remove(); };
    }, []);

    const expandSheetForComment = () => {
        lastSnap.current = SCREEN_H - SHEET_FULL;
        setSheetPosition('full');
        Animated.spring(sheetY, {
            toValue: SCREEN_H - SHEET_FULL,
            useNativeDriver: false, tension: 80, friction: 12,
        }).start();
        setTimeout(() => sheetScrollRef.current?.scrollToEnd({ animated: true }), 400);
    };

    const panResponder = useMemo(() => PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8,
        onPanResponderGrant: () => {
            sheetY.setOffset(lastSnap.current);
            sheetY.setValue(0);
        },
        onPanResponderMove: Animated.event([null, { dy: sheetY }], { useNativeDriver: false }),
        onPanResponderRelease: (_, g) => {
            sheetY.flattenOffset();
            const current = lastSnap.current + g.dy;
            const vy = g.vy;
            let target: number;
            if (vy > 0.5) {
                target = current < SCREEN_H - SHEET_MID ? SCREEN_H - SHEET_MID : SCREEN_H - SHEET_PEEK;
            } else if (vy < -0.5) {
                target = current > SCREEN_H - SHEET_MID ? SCREEN_H - SHEET_MID : SCREEN_H - SHEET_FULL;
            } else {
                const snaps = [SCREEN_H - SHEET_FULL, SCREEN_H - SHEET_MID, SCREEN_H - SHEET_PEEK];
                target = snaps.reduce((p, s) => Math.abs(current - s) < Math.abs(current - p) ? s : p);
            }
            lastSnap.current = target;
            if (target === SCREEN_H - SHEET_PEEK) setSheetPosition('peek');
            else if (target === SCREEN_H - SHEET_MID) setSheetPosition('mid');
            else setSheetPosition('full');
            Animated.spring(sheetY, { toValue: target, useNativeDriver: false, tension: 80, friction: 12 }).start();
        },
    }), []);

    // ─── Edge Swipe Back Gesture ───
    const sheetDetailRef = useRef(sheetDetail);
    const activeCategoryRef = useRef(activeCategory);
    const showPicksRef = useRef(showPicks);
    sheetDetailRef.current = sheetDetail;
    activeCategoryRef.current = activeCategory;
    showPicksRef.current = showPicks;

    const swipeBackPan = useMemo(() => PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => g.dx > 15 && Math.abs(g.dy) < 30,
        onPanResponderRelease: (_, g) => {
            if (g.dx > 60) {
                if (sheetDetailRef.current) {
                    setSheetDetail(null);
                } else if (showPicksRef.current) {
                    setShowPicks(false);
                } else if (activeCategoryRef.current) {
                    setActiveCategory(null);
                } else {
                    navigation.goBack();
                }
            }
        },
    }), []);

    // ─── Firestore ───
    useEffect(() => {
        const q = query(collection(db, 'local_recommendations'));
        return onSnapshot(q, snap => {
            const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as GuideItem));
            items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            setGuides(items);
        }, () => {});
    }, []);

    // ─── User Favorites ───
    useEffect(() => {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        const favRef = collection(db, 'users', uid, 'map_favorites');
        return onSnapshot(favRef, snap => {
            setFavoriteIds(new Set(snap.docs.map(d => d.id)));
        }, () => {});
    }, []);

    const toggleFavorite = async (guideId: string) => {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        const ref = doc(db, 'users', uid, 'map_favorites', guideId);
        if (favoriteIds.has(guideId)) {
            await deleteDoc(ref);
        } else {
            await setDoc(ref, { createdAt: new Date() });
        }
    };

    // Keep the open popup/sheet in sync with live Firestore data (likes count, edits)
    useEffect(() => {
        if (selectedGuide) {
            const updated = guides.find(g => g.id === selectedGuide.id);
            if (updated && JSON.stringify(updated) !== JSON.stringify(selectedGuide)) setSelectedGuide(updated);
        }
        if (sheetDetail) {
            const updated = guides.find(g => g.id === sheetDetail.id);
            if (updated && JSON.stringify(updated) !== JSON.stringify(sheetDetail)) setSheetDetail(updated);
        }
    }, [guides]);

    // ─── Likes (same data as LocalGuideScreen: local_recommendations/{id}/likes/{uid}) ───
    const [likedIds, setLikedIds] = useState<Set<string>>(new Set());

    // Live set of recs this user liked (users/{uid}/liked_recs mirror, kept in
    // sync by toggleLike here and in LocalGuideScreen)
    useEffect(() => {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        return onSnapshot(collection(db, 'users', uid, 'liked_recs'), snap => {
            setLikedIds(new Set(snap.docs.map(d => d.id)));
        }, () => {});
    }, []);

    const toggleLike = async (guide: GuideItem) => {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        const likeRef = doc(db, 'local_recommendations', guide.id, 'likes', uid);
        const recRef = doc(db, 'local_recommendations', guide.id);
        const mirrorRef = doc(db, 'users', uid, 'liked_recs', guide.id);
        if (likedIds.has(guide.id)) {
            setLikedIds(prev => { const next = new Set(prev); next.delete(guide.id); return next; });
            try {
                await deleteDoc(likeRef);
                await updateDoc(recRef, { likes: increment(-1) });
                await deleteDoc(mirrorRef);
            } catch {}
        } else {
            setLikedIds(prev => new Set(prev).add(guide.id));
            try {
                await setDoc(likeRef, { userId: uid, createdAt: new Date() });
                await setDoc(mirrorRef, { createdAt: new Date() });
                await updateDoc(recRef, { likes: increment(1) });
                const user = auth.currentUser;
                if (user && guide.authorId && guide.authorId !== uid) {
                    const likeTitle = `${user.displayName || 'Someone'} liked your recommendation`;
                    const likeBody = (guide.title || '').substring(0, 80);
                    addDoc(collection(db, 'dolphin_notifications'), {
                        recipientId: guide.authorId,
                        type: 'like',
                        title: likeTitle,
                        body: likeBody,
                        createdAt: serverTimestamp(),
                        read: false,
                    }).catch(() => {});
                    sendPushToUser(guide.authorId, likeTitle, likeBody, { type: 'like' });
                }
            } catch {}
        }
    };

    // Card used in the Community Picks list (focuses the map + opens detail)
    const renderPicksCard = (item: GuideItem) => (
        <TouchableOpacity
            key={item.id}
            style={styles.postCard}
            activeOpacity={0.9}
            onPress={() => {
                if (item.latitude && item.longitude) {
                    const LAT_DELTA = 0.006;
                    const latOffset = (SHEET_MID / 2 / SCREEN_H) * LAT_DELTA;
                    mapRef.current?.animateToRegion({
                        latitude: item.latitude - latOffset,
                        longitude: item.longitude,
                        latitudeDelta: LAT_DELTA,
                        longitudeDelta: LAT_DELTA,
                    }, 400);
                }
                setSheetDetail(item);
                lastSnap.current = SCREEN_H - SHEET_MID;
                setSheetPosition('mid');
                Animated.spring(sheetY, {
                    toValue: SCREEN_H - SHEET_MID,
                    useNativeDriver: false, tension: 80, friction: 12,
                }).start();
            }}
        >
            {(item.photos?.[0] || item.photo) && (
                <Image
                    source={{ uri: item.photos?.[0] || item.photo }}
                    style={styles.postImage}
                />
            )}
            <View style={styles.postInfo}>
                <Text style={styles.postTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.postDesc} numberOfLines={2}>{item.description}</Text>
                <View style={styles.postBottom}>
                    <View style={styles.postMeta}>
                        <Ionicons name="heart" size={12} color="#EF4444" />
                        <Text style={styles.postMetaText}>{item.likes || 0}</Text>
                        <Text style={styles.postMetaDot}>·</Text>
                        <Text style={styles.postMetaText}>{item.authorName}</Text>
                    </View>
                    {item.latitude && (
                        <View style={styles.postLocationTag}>
                            <Ionicons name="location" size={10} color="#10B981" />
                            <Text style={styles.postLocationText}>Map</Text>
                        </View>
                    )}
                </View>
            </View>
        </TouchableOpacity>
    );

    const deleteGuide = (guide: GuideItem) => {
        if (guide.authorId !== auth.currentUser?.uid) return;
        Alert.alert('Delete', 'Delete this recommendation?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete', style: 'destructive',
                onPress: async () => {
                    try {
                        await deleteDoc(doc(db, 'local_recommendations', guide.id));
                        setSheetDetail(null);
                        if (selectedGuide?.id === guide.id) setSelectedGuide(null);
                    } catch {}
                },
            },
        ]);
    };

    const editGuide = (guide: GuideItem) => {
        const cat = LOCAL_CATEGORIES.find(c => c.key === guide.category);
        if (!cat) return;
        setSheetDetail(null);
        navigation.navigate('LocalGuide', { category: cat, openItemId: guide.id, startEdit: true });
    };

    // Open the actual full post (LocalGuide detail) for a guide
    const openFullPost = (guide: GuideItem) => {
        const cat = LOCAL_CATEGORIES.find(c => c.key === guide.category);
        if (!cat) return;
        navigation.navigate('LocalGuide', { category: cat, openItemId: guide.id });
    };

    // Collapse the sheet and zoom the map onto this guide's pin
    const showOnMap = (guide: GuideItem) => {
        if (!guide.latitude || !guide.longitude) return;
        Keyboard.dismiss();
        const LAT_DELTA = 0.004;
        // Keep the pin centered in the visible area above the peeked sheet
        const latOffset = (SHEET_PEEK / 2 / SCREEN_H) * LAT_DELTA;
        mapRef.current?.animateToRegion({
            latitude: guide.latitude - latOffset,
            longitude: guide.longitude,
            latitudeDelta: LAT_DELTA,
            longitudeDelta: LAT_DELTA,
        }, 450);
        lastSnap.current = SCREEN_H - SHEET_PEEK;
        setSheetPosition('peek');
        Animated.spring(sheetY, {
            toValue: SCREEN_H - SHEET_PEEK,
            useNativeDriver: false, tension: 80, friction: 12,
        }).start();
    };

    const locatedGuides = guides.filter(g => g.latitude && g.longitude);
    const displayedGuides = locatedGuides.filter(g => {
        // Always show the currently selected or detail item
        if (sheetDetail?.id === g.id || selectedGuide?.id === g.id) return true;
        // If favorites mode: show only favorited
        if (showFavorites) return favoriteIds.has(g.id);
        // If no category selected: show nothing (clean map)
        if (!activeCategory) return false;
        // 'all' shows everything
        if (activeCategory === 'all') return true;
        // Otherwise filter by category
        return g.category === activeCategory;
    });

    // Re-enable marker tracking briefly whenever the visible marker set changes,
    // so freshly mounted custom markers capture a fully-painted bitmap (Android).
    useEffect(() => {
        setTracksMarkers(true);
        const t = setTimeout(() => setTracksMarkers(false), 2200);
        return () => clearTimeout(t);
    }, [displayedGuides.length, displayedGuides.map(g => g.category).join(',')]);

    // Guides visible in current map viewport (Airbnb-style list), nearest to center first
    const visibleGuides = visibleRegion ? locatedGuides.filter(g => {
        const halfLat = visibleRegion.latD / 2;
        const halfLng = visibleRegion.lngD / 2;
        return (
            g.latitude! >= visibleRegion.lat - halfLat &&
            g.latitude! <= visibleRegion.lat + halfLat &&
            g.longitude! >= visibleRegion.lng - halfLng &&
            g.longitude! <= visibleRegion.lng + halfLng
        );
    }).sort((a, b) => {
        const dA = Math.hypot(a.latitude! - visibleRegion.lat, a.longitude! - visibleRegion.lng);
        const dB = Math.hypot(b.latitude! - visibleRegion.lat, b.longitude! - visibleRegion.lng);
        return dA - dB;
    }) : locatedGuides;

    // Bottom-sheet list: 'all' follows the map viewport (every type in view),
    // a specific category lists all posts in that category
    const sheetGuides = activeCategory === 'all'
        ? visibleGuides
        : activeCategory
            ? guides.filter(g => g.category === activeCategory)
            : [];

    // ─── Initial view: ALWAYS open on the fixed Songdo region ───
    // The map's initialRegion is SONGDO_REGION, so it starts there with no zoom-out.
    // We intentionally do NOT fit-to-all-pins anymore (a tip posted elsewhere in
    // Korea used to zoom the whole country into view on first load).

    // ─── Local tab double-tap → recenter to the Songdo home view ───
    const resetAppliedRef = useRef<number>(0);
    useEffect(() => {
        const ts = route?.params?.resetMapTs;
        if (!ts || ts === resetAppliedRef.current) return;
        resetAppliedRef.current = ts;
        setShowPicks(false);
        setSelectedPoi(null);
        if (selectedGuide) dismissPopup();
        mapRef.current?.animateToRegion(SONGDO_REGION, 500);
    }, [route?.params?.resetMapTs]);

    // ─── Focus a specific item (navigated from LocalGuide "View on Map") ───
    const focusAppliedRef = useRef<string | null>(null);
    useEffect(() => {
        const fid = route?.params?.focusItemId;
        if (!fid || guides.length === 0) return;
        const key = `${fid}_${route?.params?.focusTs || ''}`;
        if (focusAppliedRef.current === key) return;
        const item = guides.find(g => g.id === fid);
        if (!item) return;
        focusAppliedRef.current = key;
        setShowPicks(false);
        if (item.latitude && item.longitude) {
            const LAT_DELTA = 0.006;
            const latOffset = (SHEET_MID / 2 / SCREEN_H) * LAT_DELTA;
            mapRef.current?.animateToRegion({
                latitude: item.latitude - latOffset,
                longitude: item.longitude,
                latitudeDelta: LAT_DELTA,
                longitudeDelta: LAT_DELTA,
            }, 500);
        }
        setSheetDetail(item);
        lastSnap.current = SCREEN_H - SHEET_MID;
        setSheetPosition('mid');
        Animated.spring(sheetY, {
            toValue: SCREEN_H - SHEET_MID,
            useNativeDriver: false, tension: 80, friction: 12,
        }).start();
    }, [guides.length, route?.params?.focusItemId, route?.params?.focusTs]);

    // Nearby guides for detail view (within ~500m)
    const nearbyGuides = sheetDetail ? locatedGuides.filter(g =>
        g.id !== sheetDetail.id &&
        Math.abs(g.latitude! - (sheetDetail.latitude || 0)) < 0.005 &&
        Math.abs(g.longitude! - (sheetDetail.longitude || 0)) < 0.005
    ) : [];

    const handleMyLocation = async () => {
        if (userLocation) {
            mapRef.current?.animateToRegion({
                latitude: userLocation.latitude,
                longitude: userLocation.longitude,
                latitudeDelta: 0.008,
                longitudeDelta: 0.008,
            }, 500);
        } else {
            try {
                const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
                const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
                setUserLocation(coords);
                mapRef.current?.animateToRegion({
                    ...coords,
                    latitudeDelta: 0.008,
                    longitudeDelta: 0.008,
                }, 500);
            } catch {
                mapRef.current?.animateToRegion({
                    latitude: DEFAULT_LAT,
                    longitude: DEFAULT_LNG,
                    latitudeDelta: 0.008,
                    longitudeDelta: 0.008,
                }, 500);
            }
        }
    };

    // Zoom in/out around the current map center
    const zoomBy = (factor: number) => {
        const region = visibleRegion;
        if (!region) return;
        mapRef.current?.animateToRegion({
            latitude: region.lat,
            longitude: region.lng,
            latitudeDelta: Math.max(0.0006, Math.min(1.2, region.latD * factor)),
            longitudeDelta: Math.max(0.0006, Math.min(1.2, region.lngD * factor)),
        }, 200);
    };

    const handleMarkerPress = (guide: GuideItem) => {
        if (selectedGuide?.id === guide.id) return;
        setSelectedPoi(null);
        // If already open, close first then open new
        if (selectedGuide) {
            Animated.parallel([
                Animated.timing(popupScale, { toValue: 0, duration: 150, useNativeDriver: true }),
                Animated.timing(popupOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
            ]).start(() => {
                setSelectedGuide(guide);
                Animated.parallel([
                    Animated.spring(popupScale, { toValue: 1, useNativeDriver: true, tension: 65, friction: 8 }),
                    Animated.timing(popupOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
                ]).start();
            });
        } else {
            setSelectedGuide(guide);
            popupScale.setValue(0);
            popupOpacity.setValue(0);
            Animated.parallel([
                Animated.spring(popupScale, { toValue: 1, useNativeDriver: true, tension: 65, friction: 8 }),
                Animated.timing(popupOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
            ]).start();
        }
        lastSnap.current = SCREEN_H - SHEET_PEEK;
        setSheetPosition('peek');
        Animated.spring(sheetY, {
            toValue: SCREEN_H - SHEET_PEEK,
            useNativeDriver: false, tension: 80, friction: 12,
        }).start();
    };

    const dismissPopup = () => {
        Animated.parallel([
            Animated.timing(popupScale, { toValue: 0, duration: 200, useNativeDriver: true }),
            Animated.timing(popupOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]).start(() => setSelectedGuide(null));
    };

    // ─── Community Picks (grouped browse of every recommendation) ───
    const openPicks = () => {
        Keyboard.dismiss();
        setSheetDetail(null);
        setSelectedPoi(null);
        if (selectedGuide) dismissPopup();
        setPicksCuisine(null);
        setShowPicks(true);
        lastSnap.current = SCREEN_H - SHEET_FULL;
        setSheetPosition('full');
        Animated.spring(sheetY, {
            toValue: SCREEN_H - SHEET_FULL,
            useNativeDriver: false, tension: 80, friction: 12,
        }).start();
        setTimeout(() => sheetScrollRef.current?.scrollTo({ y: 0, animated: false }), 50);
    };

    const closePicks = () => {
        setShowPicks(false);
        bounceSheetToPeek();
    };

    // Bounce the sheet to draw attention, ending at peek — keep snap state in sync
    // so the next drag/scroll doesn't jump from a stale position
    const bounceSheetToPeek = () => {
        const peekY = SCREEN_H - SHEET_PEEK;
        lastSnap.current = peekY;
        setSheetPosition('peek');
        Animated.sequence([
            Animated.timing(sheetY, { toValue: peekY - 80, duration: 250, useNativeDriver: false }),
            Animated.spring(sheetY, { toValue: peekY, useNativeDriver: false, tension: 120, friction: 8 }),
        ]).start();
    };

    const handleCategoryPress = (cat: typeof LOCAL_CATEGORIES[0]) => {
        navigation.navigate('LocalGuide', { category: cat });
    };

    const getCatCount = (key: string) => guides.filter(g => g.category === key).length;

    const filteredCategories = search.trim()
        ? LOCAL_CATEGORIES.filter(c =>
            c.label.toLowerCase().includes(search.toLowerCase()) || c.labelKo.includes(search)
        )
        : LOCAL_CATEGORIES;

    // ─── Place Search (Nominatim) ───
    const [searching, setSearching] = useState(false);

    const doSearch = useCallback(async (text: string) => {
        if (text.trim().length < 2) {
            setPlaceResults([]);
            setShowPlaceResults(false);
            return;
        }
        setSearching(true);
        try {
            const encoded = encodeURIComponent(text + ' Songdo Incheon');
            const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=6&addressdetails=1&accept-language=en,ko`;
            const res = await fetch(url, { headers: { 'User-Agent': 'DolphinApp/1.0' } });
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                const mapped: PlaceResult[] = data.map((item: any) => ({
                    id: item.place_id?.toString() || `${item.lat}_${item.lon}`,
                    name: item.name || item.display_name?.split(',')[0] || text,
                    address: item.display_name || '',
                    lat: parseFloat(item.lat),
                    lng: parseFloat(item.lon),
                }));
                setPlaceResults(mapped);
                setShowPlaceResults(true);
            } else {
                // Fallback: search without location bias
                const res2 = await fetch(
                    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&limit=6&addressdetails=1&accept-language=en,ko`,
                    { headers: { 'User-Agent': 'DolphinApp/1.0' } }
                );
                const data2 = await res2.json();
                if (Array.isArray(data2) && data2.length > 0) {
                    const mapped: PlaceResult[] = data2.map((item: any) => ({
                        id: item.place_id?.toString() || `${item.lat}_${item.lon}`,
                        name: item.name || item.display_name?.split(',')[0] || text,
                        address: item.display_name || '',
                        lat: parseFloat(item.lat),
                        lng: parseFloat(item.lon),
                    }));
                    setPlaceResults(mapped);
                    setShowPlaceResults(true);
                } else {
                    setPlaceResults([]);
                    setShowPlaceResults(false);
                }
            }
        } catch {
            setPlaceResults([]);
            setShowPlaceResults(false);
        }
        setSearching(false);
    }, []);

    const searchPlaces = useCallback((text: string) => {
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        if (text.trim().length < 2) {
            setPlaceResults([]);
            setShowPlaceResults(false);
            return;
        }
        searchTimerRef.current = setTimeout(() => doSearch(text), 300);
    }, [doSearch]);

    const handleSearchChange = (text: string) => {
        setSearch(text);
        if (text.trim().length >= 2) {
            setSearching(true);
        }
        searchPlaces(text);
    };

    const handleSearchSubmit = () => {
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        if (search.trim().length >= 2) {
            doSearch(search);
        }
    };

    const handlePlaceSelect = (place: PlaceResult) => {
        setShowPlaceResults(false);
        setPlaceResults([]);
        setSearch('');
        Keyboard.dismiss();
        mapRef.current?.animateToRegion({
            latitude: place.lat,
            longitude: place.lng,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
        }, 500);
    };

    // Community recommendations matching the search text (shown above external places)
    const searchLower = search.trim().toLowerCase();
    const matchedGuides = searchLower.length >= 2
        ? locatedGuides.filter(g =>
            g.title?.toLowerCase().includes(searchLower) ||
            g.description?.toLowerCase().includes(searchLower)
        ).slice(0, 4)
        : [];

    const handleGuideSelect = (g: GuideItem) => {
        setShowPlaceResults(false);
        setPlaceResults([]);
        setSearch('');
        Keyboard.dismiss();
        const LAT_DELTA = 0.006;
        const latOffset = (SHEET_MID / 2 / SCREEN_H) * LAT_DELTA;
        mapRef.current?.animateToRegion({
            latitude: g.latitude! - latOffset,
            longitude: g.longitude!,
            latitudeDelta: LAT_DELTA,
            longitudeDelta: LAT_DELTA,
        }, 400);
        setSheetDetail(g);
        lastSnap.current = SCREEN_H - SHEET_MID;
        setSheetPosition('mid');
        Animated.spring(sheetY, {
            toValue: SCREEN_H - SHEET_MID,
            useNativeDriver: false, tension: 80, friction: 12,
        }).start();
    };

    // Clear pending search debounce on unmount
    useEffect(() => () => {
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    }, []);

    return (
        <View style={styles.container}>
            {/* ─── Left Edge Swipe Back Area ─── */}
            <View
                {...swipeBackPan.panHandlers}
                style={styles.edgeSwipeArea}
            />


            {/* ─── Google Maps ─── */}
            <MapView
                ref={mapRef}
                style={styles.map}
                provider={PROVIDER_GOOGLE}
                initialRegion={SONGDO_REGION}
                showsUserLocation={true}
                showsMyLocationButton={false}
                showsCompass={false}
                showsScale={false}
                showsTraffic={false}
                showsBuildings={false}
                showsIndoors={false}
                showsPointsOfInterest={true}
                mapType="standard"
                onRegionChangeComplete={(region) => {
                    setVisibleRegion({
                        lat: region.latitude,
                        lng: region.longitude,
                        latD: region.latitudeDelta,
                        lngD: region.longitudeDelta,
                    });
                }}
                onPoiClick={(e) => {
                    const { name, coordinate, placeId } = e.nativeEvent;
                    if (selectedGuide) dismissPopup();
                    fetchPlaceDetails(placeId, name, coordinate);
                    mapRef.current?.animateToRegion({
                        ...coordinate,
                        latitudeDelta: 0.004,
                        longitudeDelta: 0.004,
                    }, 300);
                }}
                onPress={() => {
                    setSelectedPoi(null);
                    if (selectedGuide) dismissPopup();
                }}
            >
                {displayedGuides.map(g => {
                    const m = MARKER_STYLE[g.category] || DEFAULT_MARKER;
                    return (
                        <Marker
                            key={g.id}
                            coordinate={{ latitude: g.latitude!, longitude: g.longitude! }}
                            onPress={() => handleMarkerPress(g)}
                            tracksViewChanges={tracksMarkers}
                            anchor={{ x: 0.5, y: 1 }}
                        >
                            <View style={styles.markerWrap}>
                                <View style={[styles.markerPin, { backgroundColor: m.bg }]}>
                                    <Ionicons name={m.icon as any} size={14} color="#fff" />
                                </View>
                                <View style={[styles.markerArrow, { borderTopColor: m.bg }]} />
                            </View>
                        </Marker>
                    );
                })}
                {/* Always mounted: conditionally adding/removing this marker while the
                    guide markers above change count crashes AIRGoogleMap's
                    insertReactSubview (stale insert index in the Fabric interop layer).
                    Park it invisibly at null island instead of unmounting. */}
                <Marker
                    key="__poi"
                    coordinate={selectedPoi?.coordinate ?? { latitude: 0, longitude: 0 }}
                    opacity={selectedPoi ? 1 : 0}
                    tracksViewChanges={false}
                />
            </MapView>

            {/* ─── POI Detail Card ─── */}
            {selectedPoi && (
                <View style={styles.poiCard}>
                    {/* Close button */}
                    <TouchableOpacity
                        style={styles.poiCardClose}
                        onPress={() => setSelectedPoi(null)}
                    >
                        <Ionicons name="close" size={18} color="#64748B" />
                    </TouchableOpacity>

                    <ScrollView
                        style={{ maxHeight: SCREEN_H * 0.48 }}
                        bounces={false}
                        showsVerticalScrollIndicator={false}
                    >
                        {/* Photo banner */}
                        {selectedPoi.photoUrl ? (
                            <Image
                                source={{ uri: selectedPoi.photoUrl }}
                                style={styles.poiBanner}
                            />
                        ) : null}

                        <View style={styles.poiBody}>
                            <Text style={styles.poiCardName} numberOfLines={2}>{selectedPoi.name}</Text>

                            {/* Rating */}
                            {selectedPoi.rating != null && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#F59E0B' }}>{selectedPoi.rating}</Text>
                                    <View style={{ flexDirection: 'row' }}>
                                        {[1, 2, 3, 4, 5].map(i => (
                                            <Ionicons
                                                key={i}
                                                name={i <= Math.round(selectedPoi.rating!) ? 'star' : 'star-outline'}
                                                size={12}
                                                color="#F59E0B"
                                            />
                                        ))}
                                    </View>
                                    {selectedPoi.totalRatings != null && (
                                        <Text style={{ fontSize: 11, color: '#94A3B8' }}>({selectedPoi.totalRatings.toLocaleString()} reviews)</Text>
                                    )}
                                </View>
                            )}

                            {/* Open/Closed */}
                            {selectedPoi.openNow != null && (
                                <Text style={{ fontSize: 12, fontWeight: '600', color: selectedPoi.openNow ? '#10B981' : '#EF4444', marginTop: 3 }}>
                                    {selectedPoi.openNow ? 'Open now' : 'Closed'}
                                </Text>
                            )}

                            {/* Address */}
                            {selectedPoi.address && (
                                <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 3 }} numberOfLines={2}>{selectedPoi.address}</Text>
                            )}

                            {/* Action buttons */}
                            <View style={styles.poiActionRow}>
                                <TouchableOpacity
                                    style={[styles.poiActionBtn, { backgroundColor: '#4285F4' }]}
                                    onPress={() => openDirections({
                                        lat: selectedPoi.coordinate.latitude,
                                        lng: selectedPoi.coordinate.longitude,
                                        name: selectedPoi.name,
                                        placeId: selectedPoi.placeId,
                                    })}
                                >
                                    <Ionicons name="navigate" size={15} color="#fff" />
                                    <Text style={styles.poiActionTextPrimary}>Directions</Text>
                                </TouchableOpacity>
                                {selectedPoi.phone ? (
                                    <TouchableOpacity
                                        style={styles.poiActionBtnSecondary}
                                        onPress={() => Linking.openURL(`tel:${selectedPoi.phone!.replace(/\s/g, '')}`)}
                                    >
                                        <Ionicons name="call" size={15} color="#4285F4" />
                                        <Text style={styles.poiActionTextSecondary}>Call</Text>
                                    </TouchableOpacity>
                                ) : null}
                                {selectedPoi.website ? (
                                    <TouchableOpacity
                                        style={styles.poiActionBtnSecondary}
                                        onPress={() => Linking.openURL(selectedPoi.website!)}
                                    >
                                        <Ionicons name="globe-outline" size={15} color="#4285F4" />
                                        <Text style={styles.poiActionTextSecondary}>Site</Text>
                                    </TouchableOpacity>
                                ) : null}
                            </View>

                            {/* Recommend this place to the community */}
                            <TouchableOpacity
                                style={styles.poiRecommendBtn}
                                onPress={() => {
                                    const poi = selectedPoi;
                                    setSelectedPoi(null);
                                    navigation.navigate('AddRecommendation', {
                                        prefill: {
                                            placeId: poi.placeId,
                                            name: poi.name,
                                            lat: poi.coordinate.latitude,
                                            lng: poi.coordinate.longitude,
                                            address: poi.address || '',
                                            rating: poi.rating,
                                            totalRatings: poi.totalRatings,
                                            types: poi.types || [],
                                        },
                                    });
                                }}
                            >
                                <Ionicons name="megaphone" size={15} color="#fff" />
                                <Text style={styles.poiActionTextPrimary}>Recommend to Community</Text>
                            </TouchableOpacity>

                            {/* Reviews */}
                            {(selectedPoi.reviews?.length ?? 0) > 0 && (
                                <View style={styles.poiReviewSection}>
                                    <Text style={styles.poiReviewHeader}>Reviews</Text>
                                    {selectedPoi.reviews!.map((rv, i) => (
                                        <View key={i} style={[styles.poiReviewItem, i > 0 && styles.poiReviewItemBorder]}>
                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                                {rv.authorPhoto ? (
                                                    <Image source={{ uri: rv.authorPhoto }} style={styles.poiReviewAvatar} />
                                                ) : (
                                                    <View style={[styles.poiReviewAvatar, { backgroundColor: '#E2E8F0', justifyContent: 'center', alignItems: 'center' }]}>
                                                        <Ionicons name="person" size={12} color="#94A3B8" />
                                                    </View>
                                                )}
                                                <Text style={styles.poiReviewAuthor} numberOfLines={1}>{rv.author}</Text>
                                                <Text style={styles.poiReviewWhen}>{rv.when}</Text>
                                            </View>
                                            <View style={{ flexDirection: 'row', marginTop: 4 }}>
                                                {[1, 2, 3, 4, 5].map(s => (
                                                    <Ionicons
                                                        key={s}
                                                        name={s <= rv.rating ? 'star' : 'star-outline'}
                                                        size={11}
                                                        color="#F59E0B"
                                                    />
                                                ))}
                                            </View>
                                            {rv.text ? (
                                                <Text style={styles.poiReviewText} numberOfLines={4}>{rv.text}</Text>
                                            ) : null}
                                        </View>
                                    ))}
                                </View>
                            )}
                        </View>
                    </ScrollView>
                </View>
            )}

            {/* ─── Search Bar + Category Chips ─── */}
            <View style={styles.searchOverlay}>
                <View style={styles.searchBar}>
                    <Ionicons name="search" size={18} color="#94A3B8" />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search nearby places…"
                        placeholderTextColor="#94A3B8"
                        value={search}
                        onChangeText={handleSearchChange}
                        onSubmitEditing={handleSearchSubmit}
                        returnKeyType="search"
                        onFocus={() => { if (placeResults.length > 0) setShowPlaceResults(true); }}
                    />
                    {searching && (
                        <ActivityIndicator size="small" color="#94A3B8" style={{ marginRight: 6 }} />
                    )}
                    {search.length > 0 && (
                        <TouchableOpacity onPress={() => { setSearch(''); setPlaceResults([]); setShowPlaceResults(false); }}>
                            <Ionicons name="close-circle" size={18} color="#94A3B8" />
                        </TouchableOpacity>
                    )}
                </View>

                {/* ─── Place Search Results ─── */}
                {search.trim().length >= 2 && (
                    <View style={styles.placeDropdown}>
                        {matchedGuides.map((g, idx) => {
                            const ms = MARKER_STYLE[g.category] || DEFAULT_MARKER;
                            return (
                                <TouchableOpacity
                                    key={`guide_${g.id}`}
                                    style={[styles.placeItem, styles.placeItemBorder]}
                                    onPress={() => handleGuideSelect(g)}
                                    activeOpacity={0.7}
                                >
                                    <View style={{
                                        width: 24, height: 24, borderRadius: 12, marginRight: 10,
                                        backgroundColor: ms.bg, justifyContent: 'center', alignItems: 'center',
                                    }}>
                                        <Ionicons name={ms.icon as any} size={13} color="#fff" />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.placeName} numberOfLines={1}>{g.title}</Text>
                                        <Text style={styles.placeAddress} numberOfLines={1}>
                                            {LOCAL_CATEGORIES.find(c => c.key === g.category)?.label || g.category} · {g.authorName}
                                        </Text>
                                    </View>
                                </TouchableOpacity>
                            );
                        })}
                        {searching ? (
                            <View style={styles.placeItem}>
                                <ActivityIndicator size="small" color="#0EA5E9" style={{ marginRight: 10 }} />
                                <Text style={styles.placeAddress}>Searching "{search}"...</Text>
                            </View>
                        ) : placeResults.length > 0 ? (
                            placeResults.map((place, idx) => (
                                <TouchableOpacity
                                    key={place.id + idx}
                                    style={[styles.placeItem, idx < placeResults.length - 1 && styles.placeItemBorder]}
                                    onPress={() => handlePlaceSelect(place)}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons name="location-outline" size={18} color="#0EA5E9" style={{ marginRight: 10 }} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.placeName} numberOfLines={1}>{place.name}</Text>
                                        <Text style={styles.placeAddress} numberOfLines={1}>{place.address}</Text>
                                    </View>
                                </TouchableOpacity>
                            ))
                        ) : showPlaceResults && matchedGuides.length === 0 ? (
                            <View style={styles.placeItem}>
                                <Ionicons name="search-outline" size={18} color="#94A3B8" style={{ marginRight: 10 }} />
                                <Text style={styles.placeAddress}>No results for "{search}"</Text>
                            </View>
                        ) : null}
                    </View>
                )}

                {/* Category filter chips */}
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.chipRow}
                >
                    {/* All chip */}
                    <TouchableOpacity
                        style={[styles.chip, activeCategory === 'all' && { backgroundColor: '#334155' }]}
                        activeOpacity={0.8}
                        onPress={() => {
                            setActiveCategory(activeCategory === 'all' ? null : 'all');
                            bounceSheetToPeek();
                        }}
                    >
                        <Ionicons name="grid" size={14} color={activeCategory === 'all' ? '#fff' : '#ccc'} />
                        <Text style={[styles.chipText, activeCategory === 'all' && { color: '#fff' }]}>All</Text>
                        {locatedGuides.length > 0 && (
                            <View style={[styles.chipBadge, activeCategory === 'all' && { backgroundColor: 'rgba(255,255,255,0.3)' }]}>
                                <Text style={[styles.chipBadgeText, activeCategory === 'all' && { color: '#fff' }]}>{locatedGuides.length}</Text>
                            </View>
                        )}
                    </TouchableOpacity>
                    {LOCAL_CATEGORIES.map(cat => {
                        const active = activeCategory === cat.key;
                        const count = getCatCount(cat.key);
                        const ms = MARKER_STYLE[cat.key];
                        return (
                            <TouchableOpacity
                                key={cat.key}
                                style={[styles.chip, active && { backgroundColor: ms?.bg || '#10B981' }]}
                                activeOpacity={0.8}
                                onPress={() => {
                                    setActiveCategory(active ? null : cat.key);
                                    bounceSheetToPeek();
                                }}
                            >
                                <Ionicons
                                    name={cat.icon as any}
                                    size={14}
                                    color={active ? '#fff' : '#ccc'}
                                />
                                <Text style={[styles.chipText, active && { color: '#fff' }]}>
                                    {cat.label}
                                </Text>
                                {count > 0 && (
                                    <View style={[styles.chipBadge, active && { backgroundColor: 'rgba(255,255,255,0.3)' }]}>
                                        <Text style={[styles.chipBadgeText, active && { color: '#fff' }]}>{count}</Text>
                                    </View>
                                )}
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>

                {/* Community Picks — browse every recommendation, grouped by category */}
                {guides.length > 0 && (
                    <TouchableOpacity style={styles.picksBtn} activeOpacity={0.9} onPress={openPicks}>
                        <LinearGradient
                            colors={['#10B981', '#059669']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.picksBtnInner}
                        >
                            <Ionicons name="sparkles" size={13} color="#fff" />
                            <Text style={styles.picksBtnText}>Community Picks</Text>
                            <View style={styles.picksBtnBadge}>
                                <Text style={styles.picksBtnBadgeText}>{guides.length}</Text>
                            </View>
                        </LinearGradient>
                    </TouchableOpacity>
                )}
            </View>

            {/* ─── Zoom Buttons (left, above the sheet) ─── */}
            {sheetPosition === 'peek' && (
                <View style={styles.zoomButtons}>
                    <TouchableOpacity
                        style={styles.zoomBtn}
                        activeOpacity={0.8}
                        onPress={() => zoomBy(0.5)}
                    >
                        <Ionicons name="add" size={20} color="#fff" />
                    </TouchableOpacity>
                    <View style={styles.zoomDivider} />
                    <TouchableOpacity
                        style={styles.zoomBtn}
                        activeOpacity={0.8}
                        onPress={() => zoomBy(2)}
                    >
                        <Ionicons name="remove" size={20} color="#fff" />
                    </TouchableOpacity>
                </View>
            )}

            {/* ─── Map Side Buttons ─── */}
            {sheetPosition === 'peek' && (
            <View style={styles.mapSideButtons}>
                <TouchableOpacity
                    style={[styles.mapSideBtn, showFavorites && styles.mapSideBtnActive]}
                    activeOpacity={0.8}
                    onPress={() => setShowFavorites(f => !f)}
                >
                    <Ionicons
                        name={showFavorites ? 'heart' : 'heart-outline'}
                        size={20}
                        color={showFavorites ? '#F43F5E' : '#fff'}
                    />
                </TouchableOpacity>
                <TouchableOpacity
                    style={styles.mapSideBtn}
                    activeOpacity={0.8}
                    onPress={handleMyLocation}
                >
                    <Ionicons name="navigate" size={20} color="#fff" />
                </TouchableOpacity>
            </View>
            )}

            {/* ─── Selected Guide Popup (Center Card) ─── */}
            {selectedGuide && (
                <Animated.View
                    style={[
                        styles.popupOverlay,
                        { opacity: popupOpacity, transform: [{ scale: popupScale }] },
                    ]}
                >
                    <View style={styles.popupCard}>
                        {/* Close */}
                        <TouchableOpacity style={styles.popupCloseBtn} onPress={dismissPopup}>
                            <Ionicons name="close" size={20} color="#64748B" />
                        </TouchableOpacity>

                        {/* Favorite */}
                        <TouchableOpacity
                            style={styles.popupFavBtn}
                            onPress={() => toggleFavorite(selectedGuide.id)}
                        >
                            <Ionicons
                                name={favoriteIds.has(selectedGuide.id) ? 'heart' : 'heart-outline'}
                                size={20}
                                color={favoriteIds.has(selectedGuide.id) ? '#F43F5E' : '#94A3B8'}
                            />
                        </TouchableOpacity>

                        {/* Photo */}
                        {(selectedGuide.photos?.[0] || selectedGuide.photo) && (
                            <Image
                                source={{ uri: selectedGuide.photos?.[0] || selectedGuide.photo }}
                                style={styles.popupPhoto}
                            />
                        )}

                        <View style={styles.popupBody}>
                            {/* Category + cuisine badges */}
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <View style={[
                                    styles.popupCatBadge,
                                    { backgroundColor: (MARKER_STYLE[selectedGuide.category] || DEFAULT_MARKER).bg + '18' },
                                ]}>
                                    <Ionicons
                                        name={(MARKER_STYLE[selectedGuide.category] || DEFAULT_MARKER).icon as any}
                                        size={12}
                                        color={(MARKER_STYLE[selectedGuide.category] || DEFAULT_MARKER).bg}
                                    />
                                    <Text style={[
                                        styles.popupCatText,
                                        { color: (MARKER_STYLE[selectedGuide.category] || DEFAULT_MARKER).bg },
                                    ]}>
                                        {LOCAL_CATEGORIES.find(c => c.key === selectedGuide.category)?.label || selectedGuide.category}
                                    </Text>
                                </View>
                                {selectedGuide.cuisine ? (
                                    <View style={[styles.popupCatBadge, { backgroundColor: '#FFF1F2' }]}>
                                        <Text style={[styles.popupCatText, { color: '#E11D48' }]}>
                                            {cuisineLabel(selectedGuide.cuisine)}
                                        </Text>
                                    </View>
                                ) : null}
                            </View>

                            <Text style={styles.popupTitle}>{selectedGuide.title}</Text>
                            <Text style={styles.popupDesc} numberOfLines={4}>{selectedGuide.description}</Text>

                            {selectedGuide.address && (
                                <View style={styles.popupAddress}>
                                    <Ionicons name="location-outline" size={13} color="#94A3B8" />
                                    <Text style={styles.popupAddressText} numberOfLines={1}>{selectedGuide.address}</Text>
                                </View>
                            )}

                            {/* Linked Google Maps place */}
                            <GooglePlaceChip placeId={selectedGuide.placeId} />

                            <View style={styles.popupFooter}>
                                <View style={styles.popupMeta}>
                                    <TouchableOpacity
                                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                                        onPress={() => toggleLike(selectedGuide)}
                                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 6 }}
                                    >
                                        <Ionicons
                                            name={likedIds.has(selectedGuide.id) ? 'heart' : 'heart-outline'}
                                            size={15}
                                            color="#EF4444"
                                        />
                                        <Text style={[styles.popupMetaText, likedIds.has(selectedGuide.id) && { color: '#EF4444', fontWeight: '700' }]}>
                                            {selectedGuide.likes || 0}
                                        </Text>
                                    </TouchableOpacity>
                                    <Text style={styles.popupMetaDot}>·</Text>
                                    <Text style={styles.popupMetaText}>{selectedGuide.authorName}</Text>
                                </View>
                                <TouchableOpacity
                                    style={styles.popupViewBtn}
                                    activeOpacity={0.8}
                                    onPress={() => {
                                        openFullPost(selectedGuide);
                                        dismissPopup();
                                    }}
                                >
                                    <Text style={styles.popupViewText}>View</Text>
                                    <Ionicons name="chevron-forward" size={14} color="#fff" />
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                </Animated.View>
            )}

            {/* ─── Bottom Sheet ─── */}
            <Animated.View style={[styles.bottomSheet, { top: sheetY }]}>
                <View {...panResponder.panHandlers} style={styles.sheetHandleArea}>
                    <View style={styles.sheetHandle} />
                    {sheetDetail ? (
                        <View style={styles.sheetHeaderRow}>
                            <TouchableOpacity
                                style={styles.sheetBackBtn}
                                onPress={() => setSheetDetail(null)}
                            >
                                <Ionicons name="chevron-back" size={20} color="#1E293B" />
                            </TouchableOpacity>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.sheetTitle} numberOfLines={1}>{sheetDetail.title}</Text>
                                <Text style={styles.sheetSubtitle}>{sheetDetail.authorName}</Text>
                            </View>
                        </View>
                    ) : showPicks ? (
                        <View style={styles.sheetHeaderRow}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.sheetTitle}>Community Picks ✨</Text>
                                <Text style={styles.sheetSubtitle}>
                                    {guides.length} place{guides.length === 1 ? '' : 's'} recommended by your community
                                </Text>
                            </View>
                            <TouchableOpacity style={styles.sheetClearBtn} onPress={closePicks}>
                                <Text style={styles.sheetClearText}>Map</Text>
                            </TouchableOpacity>
                        </View>
                    ) : activeCategory ? (
                        <View style={styles.sheetHeaderRow}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.sheetTitle}>
                                    {activeCategory === 'all' ? 'All Places' : (LOCAL_CATEGORIES.find(c => c.key === activeCategory)?.label || activeCategory)}
                                </Text>
                                <Text style={styles.sheetSubtitle}>
                                    {sheetGuides.length} place{sheetGuides.length === 1 ? '' : 's'}{activeCategory === 'all' ? ' in view' : ''}
                                </Text>
                            </View>
                            <TouchableOpacity
                                style={styles.sheetClearBtn}
                                onPress={() => setActiveCategory(null)}
                            >
                                <Text style={styles.sheetClearText}>Show All</Text>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <>
                            <Text style={styles.sheetTitle}>Local Guide</Text>
                            <Text style={styles.sheetSubtitle}>Songdo Neighborhood Guide</Text>
                        </>
                    )}
                </View>

                <ScrollView
                    ref={sheetScrollRef}
                    style={{ flex: 1 }}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={[
                        sheetDetail ? styles.detailContent
                            : showPicks ? styles.postList
                            : activeCategory ? styles.postList
                            : styles.categoryGrid,
                        kbPad > 0 && { paddingBottom: kbPad + 80 },
                    ]}
                    showsVerticalScrollIndicator={false}
                    onScrollBeginDrag={() => {
                        // Auto-expand sheet to full when user scrolls
                        if (lastSnap.current !== SCREEN_H - SHEET_FULL) {
                            lastSnap.current = SCREEN_H - SHEET_FULL;
                            setSheetPosition('full');
                            Animated.spring(sheetY, {
                                toValue: SCREEN_H - SHEET_FULL,
                                useNativeDriver: false, tension: 80, friction: 12,
                            }).start();
                        }
                    }}
                >
                    {sheetDetail ? (
                        // ─── Detail View (compact) ───
                        <>
                            <View style={styles.detailCard}>
                                {(() => {
                                    const detailPhotos = sheetDetail.photos?.length
                                        ? sheetDetail.photos
                                        : (sheetDetail.photo ? [sheetDetail.photo] : []);
                                    if (detailPhotos.length === 0) return null;
                                    if (detailPhotos.length === 1) {
                                        return (
                                            <TouchableOpacity
                                                activeOpacity={0.9}
                                                onPress={() => setPhotoViewerUri(detailPhotos[0])}
                                            >
                                                <Image source={{ uri: detailPhotos[0] }} style={styles.detailPhoto} />
                                            </TouchableOpacity>
                                        );
                                    }
                                    return (
                                        <View>
                                            <ScrollView
                                                horizontal
                                                pagingEnabled
                                                showsHorizontalScrollIndicator={false}
                                            >
                                                {detailPhotos.map((uri, i) => (
                                                    <TouchableOpacity
                                                        key={i}
                                                        activeOpacity={0.9}
                                                        onPress={() => setPhotoViewerUri(uri)}
                                                    >
                                                        <Image
                                                            source={{ uri }}
                                                            style={[styles.detailPhoto, { width: SCREEN_W - 32 }]}
                                                        />
                                                    </TouchableOpacity>
                                                ))}
                                            </ScrollView>
                                            <View style={styles.photoCountBadge}>
                                                <Ionicons name="images" size={11} color="#fff" />
                                                <Text style={styles.photoCountText}>{detailPhotos.length}</Text>
                                            </View>
                                        </View>
                                    );
                                })()}
                                <View style={styles.detailBody}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                        <View style={[
                                            styles.popupCatBadge,
                                            { backgroundColor: (MARKER_STYLE[sheetDetail.category] || DEFAULT_MARKER).bg + '18' },
                                        ]}>
                                            <Ionicons
                                                name={(MARKER_STYLE[sheetDetail.category] || DEFAULT_MARKER).icon as any}
                                                size={11}
                                                color={(MARKER_STYLE[sheetDetail.category] || DEFAULT_MARKER).bg}
                                            />
                                            <Text style={[
                                                styles.popupCatText,
                                                { color: (MARKER_STYLE[sheetDetail.category] || DEFAULT_MARKER).bg },
                                            ]}>
                                                {LOCAL_CATEGORIES.find(c => c.key === sheetDetail.category)?.label || sheetDetail.category}
                                            </Text>
                                        </View>
                                        {sheetDetail.cuisine ? (
                                            <View style={[styles.popupCatBadge, { backgroundColor: '#FFF1F2' }]}>
                                                <Text style={[styles.popupCatText, { color: '#E11D48' }]}>
                                                    {cuisineLabel(sheetDetail.cuisine)}
                                                </Text>
                                            </View>
                                        ) : null}
                                    </View>

                                    <Text style={styles.detailTitle}>{sheetDetail.title}</Text>
                                    <Text style={styles.detailDesc} numberOfLines={6}>{sheetDetail.description}</Text>

                                    {sheetDetail.address && (
                                        <View style={styles.detailAddress}>
                                            <Ionicons name="location-outline" size={13} color="#94A3B8" />
                                            <Text style={styles.detailAddressText} numberOfLines={1}>{sheetDetail.address}</Text>
                                        </View>
                                    )}

                                    {/* Linked Google Maps place */}
                                    <GooglePlaceChip placeId={sheetDetail.placeId} />

                                    <View style={styles.detailFooter}>
                                        <View style={styles.detailAuthor}>
                                            <TouchableOpacity
                                                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingRight: 4 }}
                                                onPress={() => toggleLike(sheetDetail)}
                                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                                            >
                                                <Ionicons
                                                    name={likedIds.has(sheetDetail.id) ? 'heart' : 'heart-outline'}
                                                    size={16}
                                                    color="#EF4444"
                                                />
                                                <Text style={[styles.detailMetaText, likedIds.has(sheetDetail.id) && { color: '#EF4444', fontWeight: '700' }]}>
                                                    {sheetDetail.likes || 0}
                                                </Text>
                                            </TouchableOpacity>
                                            <Text style={styles.postMetaDot}>·</Text>
                                            <Text style={styles.detailMetaText}>{sheetDetail.authorName}</Text>
                                        </View>
                                        <TouchableOpacity
                                            style={[
                                                styles.detailFavBtn,
                                                favoriteIds.has(sheetDetail.id) && styles.detailFavBtnActive,
                                            ]}
                                            onPress={() => toggleFavorite(sheetDetail.id)}
                                        >
                                            <Ionicons
                                                name={favoriteIds.has(sheetDetail.id) ? 'heart' : 'heart-outline'}
                                                size={14}
                                                color={favoriteIds.has(sheetDetail.id) ? '#fff' : '#F43F5E'}
                                            />
                                            <Text style={[
                                                styles.detailFavText,
                                                favoriteIds.has(sheetDetail.id) && { color: '#fff' },
                                            ]}>
                                                {favoriteIds.has(sheetDetail.id) ? 'Saved' : 'Save'}
                                            </Text>
                                        </TouchableOpacity>
                                    </View>

                                    {/* Go to the full post / get directions */}
                                    <View style={styles.ownerActionRow}>
                                        <TouchableOpacity
                                            style={styles.detailFullPostBtn}
                                            activeOpacity={0.85}
                                            onPress={() => openFullPost(sheetDetail)}
                                        >
                                            <Ionicons name="reader-outline" size={15} color="#fff" />
                                            <Text style={styles.detailFullPostText}>View Full Post</Text>
                                        </TouchableOpacity>
                                        {sheetDetail.latitude && sheetDetail.longitude ? (
                                            <TouchableOpacity
                                                style={styles.detailDirectionsBtn}
                                                activeOpacity={0.85}
                                                onPress={() => showOnMap(sheetDetail)}
                                            >
                                                <Ionicons name="location" size={15} color="#4285F4" />
                                                <Text style={styles.detailDirectionsText}>Show on Map</Text>
                                            </TouchableOpacity>
                                        ) : null}
                                    </View>

                                    {/* Owner actions */}
                                    {sheetDetail.authorId === auth.currentUser?.uid && (
                                        <View style={styles.ownerActionRow}>
                                            <TouchableOpacity
                                                style={styles.ownerActionBtn}
                                                onPress={() => editGuide(sheetDetail)}
                                            >
                                                <Ionicons name="create-outline" size={15} color="#475569" />
                                                <Text style={styles.ownerActionText}>Edit</Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                style={[styles.ownerActionBtn, { borderColor: '#FECACA' }]}
                                                onPress={() => deleteGuide(sheetDetail)}
                                            >
                                                <Ionicons name="trash-outline" size={15} color="#EF4444" />
                                                <Text style={[styles.ownerActionText, { color: '#EF4444' }]}>Delete</Text>
                                            </TouchableOpacity>
                                        </View>
                                    )}

                                    {/* Comments */}
                                    <RecommendationComments
                                        recId={sheetDetail.id}
                                        recTitle={sheetDetail.title}
                                        recAuthorId={sheetDetail.authorId}
                                        onInputFocus={expandSheetForComment}
                                    />
                                </View>
                            </View>

                            {/* ─── Nearby Places ─── */}
                            {nearbyGuides.length > 0 && (
                                <View style={styles.nearbySection}>
                                    <Text style={styles.nearbySectionTitle}>Nearby Places</Text>
                                    {nearbyGuides.map(item => {
                                        const ms = MARKER_STYLE[item.category] || DEFAULT_MARKER;
                                        return (
                                            <TouchableOpacity
                                                key={item.id}
                                                style={styles.postCard}
                                                activeOpacity={0.9}
                                                onPress={() => {
                                                    if (item.latitude && item.longitude) {
                                                        const LAT_DELTA = 0.006;
                                                        const latOffset = (SHEET_MID / 2 / SCREEN_H) * LAT_DELTA;
                                                        mapRef.current?.animateToRegion({
                                                            latitude: item.latitude - latOffset,
                                                            longitude: item.longitude,
                                                            latitudeDelta: LAT_DELTA,
                                                            longitudeDelta: LAT_DELTA,
                                                        }, 400);
                                                    }
                                                    setSheetDetail(item);
                                                }}
                                            >
                                                {(item.photos?.[0] || item.photo) && (
                                                    <Image
                                                        source={{ uri: item.photos?.[0] || item.photo }}
                                                        style={styles.postImage}
                                                    />
                                                )}
                                                <View style={styles.postInfo}>
                                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                                        <Ionicons name={ms.icon as any} size={11} color={ms.bg} />
                                                        <Text style={[styles.postMetaText, { color: ms.bg }]}>
                                                            {LOCAL_CATEGORIES.find(c => c.key === item.category)?.label}
                                                        </Text>
                                                    </View>
                                                    <Text style={styles.postTitle} numberOfLines={1}>{item.title}</Text>
                                                    <Text style={styles.postDesc} numberOfLines={1}>{item.description}</Text>
                                                </View>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            )}
                        </>
                    ) : showPicks ? (
                        // ─── Community Picks: every recommendation grouped by category ───
                        guides.length === 0 ? (
                            <View style={styles.emptyState}>
                                <Ionicons name="sparkles" size={40} color="#CBD5E1" />
                                <Text style={styles.emptyText}>No picks yet</Text>
                                <Text style={styles.emptySubtext}>Be the first to recommend a place!</Text>
                            </View>
                        ) : (
                            <>
                                {/* My Likes — places this user liked, pinned on top */}
                                {(() => {
                                    const likedGuides = guides.filter(g => likedIds.has(g.id));
                                    if (likedGuides.length === 0) return null;
                                    return (
                                        <View style={{ marginBottom: 8 }}>
                                            <View style={styles.picksSectionHeader}>
                                                <View style={[styles.picksSectionIcon, { backgroundColor: '#EF4444' }]}>
                                                    <Ionicons name="heart" size={12} color="#fff" />
                                                </View>
                                                <Text style={styles.picksSectionTitle}>My Likes</Text>
                                                <Text style={styles.picksSectionCount}>{likedGuides.length}</Text>
                                            </View>
                                            {likedGuides.map(renderPicksCard)}
                                        </View>
                                    );
                                })()}
                                {LOCAL_CATEGORIES.map(cat => {
                                const items = guides.filter(g => g.category === cat.key);
                                if (items.length === 0) return null;
                                const ms = MARKER_STYLE[cat.key] || DEFAULT_MARKER;
                                const isRestaurant = cat.key === 'restaurant';
                                const cuisinesPresent = isRestaurant
                                    ? CUISINES.filter(c => items.some(i => i.cuisine === c.key))
                                    : [];
                                const filteredItems = isRestaurant && picksCuisine
                                    ? items.filter(i => i.cuisine === picksCuisine)
                                    : items;
                                // Picks shows a 3-item preview per category; "View all" opens the full list
                                const visibleItems = filteredItems.slice(0, 3);
                                const hiddenCount = filteredItems.length - visibleItems.length;
                                return (
                                    <View key={cat.key} style={{ marginBottom: 8 }}>
                                        <View style={styles.picksSectionHeader}>
                                            <View style={[styles.picksSectionIcon, { backgroundColor: ms.bg }]}>
                                                <Ionicons name={cat.icon as any} size={12} color="#fff" />
                                            </View>
                                            <Text style={styles.picksSectionTitle}>{cat.label}</Text>
                                            <Text style={styles.picksSectionCount}>{items.length}</Text>
                                        </View>
                                        {isRestaurant && cuisinesPresent.length > 0 && (
                                            <ScrollView
                                                horizontal
                                                showsHorizontalScrollIndicator={false}
                                                contentContainerStyle={styles.picksCuisineRow}
                                            >
                                                <TouchableOpacity
                                                    style={[styles.picksCuisineChip, picksCuisine === null && styles.picksCuisineChipActive]}
                                                    onPress={() => setPicksCuisine(null)}
                                                    activeOpacity={0.8}
                                                >
                                                    <Text style={[styles.picksCuisineText, picksCuisine === null && styles.picksCuisineTextActive]}>
                                                        All
                                                    </Text>
                                                </TouchableOpacity>
                                                {cuisinesPresent.map(c => {
                                                    const active = picksCuisine === c.key;
                                                    return (
                                                        <TouchableOpacity
                                                            key={c.key}
                                                            style={[styles.picksCuisineChip, active && styles.picksCuisineChipActive]}
                                                            onPress={() => setPicksCuisine(active ? null : c.key)}
                                                            activeOpacity={0.8}
                                                        >
                                                            <Text style={[styles.picksCuisineText, active && styles.picksCuisineTextActive]}>
                                                                {c.label}
                                                            </Text>
                                                        </TouchableOpacity>
                                                    );
                                                })}
                                            </ScrollView>
                                        )}
                                        {visibleItems.map(renderPicksCard)}
                                        <TouchableOpacity
                                            style={styles.picksViewAllBtn}
                                            activeOpacity={0.8}
                                            onPress={() => navigation.navigate('LocalGuide', { category: cat })}
                                        >
                                            <Text style={styles.picksViewAllText}>
                                                View all {items.length} {cat.label.toLowerCase()}
                                            </Text>
                                            <Ionicons name="chevron-forward" size={13} color="#475569" />
                                        </TouchableOpacity>
                                    </View>
                                );
                                })}
                            </>
                        )
                    ) : activeCategory ? (
                        // ─── Category Posts ───
                        sheetGuides.length === 0 ? (
                            <View style={styles.emptyState}>
                                <Ionicons
                                    name={(MARKER_STYLE[activeCategory] || DEFAULT_MARKER).icon as any}
                                    size={40}
                                    color="#CBD5E1"
                                />
                                <Text style={styles.emptyText}>
                                    {activeCategory === 'all' ? 'No places in this area' : 'No posts yet'}
                                </Text>
                                <Text style={styles.emptySubtext}>
                                    {activeCategory === 'all' ? 'Move the map to explore' : 'Be the first to add one!'}
                                </Text>
                            </View>
                        ) : (
                            sheetGuides.map(item => (
                                <TouchableOpacity
                                    key={item.id}
                                    style={styles.postCard}
                                    activeOpacity={0.9}
                                    onPress={() => {
                                        if (item.latitude && item.longitude) {
                                            // Offset center so marker is visible above sheet
                                            const LAT_DELTA = 0.006;
                                            const latOffset = (SHEET_MID / 2 / SCREEN_H) * LAT_DELTA;
                                            mapRef.current?.animateToRegion({
                                                latitude: item.latitude - latOffset,
                                                longitude: item.longitude,
                                                latitudeDelta: LAT_DELTA,
                                                longitudeDelta: LAT_DELTA,
                                            }, 400);
                                        }
                                        setSheetDetail(item);
                                        lastSnap.current = SCREEN_H - SHEET_MID;
                                        setSheetPosition('mid');
                                        Animated.spring(sheetY, {
                                            toValue: SCREEN_H - SHEET_MID,
                                            useNativeDriver: false, tension: 80, friction: 12,
                                        }).start();
                                    }}
                                >
                                    {(item.photos?.[0] || item.photo) && (
                                        <Image
                                            source={{ uri: item.photos?.[0] || item.photo }}
                                            style={styles.postImage}
                                        />
                                    )}
                                    <View style={styles.postInfo}>
                                        <Text style={styles.postTitle} numberOfLines={1}>{item.title}</Text>
                                        <Text style={styles.postDesc} numberOfLines={2}>{item.description}</Text>
                                        <View style={styles.postBottom}>
                                            <View style={styles.postMeta}>
                                                <Ionicons name="heart" size={12} color="#EF4444" />
                                                <Text style={styles.postMetaText}>{item.likes || 0}</Text>
                                                <Text style={styles.postMetaDot}>·</Text>
                                                <Text style={styles.postMetaText}>{item.authorName}</Text>
                                            </View>
                                            {item.latitude && (
                                                <View style={styles.postLocationTag}>
                                                    <Ionicons name="location" size={10} color="#10B981" />
                                                    <Text style={styles.postLocationText}>Map</Text>
                                                </View>
                                            )}
                                        </View>
                                    </View>
                                </TouchableOpacity>
                            ))
                        )
                    ) : (
                        // ─── Category Cards Grid ───
                        filteredCategories.map(cat => {
                            const count = getCatCount(cat.key);
                            return (
                                <TouchableOpacity
                                    key={cat.key}
                                    style={styles.categoryCard}
                                    activeOpacity={0.85}
                                    onPress={() => {
                                        setActiveCategory(cat.key);
                                        // Auto-expand sheet so list is visible
                                        lastSnap.current = SCREEN_H - SHEET_MID;
                                        setSheetPosition('mid');
                                        Animated.spring(sheetY, {
                                            toValue: SCREEN_H - SHEET_MID,
                                            useNativeDriver: false, tension: 80, friction: 12,
                                        }).start();
                                    }}
                                >
                                    <LinearGradient
                                        colors={cat.gradient}
                                        start={{ x: 0, y: 0 }}
                                        end={{ x: 1, y: 1 }}
                                        style={styles.categoryGradient}
                                    >
                                        <View style={styles.categoryIconWrap}>
                                            <Ionicons name={cat.icon} size={22} color="#fff" />
                                        </View>
                                        <Text style={styles.categoryLabel}>{cat.label}</Text>
                                        <Text style={styles.categoryLabelKo}>{cat.labelKo}</Text>
                                        {count > 0 && (
                                            <View style={styles.categoryBadge}>
                                                <Text style={styles.categoryBadgeText}>{count}</Text>
                                            </View>
                                        )}
                                    </LinearGradient>
                                </TouchableOpacity>
                            );
                        })
                    )}
                </ScrollView>
            </Animated.View>

            {/* ─── FAB ─── */}
            {sheetPosition === 'peek' && (
                <TouchableOpacity
                    style={styles.fab}
                    activeOpacity={0.85}
                    onPress={() => (navigation as any).navigate('AddRecommendation')}
                >
                    <Ionicons name="add" size={28} color="#fff" />
                </TouchableOpacity>
            )}

            {/* ─── First-visit Onboarding ─── */}
            <Modal
                visible={showOnboarding}
                transparent
                animationType="fade"
                onRequestClose={dismissOnboarding}
            >
                <View style={styles.onboardOverlay}>
                    <View style={styles.onboardCard}>
                        <LinearGradient
                            colors={['#10B981', '#059669']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.onboardHeader}
                        >
                            <View style={styles.onboardHeaderIcon}>
                                <Ionicons name="map" size={26} color="#fff" />
                            </View>
                            <Text style={styles.onboardTitle}>Local Guide</Text>
                            <Text style={styles.onboardSubtitle}>
                                Songdo's best spots, picked by your school community
                            </Text>
                        </LinearGradient>

                        <View style={styles.onboardBody}>
                            {[
                                {
                                    icon: 'location' as const, color: '#F43F5E',
                                    title: 'Explore the map',
                                    desc: 'Every pin is a real place recommended by students & parents.',
                                },
                                {
                                    icon: 'sparkles' as const, color: '#10B981',
                                    title: 'Community Picks',
                                    desc: 'Browse all recommendations at once, grouped by category.',
                                },
                                {
                                    icon: 'star' as const, color: '#F59E0B',
                                    title: 'Tap any place',
                                    desc: 'See Google ratings, reviews & get directions in one tap.',
                                },
                                {
                                    icon: 'megaphone' as const, color: '#6366F1',
                                    title: 'Share your favorites',
                                    desc: 'Found a gem? Hit + to recommend it — likes & comments welcome!',
                                },
                            ].map(f => (
                                <View key={f.title} style={styles.onboardRow}>
                                    <View style={[styles.onboardRowIcon, { backgroundColor: f.color + '18' }]}>
                                        <Ionicons name={f.icon} size={18} color={f.color} />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.onboardRowTitle}>{f.title}</Text>
                                        <Text style={styles.onboardRowDesc}>{f.desc}</Text>
                                    </View>
                                </View>
                            ))}

                            <TouchableOpacity style={styles.onboardCta} activeOpacity={0.9} onPress={dismissOnboarding}>
                                <LinearGradient
                                    colors={['#10B981', '#059669']}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 0 }}
                                    style={styles.onboardCtaInner}
                                >
                                    <Text style={styles.onboardCtaText}>Let's explore!</Text>
                                    <Ionicons name="arrow-forward" size={16} color="#fff" />
                                </LinearGradient>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ─── Fullscreen Photo Viewer ─── */}
            <Modal
                visible={!!photoViewerUri}
                transparent
                animationType="fade"
                onRequestClose={() => setPhotoViewerUri(null)}
            >
                <View style={styles.photoViewerOverlay}>
                    <TouchableOpacity
                        style={styles.photoViewerClose}
                        onPress={() => setPhotoViewerUri(null)}
                    >
                        <Ionicons name="close" size={26} color="#fff" />
                    </TouchableOpacity>
                    {photoViewerUri && (
                        <Image
                            source={{ uri: photoViewerUri }}
                            style={styles.photoViewerImage}
                            resizeMode="contain"
                        />
                    )}
                </View>
            </Modal>
        </View>
    );
}

const CARD_GAP = 10;
const CARD_W = (SCREEN_W - 32 - CARD_GAP) / 2;

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f5f5f5' },
    edgeSwipeArea: {
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: 25, zIndex: 999,
    },
    map: { ...StyleSheet.absoluteFillObject },

    markerWrap: { alignItems: 'center' },
    markerPin: {
        // NOTE: no shadow here — shadows on map markers rasterize as a square
        // gray box behind the transparent pin
        width: 32, height: 32, borderRadius: 16,
        justifyContent: 'center', alignItems: 'center',
        borderWidth: 2.5, borderColor: '#fff',
    },
    markerArrow: {
        width: 0, height: 0, marginTop: -2,
        borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 8,
        borderLeftColor: 'transparent', borderRightColor: 'transparent',
        borderTopColor: '#10B981',
    },

    // POI Callout
    poiCard: {
        position: 'absolute',
        bottom: SHEET_PEEK + 12,
        left: 16, right: 16,
        backgroundColor: '#fff',
        borderRadius: 16,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8,
        zIndex: 20,
    },
    poiCardClose: {
        position: 'absolute', top: 10, right: 10, zIndex: 2,
        width: 28, height: 28, borderRadius: 14,
        backgroundColor: 'rgba(241,245,249,0.92)',
        justifyContent: 'center', alignItems: 'center',
    },
    poiBanner: {
        width: '100%', height: 140,
        backgroundColor: '#E2E8F0',
    },
    poiBody: {
        padding: 16,
    },
    poiCardName: {
        fontSize: 16, fontWeight: '800', color: '#0F172A',
        paddingRight: 28,
    },
    poiActionRow: {
        flexDirection: 'row', gap: 8, marginTop: 12,
    },
    poiActionBtn: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 6, paddingVertical: 10, borderRadius: 12,
    },
    poiActionBtnSecondary: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 5, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12,
        borderWidth: 1.5, borderColor: '#4285F4',
    },
    poiActionTextPrimary: {
        color: '#fff', fontWeight: '700', fontSize: 13,
    },
    poiActionTextSecondary: {
        color: '#4285F4', fontWeight: '700', fontSize: 13,
    },
    poiRecommendBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 6, paddingVertical: 10, borderRadius: 12, marginTop: 8,
        backgroundColor: '#10B981',
    },
    poiReviewSection: {
        marginTop: 14,
    },
    poiReviewHeader: {
        fontSize: 13, fontWeight: '800', color: '#0F172A', marginBottom: 4,
    },
    poiReviewItem: {
        paddingVertical: 10,
    },
    poiReviewItemBorder: {
        borderTopWidth: 1, borderTopColor: '#F1F5F9',
    },
    poiReviewAvatar: {
        width: 22, height: 22, borderRadius: 11,
    },
    poiReviewAuthor: {
        fontSize: 12, fontWeight: '700', color: '#334155', flexShrink: 1,
    },
    poiReviewWhen: {
        fontSize: 11, color: '#94A3B8', marginLeft: 'auto',
    },
    poiReviewText: {
        fontSize: 12, color: '#475569', lineHeight: 17, marginTop: 4,
    },
    ownerActionRow: {
        flexDirection: 'row', gap: 8, marginTop: 10,
    },
    ownerActionBtn: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 5, paddingVertical: 9, borderRadius: 10,
        borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC',
    },
    ownerActionText: {
        fontSize: 13, fontWeight: '600', color: '#475569',
    },
    detailFullPostBtn: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 6, paddingVertical: 10, borderRadius: 10,
        backgroundColor: '#10B981',
    },
    detailFullPostText: {
        fontSize: 13, fontWeight: '700', color: '#fff',
    },
    detailDirectionsBtn: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 6, paddingVertical: 10, borderRadius: 10,
        borderWidth: 1.5, borderColor: '#4285F4', backgroundColor: '#fff',
    },
    detailDirectionsText: {
        fontSize: 13, fontWeight: '700', color: '#4285F4',
    },
    picksBtn: {
        alignSelf: 'flex-start',
        marginTop: 8,
        borderRadius: 9999,
        overflow: 'hidden',
        shadowColor: '#059669',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
        elevation: 5,
    },
    picksBtnInner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 13,
        paddingVertical: 8,
    },
    picksBtnText: {
        fontSize: 12.5,
        fontWeight: '800',
        color: '#fff',
    },
    picksBtnBadge: {
        backgroundColor: 'rgba(255,255,255,0.28)',
        borderRadius: 9,
        paddingHorizontal: 6,
        paddingVertical: 1,
    },
    picksBtnBadgeText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#fff',
    },
    picksSectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 6,
        marginBottom: 8,
    },
    picksSectionIcon: {
        width: 24,
        height: 24,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    picksSectionTitle: {
        fontSize: 15,
        fontWeight: '800',
        color: '#0F172A',
        flex: 1,
    },
    picksSectionCount: {
        fontSize: 12,
        fontWeight: '700',
        color: '#94A3B8',
    },
    picksCuisineRow: {
        gap: 6,
        paddingBottom: 12,
        paddingTop: 2,
    },
    picksCuisineChip: {
        paddingHorizontal: 13,
        paddingVertical: 7,
        borderRadius: 9999,
        backgroundColor: '#F1F5F9',
    },
    picksCuisineChipActive: {
        backgroundColor: '#0F172A',
    },
    picksCuisineText: {
        fontSize: 12.5,
        fontWeight: '600',
        color: '#64748B',
        letterSpacing: -0.1,
    },
    picksCuisineTextActive: {
        color: '#fff',
        fontWeight: '700',
    },
    picksViewAllBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        paddingVertical: 11,
        borderRadius: 12,
        backgroundColor: '#F8FAFC',
        borderWidth: 1,
        borderColor: '#F1F5F9',
        marginBottom: 4,
    },
    picksViewAllText: {
        fontSize: 13,
        fontWeight: '700',
        color: '#475569',
    },
    photoCountBadge: {
        position: 'absolute', bottom: 8, right: 8,
        flexDirection: 'row', alignItems: 'center', gap: 4,
        backgroundColor: 'rgba(15,23,42,0.65)',
        paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
    },
    photoCountText: {
        fontSize: 11, fontWeight: '700', color: '#fff',
    },

    searchOverlay: { position: 'absolute', top: SAFE_TOP + 4, left: 16, right: 16, zIndex: 10 },
    searchBar: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#fff', borderRadius: r(14),
        paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 12 : 8,
        gap: 8,
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12, shadowRadius: 12, elevation: 8,
    },
    searchInput: { flex: 1, fontSize: 15, color: '#1E293B', padding: 0 },
    placeDropdown: {
        backgroundColor: '#fff',
        borderRadius: r(12),
        marginTop: 6,
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12, shadowRadius: 12, elevation: 8,
        overflow: 'hidden',
    },
    placeItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    placeItemBorder: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#E2E8F0',
    },
    placeName: {
        fontSize: 14,
        fontWeight: '600',
        color: '#1E293B',
    },
    placeAddress: {
        fontSize: 11,
        color: '#94A3B8',
        marginTop: 2,
    },
    chipRow: { paddingTop: 10, paddingBottom: 4, gap: 8, paddingRight: 8 },
    chip: {
        flexDirection: 'row', alignItems: 'center', gap: 5,
        backgroundColor: 'rgba(30,30,30,0.75)',
        paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    },
    chipText: { fontSize: 12, fontWeight: '600', color: '#ccc' },
    chipBadge: {
        backgroundColor: 'rgba(255,255,255,0.15)',
        paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, marginLeft: 2,
    },
    chipBadgeText: { fontSize: 10, fontWeight: '700', color: '#aaa' },

    // Right column: heart + my-location, stacked directly above the FAB
    mapSideButtons: {
        position: 'absolute', right: 20, bottom: SHEET_PEEK + 16 + 52 + 12,
        gap: 10, zIndex: 10, alignItems: 'center',
    },
    // Left: zoom pill anchored just above the sheet, mirroring the FAB
    zoomButtons: {
        position: 'absolute', left: 20, bottom: SHEET_PEEK + 16,
        zIndex: 10,
        borderRadius: 22,
        overflow: 'hidden',
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3, shadowRadius: 6, elevation: 6,
    },
    zoomDivider: {
        height: 1, width: 44, backgroundColor: 'rgba(255,255,255,0.25)',
    },

    // ─── Onboarding ───
    onboardOverlay: {
        flex: 1, backgroundColor: 'rgba(15,23,42,0.55)',
        justifyContent: 'center', alignItems: 'center', padding: 24,
    },
    onboardCard: {
        width: '100%', maxWidth: 380,
        backgroundColor: '#fff', borderRadius: 24, overflow: 'hidden',
        shadowColor: '#000', shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.3, shadowRadius: 24, elevation: 12,
    },
    onboardHeader: {
        alignItems: 'center', paddingVertical: 24, paddingHorizontal: 20,
    },
    onboardHeaderIcon: {
        width: 52, height: 52, borderRadius: 26,
        backgroundColor: 'rgba(255,255,255,0.22)',
        justifyContent: 'center', alignItems: 'center', marginBottom: 10,
    },
    onboardTitle: {
        fontSize: 22, fontWeight: '900', color: '#fff', letterSpacing: -0.3,
    },
    onboardSubtitle: {
        fontSize: 13, color: 'rgba(255,255,255,0.9)', marginTop: 4, textAlign: 'center',
    },
    onboardBody: {
        padding: 20, gap: 14,
    },
    onboardRow: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
    },
    onboardRowIcon: {
        width: 38, height: 38, borderRadius: 12,
        justifyContent: 'center', alignItems: 'center',
    },
    onboardRowTitle: {
        fontSize: 14, fontWeight: '800', color: '#0F172A',
    },
    onboardRowDesc: {
        fontSize: 12, color: '#64748B', lineHeight: 17, marginTop: 1,
    },
    onboardCta: {
        marginTop: 6, borderRadius: 14, overflow: 'hidden',
    },
    onboardCtaInner: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 6, paddingVertical: 14,
    },
    onboardCtaText: {
        fontSize: 15, fontWeight: '800', color: '#fff',
    },
    mapSideBtn: {
        width: 44, height: 44, borderRadius: 22,
        backgroundColor: 'rgba(30,30,30,0.85)',
        justifyContent: 'center', alignItems: 'center',
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3, shadowRadius: 6, elevation: 6,
    },
    mapSideBtnActive: {
        backgroundColor: 'rgba(30,30,30,0.95)',
    },

    popupOverlay: {
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        justifyContent: 'center', alignItems: 'center',
        paddingHorizontal: 24, zIndex: 30,
    },
    popupCard: {
        width: '100%', maxWidth: 360,
        backgroundColor: '#fff', borderRadius: r(20),
        overflow: 'hidden',
        shadowColor: '#000', shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.25, shadowRadius: 24, elevation: 20,
    },
    popupCloseBtn: {
        position: 'absolute', top: 12, right: 12, zIndex: 5,
        width: 32, height: 32, borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.9)',
        justifyContent: 'center', alignItems: 'center',
    },
    popupFavBtn: {
        position: 'absolute', top: 12, right: 52, zIndex: 5,
        width: 32, height: 32, borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.9)',
        justifyContent: 'center', alignItems: 'center',
    },
    popupPhoto: {
        width: '100%', height: 180,
    },
    popupBody: { padding: 16, gap: 8 },
    popupCatBadge: {
        flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
        gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
    },
    popupCatText: { fontSize: 12, fontWeight: '600' },
    popupTitle: { fontSize: 18, fontWeight: '800', color: '#1E293B', letterSpacing: -0.3 },
    popupDesc: { fontSize: 13, color: '#64748B', lineHeight: 19 },
    popupAddress: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    popupAddressText: { fontSize: 12, color: '#94A3B8', flex: 1 },
    popupFooter: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        marginTop: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F1F5F9',
    },
    popupMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    popupMetaText: { fontSize: 12, color: '#94A3B8' },
    popupMetaDot: { fontSize: 12, color: '#CBD5E1' },
    popupViewBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        backgroundColor: '#10B981', paddingHorizontal: 14, paddingVertical: 7,
        borderRadius: 20,
    },
    popupViewText: { fontSize: 13, fontWeight: '600', color: '#fff' },

    bottomSheet: {
        position: 'absolute', left: 0, right: 0,
        height: SHEET_FULL + 50,
        backgroundColor: '#fff',
        borderTopLeftRadius: 20, borderTopRightRadius: 20,
        shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.1, shadowRadius: 12, elevation: 20, zIndex: 15,
    },
    sheetHandleArea: { paddingTop: 10, paddingBottom: 10, paddingHorizontal: 16 },
    sheetHandle: {
        width: 36, height: 4, borderRadius: 2,
        backgroundColor: '#CBD5E1', alignSelf: 'center', marginBottom: 14,
    },
    sheetTitle: { fontSize: 22, fontWeight: '800', color: '#1E293B', letterSpacing: -0.3 },
    sheetSubtitle: { fontSize: 13, color: '#94A3B8', marginTop: 2 },

    categoryGrid: {
        flexDirection: 'row', flexWrap: 'wrap',
        paddingHorizontal: 16, paddingTop: 8, paddingBottom: 120, gap: CARD_GAP,
    },
    categoryCard: {
        width: CARD_W, borderRadius: r(16), overflow: 'hidden',
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1, shadowRadius: 6, elevation: 3,
    },
    categoryGradient: { padding: 14, minHeight: 110, justifyContent: 'flex-end' },
    categoryIconWrap: {
        width: 40, height: 40, borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.25)',
        justifyContent: 'center', alignItems: 'center', marginBottom: 10,
    },
    categoryLabel: { fontSize: 15, fontWeight: '700', color: '#fff' },
    categoryLabelKo: { fontSize: 11, fontWeight: '500', color: 'rgba(255,255,255,0.85)', marginTop: 2 },
    categoryBadge: {
        position: 'absolute', top: 10, right: 10,
        backgroundColor: 'rgba(255,255,255,0.3)',
        paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
    },
    categoryBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },

    sheetHeaderRow: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    },
    sheetClearBtn: {
        backgroundColor: '#F1F5F9', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    },
    sheetClearText: { fontSize: 12, fontWeight: '600', color: '#64748B' },

    postList: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 120, gap: 12 },
    postCard: {
        flexDirection: 'row', backgroundColor: '#F8FAFC',
        borderRadius: r(14), overflow: 'hidden',
    },
    postImage: { width: 90, height: 90 },
    postInfo: { flex: 1, padding: 10, justifyContent: 'center', gap: 3 },
    postTitle: { fontSize: 14, fontWeight: '700', color: '#1E293B' },
    postDesc: { fontSize: 12, color: '#64748B', lineHeight: 17 },
    postBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
    postMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    postMetaText: { fontSize: 11, color: '#94A3B8' },
    postMetaDot: { fontSize: 11, color: '#CBD5E1' },
    postLocationTag: {
        flexDirection: 'row', alignItems: 'center', gap: 2,
        backgroundColor: '#ECFDF5', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
    },
    postLocationText: { fontSize: 10, fontWeight: '600', color: '#10B981' },

    emptyState: { alignItems: 'center', paddingTop: 40, gap: 8 },
    emptyText: { fontSize: 16, fontWeight: '600', color: '#94A3B8' },
    emptySubtext: { fontSize: 13, color: '#CBD5E1' },

    sheetBackBtn: {
        width: 30, height: 30, borderRadius: 15,
        backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center',
        marginRight: 10,
    },

    detailContent: { paddingHorizontal: 16, paddingBottom: 120 },
    detailCard: {
        backgroundColor: '#F8FAFC', borderRadius: r(16),
        overflow: 'hidden',
    },
    detailPhoto: { width: '100%', height: 140 },
    detailBody: { padding: 14, gap: 6 },
    detailTitle: { fontSize: 16, fontWeight: '700', color: '#1E293B', letterSpacing: -0.2 },
    detailDesc: { fontSize: 13, color: '#475569', lineHeight: 19 },
    detailAddress: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    detailAddressText: { fontSize: 12, color: '#94A3B8', flex: 1 },
    detailFooter: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#E2E8F0',
    },
    detailAuthor: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    detailMetaText: { fontSize: 12, color: '#94A3B8' },
    detailFavBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        borderWidth: 1.5, borderColor: '#F43F5E',
        paddingHorizontal: 12, paddingVertical: 5, borderRadius: 18,
    },
    detailFavBtnActive: {
        backgroundColor: '#F43F5E', borderColor: '#F43F5E',
    },
    detailFavText: { fontSize: 12, fontWeight: '600', color: '#F43F5E' },

    fab: {
        position: 'absolute', bottom: SHEET_PEEK + 16, right: 16,
        width: 52, height: 52, borderRadius: 26,
        backgroundColor: '#10B981', justifyContent: 'center', alignItems: 'center',
        shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.25, shadowRadius: 6, elevation: 8, zIndex: 20,
    },
    zoomBtn: {
        width: 44, height: 40,
        backgroundColor: 'rgba(30,30,30,0.85)',
        justifyContent: 'center', alignItems: 'center',
    },

    nearbySection: { marginTop: 16, gap: 10 },
    nearbySectionTitle: { fontSize: 15, fontWeight: '700', color: '#1E293B', marginBottom: 2 },

    photoViewerOverlay: {
        flex: 1, backgroundColor: 'rgba(0,0,0,0.92)',
        justifyContent: 'center', alignItems: 'center',
    },
    photoViewerClose: {
        position: 'absolute', top: SAFE_TOP + 8, right: 16, zIndex: 10,
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.15)',
        justifyContent: 'center', alignItems: 'center',
    },
    photoViewerImage: {
        width: SCREEN_W - 32, height: SCREEN_H * 0.6,
    },
});
