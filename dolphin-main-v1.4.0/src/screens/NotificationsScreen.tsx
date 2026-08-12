import React, { useEffect, useState, useRef } from 'react';
import {
    View, Text, StyleSheet, FlatList, TouchableOpacity, Modal, Dimensions, Alert,
    Animated, PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, r } from '../theme/theme';
import { db, auth } from '../config/firebase';
import {
    collection, query, onSnapshot, where, updateDoc, doc, getDoc, deleteDoc,
    writeBatch,
} from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsWebDesktop } from '../utils/useResponsive';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.3;

const NOTIF_META: Record<string, { icon: string; color: string; label: string }> = {
    like: { icon: 'heart', color: '#EF4444', label: 'Like' },
    comment: { icon: 'chatbox', color: '#2563EB', label: 'Comment' },
    chat: { icon: 'chatbubbles', color: '#0EA5E9', label: 'Chat' },
    queue: { icon: 'cart', color: '#F97316', label: 'Queue' },
    lounge: { icon: 'chatbubbles', color: '#6366F1', label: 'F&S Lounge' },
    market: { icon: 'storefront', color: '#F97316', label: 'Market' },
    announcement: { icon: 'megaphone', color: '#F59E0B', label: 'Announcement' },
};

// ─── Swipeable Notification Row ───
function SwipeableNotifRow({ item, onPress, onDelete }: {
    item: any;
    onPress: () => void;
    onDelete: () => void;
}) {
    const translateX = useRef(new Animated.Value(0)).current;
    const rowHeight = useRef(new Animated.Value(1)).current;
    const meta = NOTIF_META[item.type] || NOTIF_META.announcement;
    const isUnread = !item.read;

    const panResponder = useRef(PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 15 && Math.abs(g.dy) < 20,
        onPanResponderMove: (_, g) => {
            translateX.setValue(g.dx);
        },
        onPanResponderRelease: (_, g) => {
            if (Math.abs(g.dx) > SWIPE_THRESHOLD) {
                // Swipe away
                const dir = g.dx > 0 ? SCREEN_WIDTH : -SCREEN_WIDTH;
                Animated.timing(translateX, {
                    toValue: dir,
                    duration: 200,
                    useNativeDriver: true,
                }).start(() => {
                    Animated.timing(rowHeight, {
                        toValue: 0,
                        duration: 200,
                        useNativeDriver: false,
                    }).start(onDelete);
                });
            } else {
                // Snap back
                Animated.spring(translateX, {
                    toValue: 0,
                    useNativeDriver: true,
                    tension: 80,
                    friction: 10,
                }).start();
            }
        },
    })).current;

    const opacity = translateX.interpolate({
        inputRange: [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
        outputRange: [0, 1, 0],
    });

    return (
        <Animated.View
            style={{
                maxHeight: rowHeight.interpolate({ inputRange: [0, 1], outputRange: [0, 200] }),
                opacity: rowHeight,
                overflow: 'hidden',
            }}
        >
            {/* Delete background */}
            <View style={styles.swipeBg}>
                <View style={styles.swipeBgLeft}>
                    <Ionicons name="trash" size={22} color="#fff" />
                    <Text style={styles.swipeBgText}>Delete</Text>
                </View>
                <View style={styles.swipeBgRight}>
                    <Text style={styles.swipeBgText}>Delete</Text>
                    <Ionicons name="trash" size={22} color="#fff" />
                </View>
            </View>

            <Animated.View
                {...panResponder.panHandlers}
                style={[{ transform: [{ translateX }], opacity }]}
            >
                <TouchableOpacity
                    style={[styles.notifCard, isUnread && styles.notifUnread]}
                    activeOpacity={0.7}
                    onPress={onPress}
                >
                    <View style={[styles.notifIcon, { backgroundColor: meta.color + '18' }]}>
                        <Ionicons name={meta.icon as any} size={20} color={meta.color} />
                    </View>
                    <View style={styles.notifContent}>
                        <Text style={styles.notifTitle} numberOfLines={1}>{item.title}</Text>
                        <Text style={styles.notifBody} numberOfLines={2}>{item.body}</Text>
                        <Text style={styles.notifTime}>{timeAgoFn(item.createdAt)}</Text>
                    </View>
                    {isUnread && item.type !== 'announcement' && <View style={styles.unreadDot} />}
                </TouchableOpacity>
            </Animated.View>
        </Animated.View>
    );
}

function timeAgoFn(ts: any) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

export function NotificationsScreen({ navigation }: any) {
    const isWebDesktop = useIsWebDesktop();
    const [notifications, setNotifications] = useState<any[]>([]);
    const [announcements, setAnnouncements] = useState<any[]>([]);
    const [announcementPopup, setAnnouncementPopup] = useState<any>(null);
    const currentUser = auth.currentUser;

    useEffect(() => {
        if (!currentUser) return;
        const unsubs: (() => void)[] = [];

        // Personal notifications (no composite index needed)
        const q = query(
            collection(db, 'dolphin_notifications'),
            where('recipientId', '==', currentUser.uid)
        );
        unsubs.push(onSnapshot(q, async snap => {
            const val = await AsyncStorage.getItem('@notif_settings');
            const prefs = val ? JSON.parse(val) : {};
            const isAllEnabled = prefs.all !== false;

            let items = snap.docs.map(d => ({ id: d.id, ...d.data() as any }));

            // Filter out notifications based on preferences
            items = items.filter(item => {
                if (!isAllEnabled && item.type !== 'announcement') return false;
                if (item.type === 'like' && prefs.likes === false) return false;
                if (item.type === 'comment' && prefs.comments === false) return false;
                if (item.type === 'chat' && prefs.messages === false) return false;
                if (item.type === 'lounge' && prefs.lounge === false) return false;
                if (item.type === 'market' && prefs.market === false) return false;
                return true;
            });

            items.sort((a: any, b: any) => {
                const tA = a.createdAt?.seconds || 0;
                const tB = b.createdAt?.seconds || 0;
                return tB - tA;
            });
            setNotifications(items);
        }, () => setNotifications([])));

        // Global announcements
        const aq = query(
            collection(db, 'dolphin_announcements')
        );
        unsubs.push(onSnapshot(aq, async snap => {
            const items = snap.docs.map(d => ({ id: d.id, ...d.data(), type: 'announcement' }));
            items.sort((a: any, b: any) => {
                const tA = a.createdAt?.seconds || 0;
                const tB = b.createdAt?.seconds || 0;
                return tB - tA;
            });
            // Filter out already-seen announcements
            const filtered: any[] = [];
            for (const item of items) {
                const seen = await AsyncStorage.getItem(`seen_announcement_${item.id}`);
                if (!seen) filtered.push(item);
            }
            setAnnouncements(filtered);
        }));

        return () => unsubs.forEach(u => u());
    }, [currentUser]);

    const allItems = [...announcements, ...notifications].sort((a, b) => {
        const tA = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
        const tB = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
        return tB - tA;
    });

    const markAsRead = async (id: string) => {
        try {
            await updateDoc(doc(db, 'dolphin_notifications', id), { read: true });
        } catch {}
    };

    const handleDeleteNotif = async (item: any) => {
        if (item.type === 'announcement') {
            await AsyncStorage.setItem(`seen_announcement_${item.id}`, 'true');
            setAnnouncements(prev => prev.filter(a => a.id !== item.id));
        } else {
            try { await deleteDoc(doc(db, 'dolphin_notifications', item.id)); } catch {}
        }
    };

    const handleClearAll = () => {
        if (allItems.length === 0) return;
        Alert.alert(
            'Clear All Notifications',
            'Are you sure you want to delete all notifications?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Clear All', style: 'destructive',
                    onPress: async () => {
                        // Delete personal notifications
                        const batch = writeBatch(db);
                        for (const notif of notifications) {
                            batch.delete(doc(db, 'dolphin_notifications', notif.id));
                        }
                        try { await batch.commit(); } catch {}

                        // Mark all announcements as seen
                        for (const ann of announcements) {
                            await AsyncStorage.setItem(`seen_announcement_${ann.id}`, 'true');
                        }
                        setAnnouncements([]);
                    },
                },
            ]
        );
    };

    const handleNotifPress = async (item: any) => {
        // Mark notification as read on tap
        if (item.type !== 'announcement' && item.id && !item.read) {
            try { await updateDoc(doc(db, 'dolphin_notifications', item.id), { read: true }); } catch {}
        }

        if (item.type === 'announcement') {
            setAnnouncementPopup(item);
            await AsyncStorage.setItem(`seen_announcement_${item.id}`, 'true');
            setAnnouncements(prev => prev.filter(a => a.id !== item.id));
        } else if (item.type === 'comment' || item.type === 'like') {
            if (item.postId) {
                try {
                    const snap = await getDoc(doc(db, 'lounge_posts', item.postId));
                    if (snap.exists()) {
                        navigation.navigate('PostDetail', { post: { id: snap.id, ...snap.data() } });
                    } else {
                        Alert.alert('Not Found', 'This post may have been deleted.');
                    }
                } catch { Alert.alert('Error', 'Could not load post.'); }
            }
        } else if (item.type === 'chat') {
            if (item.chatId) {
                navigation.navigate('ChatRoom', {
                    chatId: item.chatId,
                    otherUserId: item.senderId,
                    otherUserName: item.senderName || 'Someone',
                });
            } else {
                Alert.alert('Chat Unavailable', 'This chat could not be found.');
            }
        } else if (item.listingId) {
            try {
                const snap = await getDoc(doc(db, 'market_listings', item.listingId));
                if (snap.exists()) {
                    navigation.navigate('ListingDetail', {
                        listing: { id: snap.id, ...snap.data() },
                        openQueue: item.type === 'queue' || item.type === 'request',
                    });
                } else {
                    Alert.alert('Not Found', 'This listing may have been deleted.');
                }
            } catch { Alert.alert('Error', 'Could not load listing.'); }
        }
    };

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={[styles.header, isWebDesktop && { paddingTop: 20 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Notifications</Text>
                {allItems.length > 0 ? (
                    <TouchableOpacity onPress={handleClearAll} style={styles.clearBtn}>
                        <Ionicons name="trash-outline" size={18} color="#EF4444" />
                        <Text style={styles.clearBtnText}>Clear</Text>
                    </TouchableOpacity>
                ) : (
                    <View style={{ width: 60 }} />
                )}
            </View>

            {allItems.length === 0 ? (
                <View style={styles.emptyWrap}>
                    <Ionicons name="notifications-off-outline" size={56} color={theme.colors.textMuted} />
                    <Text style={styles.emptyTitle}>No notifications yet</Text>
                    <Text style={styles.emptyHint}>Likes, comments, chats, and announcements will appear here</Text>
                </View>
            ) : (
                <FlatList
                    data={allItems}
                    keyExtractor={(item, i) => item.id + '_' + i}
                    renderItem={({ item }) => (
                        <SwipeableNotifRow
                            item={item}
                            onPress={() => handleNotifPress(item)}
                            onDelete={() => handleDeleteNotif(item)}
                        />
                    )}
                    contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
                />
            )}

            {/* Announcement Popup */}
            <Modal visible={!!announcementPopup} transparent animationType="fade" onRequestClose={() => setAnnouncementPopup(null)}>
                <View style={styles.popupOverlay}>
                    <View style={styles.popupCard}>
                        <View style={styles.popupHeader}>
                            <Ionicons name="megaphone" size={24} color="#F59E0B" />
                            <Text style={styles.popupLabel}>Announcement</Text>
                        </View>
                        <Text style={styles.popupTitle}>{announcementPopup?.title}</Text>
                        <Text style={styles.popupBody}>{announcementPopup?.body}</Text>
                        <TouchableOpacity style={styles.popupBtn} onPress={() => setAnnouncementPopup(null)}>
                            <Text style={styles.popupBtnText}>OK</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingTop: 60, paddingBottom: 12,
        backgroundColor: theme.colors.surface, ...theme.shadows.sm,
    },
    backBtn: { padding: 4 },
    headerTitle: { ...theme.typography.h3, color: theme.colors.textPrimary },
    clearBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: 10, paddingVertical: 6, borderRadius: r(8),
        backgroundColor: '#FEF2F2',
    },
    clearBtnText: { fontSize: 13, fontWeight: '600', color: '#EF4444' },

    emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: theme.colors.textMuted, marginTop: 16 },
    emptyHint: { fontSize: 14, color: theme.colors.textMuted, textAlign: 'center', marginTop: 8 },

    // Swipe background
    swipeBg: {
        position: 'absolute', top: 0, bottom: 10, left: 0, right: 0,
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        backgroundColor: '#EF4444', borderRadius: r(14), paddingHorizontal: 20,
    },
    swipeBgLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    swipeBgRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    swipeBgText: { color: '#fff', fontWeight: '700', fontSize: 14 },

    notifCard: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        backgroundColor: theme.colors.surface, borderRadius: r(14),
        padding: 14, marginBottom: 10, borderWidth: 1, borderColor: theme.colors.borderLight,
    },
    notifUnread: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' },
    notifIcon: {
        width: 40, height: 40, borderRadius: r(12), justifyContent: 'center', alignItems: 'center',
    },
    notifContent: { flex: 1 },
    notifTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.textPrimary },
    notifBody: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 2 },
    notifTime: { fontSize: 11, color: theme.colors.textMuted, marginTop: 4 },
    unreadDot: { width: 8, height: 8, borderRadius: r(4), backgroundColor: '#2563EB' },

    popupOverlay: {
        flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center', alignItems: 'center', padding: 32,
    },
    popupCard: {
        backgroundColor: '#fff', borderRadius: r(20), padding: 24,
        width: '100%', maxWidth: 340, ...theme.shadows.lg,
    },
    popupHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
    popupLabel: { fontSize: 14, fontWeight: '800', color: '#F59E0B' },
    popupTitle: { fontSize: 20, fontWeight: '800', color: theme.colors.textPrimary, marginBottom: 8 },
    popupBody: { fontSize: 15, color: theme.colors.textSecondary, lineHeight: 22 },
    popupBtn: {
        backgroundColor: theme.colors.primary, borderRadius: r(12),
        paddingVertical: 12, alignItems: 'center', marginTop: 20,
    },
    popupBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
