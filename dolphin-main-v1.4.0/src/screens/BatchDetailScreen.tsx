import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, r } from '../theme/theme';
import { formatPrice } from '../utils/price';
import { db, auth } from '../config/firebase';
import { collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { useIsWebDesktop } from '../utils/useResponsive';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_GAP = 10;
const CARD_WIDTH = (SCREEN_WIDTH - 16 * 2 - CARD_GAP) / 2;

function timeAgo(timestamp: any): string {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const diff = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
    available: { label: 'On Sale', color: '#059669', bg: '#D1FAE5' },
    sold: { label: 'Sold', color: '#DC2626', bg: '#FEE2E2' },
    reserved: { label: 'Reserved', color: '#D97706', bg: '#FEF3C7' },
};

export function BatchDetailScreen({ route, navigation }: any) {
    const isWebDesktop = useIsWebDesktop();
    const { items, sellerName } = route.params;
    const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
    const uid = auth.currentUser?.uid;

    useEffect(() => {
        if (!uid) return;
        const unsub = onSnapshot(collection(db, 'users', uid, 'market_saved'), (snap) => {
            setSavedIds(new Set(snap.docs.map(d => d.id)));
        });
        return unsub;
    }, [uid]);

    const toggleSave = async (itemId: string) => {
        if (!uid) return;
        const ref = doc(db, 'users', uid, 'market_saved', itemId);
        try {
            if (savedIds.has(itemId)) {
                await deleteDoc(ref);
            } else {
                await setDoc(ref, { savedAt: new Date().toISOString(), listingId: itemId });
            }
        } catch {}
    };

    const renderItem = ({ item }: { item: any }) => {
        const statusInfo = STATUS_META[item.status] || STATUS_META.available;
        const isSaved = savedIds.has(item.id);

        return (
            <TouchableOpacity
                style={styles.itemCard}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('ListingDetail', { listing: item })}
            >
                {item.photos && item.photos[0] ? (
                    <Image source={{ uri: item.photos[0] }} style={styles.itemImage} />
                ) : (
                    <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                        <Ionicons name="cube-outline" size={32} color={theme.colors.textMuted} />
                    </View>
                )}
                {/* Status badge */}
                <View style={[styles.statusBadge, { backgroundColor: statusInfo.bg }]}>
                    <Text style={[styles.statusBadgeText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
                </View>
                {/* Heart / Save */}
                <TouchableOpacity
                    style={styles.heartBtn}
                    activeOpacity={0.7}
                    onPress={() => toggleSave(item.id)}
                >
                    <Ionicons
                        name={isSaved ? 'heart' : 'heart-outline'}
                        size={20}
                        color={isSaved ? '#EF4444' : theme.colors.textMuted}
                    />
                </TouchableOpacity>
                <View style={styles.itemInfo}>
                    <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.itemPrice}>{formatPrice(item.price, item.currency)}</Text>
                    <Text style={styles.itemTime}>{timeAgo(item.createdAt)}</Text>
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <View style={styles.container}>
            <View style={[styles.header, isWebDesktop && { paddingTop: 20 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{sellerName}'s Items</Text>
                <View style={{ width: 32 }} />
            </View>

            <FlatList
                data={items}
                keyExtractor={item => item.id}
                renderItem={renderItem}
                numColumns={2}
                columnWrapperStyle={styles.row}
                contentContainerStyle={styles.list}
            />
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
    headerTitle: { fontSize: 18, fontWeight: '700', color: theme.colors.textPrimary },
    list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 },
    row: { gap: CARD_GAP, marginBottom: CARD_GAP },
    itemCard: {
        width: CARD_WIDTH, backgroundColor: theme.colors.surface,
        borderRadius: r(14), ...theme.shadows.sm,
    },
    itemImage: {
        width: '100%', height: CARD_WIDTH, resizeMode: 'cover',
        borderTopLeftRadius: r(14), borderTopRightRadius: r(14),
    },
    itemImagePlaceholder: { backgroundColor: theme.colors.surfaceAlt, justifyContent: 'center', alignItems: 'center' },
    statusBadge: {
        position: 'absolute', top: 8, left: 8,
        paddingHorizontal: 8, paddingVertical: 3, borderRadius: r(4),
    },
    statusBadgeText: { fontSize: 10, fontWeight: '800' },
    heartBtn: {
        position: 'absolute', top: CARD_WIDTH - 32, right: 8,
        width: 32, height: 32, borderRadius: r(16),
        backgroundColor: 'rgba(255,255,255,0.95)',
        justifyContent: 'center', alignItems: 'center',
        ...theme.shadows.sm,
    },
    itemInfo: { padding: 10 },
    itemName: { fontSize: 13, fontWeight: '600', color: theme.colors.textPrimary },
    itemPrice: { fontSize: 16, fontWeight: '800', color: theme.colors.textPrimary, marginTop: 2 },
    itemTime: { fontSize: 11, color: theme.colors.textMuted, marginTop: 4 },
});
