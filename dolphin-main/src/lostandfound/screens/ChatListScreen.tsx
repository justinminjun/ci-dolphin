import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, Alert, Animated } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme/theme';
import { auth, db } from '../config/firebase';
import { collection, query, where, onSnapshot, doc, getDoc, setDoc, deleteDoc, updateDoc, getDocs } from 'firebase/firestore';
import { timeAgo } from '../utils/timeAgo';

export function ChatListScreen({ navigation }: any) {
    const [chats, setChats] = useState<any[]>([]);
    const [userPhotoCache, setUserPhotoCache] = useState<Record<string, string | null>>({});
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const currentUser = auth.currentUser;
    const swipeableRefs = useRef<Record<string, Swipeable | null>>({});

    const fetchUserPhoto = async (userId: string) => {
        if (userId in userPhotoCache) return;
        try {
            const snap = await getDoc(doc(db, 'users', userId));
            const photo = snap.exists() ? (snap.data().photoURL || null) : null;
            setUserPhotoCache(prev => ({ ...prev, [userId]: photo }));
        } catch {
            setUserPhotoCache(prev => ({ ...prev, [userId]: null }));
        }
    };

    useEffect(() => {
        if (!currentUser) return;
        const q = query(collection(db, 'chats'), where('participants', 'array-contains', currentUser.uid));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetched: any[] = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            fetched.sort((a, b) => (b.updatedAt?.toMillis() || 0) - (a.updatedAt?.toMillis() || 0));
            setChats(fetched);

            fetched.forEach(chat => {
                const otherUserId = chat.participants?.find((p: string) => p !== currentUser.uid);
                if (otherUserId) fetchUserPhoto(otherUserId);
            });

            // Backfill
            fetched.forEach(async (chat) => {
                if (chat.postId && !chat.postImage) {
                    try {
                        const postSnap = await getDoc(doc(db, 'posts', chat.postId));
                        if (postSnap.exists()) {
                            const postData = postSnap.data();
                            const img = postData.imageUrls?.[0] || postData.imageUrl || null;
                            const title = postData.title || null;
                            if (img) {
                                await setDoc(doc(db, 'chats', chat.id), { postImage: img, postTitle: title }, { merge: true });
                            }
                        }
                    } catch (e) { /* silently fail */ }
                }
            });
        });
        return unsubscribe;
    }, []);

    useEffect(() => {
        navigation.setOptions({
            headerRight: () => (
                <TouchableOpacity
                    onPress={() => {
                        if (selectMode) {
                            setSelectMode(false);
                            setSelectedIds(new Set());
                        } else {
                            setSelectMode(true);
                        }
                    }}
                    style={{ marginRight: 8, paddingHorizontal: 10, paddingVertical: 6 }}
                >
                    <Text style={{ color: theme.colors.primary, fontWeight: '600', fontSize: 15 }}>
                        {selectMode ? 'Cancel' : 'Select'}
                    </Text>
                </TouchableOpacity>
            ),
        });
    }, [selectMode, navigation]);

    const isUnread = (chat: any): boolean => {
        if (!currentUser) return false;
        const lastRead = chat.lastRead?.[currentUser.uid];
        const updatedAt = chat.updatedAt;
        if (!lastRead || !updatedAt) return !!chat.lastMessage;
        return updatedAt.toMillis() > lastRead.toMillis();
    };

    const handleDeleteChat = async (chatId: string) => {
        Alert.alert('Delete Chat', 'Delete this conversation? Messages will be removed.', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete', style: 'destructive',
                onPress: async () => {
                    try {
                        // Delete subcollection messages first
                        const messagesSnap = await getDocs(collection(db, 'chats', chatId, 'messages'));
                        const deletePromises = messagesSnap.docs.map(d => deleteDoc(d.ref));
                        await Promise.all(deletePromises);
                        await deleteDoc(doc(db, 'chats', chatId));
                    } catch (e) {
                        Alert.alert('Error', 'Failed to delete chat.');
                    }
                }
            }
        ]);
    };

    const handleResolveFromList = async (chat: any) => {
        const thePostId = chat.postId;
        if (!thePostId) {
            Alert.alert('No Post', 'This chat is not linked to a post.');
            return;
        }
        try {
            const postSnap = await getDoc(doc(db, 'posts', thePostId));
            if (!postSnap.exists()) {
                Alert.alert('Error', 'Post not found.');
                return;
            }
            const current = postSnap.data().status || 'active';
            const newStatus = current === 'resolved' ? 'active' : 'resolved';
            Alert.alert(
                newStatus === 'resolved' ? 'Resolve Item' : 'Reopen Item',
                newStatus === 'resolved' ? 'Mark this item as resolved?' : 'Reopen this item?',
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: newStatus === 'resolved' ? 'Resolve' : 'Reopen',
                        onPress: async () => {
                            await updateDoc(doc(db, 'posts', thePostId), { status: newStatus });
                            swipeableRefs.current[chat.id]?.close();
                        }
                    }
                ]
            );
        } catch (e) {
            Alert.alert('Error', 'Failed to update post.');
        }
    };

    const handleMultiDelete = () => {
        if (selectedIds.size === 0) return;
        Alert.alert('Delete Chats', `Delete ${selectedIds.size} conversation(s)?`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete', style: 'destructive',
                onPress: async () => {
                    for (const chatId of selectedIds) {
                        try {
                            const messagesSnap = await getDocs(collection(db, 'chats', chatId, 'messages'));
                            await Promise.all(messagesSnap.docs.map(d => deleteDoc(d.ref)));
                            await deleteDoc(doc(db, 'chats', chatId));
                        } catch { /* continue */ }
                    }
                    setSelectedIds(new Set());
                    setSelectMode(false);
                }
            }
        ]);
    };

    const toggleSelect = (chatId: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(chatId)) next.delete(chatId);
            else next.add(chatId);
            return next;
        });
    };

    const renderRightActions = (chatId: string) => {
        return (
            <TouchableOpacity
                style={styles.swipeDeleteAction}
                onPress={() => handleDeleteChat(chatId)}
                activeOpacity={0.8}
            >
                <Ionicons name="trash-outline" size={22} color="#fff" />
                <Text style={styles.swipeActionText}>Delete</Text>
            </TouchableOpacity>
        );
    };

    const renderLeftActions = (chat: any) => {
        if (!chat.postId) return null;
        return (
            <TouchableOpacity
                style={styles.swipeResolveAction}
                onPress={() => handleResolveFromList(chat)}
                activeOpacity={0.8}
            >
                <Ionicons name="checkmark-circle-outline" size={22} color="#fff" />
                <Text style={styles.swipeActionText}>Resolve</Text>
            </TouchableOpacity>
        );
    };

    const renderItem = ({ item }: { item: any }) => {
        const otherUserId = item.participants.find((p: string) => p !== currentUser?.uid);
        const otherUserName = item.participantNames?.[otherUserId] || 'Unknown User';
        const unread = isUnread(item);
        const otherUserPhoto = userPhotoCache[otherUserId];
        const isSelected = selectedIds.has(item.id);

        const renderAvatar = () => {
            if (item.postImage) {
                return <Image source={{ uri: item.postImage }} style={styles.itemThumb} />;
            }
            if (otherUserPhoto) {
                return <Image source={{ uri: otherUserPhoto }} style={styles.avatarImage} />;
            }
            return (
                <View style={[styles.avatar, unread && styles.avatarUnread]}>
                    <Text style={styles.avatarText}>{otherUserName[0].toUpperCase()}</Text>
                </View>
            );
        };

        const chatContent = (
            <TouchableOpacity
                style={[styles.chatCard, unread && styles.chatCardUnread, isSelected && styles.chatCardSelected]}
                onPress={() => {
                    if (selectMode) {
                        toggleSelect(item.id);
                    } else {
                        navigation.navigate('Chat', {
                            recipientId: otherUserId,
                            recipientName: otherUserName,
                            postId: item.postId,
                            postTitle: item.postTitle,
                            postImage: item.postImage,
                            chatId: item.id,
                        });
                    }
                }}
                onLongPress={() => {
                    if (!selectMode) {
                        setSelectMode(true);
                        setSelectedIds(new Set([item.id]));
                    }
                }}
                activeOpacity={0.7}
            >
                {selectMode && (
                    <View style={[styles.selectCircle, isSelected && styles.selectCircleActive]}>
                        {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </View>
                )}
                {renderAvatar()}
                <View style={styles.chatInfo}>
                    <View style={styles.chatHeader}>
                        <Text style={[styles.chatName, unread && styles.chatNameUnread]} numberOfLines={1}>{otherUserName}</Text>
                        <View style={styles.timeRow}>
                            {unread && <View style={styles.unreadDot} />}
                            <Text style={[styles.chatTime, unread && styles.chatTimeUnread]}>{timeAgo(item.updatedAt)}</Text>
                        </View>
                    </View>
                    {item.postTitle && (
                        <Text style={styles.itemLabel} numberOfLines={1}>{item.postTitle}</Text>
                    )}
                    <Text style={[styles.lastMessage, unread && styles.lastMessageUnread]} numberOfLines={1}>{item.lastMessage || 'Start a conversation...'}</Text>
                </View>
            </TouchableOpacity>
        );

        if (selectMode) return chatContent;

        return (
            <Swipeable
                ref={(ref) => { swipeableRefs.current[item.id] = ref; }}
                renderRightActions={() => renderRightActions(item.id)}
                renderLeftActions={() => renderLeftActions(item)}
                overshootRight={false}
                overshootLeft={false}
                friction={2}
            >
                {chatContent}
            </Swipeable>
        );
    };

    return (
        <View style={styles.container}>
            {/* Multi-select toolbar */}
            {selectMode && selectedIds.size > 0 && (
                <View style={styles.selectToolbar}>
                    <Text style={styles.selectCount}>{selectedIds.size} selected</Text>
                    <TouchableOpacity style={styles.selectDeleteBtn} onPress={handleMultiDelete}>
                        <Ionicons name="trash-outline" size={18} color="#fff" />
                        <Text style={styles.selectDeleteText}>Delete</Text>
                    </TouchableOpacity>
                </View>
            )}
            <FlatList
                data={chats}
                keyExtractor={item => item.id}
                renderItem={renderItem}
                contentContainerStyle={styles.list}
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Text style={styles.emptyTitle}>No messages yet</Text>
                        <Text style={styles.emptySubtext}>Chat with someone from a Lost & Found post!</Text>
                    </View>
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    list: { padding: theme.spacing.md },

    // Swipe actions
    swipeDeleteAction: {
        backgroundColor: theme.colors.danger,
        justifyContent: 'center',
        alignItems: 'center',
        width: 80,
        borderRadius: theme.radius.xl,
        marginBottom: theme.spacing.sm,
        marginLeft: 4,
    },
    swipeResolveAction: {
        backgroundColor: theme.colors.success,
        justifyContent: 'center',
        alignItems: 'center',
        width: 80,
        borderRadius: theme.radius.xl,
        marginBottom: theme.spacing.sm,
        marginRight: 4,
    },
    swipeActionText: { color: '#fff', fontSize: 11, fontWeight: '600', marginTop: 2 },

    // Select mode
    selectToolbar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        backgroundColor: theme.colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
    },
    selectCount: { ...theme.typography.body, fontWeight: '600', color: theme.colors.textPrimary },
    selectDeleteBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: theme.colors.danger,
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: theme.radius.full,
    },
    selectDeleteText: { color: '#fff', fontWeight: '600', fontSize: 13 },
    selectCircle: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 2,
        borderColor: theme.colors.border,
        justifyContent: 'center',
        alignItems: 'center',
    },
    selectCircleActive: {
        backgroundColor: theme.colors.primary,
        borderColor: theme.colors.primary,
    },

    // Chat card
    chatCard: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, backgroundColor: theme.colors.surface, padding: theme.spacing.md, borderRadius: theme.radius.xl, marginBottom: theme.spacing.sm, ...theme.shadows.sm },
    chatCardUnread: { backgroundColor: '#EEF2FF', borderWidth: 1, borderColor: '#C7D2FE' },
    chatCardSelected: { backgroundColor: '#E0E7FF', borderWidth: 1, borderColor: theme.colors.primary },
    avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center' },
    avatarUnread: { backgroundColor: '#4338CA' },
    avatarText: { color: '#fff', fontSize: 17, fontWeight: '700' },
    avatarImage: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.surfaceAlt },
    itemThumb: { width: 48, height: 48, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt },
    chatInfo: { flex: 1 },
    chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
    chatName: { ...theme.typography.body, fontWeight: '600', color: theme.colors.textPrimary, flex: 1 },
    chatNameUnread: { fontWeight: '800', color: '#1E1B4B' },
    itemLabel: { ...theme.typography.caption, color: theme.colors.primary, fontWeight: '500', marginBottom: 1 },
    timeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444' },
    chatTime: { ...theme.typography.caption, color: theme.colors.textMuted },
    chatTimeUnread: { color: theme.colors.primary, fontWeight: '600' },
    lastMessage: { ...theme.typography.bodySecondary, color: theme.colors.textSecondary },
    lastMessageUnread: { color: '#1E1B4B', fontWeight: '600' },
    emptyContainer: { alignItems: 'center', marginTop: 60 },
    emptyTitle: { ...theme.typography.h3, marginBottom: 4, color: theme.colors.textPrimary },
    emptySubtext: { ...theme.typography.bodySecondary, color: theme.colors.textSecondary, textAlign: 'center' },
});
