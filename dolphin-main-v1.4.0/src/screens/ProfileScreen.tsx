import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator, Alert, Switch, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, r } from '../theme/theme';
import { centerContent } from '../theme/responsive';
import { useIsWebDesktop } from '../utils/useResponsive';
import { signOut } from 'firebase/auth';
import { auth, db } from '../config/firebase';
import { useAuth } from '../config/AuthContext';
import { doc, getDoc } from 'firebase/firestore';
import { FeedbackModal } from '../components/FeedbackModal';
import { isAdmin as checkIsAdmin, startConfigListener } from '../utils/admin';

export function ProfileScreen({ navigation }: any) {
    const isWebDesktop = useIsWebDesktop();
    const { user, userData, loading, viewAsStudent, setViewAsStudent } = useAuth();
    const [isAdminUser, setIsAdminUser] = useState(false);
    const [showFeedback, setShowFeedback] = useState(false);

    useEffect(() => {
        // Ensure config listener is running for real-time admin list
        startConfigListener();
        setIsAdminUser(checkIsAdmin());
    }, [user]);

    const handleSignOut = () => {
        Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign Out', style: 'destructive', onPress: () => signOut(auth) }
        ]);
    };

    const menuItems = [
        { icon: 'document-text-outline', label: 'My Posts', screen: 'MyPosts' },
        { icon: 'pricetag-outline', label: 'My Listings', screen: 'MyListings' },
        { icon: 'bookmark-outline', label: 'Saved Items', screen: 'Saved' },
        { icon: 'settings-outline', label: 'Settings', screen: 'Settings' },
    ];

    return (
        <View style={styles.container}>
            <View style={[styles.header, isWebDesktop && { paddingTop: 24 }]}>
                <Text style={[styles.headerTitle, centerContent()]}>Profile</Text>
            </View>

            {/* Student View Banner */}
            {viewAsStudent && (
                <TouchableOpacity
                    style={{ backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FDBA74', paddingVertical: 8, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                    onPress={() => { setViewAsStudent(false); Alert.alert('🔓 Admin View Restored'); }}
                >
                    <Ionicons name="eye" size={16} color="#F97316" />
                    <Text style={{ color: '#C2410C', fontWeight: '700', fontSize: 13 }}>👁 Student View Mode — Tap to exit</Text>
                </TouchableOpacity>
            )}

            <ScrollView style={{ flex: 1 }} contentContainerStyle={[{ paddingBottom: 40 }, centerContent()]} showsVerticalScrollIndicator={false} bounces={true}>
            {/* Profile Card */}
            {loading ? (
                <View style={[styles.profileCard, { paddingVertical: 40 }]}>
                    <ActivityIndicator size="large" color={theme.colors.primary} />
                </View>
            ) : user ? (
                <View style={styles.profileCard}>
                    {user.photoURL ? (
                        <Image source={{ uri: user.photoURL }} style={styles.avatar} />
                    ) : (
                        <View style={styles.avatar}>
                            <Ionicons name="person" size={40} color={theme.colors.primary} />
                        </View>
                    )}
                    <Text style={styles.name}>{user.displayName || 'Dolphin User'}</Text>
                    <Text style={styles.email}>{user.email}</Text>
                    
                    <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.85}>
                        <Ionicons name="log-out-outline" size={18} color={theme.colors.danger} />
                        <Text style={styles.signOutText}>Sign Out</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <View style={styles.profileCard}>
                    <View style={styles.avatar}>
                        <Ionicons name="person" size={40} color={theme.colors.primary} />
                    </View>
                    <Text style={styles.name}>Not signed in</Text>
                </View>
            )}

            {/* Menu Items */}
            <View style={styles.menuSection}>
                {menuItems.map(item => (
                    <TouchableOpacity
                        key={item.label}
                        style={styles.menuItem}
                        onPress={() => navigation.navigate(item.screen)}
                    >
                        <Ionicons name={item.icon as any} size={20} color={theme.colors.textSecondary} />
                        <Text style={styles.menuLabel}>{item.label}</Text>
                        <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                    </TouchableOpacity>
                ))}
            </View>

            {/* Admin Panel (only for admins) */}
            {isAdminUser && (
                <>
                <View style={[styles.menuSection, { marginTop: 12 }]}>
                    <TouchableOpacity
                        style={styles.menuItem}
                        onPress={() => navigation.navigate('Admin')}
                    >
                        <Ionicons name="shield-checkmark-outline" size={20} color="#EF4444" />
                        <Text style={[styles.menuLabel, { color: '#EF4444', fontWeight: '700' }]}>Admin Panel</Text>
                        <Ionicons name="chevron-forward" size={18} color="#EF4444" />
                    </TouchableOpacity>
                </View>

                {/* View as Student Toggle — separate card */}
                <TouchableOpacity
                    activeOpacity={0.7}
                    style={{
                        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                        marginHorizontal: 16, marginTop: 12, backgroundColor: viewAsStudent ? '#FFF7ED' : theme.colors.surface,
                        borderRadius: 14, padding: 16, borderWidth: viewAsStudent ? 1.5 : 0, borderColor: '#FDBA74',
                        shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
                    }}
                    onPress={() => {
                        const next = !viewAsStudent;
                        setViewAsStudent(next);
                        Alert.alert(
                            next ? '👁 Student View ON' : '🔓 Admin View Restored',
                            next ? 'You are now seeing the app as a student would. Lounge tab is hidden.' : 'Full admin view restored.',
                        );
                    }}
                >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                        <Ionicons name={viewAsStudent ? 'eye' : 'eye-outline'} size={22} color={viewAsStudent ? '#F97316' : theme.colors.textSecondary} />
                        <View>
                            <Text style={{ fontSize: 15, fontWeight: '600', color: viewAsStudent ? '#C2410C' : theme.colors.textPrimary }}>View as Student</Text>
                            <Text style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 2 }}>See what students see</Text>
                        </View>
                    </View>
                    <Switch
                        value={viewAsStudent}
                        onValueChange={(v) => {
                            setViewAsStudent(v);
                            Alert.alert(
                                v ? '👁 Student View ON' : '🔓 Admin View Restored',
                                v ? 'You are now seeing the app as a student would. Lounge tab is hidden.' : 'Full admin view restored.',
                            );
                        }}
                        trackColor={{ false: '#E2E8F0', true: '#FDBA74' }}
                        thumbColor={viewAsStudent ? '#F97316' : '#f4f3f4'}
                    />
                </TouchableOpacity>
                </>
            )}

            {/* Feedback */}
            <View style={[styles.menuSection, { marginTop: 12 }]}>
                <TouchableOpacity style={styles.menuItem} onPress={() => setShowFeedback(true)}>
                    <Ionicons name="chatbox-ellipses-outline" size={20} color="#F97316" />
                    <Text style={[styles.menuLabel, { color: '#F97316', fontWeight: '700' }]}>Send Feedback</Text>
                    <Ionicons name="chevron-forward" size={18} color="#F97316" />
                </TouchableOpacity>
            </View>

            </ScrollView>
            <FeedbackModal visible={showFeedback} onClose={() => setShowFeedback(false)} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    header: {
        paddingHorizontal: theme.spacing.md, paddingTop: 60, paddingBottom: theme.spacing.sm,
        backgroundColor: theme.colors.surface, ...theme.shadows.sm,
    },
    headerTitle: { fontSize: 24, fontWeight: '900', color: '#0C2340' },
    profileCard: {
        margin: theme.spacing.md, backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.xl, padding: theme.spacing.lg, alignItems: 'center', ...theme.shadows.md,
    },
    avatar: {
        width: 80, height: 80, borderRadius: r(40),
        backgroundColor: theme.colors.primaryGhost, alignItems: 'center', justifyContent: 'center',
        marginBottom: theme.spacing.md,
    },
    name: { ...theme.typography.h3, color: theme.colors.textPrimary },
    email: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: 4 },
    signOutBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        backgroundColor: theme.colors.dangerBg, paddingHorizontal: 24, paddingVertical: 12,
        borderRadius: theme.radius.full, marginTop: theme.spacing.md,
    },
    signOutText: { ...theme.typography.bodyBold, color: theme.colors.danger },
    menuSection: {
        marginHorizontal: theme.spacing.md, backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg, ...theme.shadows.sm,
    },
    menuItem: {
        flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.md, paddingVertical: 14,
        borderBottomWidth: 1, borderBottomColor: theme.colors.borderLight,
    },
    studentToggleRow: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: theme.spacing.md, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: theme.colors.borderLight,
    },
    menuLabel: { ...theme.typography.body, color: theme.colors.textPrimary, flex: 1 },
});
