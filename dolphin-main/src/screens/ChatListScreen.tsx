import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    View, Text, StyleSheet, FlatList, TouchableOpacity, Image, ScrollView,
    ActionSheetIOS, Alert, Platform, Modal, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, r } from '../theme/theme';
import { auth, db } from '../config/firebase';
import { collection, query, where, onSnapshot, updateDoc, doc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { useScrollToTop, useFocusEffect } from '@react-navigation/native';
import { useGlow } from '../context/GlowContext';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PINNED_KEY = '@pinned_chats';

function timeAgo(timestamp: any): string {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const diff = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString();
}

const SOURCE_META: Record<string, { label: string; color: string; icon: string }> = {
    market: { label: 'Market', color: '#F97316', icon: 'storefront' },
    lounge: { label: 'Lounge', color: '#6366F1', icon: 'chatbubbles' },
    lostfound: { label: 'Lost & Found', color: '#059669', icon: 'search-circle' },
    tech: { label: 'Tech Office', color: '#2563EB', icon: 'desktop' },
};

export function ChatListScreen({ navigation }: any) {
    const [chats, setChats] = useState<any[]>([]);
    const [activeFilter, setActiveFilter] = useState<'all' | 'lounge' | 'market' | 'lostfound'>('all');
    const [pinnedIds, setPinnedIds] = useState<string[]>([]);
    const [contextChat, setContextChat] = useState<any>(null);
    const contextAnim = useRef(new Animated.Value(0)).current;
    const currentUser = auth.currentUser;
    const scrollRef = useRef<FlatList>(null);
    useScrollToTop(scrollRef);
    const { setGlowColor } = useGlow();

    const FILTER_COLORS = {
        all: '#0EA5E9',
        lounge: '#6366F1',
        market: '#F97316',
        lostfound: '#10B981',
    };

    useFocusEffect(
        React.useCallback(() => {
            setGlowColor(FILTER_COLORS[activeFilter]);
        }, [activeFilter, setGlowColor])
    );

    // Load pinned chats
    useEffect(() => {
        AsyncStorage.getItem(PINNED_KEY).then(val => {
            if (val) setPinnedIds(JSON.parse(val));
        });
    }, []);

    const savePinned = async (ids: string[]) => {
        setPinnedIds(ids);
        await AsyncStorage.setItem(PINNED_KEY, JSON.stringify(ids));
    };

    useEffect(() => {
        if (!currentUser) return;
        const q = query(
            collection(db, 'dolphin_chats'),
            where('participants', 'array-contains', currentUser.uid)
        );

        const unsub = onSnapshot(q, (snapshot) => {
            let data = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
            data = data.filter(chat => !chat.deletedBy?.includes(currentUser.uid));
            data.sort((a, b) => {
                const tA = a.updatedAt?.toMillis?.() || 0;
                const tB = b.updatedAt?.toMillis?.() || 0;
                return tB - tA;
            });
            setChats(data);
        });
        return unsub;
    }, [currentUser]);

    // ── Context Menu Actions ──
    const isPinned = (chatId: string) => pinnedIds.includes(chatId);
    const isMuted = (chat: any) => chat.mutedBy?.includes(currentUser?.uid);

    const handlePin = async (chatId: string) => {
        const newPinned = isPinned(chatId)
            ? pinnedIds.filter(id => id !== chatId)
            : [...pinnedIds, chatId];
        await savePinned(newPinned);
        closeContext();
    };

    const handleMute = async (chat: any) => {
        if (!currentUser) return;
        try {
            const muted = isMuted(chat);
            await updateDoc(doc(db, 'dolphin_chats', chat.id), {
                mutedBy: muted ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid),
            });
        } catch {}
        closeContext();
    };

    const handleDelete = (chat: any) => {
        closeContext();
        setTimeout(() => {
            Alert.alert(
                'Delete Chat',
                'This chat will be removed from your list. The other person will not be notified.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Delete', style: 'destructive', onPress: async () => {
                            if (!currentUser) return;
                            try {
                                await updateDoc(doc(db, 'dolphin_chats', chat.id), {
                                    deletedBy: arrayUnion(currentUser.uid),
                                });
                            } catch {}
                        }
                    },
                ]
            );
        }, 300);
    };

    const openContext = (chat: any) => {
        setContextChat(chat);
        Animated.spring(contextAnim, { toValue: 1, friction: 8, tension: 65, useNativeDriver: true }).start();
    };

    const closeContext = () => {
        Animated.timing(contextAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
            setContextChat(null);
        });
    };

    const handleLongPress = (chat: any) => {
        if (Platform.OS === 'ios') {
            openContext(chat);
        } else {
            // Android fallback — use Alert
            const muted = isMuted(chat);
            const pinned = isPinned(chat.id);
            Alert.alert(
                'Chat Options',
                undefined,
                [
                    { text: pinned ? 'Unpin' : 'Pin to Top', onPress: () => handlePin(chat.id) },
                    { text: muted ? 'Unmute' : 'Mute Notifications', onPress: () => handleMute(chat) },
                    { text: 'Delete Chat', style: 'destructive', onPress: () => handleDelete(chat) },
                    { text: 'Cancel', style: 'cancel' },
                ]
            );
        }
    };

    // ── Sort: pinned first, then by updatedAt ──
    const sortedChats = useCallback((list: any[]) => {
        return [...list].sort((a, b) => {
            const aPinned = pinnedIds.includes(a.id) ? 1 : 0;
            const bPinned = pinnedIds.includes(b.id) ? 1 : 0;
            if (aPinned !== bPinned) return bPinned - aPinned;
            const tA = a.updatedAt?.toMillis?.() || 0;
            const tB = b.updatedAt?.toMillis?.() || 0;
            return tB - tA;
        });
    }, [pinnedIds]);

    const renderChat = ({ item }: { item: any }) => {
        const otherUserId = item.participants.find((id: string) => id !== currentUser?.uid);
        const otherUserName = item.participantNames?.[otherUserId] || 'Someone';
        const myLastRead = item.lastRead?.[currentUser?.uid || ''];
        const isUnread = myLastRead ? (item.updatedAt?.toMillis() > myLastRead.toMillis()) : !!item.lastMessage;
        
        const source = item.chatSource || item.postType || 'lounge';
        const sourceMeta = SOURCE_META[source] || SOURCE_META.market;
        const hasPhoto = !!(item.listingPhoto || item.postImage);
        const photoUri = item.listingPhoto || item.postImage;
        const contextTitle = item.listingName || item.postTitle || '';
        const pinned = isPinned(item.id);
        const muted = isMuted(item);

        return (
            <TouchableOpacity 
                style={[styles.chatItem, isUnread && styles.chatItemUnread, pinned && styles.chatItemPinned]} 
                onPress={() => navigation.navigate('ChatRoom', {
                    chatId: item.id,
                    otherUserId,
                    otherUserName,
                    listingName: contextTitle,
                    listingId: item.listingId || item.postId,
                    listingPhoto: photoUri,
                    listingPrice: item.listingPrice,
                    listingCurrency: item.listingCurrency,
                    chatSource: source,
                })}
                onLongPress={() => handleLongPress(item)}
                delayLongPress={400}
                activeOpacity={0.7}
            >
                {/* Thumbnail — photo or avatar */}
                <View style={styles.thumbnailWrap}>
                    {hasPhoto ? (
                        <Image source={{ uri: photoUri }} style={styles.thumbnail} />
                    ) : (
                        <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
                            <Ionicons name={sourceMeta.icon as any} size={22} color={sourceMeta.color} />
                        </View>
                    )}
                    {/* Small source badge */}
                    <View style={[styles.sourceBadge, { backgroundColor: sourceMeta.color }]}>
                        <Ionicons name={sourceMeta.icon as any} size={10} color="#fff" />
                    </View>
                </View>

                {/* Chat info */}
                <View style={styles.chatInfo}>
                    <View style={styles.chatHeaderRow}>
                        <View style={styles.nameRow}>
                            {pinned && <Ionicons name="pin" size={12} color={theme.colors.primary} style={{ marginRight: 4 }} />}
                            <Text style={[styles.chatName, isUnread && styles.unreadName]} numberOfLines={1}>{otherUserName}</Text>
                        </View>
                        <View style={styles.metaRow}>
                            {muted && <Ionicons name="notifications-off" size={12} color={theme.colors.textMuted} style={{ marginRight: 4 }} />}
                            <Text style={styles.chatTime}>{timeAgo(item.updatedAt)}</Text>
                        </View>
                    </View>
                    {contextTitle ? (
                        <Text style={[styles.contextTitle, { color: sourceMeta.color }]} numberOfLines={1}>
                            {contextTitle}
                        </Text>
                    ) : null}
                    <View style={styles.lastMessageRow}>
                        <Text style={[styles.chatLastMessage, isUnread && styles.unreadText]} numberOfLines={1}>
                            {item.lastMessage || 'Started a conversation'}
                        </Text>
                        {isUnread && <View style={styles.unreadDot} />}
                    </View>
                </View>
            </TouchableOpacity>
        );
    };

    const FILTERS: { key: typeof activeFilter; label: string }[] = [
        { key: 'all', label: 'All' },
        { key: 'lounge', label: 'Lounge' },
        { key: 'market', label: 'Market' },
        { key: 'lostfound', label: 'Lost & Found' },
    ];

    const filteredChats = activeFilter === 'all'
        ? chats
        : chats.filter(c => (c.chatSource || c.postType || 'lounge') === activeFilter);

    const displayChats = sortedChats(filteredChats);

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Messages</Text>
                {/* Filter Tabs */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterRow}>
                    {FILTERS.map(f => (
                        <TouchableOpacity
                            key={f.key}
                            style={[
                                styles.filterChip, 
                                activeFilter === f.key && { backgroundColor: FILTER_COLORS[f.key] }
                            ]}
                            onPress={() => setActiveFilter(f.key)}
                            activeOpacity={0.8}
                        >
                            <Text style={[styles.filterText, activeFilter === f.key && styles.filterTextActive]}>{f.label}</Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>
            
            {displayChats.length > 0 ? (
                <FlatList
                    ref={scrollRef}
                    data={displayChats}
                    keyExtractor={item => item.id}
                    renderItem={renderChat}
                    contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8 }}
                />
            ) : (
                <View style={styles.emptyContainer}>
                    <Ionicons name="chatbubble-ellipses-outline" size={64} color={theme.colors.textMuted} />
                    <Text style={styles.emptyTitle}>{activeFilter === 'all' ? 'No messages yet' : 'No messages here'}</Text>
                    <Text style={styles.emptySubtitle}>
                        {activeFilter === 'all'
                            ? "Start a conversation from a post\nto see your messages here."
                            : `No ${FILTERS.find(f => f.key === activeFilter)?.label} chats yet.`}
                    </Text>
                </View>
            )}

            {/* ── Context Menu Modal (iOS style bottom sheet) ── */}
            <Modal visible={!!contextChat} transparent animationType="none" onRequestClose={closeContext}>
                <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={closeContext}>
                    <Animated.View style={[styles.contextSheet, {
                        transform: [{
                            translateY: contextAnim.interpolate({ inputRange: [0, 1], outputRange: [300, 0] }),
                        }],
                        opacity: contextAnim,
                    }]}>
                        {contextChat && (() => {
                            const otherUserId = contextChat.participants.find((id: string) => id !== currentUser?.uid);
                            const otherUserName = contextChat.participantNames?.[otherUserId] || 'Someone';
                            const source = contextChat.chatSource || contextChat.postType || 'lounge';
                            const sm = SOURCE_META[source] || SOURCE_META.market;
                            const pinned = isPinned(contextChat.id);
                            const muted = isMuted(contextChat);

                            return (
                                <>
                                    {/* Chat preview */}
                                    <View style={styles.contextPreview}>
                                        <View style={[styles.contextAvatar, { backgroundColor: sm.color + '18' }]}>
                                            <Ionicons name={sm.icon as any} size={20} color={sm.color} />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.contextName} numberOfLines={1}>{otherUserName}</Text>
                                            <Text style={styles.contextSub} numberOfLines={1}>
                                                {contextChat.listingName || contextChat.postTitle || sm.label}
                                            </Text>
                                        </View>
                                    </View>

                                    <View style={styles.contextDivider} />

                                    {/* Actions */}
                                    <TouchableOpacity style={styles.contextAction} onPress={() => handlePin(contextChat.id)} activeOpacity={0.7}>
                                        <View style={[styles.contextIconWrap, { backgroundColor: '#0EA5E920' }]}>
                                            <Ionicons name={pinned ? 'pin-outline' : 'pin'} size={18} color="#0EA5E9" />
                                        </View>
                                        <Text style={styles.contextActionText}>{pinned ? 'Unpin Chat' : 'Pin to Top'}</Text>
                                        {pinned && <View style={styles.activeIndicator}><Text style={styles.activeIndicatorText}>ON</Text></View>}
                                    </TouchableOpacity>

                                    <TouchableOpacity style={styles.contextAction} onPress={() => handleMute(contextChat)} activeOpacity={0.7}>
                                        <View style={[styles.contextIconWrap, { backgroundColor: '#F59E0B20' }]}>
                                            <Ionicons name={muted ? 'notifications' : 'notifications-off'} size={18} color="#F59E0B" />
                                        </View>
                                        <Text style={styles.contextActionText}>{muted ? 'Unmute Notifications' : 'Mute Notifications'}</Text>
                                        {muted && <View style={styles.activeIndicator}><Text style={styles.activeIndicatorText}>MUTED</Text></View>}
                                    </TouchableOpacity>

                                    <View style={styles.contextDivider} />

                                    <TouchableOpacity style={styles.contextAction} onPress={() => handleDelete(contextChat)} activeOpacity={0.7}>
                                        <View style={[styles.contextIconWrap, { backgroundColor: '#EF444420' }]}>
                                            <Ionicons name="trash" size={18} color="#EF4444" />
                                        </View>
                                        <Text style={[styles.contextActionText, { color: '#EF4444' }]}>Delete Chat</Text>
                                    </TouchableOpacity>

                                    {/* Cancel */}
                                    <TouchableOpacity style={styles.contextCancel} onPress={closeContext} activeOpacity={0.8}>
                                        <Text style={styles.contextCancelText}>Cancel</Text>
                                    </TouchableOpacity>
                                </>
                            );
                        })()}
                    </Animated.View>
                </TouchableOpacity>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    header: {
        paddingHorizontal: 16, paddingTop: 60, paddingBottom: 10,
        backgroundColor: theme.colors.surface, ...theme.shadows.sm,
    },
    headerTitle: { fontSize: 24, fontWeight: '900', color: '#0C2340' },
    filterScroll: { marginTop: 12, marginBottom: 10 },
    filterRow: { flexDirection: 'row', gap: 8 },
    filterChip: {
        paddingHorizontal: 14, paddingVertical: 8,
        borderRadius: r(20), backgroundColor: theme.colors.surfaceAlt,
    },
    filterText: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
    filterTextActive: { color: '#fff', fontWeight: '700' },
    
    emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    emptyTitle: { ...theme.typography.h3, color: theme.colors.textPrimary, marginTop: 16 },
    emptySubtitle: { ...theme.typography.body, color: theme.colors.textMuted, textAlign: 'center', marginTop: 8 },

    chatItem: {
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: 12, paddingHorizontal: 4,
        borderBottomWidth: 1, borderBottomColor: theme.colors.borderLight,
    },
    chatItemUnread: {
        backgroundColor: 'rgba(99, 102, 241, 0.04)',
    },
    chatItemPinned: {
        backgroundColor: 'rgba(14, 165, 233, 0.04)',
    },

    // Thumbnail (square photo like 당근)
    thumbnailWrap: { position: 'relative' },
    thumbnail: {
        width: 52, height: 52, borderRadius: r(10),
        resizeMode: 'cover', backgroundColor: theme.colors.surfaceAlt,
    },
    thumbnailPlaceholder: {
        justifyContent: 'center', alignItems: 'center',
        borderWidth: 1, borderColor: theme.colors.border,
    },
    sourceBadge: {
        position: 'absolute', bottom: -3, right: -3,
        width: 20, height: 20, borderRadius: r(10),
        justifyContent: 'center', alignItems: 'center',
        borderWidth: 2, borderColor: theme.colors.background,
    },

    chatInfo: { flex: 1, marginLeft: 12 },
    chatHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 1 },
    nameRow: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
    metaRow: { flexDirection: 'row', alignItems: 'center' },
    chatName: { fontSize: 15, fontWeight: '600', color: theme.colors.textPrimary, flex: 1 },
    unreadName: { fontWeight: '800' },
    chatTime: { fontSize: 12, color: theme.colors.textMuted },
    contextTitle: { fontSize: 12, fontWeight: '700', marginBottom: 2 },
    lastMessageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    chatLastMessage: { flex: 1, fontSize: 13, color: theme.colors.textSecondary },
    unreadText: { fontWeight: '700', color: theme.colors.textPrimary },
    unreadDot: { width: 8, height: 8, borderRadius: r(4), backgroundColor: theme.colors.danger, marginLeft: 8 },

    // ── Context Menu ──
    overlay: {
        flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
        justifyContent: 'flex-end',
    },
    contextSheet: {
        backgroundColor: theme.colors.surface,
        borderTopLeftRadius: r(24), borderTopRightRadius: r(24),
        paddingTop: 8, paddingBottom: 40, paddingHorizontal: 20,
        ...theme.shadows.lg,
    },
    contextPreview: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingVertical: 16,
    },
    contextAvatar: {
        width: 44, height: 44, borderRadius: r(22),
        justifyContent: 'center', alignItems: 'center',
    },
    contextName: { fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary },
    contextSub: { fontSize: 13, color: theme.colors.textMuted, marginTop: 2 },
    contextDivider: {
        height: 1, backgroundColor: theme.colors.borderLight, marginVertical: 4,
    },
    contextAction: {
        flexDirection: 'row', alignItems: 'center', gap: 14,
        paddingVertical: 14,
    },
    contextIconWrap: {
        width: 36, height: 36, borderRadius: r(10),
        justifyContent: 'center', alignItems: 'center',
    },
    contextActionText: {
        fontSize: 16, fontWeight: '600', color: theme.colors.textPrimary, flex: 1,
    },
    activeIndicator: {
        backgroundColor: '#0EA5E918', paddingHorizontal: 8, paddingVertical: 3,
        borderRadius: r(6),
    },
    activeIndicatorText: {
        fontSize: 10, fontWeight: '800', color: '#0EA5E9', letterSpacing: 0.5,
    },
    contextCancel: {
        marginTop: 8, paddingVertical: 14, alignItems: 'center',
        backgroundColor: theme.colors.surfaceAlt, borderRadius: r(14),
    },
    contextCancelText: {
        fontSize: 16, fontWeight: '700', color: theme.colors.textSecondary,
    },
});
