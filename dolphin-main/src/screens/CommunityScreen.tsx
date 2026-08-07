import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Image, Alert, Share, ScrollView, TextInput, Platform, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SpotlightGuide, SpotlightStep } from '../components/SpotlightGuide';
import { theme, r } from '../theme/theme';
import { db, auth } from '../config/firebase';
import { collection, query, orderBy, onSnapshot, doc, deleteDoc, updateDoc, increment, setDoc, getDoc, where } from 'firebase/firestore';
import { useScrollToTop, useFocusEffect } from '@react-navigation/native';
import { getBlockedUsers } from '../utils/moderation';

const CATEGORY_META: Record<string, { icon: string; color: string; label: string }> = {
    general: { icon: 'chatbubbles', color: theme.colors.primary, label: 'General' },
    question: { icon: 'help-circle', color: '#8B5CF6', label: 'Questions' },
    event: { icon: 'calendar', color: '#F59E0B', label: 'Events' },
    tip: { icon: 'bulb', color: '#10B981', label: 'Tips' },
    life: { icon: 'information-circle', color: '#06B6D4', label: 'Life Info' },
    food: { icon: 'restaurant', color: '#F43F5E', label: 'Food/Dining' },
    housing: { icon: 'home', color: '#8B5CF6', label: 'Housing' },
};

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

export function CommunityScreen({ navigation }: any) {
    const [posts, setPosts] = useState<any[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [loading, setLoading] = useState(true);
    const [activeFilter, setActiveFilter] = useState('all');
    const [likedPosts, setLikedPosts] = useState<Set<string>>(new Set());
    const [unreadCount, setUnreadCount] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
    const scrollRef = useRef<FlatList>(null);
    useScrollToTop(scrollRef);

    const [showGuide, setShowGuide] = useState(false);

    useFocusEffect(
        React.useCallback(() => {
            AsyncStorage.getItem('@guide_lounge').then(val => {
                if (val === null) setTimeout(() => setShowGuide(true), 600);
            });
        }, [])
    );

    const SAFE_TOP = Platform.OS === 'ios' ? 60 : 30;
    const SCREEN_W = Dimensions.get('window').width;
    const LOUNGE_STEPS: SpotlightStep[] = [
        {
            target: null,
            title: '💬 F&S Lounge',
            description: 'The community board for Faculty & Staff.\nShare updates, ask questions, and connect.',
            tooltipPosition: 'center',
        },
        {
            target: { x: 16, y: SAFE_TOP + 50, width: SCREEN_W - 32, height: 40 },
            title: 'Categories',
            description: 'Filter posts by category: General, Questions, Events, Tips, Life Info, Food/Dining, and Housing.',
            tooltipPosition: 'bottom',
            borderRadius: 20,
        },
        {
            target: { x: 278, y: 717, width: 106, height: 49 },
            title: '✏️ Create a Post',
            description: 'Write a new post with formatting options, photos, and even email notifications. Enable Direct Chat so others can message you about your post.',
            tooltipPosition: 'top',
            borderRadius: 28,
        },
    ];

    useEffect(() => {
        const q = query(collection(db, 'lounge_posts'), orderBy('createdAt', 'desc'));
        const unsub = onSnapshot(q, (snap) => {
            setPosts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setLoading(false);
        }, () => { setLoading(false); });
        return unsub;
    }, []);

    // Load blocked users
    useEffect(() => {
        getBlockedUsers().then(setBlockedUsers);
    }, []);

    // Auto-stop refreshing after data loads or timeout
    useEffect(() => {
        if (refreshing) {
            const timer = setTimeout(() => setRefreshing(false), 1000);
            return () => clearTimeout(timer);
        }
    }, [refreshing, posts]);

    // Unread notification count
    useEffect(() => {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        const q = query(
            collection(db, 'dolphin_notifications'),
            where('recipientId', '==', uid),
            where('read', '==', false)
        );
        return onSnapshot(q, snap => setUnreadCount(snap.size), () => {});
    }, []);

    // Load liked status for current user
    useEffect(() => {
        const uid = auth.currentUser?.uid;
        if (!uid || posts.length === 0) return;
        const checkLikes = async () => {
            const liked = new Set<string>();
            for (const post of posts) {
                try {
                    const likeDoc = await getDoc(doc(db, 'lounge_posts', post.id, 'likes', uid));
                    if (likeDoc.exists()) liked.add(post.id);
                } catch {}
            }
            setLikedPosts(liked);
        };
        checkLikes();
    }, [posts.length]);

    let displayedPosts = posts.filter(p => !blockedUsers.includes(p.authorId));
    if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        displayedPosts = posts.filter(p =>
            (p.title || '').toLowerCase().includes(q) ||
            (p.body || '').toLowerCase().includes(q) ||
            (p.authorName || '').toLowerCase().includes(q)
        );
    } else if (activeFilter === 'popular') {
        displayedPosts = [...posts].sort((a, b) => {
            const scoreA = (a.likes || 0) * 10 + (a.views || 0);
            const scoreB = (b.likes || 0) * 10 + (b.views || 0);
            return scoreB - scoreA;
        });
    } else if (activeFilter !== 'all') {
        displayedPosts = posts.filter(p => p.category === activeFilter);
    }

    const toggleLike = async (postId: string) => {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        const likeRef = doc(db, 'lounge_posts', postId, 'likes', uid);
        const postRef = doc(db, 'lounge_posts', postId);
        if (likedPosts.has(postId)) {
            // Unlike
            setLikedPosts(prev => { const n = new Set(prev); n.delete(postId); return n; });
            try {
                await deleteDoc(likeRef);
                await updateDoc(postRef, { likes: increment(-1) });
            } catch {}
        } else {
            // Like
            setLikedPosts(prev => new Set(prev).add(postId));
            try {
                await setDoc(likeRef, { userId: uid, createdAt: new Date() });
                await updateDoc(postRef, { likes: increment(1) });
            } catch {}
        }
    };

    const handleDelete = (post: any) => {
        const uid = auth.currentUser?.uid;
        if (post.authorId !== uid) return;
        Alert.alert('Delete Post', 'Are you sure you want to delete this post?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete', style: 'destructive',
                onPress: async () => {
                    try { await deleteDoc(doc(db, 'lounge_posts', post.id)); } catch {}
                }
            },
        ]);
    };

    const handleShare = async (post: any) => {
        try {
            await Share.share({
                message: `${post.title}\n\n${post.body}\n\n— via Dolphin App`,
            });
        } catch {}
    };

    const handlePostPress = async (post: any) => {
        // Increment view count — once per user per post
        const uid = auth.currentUser?.uid;
        if (uid) {
            try {
                const viewRef = doc(db, 'lounge_posts', post.id, 'views', uid);
                const viewSnap = await getDoc(viewRef);
                if (!viewSnap.exists()) {
                    await setDoc(viewRef, { viewedAt: new Date() });
                    await updateDoc(doc(db, 'lounge_posts', post.id), { views: increment(1) });
                }
            } catch {}
        }
        navigation.navigate('PostDetail', { post: { ...post, views: (post.views || 0) + (uid ? 1 : 0) } });
    };

    const renderPost = ({ item }: { item: any }) => {
        const meta = CATEGORY_META[item.category] || CATEGORY_META.general;
        const isOwner = item.authorId === auth.currentUser?.uid;
        const isLiked = likedPosts.has(item.id);
        const hasPhoto = item.photos && item.photos.length > 0;
        
        return (
            <View style={styles.postCard}>
                <View style={styles.categoryBadgeRow}>
                    <View style={[styles.categoryBadge, { backgroundColor: meta.color + '18' }]}>
                        <Text style={[styles.categoryBadgeText, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                    {isOwner && (
                        <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item)}>
                            <Ionicons name="ellipsis-vertical" size={16} color={theme.colors.textMuted} />
                        </TouchableOpacity>
                    )}
                </View>

                <TouchableOpacity onPress={() => handlePostPress(item)} activeOpacity={0.7} style={styles.postContentRow}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.postTitle}>{item.title}</Text>
                        <Text style={styles.postBody} numberOfLines={2}>{item.body}</Text>
                    </View>
                    {hasPhoto && (
                        <Image source={{ uri: item.photos[0] }} style={styles.postThumb} />
                    )}
                </TouchableOpacity>

                <View style={styles.footerRow}>
                    <Text style={styles.footerText}>
                        {item.authorName} · {timeAgo(item.createdAt)} · {item.views || 0} views
                    </Text>
                    
                    <View style={styles.actionsRow}>
                        <TouchableOpacity style={styles.actionBtn} onPress={() => toggleLike(item.id)}>
                            <Ionicons name={isLiked ? 'thumbs-up' : 'thumbs-up-outline'} size={18} color={isLiked ? '#2563EB' : theme.colors.textMuted} />
                            <Text style={[styles.actionText, isLiked && { color: '#2563EB' }]}>{item.likes || 0}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionBtn} onPress={() => handlePostPress(item)}>
                            <Ionicons name="chatbox-outline" size={17} color={theme.colors.textMuted} />
                            <Text style={styles.actionText}>{item.commentCount || 0}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        );
    };

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.headerTitle}>F&S Lounge</Text>
                <View style={styles.headerRight}>
                    <TouchableOpacity style={styles.headerBtn} onPress={() => { setShowSearch(s => !s); if (showSearch) setSearchQuery(''); }}>
                        <Ionicons name={showSearch ? 'close' : 'search-outline'} size={24} color={theme.colors.textPrimary} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.navigate('Notifications')}>
                        <Ionicons name="notifications-outline" size={24} color={theme.colors.textPrimary} />
                        {unreadCount > 0 && (
                            <View style={styles.notifBadge}>
                                <Text style={styles.notifBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                            </View>
                        )}
                    </TouchableOpacity>
                </View>
            </View>

            {/* Search Bar (expandable) */}
            {showSearch && (
                <View style={styles.searchBar}>
                    <Ionicons name="search-outline" size={16} color={theme.colors.textMuted} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search posts..."
                        placeholderTextColor={theme.colors.textMuted}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        autoFocus
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchQuery('')}>
                            <Ionicons name="close-circle" size={16} color={theme.colors.textMuted} />
                        </TouchableOpacity>
                    )}
                </View>
            )}

            {/* Top Links (Large) */}
            <View style={styles.topLinksRow}>
                {[
                    { key: 'general', label: 'General' },
                    { key: 'question', label: 'Questions' },
                    { key: 'event', label: 'Events' },
                    { key: 'tip', label: 'Tips' },
                ].map(link => (
                    <TouchableOpacity key={link.key} onPress={() => setActiveFilter(link.key)}>
                        <Text style={[
                            styles.topLinkText,
                            activeFilter === link.key && styles.topLinkTextActive
                        ]}>{link.label}</Text>
                    </TouchableOpacity>
                ))}
            </View>

            {/* Filter Pills */}
            <View style={styles.pillContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillScroll}>
                    {[
                        { key: 'all', label: 'All' },
                        { key: 'popular', label: 'Popular', icon: 'flame', iconColor: '#EF4444' },
                        { key: 'life', label: 'Life Info' },
                        { key: 'food', label: 'Food/Dining' },
                        { key: 'housing', label: 'Housing' },
                    ].map(pill => (
                        <TouchableOpacity
                            key={pill.key}
                            style={[
                                styles.pill,
                                activeFilter === pill.key && styles.pillActive
                            ]}
                            onPress={() => setActiveFilter(pill.key)}
                        >
                            {pill.icon && (
                                <Ionicons 
                                    name={pill.icon as any} 
                                    size={14} 
                                    color={pill.iconColor || (activeFilter === pill.key ? '#fff' : theme.colors.textSecondary)} 
                                    style={{ marginRight: 4 }} 
                                />
                            )}
                            <Text style={[
                                styles.pillText,
                                activeFilter === pill.key && styles.pillTextActive
                            ]}>{pill.label}</Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            {/* Feed */}
            <FlatList
                ref={scrollRef}
                data={displayedPosts}
                keyExtractor={item => item.id}
                renderItem={renderPost}
                contentContainerStyle={styles.list}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={() => setRefreshing(true)} tintColor={theme.colors.primary} />
                }
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Ionicons name="chatbubbles-outline" size={64} color={theme.colors.textMuted} />
                        <Text style={styles.emptyTitle}>{loading ? 'Loading...' : 'No posts yet'}</Text>
                        <Text style={styles.emptySubtitle}>Be the first to start a conversation!</Text>
                    </View>
                }
            />

            {/* FAB */}
            <TouchableOpacity
                style={styles.fab}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('CreatePost')}
            >
                <Ionicons name="add" size={24} color="#fff" />
                <Text style={styles.fabText}>Post</Text>
            </TouchableOpacity>

            <SpotlightGuide
                storageKey="@guide_lounge"
                steps={LOUNGE_STEPS}
                visible={showGuide}
                onDismiss={() => setShowGuide(false)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingTop: 60, paddingBottom: 10,
        backgroundColor: theme.colors.surface, ...theme.shadows.sm,
    },
    headerTitle: { fontSize: 24, fontWeight: '900', color: '#0C2340' },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    headerBtn: { padding: 6, position: 'relative' },
    notifBadge: {
        position: 'absolute', top: 0, right: -2,
        minWidth: 16, height: 16, borderRadius: 8,
        backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center',
        paddingHorizontal: 3, borderWidth: 1.5, borderColor: theme.colors.surface,
    },
    notifBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
    searchBar: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        backgroundColor: '#F1F5F9', borderRadius: r(12),
        paddingHorizontal: 14, paddingVertical: 10,
        marginHorizontal: 20, marginBottom: 10,
    },
    searchInput: { flex: 1, fontSize: 14, color: theme.colors.textPrimary },
    
    topLinksRow: {
        flexDirection: 'row', alignItems: 'center', gap: 20,
        paddingHorizontal: 16, paddingBottom: 12,
        backgroundColor: theme.colors.surface,
    },
    topLinkText: { fontSize: 18, fontWeight: '700', color: theme.colors.textMuted },
    topLinkTextActive: { color: theme.colors.textPrimary },

    pillContainer: { backgroundColor: theme.colors.surface, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.borderLight },
    pillScroll: { paddingHorizontal: 16, gap: 8 },
    pill: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 14, paddingVertical: 8, borderRadius: r(20),
        backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.borderLight
    },
    pillActive: { backgroundColor: theme.colors.textPrimary, borderColor: theme.colors.textPrimary },
    pillText: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
    pillTextActive: { color: theme.colors.background },

    list: { paddingBottom: 120, paddingHorizontal: 16, paddingTop: 8 },
    postCard: {
        backgroundColor: '#FFFFFF',
        padding: 16, marginBottom: 10, borderRadius: r(14),
        shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
    },
    postContentRow: { flexDirection: 'row', marginVertical: 8, gap: 12 },
    postThumb: { width: 72, height: 72, borderRadius: r(10), backgroundColor: theme.colors.surfaceAlt },
    categoryBadgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    categoryBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
    categoryBadgeText: { fontSize: 11, fontWeight: '700' },
    deleteBtn: { padding: 4 },
    
    postTitle: { fontSize: 17, fontWeight: '600', color: theme.colors.textPrimary, marginBottom: 6 },
    postBody: { fontSize: 15, color: theme.colors.textSecondary, lineHeight: 22 },
    
    footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
    footerText: { fontSize: 12, color: theme.colors.textMuted },
    actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    actionText: { fontSize: 13, color: theme.colors.textMuted, fontWeight: '500' },

    emptyContainer: { alignItems: 'center', marginTop: 80 },
    emptyTitle: { ...theme.typography.h3, color: theme.colors.textPrimary, marginTop: theme.spacing.md },
    emptySubtitle: { ...theme.typography.body, color: theme.colors.textMuted, textAlign: 'center', marginTop: theme.spacing.sm },
    
    fab: {
        position: 'absolute', bottom: 20, right: 20,
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 20, paddingVertical: 14, borderRadius: r(28),
        backgroundColor: '#6366F1', ...theme.shadows.lg,
    },
    fabText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
