import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, r } from '../theme/theme';
import { useIsWebDesktop } from '../utils/useResponsive';

export function SellerDetailScreen({ route, navigation }: any) {
    const isWebDesktop = useIsWebDesktop();
    const { seller } = route.params;

    const renderItem = ({ item }: any) => (
        <View style={styles.itemCard}>
            {item.photos && item.photos[0] ? (
                <Image source={{ uri: item.photos[0] }} style={styles.itemImage} />
            ) : (
                <View style={[styles.itemImage, styles.placeholder]}>
                    <Ionicons name="cube-outline" size={32} color={theme.colors.textMuted} />
                </View>
            )}
            <View style={styles.itemInfo}>
                <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.itemPrice}>{item.price || 'Price not set'}</Text>
                {item.description ? (
                    <Text style={styles.itemDesc} numberOfLines={2}>{item.description}</Text>
                ) : null}
                <View style={styles.statusBadge}>
                    <Text style={styles.statusText}>{item.status || 'Available'}</Text>
                </View>
            </View>
        </View>
    );

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={[styles.header, isWebDesktop && { paddingTop: 20 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Seller</Text>
                <View style={{ width: 32 }} />
            </View>

            {/* Seller Profile */}
            <View style={styles.sellerCard}>
                {seller.sellerPhoto ? (
                    <Image source={{ uri: seller.sellerPhoto }} style={styles.sellerAvatar} />
                ) : (
                    <View style={[styles.sellerAvatar, styles.avatarFallback]}>
                        <Text style={styles.avatarText}>{seller.sellerName[0]}</Text>
                    </View>
                )}
                <Text style={styles.sellerName}>{seller.sellerName}</Text>
                <Text style={styles.sellerCount}>{seller.totalItems} item{seller.totalItems > 1 ? 's' : ''} listed</Text>
            </View>

            {/* Items */}
            <FlatList
                data={seller.items}
                keyExtractor={item => item.id}
                renderItem={renderItem}
                contentContainerStyle={styles.list}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: theme.spacing.md, paddingTop: 60, paddingBottom: 12,
        backgroundColor: theme.colors.surface, ...theme.shadows.sm,
    },
    backBtn: { padding: 4 },
    headerTitle: { ...theme.typography.h3, color: theme.colors.textPrimary },
    sellerCard: {
        alignItems: 'center', padding: 20,
        backgroundColor: theme.colors.surface, marginBottom: 8,
    },
    sellerAvatar: { width: 64, height: 64, borderRadius: r(32), backgroundColor: theme.colors.surfaceAlt, marginBottom: 10 },
    avatarFallback: { justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.primaryLight },
    avatarText: { color: '#fff', fontWeight: '700', fontSize: 24 },
    sellerName: { ...theme.typography.h2, color: theme.colors.textPrimary, fontSize: 20 },
    sellerCount: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: 4 },
    list: { padding: theme.spacing.md },
    itemCard: {
        flexDirection: 'row', backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        marginBottom: 12, ...theme.shadows.sm,
    },
    itemImage: {
        width: 100, height: 100, resizeMode: 'cover',
        borderTopLeftRadius: theme.radius.lg, borderBottomLeftRadius: theme.radius.lg,
    },
    placeholder: {
        backgroundColor: theme.colors.surfaceAlt,
        justifyContent: 'center', alignItems: 'center',
    },
    itemInfo: { flex: 1, padding: 12 },
    itemName: { ...theme.typography.bodyBold, color: theme.colors.textPrimary, fontSize: 15, marginBottom: 4 },
    itemPrice: { ...theme.typography.h3, color: theme.colors.primary, fontSize: 16, marginBottom: 4 },
    itemDesc: { ...theme.typography.caption, color: theme.colors.textSecondary, lineHeight: 16, marginBottom: 6 },
    statusBadge: {
        alignSelf: 'flex-start', backgroundColor: '#D1FAE5',
        paddingHorizontal: 8, paddingVertical: 2, borderRadius: r(6),
    },
    statusText: { fontSize: 10, fontWeight: '700', color: '#10B981' },
});
