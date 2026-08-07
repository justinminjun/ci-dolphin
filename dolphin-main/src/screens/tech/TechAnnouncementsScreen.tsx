import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, r } from '../../theme/theme';
import { db, auth } from '../../config/firebase';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';

const DEFAULT_ANNOUNCEMENTS = [
    { id: 'default1', title: 'WiFi Network Info', body: 'Student WiFi: CIS-Student\nStaff WiFi: CIS-Staff\nGuest WiFi: CIS-Guest', category: 'info', createdAt: null },
    { id: 'default2', title: 'Tech Office Hours', body: 'Monday–Friday: 7:30 AM – 4:30 PM\nLocation: Room B118\nEmail: techsupport@chadwickschool.org', category: 'info', createdAt: null },
    { id: 'default3', title: 'Password Reset', body: 'If you forgot your Google password, visit the Tech Office with your student ID. Staff can reset through the admin portal.', category: 'tip', createdAt: null },
];

export function TechAnnouncementsScreen() {
    const [announcements, setAnnouncements] = useState<any[]>(DEFAULT_ANNOUNCEMENTS);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        const q = query(collection(db, 'tech_announcements'), orderBy('createdAt', 'desc'));
        const unsub = onSnapshot(q, (snap) => {
            const live = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setAnnouncements(live.length > 0 ? live : DEFAULT_ANNOUNCEMENTS);
            setRefreshing(false);
        }, () => setRefreshing(false));
        return unsub;
    }, []);

    const getCategoryStyle = (cat: string) => {
        switch (cat) {
            case 'urgent': return { bg: '#FEE2E2', color: '#EF4444', icon: 'alert-circle' };
            case 'update': return { bg: '#DBEAFE', color: '#3B82F6', icon: 'arrow-up-circle' };
            case 'tip': return { bg: '#D1FAE5', color: '#10B981', icon: 'bulb' };
            default: return { bg: '#E0E7FF', color: '#6366F1', icon: 'information-circle' };
        }
    };

    const renderItem = ({ item }: any) => {
        const style = getCategoryStyle(item.category);
        return (
            <View style={styles.card}>
                <View style={styles.cardHeader}>
                    <View style={[styles.badge, { backgroundColor: style.bg }]}>
                        <Ionicons name={style.icon as any} size={14} color={style.color} />
                        <Text style={[styles.badgeText, { color: style.color }]}>
                            {(item.category || 'info').toUpperCase()}
                        </Text>
                    </View>
                </View>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardBody}>{item.body}</Text>
            </View>
        );
    };

    return (
        <FlatList
            data={announcements}
            keyExtractor={item => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={() => setRefreshing(true)} tintColor="#6366F1" />
            }
            ListEmptyComponent={
                <View style={styles.empty}>
                    <Ionicons name="megaphone-outline" size={48} color={theme.colors.textMuted} />
                    <Text style={styles.emptyText}>No announcements yet</Text>
                </View>
            }
        />
    );
}

const styles = StyleSheet.create({
    list: { padding: 16, paddingBottom: 20 },
    card: {
        backgroundColor: '#fff', borderRadius: r(16), padding: 16,
        marginBottom: 12, ...theme.shadows.sm,
    },
    cardHeader: { flexDirection: 'row', marginBottom: 8 },
    badge: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: 8, paddingVertical: 3, borderRadius: r(20),
    },
    badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
    cardTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a2e', marginBottom: 4 },
    cardBody: { fontSize: 14, lineHeight: 20, color: '#6B7280' },
    empty: { alignItems: 'center', marginTop: 60 },
    emptyText: { color: theme.colors.textMuted, marginTop: 12, fontSize: 15 },
});
