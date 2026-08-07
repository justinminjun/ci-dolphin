import React, { useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, FlatList, TouchableOpacity, Modal, Dimensions, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, r } from '../theme/theme';
import { db, auth } from '../config/firebase';
import {
    collection, query, onSnapshot, where, updateDoc, doc, getDoc, deleteDoc,
} from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SCREEN_WIDTH = Dimensions.get('window').width;

const NOTIF_META: Record<string, { icon: string; color: string; label: string }> = {
    like: { icon: 'heart', color: '#EF4444', label: 'Like' },
    comment: { icon: 'chatbox', color: '#2563EB', label: 'Comment' },
    chat: { icon: 'chatbubbles', color: '#0EA5E9', label: 'Chat' },
    queue: { icon: 'cart', color: '#F97316', label: 'Queue' },
    announcement: { icon: 'megaphone', color: '#F59E0B', label: 'Announcement' },
};

export function NotificationsScreen({ navigation }: any) {
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
                // Add more custom filtering based on app requirements
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

    const timeAgo = (ts: any) => {
        if (!ts) return '';
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        const diff = (Date.now() - d.getTime()) / 1000;
        if (diff < 60) return 'Just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    };

    const markAsRead = async (id: string) => {
        try {
            await updateDoc(doc(db, 'dolphin_notifications', id), { read: true });
        } catch {}
    };

    const handleNotifPress = async (item: any) => {
        // Delete the notification on tap
        if (item.type !== 'announcement' && item.id) {
            try { await deleteDoc(doc(db, 'dolphin_notifications', item.id)); } catch {}
        }

        if (item.type === 'announcement') {
            setAnnouncementPopup(item);
            // Mark as seen so it disappears from list
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

    const renderItem = ({ item }: { item: any }) => {
        const meta = NOTIF_META[item.type] || NOTIF_META.announcement;
        const isUnread = !item.read;

        return (
            <TouchableOpacity
                style={[styles.notifCard, isUnread && styles.notifUnread]}
                activeOpacity={0.7}
                onPress={() => handleNotifPress(item)}
            >
                <View style={[styles.notifIcon, { backgroundColor: meta.color + '18' }]}>
                    <Ionicons name={meta.icon as any} size={20} color={meta.color} />
                </View>
                <View style={styles.notifContent}>
                    <Text style={styles.notifTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.notifBody} numberOfLines={2}>{item.body}</Text>
                    <Text style={styles.notifTime}>{timeAgo(item.createdAt)}</Text>
                </View>
                {isUnread && item.type !== 'announcement' && <View style={styles.unreadDot} />}
            </TouchableOpacity>
        );
    };

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Notifications</Text>
                <View style={{ width: 32 }} />
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
                    renderItem={renderItem}
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

    emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: theme.colors.textMuted, marginTop: 16 },
    emptyHint: { fontSize: 14, color: theme.colors.textMuted, textAlign: 'center', marginTop: 8 },

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
