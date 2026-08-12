import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/theme';

interface NavItem {
    route: string;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    color: string;
    badge?: number;
}

interface Props {
    activeRoute: string;
    isStudent: boolean;
    unreadCount: number;
    onNavigate: (route: string) => void;
}

const SIDEBAR_WIDTH = 240;

export function WebSidebarNav({ activeRoute, isStudent, unreadCount, onNavigate }: Props) {
    const items: NavItem[] = [
        { route: 'Home', label: 'Home', icon: 'home', color: theme.colors.primary },
        ...(!isStudent ? [{ route: 'Community', label: 'F&S Lounge', icon: 'chatbubbles' as const, color: '#6366F1' }] : []),
        { route: 'Local', label: 'Local Guide', icon: 'map', color: '#10B981' },
        { route: 'LostFound', label: 'Lost & Found', icon: 'search-circle', color: '#10B981' },
        { route: 'ChatList', label: 'Messages', icon: 'mail', color: '#0EA5E9', badge: unreadCount },
        { route: 'Profile', label: 'My Profile', icon: 'person-circle', color: theme.colors.primary },
    ];

    return (
        <View style={styles.sidebar}>
            <View style={styles.brandRow}>
                <Image source={require('../../assets/dolphin-logo.png')} style={styles.logo} />
                <Text style={styles.brandText}>Dolphin</Text>
            </View>

            <View style={styles.navList}>
                {items.map(item => {
                    const active = activeRoute === item.route;
                    return (
                        <TouchableOpacity
                            key={item.route}
                            style={[styles.navItem, active && { backgroundColor: item.color + '18' }]}
                            activeOpacity={0.7}
                            onPress={() => onNavigate(item.route)}
                        >
                            <Ionicons name={item.icon} size={22} color={active ? item.color : theme.colors.textMuted} />
                            <Text style={[styles.navLabel, active && { color: item.color, fontWeight: '800' }]}>
                                {item.label}
                            </Text>
                            {!!item.badge && (
                                <View style={styles.badge}>
                                    <Text style={styles.badgeText}>{item.badge > 99 ? '99+' : item.badge}</Text>
                                </View>
                            )}
                        </TouchableOpacity>
                    );
                })}
            </View>
        </View>
    );
}

export { SIDEBAR_WIDTH };

const styles = StyleSheet.create({
    sidebar: {
        width: SIDEBAR_WIDTH,
        backgroundColor: theme.colors.surface,
        borderRightWidth: 1,
        borderRightColor: theme.colors.borderLight,
        paddingTop: 28,
        paddingHorizontal: 16,
    },
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, marginBottom: 28 },
    logo: { width: 34, height: 34, borderRadius: 9 },
    brandText: { fontSize: 20, fontWeight: '800', color: theme.colors.primary },
    navList: { gap: 4 },
    navItem: {
        flexDirection: 'row', alignItems: 'center', gap: 14,
        paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12,
    },
    navLabel: { fontSize: 15, fontWeight: '600', color: theme.colors.textSecondary, flex: 1 },
    badge: {
        minWidth: 20, height: 20, borderRadius: 10,
        backgroundColor: theme.colors.danger, justifyContent: 'center', alignItems: 'center',
        paddingHorizontal: 5,
    },
    badgeText: { fontSize: 11, fontWeight: '800', color: '#fff' },
});
