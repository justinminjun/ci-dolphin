import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, RefreshControl, ActivityIndicator, TextInput } from 'react-native';
import { theme } from '../../theme/theme';
import { Ionicons } from '@expo/vector-icons';
import { auth, db } from '../config/firebase';
import { collection, query, orderBy, onSnapshot, getDocs, doc, getDoc } from 'firebase/firestore';
import { timeAgo } from '../utils/timeAgo';
import { getRoleLabel } from '../utils/userRole';

export function FeedScreen({ navigation }: any) {
    const [posts, setPosts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [filter, setFilter] = useState<'all' | 'lost' | 'found' | 'resolved'>('all');
    const [authorPhotos, setAuthorPhotos] = useState<Record<string, string | null>>({});

    const fetchAuthorPhoto = async (authorId: string) => {
        if (!authorId || authorId in authorPhotos) return;
        try {
            // For current user, use Firebase Auth photoURL directly (most reliable)
            const currentUser = auth.currentUser;
            if (currentUser && currentUser.uid === authorId && currentUser.photoURL) {
                setAuthorPhotos(prev => ({ ...prev, [authorId]: currentUser.photoURL }));
                return;
            }
            // For other users, fetch from Firestore
            const snap = await getDoc(doc(db, 'users', authorId));
            if (snap.exists()) {
                const data = snap.data();
                const photo = data.photoURL || null;
                setAuthorPhotos(prev => ({ ...prev, [authorId]: photo }));
            } else {
                setAuthorPhotos(prev => ({ ...prev, [authorId]: null }));
            }
        } catch {
            setAuthorPhotos(prev => ({ ...prev, [authorId]: null }));
        }
    };

    const fetchPosts = () => {
        try {
            const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'));
            const unsubscribe = onSnapshot(q, (snapshot) => {
                const fetched = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                setPosts(fetched);
                // Fetch author photos
                fetched.forEach((p: any) => { if (p.authorId) fetchAuthorPhoto(p.authorId); });
                setLoading(false);
                setRefreshing(false);
            }, () => {
                getDocs(collection(db, 'posts')).then(snapshot => {
                    setPosts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                    setLoading(false);
                    setRefreshing(false);
                });
            });
            return unsubscribe;
        } catch { setLoading(false); return () => { }; }
    };

    useEffect(() => { const u = fetchPosts(); return u; }, []);

    const filteredPosts = posts.filter((item: any) => {
        // Type filter
        if (filter === 'lost' && item.postType !== 'lost') return false;
        if (filter === 'found' && item.postType !== 'found') return false;
        if (filter === 'resolved' && item.status !== 'resolved') return false;
        // Hide resolved from 'all' unless explicitly viewing resolved
        if (filter === 'all' && item.status === 'resolved') return false;

        // Search filter
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
            (item.title || '').toLowerCase().includes(q) ||
            (item.description || '').toLowerCase().includes(q) ||
            (item.location || '').toLowerCase().includes(q) ||
            (item.tags || []).some((tag: string) => tag.toLowerCase().includes(q))
        );
    });

    const renderItem = ({ item }: { item: any }) => {
        const isLost = item.postType === 'lost';
        const isResolved = item.status === 'resolved';
        // Support both legacy imageUrl and new imageUrls array
        const displayImage = item.imageUrls && item.imageUrls.length > 0
            ? item.imageUrls[0]
            : item.imageUrl;
        const imageCount = item.imageUrls ? item.imageUrls.length : (item.imageUrl ? 1 : 0);
        return (
            <TouchableOpacity
                style={[styles.card, isResolved && styles.cardResolved]}
                onPress={() => navigation.navigate('Detail', { post: item })}
                activeOpacity={0.85}
            >
                <View style={styles.cardImageContainer}>
                    {displayImage ? (
                        <Image source={{ uri: displayImage }} style={styles.cardImage} />
                    ) : (
                        <View style={[styles.cardImage, styles.noImage]}><Text style={styles.noImageText}>No Image</Text></View>
                    )}
                    <View style={[styles.badge, isLost ? styles.badgeLost : styles.badgeFound]}>
                        <Text style={[styles.badgeText, isLost ? styles.badgeLostText : styles.badgeFoundText]}>
                            {isLost ? 'Lost' : 'Found'}
                        </Text>
                    </View>
                    {imageCount > 1 && (
                        <View style={styles.imageCountBadge}>
                            <Text style={styles.imageCountText}>{imageCount} photos</Text>
                        </View>
                    )}
                    {isResolved && (
                        <View style={styles.resolvedBadge}>
                            <Text style={styles.resolvedBadgeText}>✓ Resolved</Text>
                        </View>
                    )}
                </View>
                <View style={styles.cardContent}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                    <View style={styles.cardMeta}>
                        <Text style={styles.cardLocation} numberOfLines={1}>{item.location || 'Unknown location'}</Text>
                        <Text style={styles.cardTime}>{timeAgo(item.createdAt)}</Text>
                    </View>

                    {item.tags && item.tags.length > 0 && (
                        <View style={styles.tagsRow}>
                            {item.tags.slice(0, 3).map((tag: string, i: number) => (
                                <View key={i} style={styles.tag}>
                                    <Text style={styles.tagText}>#{tag}</Text>
                                </View>
                            ))}
                        </View>
                    )}

                    <View style={styles.authorRow}>
                        {authorPhotos[item.authorId] ? (
                            <Image source={{ uri: authorPhotos[item.authorId]! }} style={styles.avatarImage} />
                        ) : (
                            <View style={styles.avatar}>
                                <Text style={styles.avatarText}>{(item.authorName || 'U')[0].toUpperCase()}</Text>
                            </View>
                        )}
                        <Text style={styles.cardAuthor}>{item.authorName}</Text>
                        {item.authorEmail && (
                            <View style={[styles.roleBadge, getRoleLabel(item.authorEmail) === 'Student' ? styles.roleBadgeStudent : styles.roleBadgeFaculty]}>
                                <Text style={[styles.roleBadgeText, getRoleLabel(item.authorEmail) === 'Student' ? styles.roleBadgeTextStudent : styles.roleBadgeTextFaculty]}>
                                    {getRoleLabel(item.authorEmail)}
                                </Text>
                            </View>
                        )}
                    </View>
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <View style={styles.container}>
            {/* Search Bar */}
            <View style={styles.searchContainer}>
                <TextInput
                    style={styles.searchInput}
                    placeholder="Search items by name, location, or tag..."
                    placeholderTextColor={theme.colors.textMuted}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    clearButtonMode="while-editing"
                />
            </View>

            {/* Filter Tabs */}
            <View style={styles.filterRow}>
                {(['all', 'lost', 'found', 'resolved'] as const).map((f) => (
                    <TouchableOpacity
                        key={f}
                        style={[styles.filterTab, filter === f && styles.filterTabActive]}
                        onPress={() => setFilter(f)}
                        activeOpacity={0.7}
                    >
                        <Text style={[styles.filterTabText, filter === f && styles.filterTabTextActive]}>
                            {f === 'all' ? 'All' : f === 'lost' ? 'Lost' : f === 'found' ? 'Found' : 'Resolved'}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {loading ? (
                <ActivityIndicator size="large" color={theme.colors.primary} style={styles.loader} />
            ) : (
                <FlatList
                    data={filteredPosts}
                    keyExtractor={item => item.id}
                    renderItem={renderItem}
                    contentContainerStyle={styles.list}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchPosts(); }} tintColor={theme.colors.primary} />}
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <Text style={styles.emptyTitle}>{searchQuery ? 'No results found' : 'No items posted yet'}</Text>
                            <Text style={styles.emptySubtext}>{searchQuery ? 'Try a different search term' : 'Be the first to report a lost or found item!'}</Text>
                        </View>
                    }
                />
            )}

            {/* FAB */}
            <TouchableOpacity
                style={styles.fab}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('AddPost')}
            >
                <Ionicons name="add" size={24} color="#fff" />
                <Text style={styles.fabText}>Report</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    searchContainer: { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.sm, paddingBottom: theme.spacing.xs, backgroundColor: theme.colors.surface, borderBottomWidth: 0, borderBottomColor: theme.colors.border },
    searchInput: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.full, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: theme.colors.textPrimary },
    filterRow: { flexDirection: 'row', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, backgroundColor: theme.colors.surface, gap: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    filterTab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: theme.radius.full, backgroundColor: theme.colors.surfaceAlt },
    filterTabActive: { backgroundColor: theme.colors.primary },
    filterTabText: { ...theme.typography.caption, fontWeight: '600', color: theme.colors.textSecondary },
    filterTabTextActive: { color: '#fff' },
    loader: { marginTop: 40 },
    list: { padding: theme.spacing.md, paddingBottom: 20 },
    card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, marginBottom: theme.spacing.md, overflow: 'hidden', ...theme.shadows.md },
    cardResolved: { opacity: 0.6 },
    cardImageContainer: { position: 'relative' },
    cardImage: { width: '100%', height: 180, resizeMode: 'cover' },
    noImage: { backgroundColor: theme.colors.surfaceAlt, justifyContent: 'center', alignItems: 'center' },
    noImageText: { ...theme.typography.bodySecondary, color: theme.colors.textMuted },
    badge: { position: 'absolute', top: 10, left: 10, paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.full },
    badgeFound: { backgroundColor: theme.colors.foundBg },
    badgeLost: { backgroundColor: theme.colors.lostBg },
    badgeText: { ...theme.typography.tag, fontWeight: '600' },
    badgeFoundText: { color: theme.colors.foundText },
    badgeLostText: { color: theme.colors.lostText },
    resolvedBadge: { position: 'absolute', top: 10, right: 10, backgroundColor: '#ECFDF5', paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.full, borderWidth: 1, borderColor: '#A7F3D0' },
    resolvedBadgeText: { fontSize: 11, fontWeight: '700', color: theme.colors.success },
    imageCountBadge: { position: 'absolute', bottom: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.full, flexDirection: 'row', alignItems: 'center' },
    imageCountText: { color: '#fff', fontSize: 11, fontWeight: '600' },
    cardContent: { padding: theme.spacing.md },
    cardTitle: { ...theme.typography.h3, color: theme.colors.textPrimary, marginBottom: 4 },
    cardMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.sm },
    cardLocation: { ...theme.typography.caption, color: theme.colors.textSecondary, flex: 1 },
    cardTime: { ...theme.typography.caption, color: theme.colors.textMuted },
    tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: theme.spacing.sm },
    tag: { backgroundColor: theme.colors.tagBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.full },
    tagText: { ...theme.typography.tag, color: theme.colors.tagText },
    authorRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, borderTopWidth: 1, borderColor: theme.colors.borderLight, paddingTop: theme.spacing.sm },
    avatar: { width: 24, height: 24, borderRadius: 12, backgroundColor: theme.colors.primaryLight, justifyContent: 'center', alignItems: 'center' },
    avatarImage: { width: 24, height: 24, borderRadius: 12, backgroundColor: theme.colors.surfaceAlt },
    avatarText: { color: '#fff', fontSize: 11, fontWeight: '700' },
    cardAuthor: { ...theme.typography.caption, color: theme.colors.textSecondary, fontWeight: '500' },
    roleBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, marginLeft: 'auto' },
    roleBadgeStudent: { backgroundColor: '#EEF2FF' },
    roleBadgeFaculty: { backgroundColor: '#FEF3C7' },
    roleBadgeText: { fontSize: 9, fontWeight: '600' },
    roleBadgeTextStudent: { color: '#4338CA' },
    roleBadgeTextFaculty: { color: '#D97706' },
    emptyContainer: { alignItems: 'center', marginTop: 60 },
    emptyTitle: { ...theme.typography.h3, marginBottom: 4, color: theme.colors.textPrimary },
    emptySubtext: { ...theme.typography.bodySecondary, color: theme.colors.textSecondary, textAlign: 'center' },
    fab: {
        position: 'absolute', bottom: 20, right: 20,
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 20, paddingVertical: 14, borderRadius: 28,
        backgroundColor: '#059669', ...theme.shadows.lg,
    },
    fabText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
