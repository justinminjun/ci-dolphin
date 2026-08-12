import React, { useEffect, useState, useRef } from 'react';
import {
    View, Text, StyleSheet, FlatList, Image, TouchableOpacity,
    RefreshControl, ActivityIndicator, TextInput, Animated, Dimensions,
    Platform, StatusBar, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme, r } from '../theme/theme';
import { isTablet, screenPadding, gridColumns, centerContent, CONTENT_MAX_WIDTH, WIDE_MAX_WIDTH } from '../theme/responsive';
import { useIsWebDesktop } from '../utils/useResponsive';
import { auth, db } from '../config/firebase';
import { collection, query, orderBy, onSnapshot, doc, getDoc, where } from 'firebase/firestore';
import { LOSTFOUND_CATEGORIES } from '../utils/gemini';
import { useScrollToTop } from '@react-navigation/native';
import { getBlockedUsers } from '../utils/moderation';

const { width, height } = Dimensions.get('window');
// Dimensions.get('window') is clamped to 480px on web (webDimensionsPolyfill.ts)
// for mobile-scale card math; the tablet/desktop grid needs the real width so
// cards don't shrink to fit a phantom 480px container on a wide screen.
const gridWidth = Platform.OS === 'web' && typeof window !== 'undefined' ? window.innerWidth : width;
const SAFE_TOP = Platform.OS === 'ios' ? 54 : (StatusBar.currentHeight || 24) + 10;
const CARD_GAP = 10;
const CARD_WIDTH = (width - 16 * 2 - CARD_GAP) / 2;
const cols = gridColumns(2);
const TABLET_CARD_WIDTH = (Math.min(gridWidth, WIDE_MAX_WIDTH) - screenPadding * 2 - CARD_GAP * (cols - 1)) / cols;

function timeAgo(ts: any) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'Just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

function getRoleLabel(email: string) {
    if (!email) return '';
    return email.includes('chadwickschool.org') ? 'Faculty' : 'Student';
}

// ─── Main Feed Screen ───
export function LostFoundScreen({ navigation }: any) {
    const isWebDesktop = useIsWebDesktop();
    const [posts, setPosts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<'all' | 'lost' | 'found' | 'resolved'>('all');
    const [categoryFilter, setCategoryFilter] = useState<string>('');
    const [authorPhotos, setAuthorPhotos] = useState<Record<string, string | null>>({});
    const [unreadCount, setUnreadCount] = useState(0);
    const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
    const feedRef = useRef<FlatList>(null);
    useScrollToTop(feedRef);

    // Unread notifications
    useEffect(() => {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        const q = query(collection(db, 'dolphin_notifications'), where('recipientId', '==', uid), where('read', '==', false));
        return onSnapshot(q, snap => setUnreadCount(snap.size), () => {});
    }, []);

    const fetchAuthorPhoto = async (authorId: string, postAuthorPhoto?: string | null) => {
        if (!authorId || authorId in authorPhotos) return;
        // 1. Use photo stored directly on the post if available
        if (postAuthorPhoto) { setAuthorPhotos(p => ({ ...p, [authorId]: postAuthorPhoto })); return; }
        // 2. Current user
        const cu = auth.currentUser;
        if (cu?.uid === authorId && cu.photoURL) { setAuthorPhotos(p => ({ ...p, [authorId]: cu.photoURL })); return; }
        // 3. Fetch from Firestore
        try {
            const snap = await getDoc(doc(db, 'users', authorId));
            setAuthorPhotos(p => ({ ...p, [authorId]: snap.exists() ? (snap.data().photoURL || null) : null }));
        } catch { setAuthorPhotos(p => ({ ...p, [authorId]: null })); }
    };

    // Live posts
    useEffect(() => {
        setLoading(true);
        const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'));
        const unsub = onSnapshot(q, snap => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setPosts(data);
            data.forEach((p: any) => { if (p.authorId) fetchAuthorPhoto(p.authorId, p.authorPhoto); });
            setLoading(false);
            setRefreshing(false);
        }, () => { setLoading(false); setRefreshing(false); });
        return unsub;
    }, []);

    // Load blocked users
    useEffect(() => {
        getBlockedUsers().then(setBlockedUsers);
    }, []);

    const handleRefresh = () => {
        setRefreshing(true);
        // onSnapshot already live — just reset flag after short delay
        setTimeout(() => setRefreshing(false), 1000);
    };

    const filtered = posts.filter(item => {
        if (blockedUsers.includes(item.authorId)) return false;
        if (filter === 'lost' && item.postType !== 'lost') return false;
        if (filter === 'found' && item.postType !== 'found') return false;
        if (filter === 'resolved' && item.status !== 'resolved') return false;
        if (filter === 'all' && item.status === 'resolved') return false;
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (item.title || '').toLowerCase().includes(q) ||
            (item.description || '').toLowerCase().includes(q) ||
            (item.location || '').toLowerCase().includes(q) ||
            (item.tags || []).some((t: string) => t.toLowerCase().includes(q));
    });
    // Apply category filter
    const finalFiltered = categoryFilter
        ? filtered.filter(item => (item.category || '') === categoryFilter)
        : filtered;

    const renderItem = ({ item }: { item: any }) => {
        const isLost = item.postType === 'lost';
        const isResolved = item.status === 'resolved';
        const img = item.imageUrls?.[0] || item.imageUrl;
        const imgCount = item.imageUrls ? item.imageUrls.length : (item.imageUrl ? 1 : 0);
        return (
            <TouchableOpacity
                style={[s.card, isTablet && s.cardTablet, isResolved && { opacity: 0.6 }]}
                onPress={() => navigation.navigate('LFDetail', { post: item })}
                activeOpacity={0.85}
            >
                <View>
                    {img
                        ? <Image source={{ uri: img }} style={[s.cardImg, isTablet && s.cardImgTablet]} />
                        : <View style={[s.cardImg, isTablet && s.cardImgTablet, { backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' }]}><Ionicons name="image-outline" size={36} color="#CBD5E1" /></View>
                    }
                    <View style={[s.badge, { backgroundColor: isLost ? '#FEE2E2' : '#D1FAE5' }]}>
                        <Text style={[s.badgeText, { color: isLost ? '#DC2626' : '#059669' }]}>{isLost ? 'Lost' : 'Found'}</Text>
                    </View>
                    {imgCount > 1 && <View style={s.imgCount}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{imgCount} photos</Text></View>}
                    {isResolved && <View style={s.resolvedBadge}><Text style={s.resolvedText}>✓ Resolved</Text></View>}
                </View>
                <View style={s.cardBody}>
                    <Text style={s.cardTitle} numberOfLines={1}>{item.title}</Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                        <Text style={s.cardLocation} numberOfLines={1}>{item.location || 'Unknown location'}</Text>
                        <Text style={s.cardTime}>{timeAgo(item.createdAt)}</Text>
                    </View>
                    {item.tags?.length > 0 && (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                            {item.tags.slice(0, 3).map((t: string, i: number) => (
                                <View key={i} style={s.tag}><Text style={s.tagText}>#{t}</Text></View>
                            ))}
                        </View>
                    )}
                    <View style={s.authorRow}>
                        {authorPhotos[item.authorId]
                            ? <Image source={{ uri: authorPhotos[item.authorId]! }} style={s.avatar} />
                            : <View style={[s.avatar, { backgroundColor: '#10B981', justifyContent: 'center', alignItems: 'center' }]}>
                                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{(item.authorName || 'U')[0].toUpperCase()}</Text>
                              </View>
                        }
                        <Text style={s.authorName}>{item.authorName}</Text>
                        {item.authorEmail && (
                            <View style={[s.roleBadge, { backgroundColor: getRoleLabel(item.authorEmail) === 'Faculty' ? '#FEF3C7' : '#EEF2FF' }]}>
                                <Text style={[s.roleText, { color: getRoleLabel(item.authorEmail) === 'Faculty' ? '#D97706' : '#4338CA' }]}>{getRoleLabel(item.authorEmail)}</Text>
                            </View>
                        )}
                    </View>
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <View style={s.root}>
            {/* Header — Lounge style */}
            <View style={[s.header, isWebDesktop && { paddingTop: 24 }]}>
                <Text style={s.headerTitle}>Lost & Found</Text>
                <View style={{ flexDirection: 'row', gap: 4 }}>
                    <TouchableOpacity style={s.headerIconBtn} onPress={() => navigation.navigate('Notifications')}>
                        <Ionicons name="notifications-outline" size={24} color={theme.colors.textPrimary} />
                        {unreadCount > 0 && (
                            <View style={s.notifBadge}>
                                <Text style={s.notifBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                            </View>
                        )}
                    </TouchableOpacity>
                </View>
            </View>

            {/* Filter links */}
            <View style={s.topLinksRow}>
                <View style={[s.topLinksInner, centerContent(CONTENT_MAX_WIDTH)]}>
                    {([
                        { key: 'all', label: 'All' },
                        { key: 'lost', label: 'Lost' },
                        { key: 'found', label: 'Found' },
                        { key: 'resolved', label: 'Resolved' },
                    ] as const).map(f => (
                        <TouchableOpacity key={f.key} onPress={() => setFilter(f.key)}>
                            <Text style={[s.filterLinkText, filter === f.key && s.filterLinkTextActive]}>{f.label}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>

            {/* Category filter pills */}
            <View style={s.pillContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={centerContent(CONTENT_MAX_WIDTH)} contentContainerStyle={s.pillScroll}>
                    <TouchableOpacity
                        style={[s.pill, !categoryFilter && s.pillActive]}
                        onPress={() => setCategoryFilter('')}
                    >
                        <Text style={[s.pillText, !categoryFilter && s.pillTextActive]}>All</Text>
                    </TouchableOpacity>
                    {LOSTFOUND_CATEGORIES.map(cat => (
                        <TouchableOpacity
                            key={cat}
                            style={[s.pill, categoryFilter === cat && s.pillActive]}
                            onPress={() => setCategoryFilter(categoryFilter === cat ? '' : cat)}
                        >
                            <Text style={[s.pillText, categoryFilter === cat && s.pillTextActive]}>{cat}</Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            {/* Scrollable list with header content */}
            <FlatList
                ref={feedRef}
                key={'cols-' + cols}
                data={finalFiltered}
                keyExtractor={item => item.id}
                renderItem={renderItem}
                contentContainerStyle={[s.list, isTablet && s.listTablet]}
                numColumns={cols}
                columnWrapperStyle={s.row}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.colors.primary} />}
                ListHeaderComponent={
                    <View style={centerContent(CONTENT_MAX_WIDTH)}>
                        {/* Tagline */}
                        <Text style={s.tagline}>
                            {'Lost something?\n'}Find it on Dolphin.
                        </Text>



                        {/* Search bar */}
                        <View style={s.searchBar}>
                            <Ionicons name="search-outline" size={18} color={theme.colors.textMuted} />
                            <TextInput
                                style={s.searchInput}
                                placeholder="Search by name, location, or tag..."
                                placeholderTextColor={theme.colors.textMuted}
                                value={search}
                                onChangeText={setSearch}
                            />
                            {search.length > 0 && (
                                <TouchableOpacity onPress={() => setSearch('')}>
                                    <Ionicons name="close-circle" size={18} color={theme.colors.textMuted} />
                                </TouchableOpacity>
                            )}
                        </View>

                        {/* Results count */}
                        <View style={s.resultRow}>
                            <Text style={s.resultCount}>{finalFiltered.length} item{finalFiltered.length !== 1 ? 's' : ''}</Text>
                        </View>

                        {loading && <ActivityIndicator size="large" color="#10B981" style={{ marginTop: 20, marginBottom: 10 }} />}
                    </View>
                }
                ListEmptyComponent={
                    !loading ? (
                        <View style={s.emptyContainer}>
                            <Ionicons name="search-outline" size={64} color={theme.colors.textMuted} />
                            <Text style={s.emptyTitle}>{search ? 'No results found' : 'Nothing posted yet'}</Text>
                            <Text style={s.emptySubtitle}>{search ? 'Try a different search term' : 'Tap to report a lost or found item!'}</Text>
                        </View>
                    ) : null
                }
            />

            {/* + Post FAB */}
            <TouchableOpacity
                style={s.fab}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('LFAddPost', {})}
            >
                <Ionicons name="add" size={22} color="#fff" />
                <Text style={s.fabText}>Post</Text>
            </TouchableOpacity>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },

    // Header — unified with Market
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingTop: 60, paddingBottom: 10,
        backgroundColor: theme.colors.surface, ...theme.shadows.sm,
    },
    headerTitle: { fontSize: 24, fontWeight: '900', color: '#0C2340' },
    headerIconBtn: { padding: 6, position: 'relative' },
    notifBadge: {
        position: 'absolute', top: 0, right: -2,
        minWidth: 16, height: 16, borderRadius: 8,
        backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center',
        paddingHorizontal: 3, borderWidth: 1.5, borderColor: theme.colors.surface,
    },
    notifBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
    topLinksRow: {
        paddingBottom: 12,
        backgroundColor: theme.colors.surface,
    },
    topLinksInner: {
        flexDirection: 'row', alignItems: 'center', gap: 20,
        paddingHorizontal: 16,
    },
    filterLinkText: { fontSize: 18, fontWeight: '700', color: theme.colors.textMuted },
    filterLinkTextActive: { color: '#10B981' },
    pillContainer: { backgroundColor: theme.colors.surface, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.borderLight },
    pillScroll: { paddingHorizontal: 16, gap: 8 },
    pill: {
        paddingHorizontal: 14, paddingVertical: 8, borderRadius: r(20),
        backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.borderLight,
    },
    pillActive: { backgroundColor: '#10B981', borderColor: '#10B981' },
    pillText: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
    pillTextActive: { color: '#fff' },

    // List content — matched exactly to Market
    tagline: { fontSize: 22, fontWeight: '800', color: theme.colors.textPrimary, paddingHorizontal: 16, marginTop: 20, marginBottom: 16, lineHeight: 30 },
    quickRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginBottom: 16 },
    quickCard: {
        flex: 1, backgroundColor: '#fff', borderRadius: r(14), padding: 14,
        ...theme.shadows.sm, borderWidth: 1.5, borderColor: '#10B981',
    },
    quickIconWrap: { width: 36, height: 36, borderRadius: r(10), justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
    quickLabel: { fontSize: 14, fontWeight: '800', color: theme.colors.textPrimary },
    quickDesc: { fontSize: 11, color: theme.colors.textMuted, marginTop: 2 },

    searchBar: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#fff', borderRadius: r(12), paddingHorizontal: 14, paddingVertical: 12,
        marginHorizontal: 16, marginBottom: 12,
        borderWidth: 1.5, borderColor: '#10B981',
    },
    searchInput: { flex: 1, marginLeft: 8, fontSize: 14, color: theme.colors.textPrimary },

    resultRow: { paddingHorizontal: 16, marginBottom: 8, alignItems: 'flex-end' },
    resultCount: { fontSize: 12, color: theme.colors.textMuted },

    list: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: 100 },
    listTablet: { paddingHorizontal: screenPadding, width: '100%', maxWidth: WIDE_MAX_WIDTH, alignSelf: 'center' },
    row: { gap: CARD_GAP, marginBottom: CARD_GAP },
    card: { backgroundColor: '#fff', width: CARD_WIDTH, borderRadius: r(12), overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
    cardTablet: { width: TABLET_CARD_WIDTH },
    cardImg: { width: '100%', height: CARD_WIDTH, resizeMode: 'cover' },
    cardImgTablet: { height: TABLET_CARD_WIDTH },
    badge: { position: 'absolute', top: 8, left: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: r(16) },
    badgeText: { fontSize: 10, fontWeight: '800' },
    imgCount: { position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: r(8) },
    resolvedBadge: { position: 'absolute', top: 8, right: 8, backgroundColor: '#ECFDF5', paddingHorizontal: 8, paddingVertical: 3, borderRadius: r(16), borderWidth: 1, borderColor: '#A7F3D0' },
    resolvedText: { fontSize: 10, fontWeight: '700', color: '#059669' },
    cardBody: { padding: 10 },
    cardTitle: { fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary, marginBottom: 2 },
    cardLocation: { fontSize: 11, color: theme.colors.textSecondary, flex: 1 },
    cardTime: { fontSize: 11, color: theme.colors.textMuted },
    tag: { backgroundColor: '#F0FDF4', paddingHorizontal: 6, paddingVertical: 2, borderRadius: r(16) },
    tagText: { fontSize: 10, color: '#059669', fontWeight: '600' },
    authorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: 1, borderColor: '#F1F5F9', paddingTop: 8 },
    avatar: { width: 20, height: 20, borderRadius: r(10) },
    authorName: { fontSize: 11, color: theme.colors.textSecondary, fontWeight: '500' },
    roleBadge: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: r(4), marginLeft: 'auto' },
    roleText: { fontSize: 8, fontWeight: '700' },

    emptyContainer: { alignItems: 'center', paddingTop: 40 },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: theme.colors.textPrimary, marginTop: 16 },
    emptySubtitle: { fontSize: 14, color: theme.colors.textMuted, marginTop: 4, textAlign: 'center' },
    fab: {
        position: 'absolute', bottom: 20, right: 20,
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 20, paddingVertical: 14, borderRadius: r(28),
        backgroundColor: '#10B981',
        shadowColor: '#10B981', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4, shadowRadius: 8, elevation: 6,
    },
    fabText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

