import React, { useEffect, useState, useRef } from 'react';
import {
    View, Text, StyleSheet, FlatList, TouchableOpacity, Image,
    Alert, Platform, Dimensions, ActivityIndicator, Modal, TextInput,
    KeyboardAvoidingView, ScrollView, Switch, Keyboard, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { theme, r } from '../theme/theme';
import { db, auth, storage } from '../config/firebase';
import {
    collection, query, where, onSnapshot, addDoc, serverTimestamp,
    doc, deleteDoc, updateDoc, increment, getDoc, setDoc, orderBy,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { WebView } from 'react-native-webview';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { sendPushToUser } from '../utils/notifications';
import { RecommendationComments } from '../components/RecommendationComments';
import { openDirections } from '../utils/maps';
import { GooglePlaceChip } from '../components/GooglePlaceChip';
import { CUISINES, cuisineLabel } from '../components/LocalGuideCards';
import { classifyCuisine } from '../utils/gemini';
import { useIsWebDesktop } from '../utils/useResponsive';

const SCREEN_WIDTH = Dimensions.get('window').width;
const NAVER_CLIENT_ID = '3oyx9qih7m';

// Default location: Songdo, Incheon
const DEFAULT_LAT = 37.3815;
const DEFAULT_LNG = 126.6565;

interface Recommendation {
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
    authorId: string;
    authorName: string;
    authorPhoto?: string;
    likes: number;
    createdAt: any;
}

function timeAgo(timestamp: any): string {
    if (!timestamp) return '';
    const now = Date.now();
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const diff = Math.floor((now - date.getTime()) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return date.toLocaleDateString();
}

function NaverMapEmbed({ lat, lng, name, height = 160 }: { lat: number; lng: number; name?: string; height?: number }) {
    const markerTitle = (name || '').replace(/'/g, "\\'");
    const html = `
<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<script src="https://oapi.map.naver.com/openapi/v3/maps.js?ncpClientId=${NAVER_CLIENT_ID}"></script>
<style>* { margin: 0; padding: 0; } #map { width: 100%; height: 100vh; }</style>
</head><body>
<div id="map"></div>
<script>
var map = new naver.maps.Map('map', {
    center: new naver.maps.LatLng(${lat}, ${lng}),
    zoom: 16,
    zoomControl: false,
    mapTypeControl: false,
    scaleControl: false,
    logoControl: false,
    mapDataControl: false,
});
new naver.maps.Marker({
    position: new naver.maps.LatLng(${lat}, ${lng}),
    map: map,
    title: '${markerTitle}',
});
</script></body></html>`;

    return (
        <View style={{ height, borderRadius: r(12), overflow: 'hidden', marginVertical: 8 }}>
            <WebView
                source={{ html }}
                originWhitelist={['*']}
                scrollEnabled={false}
                style={{ flex: 1 }}
                javaScriptEnabled
            />
        </View>
    );
}

// ─── Map Picker Modal ───
function MapPickerModal({
    visible, onClose, onSelect,
}: {
    visible: boolean;
    onClose: () => void;
    onSelect: (lat: number, lng: number, address: string) => void;
}) {
    const isWebDesktop = useIsWebDesktop();
    const [region, setRegion] = useState({
        latitude: DEFAULT_LAT,
        longitude: DEFAULT_LNG,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
    });
    const [address, setAddress] = useState('');
    const [searchText, setSearchText] = useState('');
    const [searchResults, setSearchResults] = useState<Array<{id: string; name: string; address: string; lat: number; lng: number}>>([]);
    const [showResults, setShowResults] = useState(false);
    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mapPickerRef = useRef<any>(null);

    const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';

    // Go to user's current location on mount
    useEffect(() => {
        if (!visible) return;
        (async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status !== 'granted') return;
                const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
                const newRegion = {
                    latitude: loc.coords.latitude,
                    longitude: loc.coords.longitude,
                    latitudeDelta: 0.005,
                    longitudeDelta: 0.005,
                };
                setRegion(newRegion);
                mapPickerRef.current?.animateToRegion(newRegion, 400);
            } catch {}
        })();
    }, [visible]);

    const goToMyLocation = async () => {
        try {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
            const newRegion = {
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
                latitudeDelta: 0.005,
                longitudeDelta: 0.005,
            };
            setRegion(newRegion);
            mapPickerRef.current?.animateToRegion(newRegion, 400);
        } catch {}
    };

    // Reverse geocode on region change
    const handleRegionChange = async (r: any) => {
        setRegion(r);
        try {
            const res = await fetch(
                `https://maps.googleapis.com/maps/api/geocode/json?latlng=${r.latitude},${r.longitude}&key=${GOOGLE_MAPS_KEY}&language=en`
            );
            const data = await res.json();
            if (data.results?.[0]) {
                setAddress(data.results[0].formatted_address);
            }
        } catch {}
    };

    // Search places
    const searchPlaces = async (text: string) => {
        if (text.trim().length < 2) { setSearchResults([]); setShowResults(false); return; }
        try {
            const res = await fetch(
                `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(text)}&location=${region.latitude},${region.longitude}&radius=10000&key=${GOOGLE_MAPS_KEY}&language=ko`
            );
            const data = await res.json();
            const results = (data.results || []).slice(0, 5).map((p: any) => ({
                id: p.place_id,
                name: p.name,
                address: p.formatted_address,
                lat: p.geometry.location.lat,
                lng: p.geometry.location.lng,
            }));
            setSearchResults(results);
            setShowResults(results.length > 0);
        } catch { setSearchResults([]); }
    };

    const handleSearchChange = (text: string) => {
        setSearchText(text);
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        searchTimerRef.current = setTimeout(() => searchPlaces(text), 400);
    };

    const handleSelectPlace = (place: {lat: number; lng: number; address: string; name: string}) => {
        setShowResults(false);
        setSearchText(place.name);
        setAddress(place.address);
        const newRegion = { latitude: place.lat, longitude: place.lng, latitudeDelta: 0.003, longitudeDelta: 0.003 };
        setRegion(newRegion);
        mapPickerRef.current?.animateToRegion(newRegion, 400);
        Keyboard.dismiss();
    };

    return (
        <Modal visible={visible} animationType="slide">
            <View style={mapStyles.container}>
                <View style={[mapStyles.header, isWebDesktop && { paddingTop: 20 }]}>
                    <TouchableOpacity onPress={onClose} style={mapStyles.closeBtn}>
                        <Ionicons name="close" size={26} color={theme.colors.textPrimary} />
                    </TouchableOpacity>
                    <Text style={mapStyles.headerTitle}>Pick Location</Text>
                    <TouchableOpacity
                        style={mapStyles.confirmBtn}
                        onPress={() => onSelect(region.latitude, region.longitude, address)}
                    >
                        <Text style={mapStyles.confirmText}>Confirm</Text>
                    </TouchableOpacity>
                </View>
                {/* Search bar */}
                <View style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#fff' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F1F5F9', borderRadius: 10, paddingHorizontal: 12 }}>
                        <Ionicons name="search" size={16} color="#94A3B8" />
                        <TextInput
                            style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 8, fontSize: 14, color: '#0F172A' }}
                            placeholder="Search for a place..."
                            placeholderTextColor="#94A3B8"
                            value={searchText}
                            onChangeText={handleSearchChange}
                            returnKeyType="search"
                        />
                        {searchText.length > 0 && (
                            <TouchableOpacity onPress={() => { setSearchText(''); setShowResults(false); }}>
                                <Ionicons name="close-circle" size={18} color="#94A3B8" />
                            </TouchableOpacity>
                        )}
                    </View>
                    {showResults && (
                        <View style={{ backgroundColor: '#fff', borderRadius: 10, marginTop: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 }}>
                            {searchResults.map(r => (
                                <TouchableOpacity
                                    key={r.id}
                                    style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 0.5, borderBottomColor: '#E2E8F0' }}
                                    onPress={() => handleSelectPlace(r)}
                                >
                                    <Ionicons name="location" size={16} color="#10B981" />
                                    <View style={{ flex: 1, marginLeft: 8 }}>
                                        <Text style={{ fontSize: 14, fontWeight: '600', color: '#0F172A' }} numberOfLines={1}>{r.name}</Text>
                                        <Text style={{ fontSize: 11, color: '#64748B', marginTop: 2 }} numberOfLines={1}>{r.address}</Text>
                                    </View>
                                </TouchableOpacity>
                            ))}
                        </View>
                    )}
                </View>
                <View style={{ flex: 1 }}>
                    <MapView
                        ref={mapPickerRef}
                        style={{ flex: 1 }}
                        provider={PROVIDER_GOOGLE}
                        initialRegion={region}
                        onRegionChangeComplete={handleRegionChange}
                        showsUserLocation={true}
                        showsMyLocationButton={false}
                    />
                    {/* Center crosshair */}
                    <View style={{ position: 'absolute', top: '50%', left: '50%', marginLeft: -16, marginTop: -32, alignItems: 'center', pointerEvents: 'none' }}>
                        <Ionicons name="location" size={32} color="#4338CA" />
                    </View>
                    {/* My Location button */}
                    <TouchableOpacity
                        style={{
                            position: 'absolute', bottom: 20, right: 16,
                            width: 44, height: 44, borderRadius: 22,
                            backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center',
                            shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
                            shadowOpacity: 0.15, shadowRadius: 4, elevation: 4,
                        }}
                        onPress={goToMyLocation}
                    >
                        <Ionicons name="navigate" size={20} color="#4338CA" />
                    </TouchableOpacity>
                </View>
                {address ? (
                    <View style={mapStyles.addressBar}>
                        <Ionicons name="location" size={16} color={theme.colors.primary} />
                        <Text style={mapStyles.addressText} numberOfLines={2}>{address}</Text>
                    </View>
                ) : null}
            </View>
        </Modal>
    );
}

const mapStyles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingTop: 60, paddingBottom: 12,
        backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.borderLight,
    },
    closeBtn: { padding: 4 },
    headerTitle: { fontSize: 18, fontWeight: '700', color: theme.colors.textPrimary },
    confirmBtn: {
        backgroundColor: theme.colors.primary, paddingHorizontal: 18, paddingVertical: 8,
        borderRadius: r(20),
    },
    confirmText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    addressBar: {
        position: 'absolute', bottom: 40, left: 16, right: 16,
        flexDirection: 'row', alignItems: 'center', gap: 8,
        backgroundColor: '#fff', padding: 14, borderRadius: r(14),
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 6,
    },
    addressText: { flex: 1, fontSize: 14, fontWeight: '500', color: theme.colors.textPrimary },
});

// ─── Main Screen ───
export function LocalGuideScreen({ route, navigation }: any) {
    const isWebDesktop = useIsWebDesktop();
    const categoryData = route?.params?.category;
    const [recs, setRecs] = useState<Recommendation[]>([]);
    const [loading, setLoading] = useState(true);
    const [likedRecs, setLikedRecs] = useState<Set<string>>(new Set());
    const [showAdd, setShowAdd] = useState(false);

    // Add form state
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [photos, setPhotos] = useState<string[]>([]);
    const [locationLat, setLocationLat] = useState<number | null>(null);
    const [locationLng, setLocationLng] = useState<number | null>(null);
    const [locationAddr, setLocationAddr] = useState('');
    const [showMapPicker, setShowMapPicker] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [detailItem, setDetailItem] = useState<Recommendation | null>(null);
    const [photoIdx, setPhotoIdx] = useState(0);
    useEffect(() => { setPhotoIdx(0); }, [detailItem?.id]);

    // ─── Community-contributed photos (others can add their own shots) ───
    const [contributedPhotos, setContributedPhotos] = useState<
        { id: string; url: string; authorId: string; authorName: string }[]
    >([]);
    const [addingPhoto, setAddingPhoto] = useState(false);
    useEffect(() => {
        setContributedPhotos([]);
        if (!detailItem?.id) return;
        const q = query(
            collection(db, 'local_recommendations', detailItem.id, 'contributedPhotos'),
            orderBy('createdAt', 'asc'),
        );
        return onSnapshot(q, snap => {
            setContributedPhotos(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
        }, () => {});
    }, [detailItem?.id]);

    const addContributedPhotos = async () => {
        const rec = detailItem;
        const user = auth.currentUser;
        if (!rec || !user) return;
        const remaining = 8 - contributedPhotos.length;
        if (remaining <= 0) { Alert.alert('This place already has plenty of community photos 📸'); return; }
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { Alert.alert('Permission needed'); return; }
        const result = await ImagePicker.launchImageLibraryAsync({
            quality: 0.6,
            allowsMultipleSelection: true,
            selectionLimit: remaining,
        });
        if (result.canceled || result.assets.length === 0) return;
        setAddingPhoto(true);
        try {
            for (const a of result.assets) {
                const compressed = await manipulateAsync(a.uri, [{ resize: { width: 1024 } }], { compress: 0.6, format: SaveFormat.JPEG });
                const response = await fetch(compressed.uri);
                const blob = await response.blob();
                const filename = `local_guide/${user.uid}/contrib_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
                const storageRef = ref(storage, filename);
                await uploadBytes(storageRef, blob);
                const url = await getDownloadURL(storageRef);
                await addDoc(collection(db, 'local_recommendations', rec.id, 'contributedPhotos'), {
                    url,
                    authorId: user.uid,
                    authorName: user.displayName || 'Anonymous',
                    authorPhoto: user.photoURL || null,
                    createdAt: serverTimestamp(),
                });
            }
            // Notify the recommendation's author (not on self-contribution)
            if (rec.authorId && rec.authorId !== user.uid) {
                const t = `${user.displayName || 'Someone'} added a photo to ${rec.title}`;
                const b = 'Tap to see the new photo on your recommendation.';
                addDoc(collection(db, 'dolphin_notifications'), {
                    recipientId: rec.authorId, type: 'like', title: t, body: b,
                    createdAt: serverTimestamp(), read: false,
                }).catch(() => {});
                sendPushToUser(rec.authorId, t, b, { type: 'like' });
            }
        } catch (e: any) {
            Alert.alert('Upload failed', e?.message || 'Please try again.');
        } finally {
            setAddingPhoto(false);
        }
    };
    const [cuisineFilter, setCuisineFilter] = useState<string | null>(null);
    const [showMapModal, setShowMapModal] = useState(false);
    // Edit mode state
    const [isEditing, setIsEditing] = useState(false);
    const [editTitle, setEditTitle] = useState('');
    const [editDesc, setEditDesc] = useState('');
    const [editLat, setEditLat] = useState<number | null>(null);
    const [editLng, setEditLng] = useState<number | null>(null);
    const [editAddr, setEditAddr] = useState('');
    const [showEditMapPicker, setShowEditMapPicker] = useState(false);
    const [savingEdit, setSavingEdit] = useState(false);

    useEffect(() => {
        if (!categoryData) return;
        // Simple query without orderBy — no composite index needed
        const q = query(
            collection(db, 'local_recommendations'),
            where('category', '==', categoryData.key),
        );
        const unsub = onSnapshot(q, snap => {
            const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as Recommendation));
            items.sort((a, b) => {
                const ta = a.createdAt?.seconds || a.createdAt?.toDate?.()?.getTime?.() / 1000 || 0;
                const tb = b.createdAt?.seconds || b.createdAt?.toDate?.()?.getTime?.() / 1000 || 0;
                return tb - ta;
            });
            setRecs(items);
            setLoading(false);
        }, (err) => {
            console.warn('LocalGuide query error:', err.message);
            setLoading(false);
        });
        return unsub;
    }, [categoryData?.key]);

    // Auto-open a specific item when navigated from the map (e.g. Edit on own post)
    const openedItemRef = useRef(false);
    useEffect(() => {
        const openItemId = route?.params?.openItemId;
        if (!openItemId || openedItemRef.current || recs.length === 0) return;
        const target = recs.find(r => r.id === openItemId);
        if (!target) return;
        openedItemRef.current = true;
        setDetailItem(target);
        if (route?.params?.startEdit && target.authorId === auth.currentUser?.uid) {
            startEditing(target);
        }
    }, [recs.length, route?.params?.openItemId]);

    // Load liked status (live mirror at users/{uid}/liked_recs)
    useEffect(() => {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        return onSnapshot(collection(db, 'users', uid, 'liked_recs'), snap => {
            setLikedRecs(new Set(snap.docs.map(d => d.id)));
        }, () => {});
    }, []);

    const toggleLike = async (recId: string) => {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        const likeRef = doc(db, 'local_recommendations', recId, 'likes', uid);
        const recRef = doc(db, 'local_recommendations', recId);
        const mirrorRef = doc(db, 'users', uid, 'liked_recs', recId);
        if (likedRecs.has(recId)) {
            setLikedRecs(prev => { const n = new Set(prev); n.delete(recId); return n; });
            try {
                await deleteDoc(likeRef);
                await updateDoc(recRef, { likes: increment(-1) });
                await deleteDoc(mirrorRef);
            } catch {}
        } else {
            setLikedRecs(prev => new Set(prev).add(recId));
            try {
                await setDoc(likeRef, { userId: uid, createdAt: new Date() });
                await setDoc(mirrorRef, { createdAt: new Date() });
                await updateDoc(recRef, { likes: increment(1) });
                // Notify the author (not on self-like)
                const rec = recs.find(r => r.id === recId);
                const user = auth.currentUser;
                if (rec && user && rec.authorId && rec.authorId !== uid) {
                    const likeTitle = `${user.displayName || 'Someone'} liked your recommendation`;
                    const likeBody = (rec.title || '').substring(0, 80);
                    addDoc(collection(db, 'dolphin_notifications'), {
                        recipientId: rec.authorId,
                        type: 'like',
                        title: likeTitle,
                        body: likeBody,
                        createdAt: serverTimestamp(),
                        read: false,
                    }).catch(() => {});
                    sendPushToUser(rec.authorId, likeTitle, likeBody, { type: 'like' });
                }
            } catch {}
        }
    };

    const pickPhoto = async () => {
        const remaining = 4 - photos.length;
        if (remaining <= 0) { Alert.alert('Maximum 4 photos'); return; }
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { Alert.alert('Permission needed'); return; }
        // Multi-select (allowsEditing is incompatible with multi-select on iOS)
        const result = await ImagePicker.launchImageLibraryAsync({
            quality: 0.6,
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

    const handleSubmit = async () => {
        if (!title.trim()) { Alert.alert('Missing', 'Please enter a place name.'); return; }
        const user = auth.currentUser;
        if (!user) return;
        setSubmitting(true);
        try {
            const uploadedUrls: string[] = [];
            for (const p of photos) {
                if (p.startsWith('https://')) { uploadedUrls.push(p); continue; }
                const compressed = await manipulateAsync(p, [{ resize: { width: 800 } }], { compress: 0.6, format: SaveFormat.JPEG });
                const response = await fetch(compressed.uri);
                const blob = await response.blob();
                const filename = `local_guide/${user.uid}/${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
                const storageRef = ref(storage, filename);
                await uploadBytes(storageRef, blob);
                uploadedUrls.push(await getDownloadURL(storageRef));
            }
            await addDoc(collection(db, 'local_recommendations'), {
                title: title.trim(),
                description: description.trim(),
                category: categoryData.key,
                photo: uploadedUrls[0] || null,
                photos: uploadedUrls,
                latitude: locationLat,
                longitude: locationLng,
                address: locationAddr,
                authorId: user.uid,
                authorName: user.displayName || 'Anonymous',
                authorPhoto: user.photoURL || null,
                likes: 0,
                createdAt: serverTimestamp(),
            });
            setTitle(''); setDescription(''); setPhotos([]);
            setLocationLat(null); setLocationLng(null); setLocationAddr('');
            setShowAdd(false);
        } catch (e: any) {
            Alert.alert('Error', e.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = (rec: Recommendation) => {
        if (rec.authorId !== auth.currentUser?.uid) return;
        Alert.alert('Delete', 'Delete this recommendation?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: async () => {
                try { await deleteDoc(doc(db, 'local_recommendations', rec.id)); } catch {}
            }},
        ]);
    };

    const startEditing = (rec: Recommendation) => {
        setEditTitle(rec.title);
        setEditDesc(rec.description || '');
        setEditLat(rec.latitude || null);
        setEditLng(rec.longitude || null);
        setEditAddr(rec.address || '');
        setIsEditing(true);
    };

    const handleSaveEdit = async () => {
        if (!detailItem) return;
        setSavingEdit(true);
        try {
            const updateData: any = {
                title: editTitle.trim(),
                description: editDesc.trim(),
            };
            if (detailItem.category === 'restaurant') {
                // Re-detect cuisine with AI when the post changes; keep the old one on failure
                const detected = await classifyCuisine({
                    name: editTitle.trim(),
                    description: editDesc.trim(),
                    address: editAddr,
                }).catch(() => null);
                updateData.cuisine = detected ?? detailItem.cuisine ?? null;
            }
            if (editLat != null && editLng != null) {
                updateData.latitude = editLat;
                updateData.longitude = editLng;
                updateData.address = editAddr;
            }
            await updateDoc(doc(db, 'local_recommendations', detailItem.id), updateData);
            setIsEditing(false);
            // Update detailItem in place
            setDetailItem(prev => prev ? { ...prev, ...updateData } : null);
            Alert.alert('Saved', 'Your changes have been saved.');
        } catch (e: any) {
            Alert.alert('Error', e.message || 'Failed to save.');
        } finally {
            setSavingEdit(false);
        }
    };

    const renderItem = ({ item }: { item: Recommendation }) => {
        const isLiked = likedRecs.has(item.id);
        const thumb = item.photos?.[0] || item.photo;
        const photoCount = item.photos?.length || (item.photo ? 1 : 0);
        return (
            <TouchableOpacity
                style={styles.recCard}
                activeOpacity={0.85}
                onPress={() => setDetailItem(item)}
            >
                {thumb && (
                    <View>
                        <Image source={{ uri: thumb }} style={styles.recPhoto} />
                        {photoCount > 1 && (
                            <View style={styles.photoCountBadge}>
                                <Ionicons name="images" size={10} color="#fff" />
                                <Text style={styles.photoCountText}>{photoCount}</Text>
                            </View>
                        )}
                    </View>
                )}
                <View style={styles.recContent}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={[styles.recTitle, { flexShrink: 1 }]} numberOfLines={1}>{item.title}</Text>
                        {item.cuisine ? (
                            <View style={styles.recCuisineBadge}>
                                <Text style={styles.recCuisineBadgeText}>{cuisineLabel(item.cuisine)}</Text>
                            </View>
                        ) : null}
                    </View>
                    {item.description ? (
                        <Text style={styles.recDesc} numberOfLines={1}>{item.description}</Text>
                    ) : null}
                    <View style={styles.recFooter}>
                        <Text style={styles.recMeta}>{item.authorName} · {timeAgo(item.createdAt)}</Text>
                        <View style={styles.likeBtn}>
                            <Ionicons name={isLiked ? 'heart' : 'heart-outline'} size={14} color={isLiked ? '#EF4444' : theme.colors.textMuted} />
                            <Text style={[styles.likeCount, isLiked && { color: '#EF4444' }]}>{item.likes || 0}</Text>
                        </View>
                    </View>
                </View>
            </TouchableOpacity>
        );
    };

    // ─── Detail Modal ───
    const renderDetailModal = () => {
        if (!detailItem) return null;
        const isLiked = likedRecs.has(detailItem.id);
        const isOwner = detailItem.authorId === auth.currentUser?.uid;
        const ownerPhotos = detailItem.photos?.length ? detailItem.photos : (detailItem.photo ? [detailItem.photo] : []);
        // One swipeable gallery: owner's photos first, then community contributions
        const gallery: { uri: string; by: string | null }[] = [
            ...ownerPhotos.map(uri => ({ uri, by: null as string | null })),
            ...contributedPhotos.map(c => ({ uri: c.url, by: c.authorName })),
        ];
        return (
            <Modal visible={!!detailItem} animationType="slide" onRequestClose={() => setDetailItem(null)}>
                <KeyboardAvoidingView
                    style={{ flex: 1, backgroundColor: theme.colors.background }}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >
                    {/* Header */}
                    <View style={[styles.detailHeader, isWebDesktop && { paddingTop: 20 }]}>
                        <TouchableOpacity onPress={() => { setDetailItem(null); setIsEditing(false); }}>
                            <Ionicons name="chevron-back" size={26} color={theme.colors.textPrimary} />
                        </TouchableOpacity>
                        <Text style={styles.detailHeaderTitle} numberOfLines={1}>{detailItem.title}</Text>
                        {isOwner ? (
                            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                                {isEditing ? (
                                    <TouchableOpacity onPress={handleSaveEdit} disabled={savingEdit}>
                                        {savingEdit ? (
                                            <ActivityIndicator size="small" color={theme.colors.primary} />
                                        ) : (
                                            <Ionicons name="checkmark-circle" size={24} color="#10B981" />
                                        )}
                                    </TouchableOpacity>
                                ) : (
                                    <TouchableOpacity onPress={() => startEditing(detailItem)}>
                                        <Ionicons name="create-outline" size={20} color={theme.colors.primary} />
                                    </TouchableOpacity>
                                )}
                                <TouchableOpacity onPress={() => { handleDelete(detailItem); setDetailItem(null); }}>
                                    <Ionicons name="trash-outline" size={20} color="#EF4444" />
                                </TouchableOpacity>
                            </View>
                        ) : <View style={{ width: 20 }} />}
                    </View>
                    <ScrollView showsVerticalScrollIndicator={false}>
                        {/* Photos — rounded carousel (owner + community contributions) */}
                        {gallery.length > 0 ? (
                            <View>
                                <ScrollView
                                    horizontal
                                    pagingEnabled
                                    showsHorizontalScrollIndicator={false}
                                    onMomentumScrollEnd={e => setPhotoIdx(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH))}
                                >
                                    {gallery.map((g, i) => (
                                        <View key={i} style={{ width: SCREEN_WIDTH, paddingHorizontal: 16, paddingTop: 12 }}>
                                            <Image source={{ uri: g.uri }} style={styles.detailPhotoCard} resizeMode="cover" />
                                            {g.by ? (
                                                <View style={styles.contribByBadge}>
                                                    <Ionicons name="camera" size={10} color="#fff" />
                                                    <Text style={styles.contribByText}>by {g.by.split(' ')[0]}</Text>
                                                </View>
                                            ) : null}
                                        </View>
                                    ))}
                                </ScrollView>
                                {/* Add-photo pill — anyone can contribute their own shots */}
                                {!isEditing && (
                                    <TouchableOpacity
                                        style={styles.addPhotoPill}
                                        activeOpacity={0.85}
                                        onPress={addContributedPhotos}
                                        disabled={addingPhoto}
                                    >
                                        {addingPhoto ? (
                                            <ActivityIndicator size="small" color="#fff" />
                                        ) : (
                                            <>
                                                <Ionicons name="camera" size={13} color="#fff" />
                                                <Text style={styles.addPhotoPillText}>Add photo</Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                )}
                                {gallery.length > 1 && (
                                    <View style={styles.photoDots}>
                                        {gallery.map((_, i) => (
                                            <View key={i} style={[styles.photoDot, i === photoIdx && styles.photoDotActive]} />
                                        ))}
                                    </View>
                                )}
                            </View>
                        ) : (!isEditing && (
                            /* No photos yet — invite the community to add the first */
                            <TouchableOpacity style={styles.contribEmpty} activeOpacity={0.8} onPress={addContributedPhotos} disabled={addingPhoto}>
                                {addingPhoto ? (
                                    <ActivityIndicator size="small" color={theme.colors.textMuted} />
                                ) : (
                                    <>
                                        <Ionicons name="camera-outline" size={26} color={theme.colors.textMuted} />
                                        <Text style={styles.contribEmptyText}>Be the first to add a photo</Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        ))}
                        <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 }}>
                            {isEditing ? (
                                <>
                                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#94A3B8', marginBottom: 4 }}>Title</Text>
                                    <TextInput
                                        style={{ fontSize: 18, fontWeight: '700', color: '#0F172A', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', paddingVertical: 8, marginBottom: 12 }}
                                        value={editTitle}
                                        onChangeText={setEditTitle}
                                        placeholder="Title"
                                    />
                                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#94A3B8', marginBottom: 4 }}>Description</Text>
                                    <TextInput
                                        style={{ fontSize: 14, color: '#334155', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, padding: 12, minHeight: 80, marginBottom: 12 }}
                                        value={editDesc}
                                        onChangeText={setEditDesc}
                                        placeholder="Description"
                                        multiline
                                        textAlignVertical="top"
                                    />
                                    {detailItem.category === 'restaurant' && (
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F5F3FF', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 12 }}>
                                            <Ionicons name="sparkles" size={13} color="#8B5CF6" />
                                            <Text style={{ flex: 1, fontSize: 12, fontWeight: '500', color: '#6D28D9', lineHeight: 16 }}>
                                                Cuisine type is re-detected automatically when you save
                                            </Text>
                                        </View>
                                    )}
                                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#94A3B8', marginBottom: 4 }}>Location</Text>
                                    <TouchableOpacity
                                        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 12, backgroundColor: '#F1F5F9', borderRadius: 8, marginBottom: 8 }}
                                        onPress={() => setShowEditMapPicker(true)}
                                    >
                                        <Ionicons name="location" size={16} color="#10B981" />
                                        <Text style={{ fontSize: 13, color: '#475569', flex: 1 }} numberOfLines={1}>
                                            {editAddr || (editLat ? `${editLat.toFixed(5)}, ${editLng?.toFixed(5)}` : 'Tap to set location')}
                                        </Text>
                                        <Ionicons name="chevron-forward" size={14} color="#94A3B8" />
                                    </TouchableOpacity>
                                    {editLat && editLng && (
                                        <NaverMapEmbed lat={editLat} lng={editLng} name={editTitle} height={140} />
                                    )}
                                </>
                            ) : (
                                <>
                                    {/* Category + cuisine badges */}
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                        <View style={styles.detailCatBadge}>
                                            <Ionicons
                                                name={(categoryData?.icon as any) || 'location'}
                                                size={12}
                                                color={categoryData?.gradient?.[0] || theme.colors.primary}
                                            />
                                            <Text style={[styles.detailCatText, { color: categoryData?.gradient?.[0] || theme.colors.primary }]}>
                                                {categoryData?.label || detailItem.category}
                                            </Text>
                                        </View>
                                        {detailItem.cuisine ? (
                                            <View style={styles.detailCatBadge}>
                                                <Text style={[styles.detailCatText, { color: '#E11D48' }]}>
                                                    {cuisineLabel(detailItem.cuisine)}
                                                </Text>
                                            </View>
                                        ) : null}
                                    </View>

                                    <Text style={styles.detailTitle}>{detailItem.title}</Text>

                                    {/* Author row */}
                                    <View style={styles.detailAuthorRow}>
                                        {detailItem.authorPhoto ? (
                                            <Image source={{ uri: detailItem.authorPhoto }} style={styles.detailAvatar} />
                                        ) : (
                                            <View style={[styles.detailAvatar, styles.detailAvatarPh]}>
                                                <Text style={styles.detailAvatarInitial}>
                                                    {(detailItem.authorName || '?').charAt(0).toUpperCase()}
                                                </Text>
                                            </View>
                                        )}
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.detailAuthorName}>{detailItem.authorName}</Text>
                                            <Text style={styles.detailTimeText}>{timeAgo(detailItem.createdAt)}</Text>
                                        </View>
                                        <TouchableOpacity
                                            style={[styles.detailLikePill, isLiked && styles.detailLikePillActive]}
                                            onPress={() => toggleLike(detailItem.id)}
                                            activeOpacity={0.8}
                                        >
                                            <Ionicons
                                                name={isLiked ? 'heart' : 'heart-outline'}
                                                size={15}
                                                color={isLiked ? '#fff' : '#EF4444'}
                                            />
                                            <Text style={[styles.detailLikePillText, isLiked && { color: '#fff' }]}>
                                                {detailItem.likes || 0}
                                            </Text>
                                        </TouchableOpacity>
                                    </View>

                                    <View style={styles.detailDivider} />

                                    {detailItem.description ? (
                                        <Text style={styles.detailDesc}>{detailItem.description}</Text>
                                    ) : null}
                                    {(detailItem.address || (detailItem.latitude && detailItem.longitude)) ? (
                                        <TouchableOpacity
                                            style={styles.locationCard}
                                            activeOpacity={0.8}
                                            onPress={() => {
                                // View this place on the Dolphin map (pin + detail sheet)
                                setDetailItem(null);
                                navigation.navigate('Main', {
                                    screen: 'Local',
                                    params: { focusItemId: detailItem.id, focusTs: Date.now() },
                                });
                            }}
                                        >
                                            {/* Map icon preview */}
                                            <View style={styles.miniMapWrap}>
                                                <LinearGradient
                                                    colors={['#E0E7FF', '#C7D2FE']}
                                                    style={styles.miniMapGradient}
                                                >
                                                    <View style={styles.miniMapPin}>
                                                        <Ionicons name="location" size={20} color="#fff" />
                                                    </View>
                                                </LinearGradient>
                                            </View>
                                            <View style={styles.locationCardInfo}>
                                                <View style={styles.locationCardTop}>
                                                    <Ionicons name="navigate-outline" size={14} color={theme.colors.primary} />
                                                    <Text style={styles.locationCardLabel}>Location</Text>
                                                </View>
                                                {detailItem.address && (
                                                    <Text style={styles.locationCardAddr} numberOfLines={2}>{detailItem.address}</Text>
                                                )}
                                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                                                    <View style={styles.locationCardAction}>
                                                        <Ionicons name="map" size={11} color={theme.colors.primary} />
                                                        <Text style={styles.locationCardActionText}>View on Map</Text>
                                                        <Ionicons name="chevron-forward" size={12} color={theme.colors.primary} />
                                                    </View>
                                                    {detailItem.latitude && detailItem.longitude ? (
                                                        <TouchableOpacity
                                                            style={styles.locationCardAction}
                                                            hitSlop={{ top: 10, bottom: 10, left: 6, right: 10 }}
                                                            onPress={() => openDirections({
                                                                lat: detailItem.latitude!,
                                                                lng: detailItem.longitude!,
                                                                name: detailItem.title,
                                                                placeId: detailItem.placeId,
                                                            })}
                                                        >
                                                            <Ionicons name="navigate" size={11} color="#4285F4" />
                                                            <Text style={[styles.locationCardActionText, { color: '#4285F4' }]}>Directions</Text>
                                                        </TouchableOpacity>
                                                    ) : null}
                                                </View>
                                            </View>
                                        </TouchableOpacity>
                                    ) : null}

                                    {/* Linked Google Maps place */}
                                    <GooglePlaceChip placeId={detailItem.placeId} />
                                </>
                            )}
                            {/* Comments */}
                            {!isEditing && (
                                <RecommendationComments
                                    recId={detailItem.id}
                                    recTitle={detailItem.title}
                                    recAuthorId={detailItem.authorId}
                                />
                            )}
                        </View>
                    </ScrollView>
                    {renderMapModal()}
                    <MapPickerModal
                        visible={showEditMapPicker}
                        onClose={() => setShowEditMapPicker(false)}
                        onSelect={(lat, lng, addr) => {
                            setEditLat(lat);
                            setEditLng(lng);
                            setEditAddr(addr);
                            setShowEditMapPicker(false);
                        }}
                    />
                </KeyboardAvoidingView>
            </Modal>
        );
    };

    // ─── Full-screen Map Modal ───
    const renderMapModal = () => {
        if (!showMapModal || !detailItem?.latitude || !detailItem?.longitude) return null;
        const markerTitle = (detailItem.title || '').replace(/'/g, "\\'");
        const mapHtml = `
<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<script src="https://oapi.map.naver.com/openapi/v3/maps.js?ncpClientId=${NAVER_CLIENT_ID}"></script>
<style>
* { margin: 0; padding: 0; }
#map { width: 100%; height: 100vh; }
.info-window {
    background: #fff; border-radius: 12px; padding: 10px 14px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.15); font-family: -apple-system, sans-serif;
    max-width: 200px;
}
.info-title { font-size: 14px; font-weight: 700; color: #0F172A; margin-bottom: 2px; }
.info-addr { font-size: 11px; color: #64748B; }
</style>
</head><body>
<div id="map"></div>
<script>
var pos = new naver.maps.LatLng(${detailItem.latitude}, ${detailItem.longitude});
var map = new naver.maps.Map('map', {
    center: pos, zoom: 16,
    zoomControl: true,
    zoomControlOptions: { position: naver.maps.Position.RIGHT_CENTER },
});
var marker = new naver.maps.Marker({ position: pos, map: map, animation: naver.maps.Animation.DROP });
var infoWindow = new naver.maps.InfoWindow({
    content: '<div class="info-window"><div class="info-title">${markerTitle}</div><div class="info-addr">${(detailItem.address || '').replace(/'/g, "\\'")}</div></div>',
    borderWidth: 0, backgroundColor: 'transparent', disableAnchor: true,
    pixelOffset: new naver.maps.Point(0, -8),
});
infoWindow.open(map, marker);
</script></body></html>`;

        return (
            <Modal visible={showMapModal} animationType="slide" onRequestClose={() => setShowMapModal(false)}>
                <View style={{ flex: 1, backgroundColor: '#fff' }}>
                    <View style={[styles.mapModalHeader, isWebDesktop && { paddingTop: 20 }]}>
                        <TouchableOpacity onPress={() => setShowMapModal(false)} style={styles.mapModalClose}>
                            <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
                        </TouchableOpacity>
                        <View style={styles.mapModalTitleWrap}>
                            <Text style={styles.mapModalTitle} numberOfLines={1}>{detailItem.title}</Text>
                            {detailItem.address && (
                                <Text style={styles.mapModalAddr} numberOfLines={1}>{detailItem.address}</Text>
                            )}
                        </View>
                        <View style={{ width: 36 }} />
                    </View>
                    <WebView
                        source={{ html: mapHtml }}
                        originWhitelist={['*']}
                        style={{ flex: 1 }}
                        javaScriptEnabled
                    />
                </View>
            </Modal>
        );
    };

    if (!categoryData) return null;

    return (
        <View style={styles.container}>
            {/* Header */}
            <LinearGradient
                colors={categoryData.gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.header, isWebDesktop && { paddingTop: 20 }]}
            >
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={26} color="#fff" />
                </TouchableOpacity>
                <View style={styles.headerCenter}>
                    <Ionicons name={categoryData.icon} size={22} color="#fff" />
                    <Text style={styles.headerTitle}>{categoryData.label}</Text>
                    <Text style={styles.headerSubtitle}>{categoryData.labelKo}</Text>
                </View>
                <View style={{ width: 34 }} />
            </LinearGradient>

            {/* Cuisine filter (Restaurants only) */}
            {categoryData.key === 'restaurant' && recs.length > 0 && (
                <View style={styles.cuisineFilterWrap}>
                    <FlatList
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.cuisineFilterRow}
                        data={[{ key: '__all', label: 'All', emoji: '🍽️' }, ...CUISINES.filter(c => recs.some(r => r.cuisine === c.key))]}
                        keyExtractor={c => c.key}
                        renderItem={({ item: c }) => {
                            const active = c.key === '__all' ? cuisineFilter === null : cuisineFilter === c.key;
                            const count = c.key === '__all' ? recs.length : recs.filter(r => r.cuisine === c.key).length;
                            return (
                                <TouchableOpacity
                                    style={[styles.cuisineFilterChip, active && styles.cuisineFilterChipActive]}
                                    onPress={() => setCuisineFilter(c.key === '__all' ? null : c.key)}
                                    activeOpacity={0.8}
                                >
                                    <Text style={{ fontSize: 13 }}>{c.emoji}</Text>
                                    <Text style={[styles.cuisineFilterText, active && styles.cuisineFilterTextActive]}>
                                        {c.label} {count}
                                    </Text>
                                </TouchableOpacity>
                            );
                        }}
                    />
                </View>
            )}

            {/* Feed */}
            <FlatList
                data={categoryData.key === 'restaurant' && cuisineFilter
                    ? recs.filter(r => r.cuisine === cuisineFilter)
                    : recs}
                keyExtractor={item => item.id}
                renderItem={renderItem}
                contentContainerStyle={styles.list}
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        {loading ? (
                            <ActivityIndicator size="large" color={categoryData.gradient[0]} />
                        ) : (
                            <>
                                <Ionicons name={categoryData.icon} size={56} color={theme.colors.textMuted} />
                                <Text style={styles.emptyTitle}>No recommendations yet</Text>
                                <Text style={styles.emptySub}>Be the first to recommend a place!</Text>
                            </>
                        )}
                    </View>
                }
            />

            {/* FAB — routes through AddRecommendation so every new post is
                Google-place linked and duplicate-checked (one place, one post). */}
            <TouchableOpacity
                style={[styles.fab, { backgroundColor: categoryData.gradient[0] }]}
                activeOpacity={0.85}
                onPress={() => (navigation as any).navigate('AddRecommendation', { category: categoryData.key })}
            >
                <Ionicons name="add" size={22} color="#fff" />
                <Text style={styles.fabText}>Recommend</Text>
            </TouchableOpacity>

            {renderDetailModal()}

            {/* Add Modal */}
            <Modal visible={showAdd} animationType="slide">
                <KeyboardAvoidingView style={styles.modalContainer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                    <View style={[styles.modalHeader, isWebDesktop && { paddingTop: 20 }]}>
                        <TouchableOpacity onPress={() => setShowAdd(false)}>
                            <Ionicons name="close" size={26} color={theme.colors.textPrimary} />
                        </TouchableOpacity>
                        <Text style={styles.modalHeaderTitle}>New Recommendation</Text>
                        <TouchableOpacity
                            style={[styles.submitBtn, !title.trim() && { opacity: 0.4 }]}
                            onPress={handleSubmit}
                            disabled={submitting || !title.trim()}
                        >
                            {submitting ? <ActivityIndicator size="small" color="#fff" /> : (
                                <Text style={styles.submitBtnText}>Post</Text>
                            )}
                        </TouchableOpacity>
                    </View>

                    <ScrollView style={styles.modalForm} keyboardShouldPersistTaps="handled">
                        {/* Photos (up to 4) */}
                        <View style={styles.photosGrid}>
                            {photos.map((uri, i) => (
                                <View key={i} style={styles.photoThumbWrap}>
                                    <Image source={{ uri }} style={styles.photoThumb} />
                                    <TouchableOpacity style={styles.photoRemove} onPress={() => removePhoto(i)}>
                                        <Ionicons name="close-circle" size={22} color="#fff" />
                                    </TouchableOpacity>
                                </View>
                            ))}
                            {photos.length < 4 && (
                                <TouchableOpacity style={styles.photoAddBtn} onPress={pickPhoto}>
                                    <Ionicons name="camera" size={24} color={theme.colors.textMuted} />
                                    <Text style={styles.photoAddText}>{photos.length === 0 ? 'Add' : `${photos.length}/4`}</Text>
                                </TouchableOpacity>
                            )}
                        </View>

                        <TextInput
                            style={styles.input}
                            placeholder="Place name (e.g. 봉추찜닭 송도점)"
                            placeholderTextColor={theme.colors.textMuted}
                            value={title}
                            onChangeText={setTitle}
                            maxLength={60}
                        />
                        <TextInput
                            style={[styles.input, styles.textArea]}
                            placeholder="Why do you recommend this place? Any tips?"
                            placeholderTextColor={theme.colors.textMuted}
                            value={description}
                            onChangeText={setDescription}
                            multiline
                            maxLength={500}
                        />

                        {/* Location */}
                        <TouchableOpacity
                            style={styles.locationBtn}
                            onPress={() => setShowMapPicker(true)}
                        >
                            <Ionicons name="location" size={20} color={locationLat ? theme.colors.primary : theme.colors.textMuted} />
                            <Text style={[styles.locationBtnText, locationLat != null && { color: theme.colors.primary }]}>
                                {locationAddr || 'Add Location on Map'}
                            </Text>
                            <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
                        </TouchableOpacity>

                        {locationLat && locationLng && (
                            <NaverMapEmbed lat={locationLat} lng={locationLng} name={title} height={140} />
                        )}
                    </ScrollView>
                </KeyboardAvoidingView>

                <MapPickerModal
                    visible={showMapPicker}
                    onClose={() => setShowMapPicker(false)}
                    onSelect={(lat, lng, addr) => {
                        setLocationLat(lat);
                        setLocationLng(lng);
                        setLocationAddr(addr);
                        setShowMapPicker(false);
                    }}
                />
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingTop: 60, paddingBottom: 20,
    },
    backBtn: { padding: 4 },
    headerCenter: { alignItems: 'center', gap: 4 },
    headerTitle: { fontSize: 22, fontWeight: '800', color: '#fff' },
    headerSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.8)' },

    // Compact card list
    list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 120 },
    recCard: {
        flexDirection: 'row', backgroundColor: '#fff', borderRadius: r(14), marginBottom: 10,
        overflow: 'hidden',
        shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
    },
    recPhoto: { width: 90, height: 90 },
    photoCountBadge: {
        position: 'absolute', bottom: 4, right: 4,
        flexDirection: 'row', alignItems: 'center', gap: 2,
        backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: r(6),
        paddingHorizontal: 5, paddingVertical: 2,
    },
    photoCountText: { fontSize: 9, fontWeight: '700', color: '#fff' },
    recContent: { flex: 1, padding: 10, justifyContent: 'center' },
    recTitle: { fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary },
    recDesc: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 2 },
    addressRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
    addressText: { fontSize: 12, color: theme.colors.primary, flex: 1 },
    recFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
    recMeta: { fontSize: 10, color: theme.colors.textMuted },
    likeBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    likeCount: { fontSize: 11, fontWeight: '600', color: theme.colors.textMuted },

    // Detail modal
    detailHeader: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingTop: 60, paddingBottom: 12,
        backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.borderLight,
    },
    detailHeaderTitle: { fontSize: 17, fontWeight: '700', color: theme.colors.textPrimary, flex: 1, marginHorizontal: 12 },
    detailTitle: {
        fontSize: 24, fontWeight: '900', color: theme.colors.textPrimary,
        letterSpacing: -0.5, lineHeight: 31, marginTop: 10, marginBottom: 12,
    },
    detailDesc: {
        fontSize: 15.5, color: '#475569', lineHeight: 25, marginBottom: 18,
    },
    detailPhotoCard: {
        width: '100%', height: (SCREEN_WIDTH - 32) * 0.62, borderRadius: 18,
        backgroundColor: '#F1F5F9',
    },
    photoDots: {
        flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10,
    },
    photoDot: {
        width: 6, height: 6, borderRadius: 3, backgroundColor: '#CBD5E1',
    },
    photoDotActive: {
        width: 16, backgroundColor: '#10B981',
    },
    // Community-contributed photos
    contribByBadge: {
        position: 'absolute', left: 26, bottom: 14,
        flexDirection: 'row', alignItems: 'center', gap: 3,
        backgroundColor: 'rgba(0,0,0,0.55)',
        paddingHorizontal: 8, paddingVertical: 4, borderRadius: 9999,
    },
    contribByText: { fontSize: 10, fontWeight: '700', color: '#fff' },
    addPhotoPill: {
        position: 'absolute', right: 26, bottom: 14,
        flexDirection: 'row', alignItems: 'center', gap: 5,
        backgroundColor: 'rgba(0,0,0,0.55)',
        paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9999,
        minWidth: 88, justifyContent: 'center',
    },
    addPhotoPillText: { fontSize: 12, fontWeight: '700', color: '#fff' },
    contribEmpty: {
        marginHorizontal: 16, marginTop: 12,
        height: (SCREEN_WIDTH - 32) * 0.42, borderRadius: 18,
        borderWidth: 1.5, borderColor: '#E2E8F0', borderStyle: 'dashed',
        backgroundColor: '#F8FAFC',
        justifyContent: 'center', alignItems: 'center', gap: 8,
    },
    contribEmptyText: { fontSize: 13, fontWeight: '600', color: theme.colors.textMuted },
    detailCatBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        alignSelf: 'flex-start',
        backgroundColor: '#F1F5F9', borderRadius: 9999,
        paddingHorizontal: 10, paddingVertical: 4,
    },
    detailCatText: {
        fontSize: 11.5, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3,
    },
    detailAuthorRow: {
        flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14,
    },
    detailAvatar: {
        width: 36, height: 36, borderRadius: 18,
    },
    detailAvatarPh: {
        backgroundColor: '#E0E7FF', justifyContent: 'center', alignItems: 'center',
    },
    detailAvatarInitial: {
        fontSize: 15, fontWeight: '800', color: '#6366F1',
    },
    detailAuthorName: {
        fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary,
    },
    detailTimeText: {
        fontSize: 12, color: theme.colors.textMuted, marginTop: 1,
    },
    detailLikePill: {
        flexDirection: 'row', alignItems: 'center', gap: 5,
        borderWidth: 1.5, borderColor: '#FECACA', backgroundColor: '#FEF2F2',
        borderRadius: 9999, paddingHorizontal: 12, paddingVertical: 6,
    },
    detailLikePillActive: {
        backgroundColor: '#EF4444', borderColor: '#EF4444',
    },
    detailLikePillText: {
        fontSize: 13, fontWeight: '800', color: '#EF4444',
    },
    detailDivider: {
        height: 1, backgroundColor: '#F1F5F9', marginBottom: 16,
    },
    cuisineFilterWrap: {
        backgroundColor: theme.colors.background,
        paddingVertical: 8,
    },
    cuisineFilterRow: {
        paddingHorizontal: 16,
        gap: 7,
    },
    cuisineFilterChip: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: 11, paddingVertical: 7, borderRadius: 9999,
        backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#E2E8F0',
    },
    cuisineFilterChipActive: {
        borderColor: '#F43F5E', backgroundColor: '#FFF1F2',
    },
    cuisineFilterText: {
        fontSize: 12.5, fontWeight: '600', color: '#64748B',
    },
    cuisineFilterTextActive: {
        color: '#E11D48', fontWeight: '800',
    },
    recCuisineBadge: {
        backgroundColor: '#FFF1F2', borderRadius: 9999,
        paddingHorizontal: 7, paddingVertical: 2,
    },
    recCuisineBadgeText: {
        fontSize: 10.5, fontWeight: '700', color: '#E11D48',
    },
    detailFooter: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.colors.borderLight,
    },
    photoIndicator: { alignItems: 'center', paddingVertical: 6, backgroundColor: '#F8FAFC' },
    photoIndicatorText: { fontSize: 11, color: theme.colors.textMuted, fontWeight: '500' },

    emptyContainer: { alignItems: 'center', marginTop: 80, gap: 8 },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: theme.colors.textPrimary },
    emptySub: { fontSize: 14, color: theme.colors.textMuted },

    fab: {
        position: 'absolute', bottom: 30, right: 20,
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 20, paddingVertical: 14, borderRadius: r(28),
        ...theme.shadows.lg,
    },
    fabText: { color: '#fff', fontSize: 15, fontWeight: '700' },

    // Add Modal
    modalContainer: { flex: 1, backgroundColor: theme.colors.background },
    modalHeader: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingTop: 60, paddingBottom: 12,
        backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.borderLight,
    },
    modalHeaderTitle: { fontSize: 18, fontWeight: '700', color: theme.colors.textPrimary },
    submitBtn: {
        backgroundColor: theme.colors.primary, paddingHorizontal: 18, paddingVertical: 8,
        borderRadius: r(20), minWidth: 60, alignItems: 'center',
    },
    submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    modalForm: { flex: 1, padding: 16 },

    // Multi-photo grid
    photosGrid: {
        flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16,
    },
    photoThumbWrap: {
        width: (SCREEN_WIDTH - 56) / 4, height: (SCREEN_WIDTH - 56) / 4,
        borderRadius: r(10), overflow: 'hidden', position: 'relative',
    },
    photoThumb: { width: '100%', height: '100%' },
    photoRemove: { position: 'absolute', top: 2, right: 2, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: r(11) },
    photoAddBtn: {
        width: (SCREEN_WIDTH - 56) / 4, height: (SCREEN_WIDTH - 56) / 4,
        borderRadius: r(10), borderWidth: 2, borderStyle: 'dashed',
        borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceAlt,
        justifyContent: 'center', alignItems: 'center', gap: 2,
    },
    photoAddText: { fontSize: 10, fontWeight: '600', color: theme.colors.textMuted },

    input: {
        backgroundColor: '#fff', borderRadius: r(14), padding: 14, fontSize: 15,
        color: theme.colors.textPrimary, borderWidth: 1, borderColor: theme.colors.borderLight,
        marginBottom: 12,
    },
    textArea: { minHeight: 100, textAlignVertical: 'top' },
    locationBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: '#fff', borderRadius: r(14), padding: 14,
        borderWidth: 1, borderColor: theme.colors.borderLight, marginBottom: 12,
    },
    locationBtnText: { flex: 1, fontSize: 14, fontWeight: '500', color: theme.colors.textMuted },

    // Location card in detail
    locationCard: {
        flexDirection: 'row', backgroundColor: '#F8FAFC', borderRadius: r(14),
        overflow: 'hidden', borderWidth: 1, borderColor: '#E2E8F0',
        marginTop: 4, marginBottom: 8,
    },
    miniMapWrap: {
        width: 80, height: '100%',
    },
    miniMapGradient: {
        flex: 1, justifyContent: 'center', alignItems: 'center',
    },
    miniMapPin: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: theme.colors.primary,
        justifyContent: 'center', alignItems: 'center',
        shadowColor: '#6366F1', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 6,
    },
    locationCardInfo: {
        flex: 1, padding: 12, justifyContent: 'center', gap: 4,
    },
    locationCardTop: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
    },
    locationCardLabel: {
        fontSize: 11, fontWeight: '700', color: theme.colors.primary, letterSpacing: 0.5,
    },
    locationCardAddr: {
        fontSize: 12, fontWeight: '500', color: '#475569', lineHeight: 16,
    },
    locationCardAction: {
        flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2,
    },
    locationCardActionText: {
        fontSize: 11, fontWeight: '700', color: theme.colors.primary,
    },

    // Full-screen map modal
    mapModalHeader: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingTop: 60, paddingBottom: 14,
        backgroundColor: '#fff',
        borderBottomWidth: 1, borderBottomColor: '#E2E8F0',
    },
    mapModalClose: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: '#F1F5F9',
        justifyContent: 'center', alignItems: 'center',
    },
    mapModalTitleWrap: {
        flex: 1, marginLeft: 12,
    },
    mapModalTitle: {
        fontSize: 16, fontWeight: '700', color: '#0F172A',
    },
    mapModalAddr: {
        fontSize: 11, color: '#64748B', marginTop: 1,
    },
});
