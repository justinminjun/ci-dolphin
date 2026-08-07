import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, Alert, RefreshControl, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme/theme';
import { db } from '../config/firebase';
import { collection, getDocs, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { timeAgo } from '../utils/timeAgo';
import { getAccessConfig, saveAccessConfig } from '../utils/admin';
import { TextInput, KeyboardAvoidingView, Platform } from 'react-native';

export function AdminScreen({ navigation }: any) {
    const [posts, setPosts] = useState<any[]>([]);
    const [reports, setReports] = useState<any[]>([]);
    const [stats, setStats] = useState({ total: 0, lost: 0, found: 0, active: 0, resolved: 0, users: 0, reports: 0 });
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [filter, setFilter] = useState<'all' | 'lost' | 'found' | 'resolved'>('all');
    const [tab, setTab] = useState<'posts' | 'reports' | 'settings'>('posts');

    const [config, setConfig] = useState({ adminEmails: [] as string[], allowedEmails: [] as string[] });
    const [newAdminEmail, setNewAdminEmail] = useState('');
    const [newAllowedEmail, setNewAllowedEmail] = useState('');

    const fetchAll = async () => {
        try {
            const snapshot = await getDocs(collection(db, 'posts'));
            const allPosts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            allPosts.sort((a: any, b: any) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            setPosts(allPosts);

            // Fetch reports
            const reportSnapshot = await getDocs(collection(db, 'reports'));
            const allReports = reportSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            allReports.sort((a: any, b: any) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            setReports(allReports);

            const uniqueUsers = new Set(allPosts.map((p: any) => p.authorId));
            const pendingReports = allReports.filter((r: any) => r.status === 'pending').length;
            setStats({
                total: allPosts.length,
                lost: allPosts.filter((p: any) => p.postType === 'lost').length,
                found: allPosts.filter((p: any) => p.postType === 'found').length,
                active: allPosts.filter((p: any) => p.status !== 'resolved').length,
                resolved: allPosts.filter((p: any) => p.status === 'resolved').length,
                users: uniqueUsers.size,
                reports: pendingReports,
            });

            const currentConfig = getAccessConfig();
            setConfig({ adminEmails: currentConfig.adminEmails, allowedEmails: currentConfig.allowedEmails });
        } catch (e) {
            console.error('Admin fetch error:', e);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => { fetchAll(); }, []);

    const handleDelete = (postId: string, title: string) => {
        Alert.alert('Admin Delete', `Delete "${title}"? This cannot be undone.`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete', style: 'destructive',
                onPress: async () => {
                    try {
                        await deleteDoc(doc(db, 'posts', postId));
                        setPosts(prev => prev.filter(p => p.id !== postId));
                        Alert.alert('Deleted', 'Post has been removed.');
                    } catch (e) {
                        Alert.alert('Error', 'Failed to delete post.');
                    }
                }
            }
        ]);
    };

    const handleToggleStatus = async (postId: string, currentStatus: string) => {
        const newStatus = currentStatus === 'resolved' ? 'active' : 'resolved';
        try {
            await updateDoc(doc(db, 'posts', postId), { status: newStatus });
            setPosts(prev => prev.map(p => p.id === postId ? { ...p, status: newStatus } : p));
        } catch (e) {
            Alert.alert('Error', 'Failed to update status.');
        }
    };

    const handleReportAction = async (reportId: string, action: 'reviewed' | 'dismissed') => {
        try {
            await updateDoc(doc(db, 'reports', reportId), { status: action });
            setReports(prev => prev.map(r => r.id === reportId ? { ...r, status: action } : r));
            Alert.alert('Done', `Report has been ${action}.`);
        } catch (e) {
            Alert.alert('Error', 'Failed to update report.');
        }
    };

    const handleDeleteReport = async (reportId: string) => {
        Alert.alert('Delete Report', 'Remove this report permanently?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete', style: 'destructive',
                onPress: async () => {
                    try {
                        await deleteDoc(doc(db, 'reports', reportId));
                        setReports(prev => prev.filter(r => r.id !== reportId));
                    } catch (e) {
                        Alert.alert('Error', 'Failed to delete report.');
                    }
                }
            }
        ]);
    };

    const filteredPosts = posts.filter((p: any) => {
        if (filter === 'all') return true;
        if (filter === 'lost') return p.postType === 'lost';
        if (filter === 'found') return p.postType === 'found';
        if (filter === 'resolved') return p.status === 'resolved';
        return true;
    });

    const StatCard = ({ label, value, color }: { label: string, value: number, color: string }) => (
        <View style={[styles.statCard, { borderLeftColor: color }]}>
            <Text style={[styles.statValue, { color }]}>{value}</Text>
            <Text style={styles.statLabel}>{label}</Text>
        </View>
    );

    const renderPost = ({ item }: { item: any }) => {
        const isLost = item.postType === 'lost';
        const isResolved = item.status === 'resolved';
        return (
            <View style={[styles.postCard, isResolved && styles.postCardResolved]}>
                <TouchableOpacity
                    style={styles.postMain}
                    onPress={() => navigation.navigate('Detail', { post: item })}
                    activeOpacity={0.8}
                >
                    {item.imageUrl ? (
                        <Image source={{ uri: item.imageUrl }} style={styles.postImage} />
                    ) : (
                        <View style={[styles.postImage, styles.noImage]}>
                            <Ionicons name="image-outline" size={24} color={theme.colors.textMuted} />
                        </View>
                    )}
                    <View style={styles.postInfo}>
                        <View style={styles.postTopRow}>
                            <View style={[styles.typeBadge, isLost ? styles.badgeLost : styles.badgeFound]}>
                                <Text style={[styles.typeBadgeText, isLost ? styles.badgeLostText : styles.badgeFoundText]}>
                                    {isLost ? 'LOST' : 'FOUND'}
                                </Text>
                            </View>
                            {isResolved && (
                                <View style={styles.resolvedBadge}>
                                    <Text style={styles.resolvedBadgeText}>Resolved</Text>
                                </View>
                            )}
                        </View>
                        <Text style={styles.postTitle} numberOfLines={1}>{item.title}</Text>
                        <Text style={styles.postAuthor} numberOfLines={1}>by {item.authorName || 'Unknown'}</Text>
                        <Text style={styles.postTime}>{timeAgo(item.createdAt)}</Text>
                    </View>
                </TouchableOpacity>
                <View style={styles.actionRow}>
                    <TouchableOpacity
                        style={[styles.actionBtn, styles.statusBtn]}
                        onPress={() => handleToggleStatus(item.id, item.status)}
                    >
                        <Text style={styles.statusBtnText}>
                            {isResolved ? 'Reopen' : 'Resolve'}
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.actionBtn, styles.deleteBtn]}
                        onPress={() => handleDelete(item.id, item.title)}
                    >
                        <Text style={styles.deleteBtnText}>Delete</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    const renderReport = ({ item }: { item: any }) => {
        const isPending = item.status === 'pending';
        return (
            <View style={[styles.reportCard, !isPending && styles.reportCardDone]}>
                <View style={styles.reportHeader}>
                    <Ionicons name="flag" size={16} color={isPending ? theme.colors.danger : theme.colors.success} />
                    <Text style={[styles.reportStatus, { color: isPending ? theme.colors.danger : theme.colors.success }]}>
                        {isPending ? 'Pending' : item.status === 'reviewed' ? 'Reviewed' : 'Dismissed'}
                    </Text>
                    <Text style={styles.reportTime}>{timeAgo(item.createdAt)}</Text>
                </View>
                <View style={styles.reportBody}>
                    <Text style={styles.reportLabel}>Reporter</Text>
                    <Text style={styles.reportValue}>{item.reporterName} ({item.reporterEmail})</Text>
                    <Text style={[styles.reportLabel, { marginTop: 6 }]}>Reported User</Text>
                    <Text style={styles.reportValue}>{item.reportedUserName} ({item.reportedUserEmail})</Text>
                    {item.postTitle && (
                        <>
                            <Text style={[styles.reportLabel, { marginTop: 6 }]}>Related Post</Text>
                            <Text style={styles.reportValue}>{item.postTitle}</Text>
                        </>
                    )}
                    <Text style={[styles.reportLabel, { marginTop: 6 }]}>Reason</Text>
                    <Text style={styles.reportReason}>{item.reason}</Text>
                </View>
                {isPending && (
                    <View style={styles.actionRow}>
                        <TouchableOpacity
                            style={[styles.actionBtn, styles.statusBtn]}
                            onPress={() => handleReportAction(item.id, 'reviewed')}
                        >
                            <Text style={[styles.statusBtnText, { color: theme.colors.primary }]}>Mark Reviewed</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.actionBtn]}
                            onPress={() => handleReportAction(item.id, 'dismissed')}
                        >
                            <Text style={[styles.statusBtnText, { color: theme.colors.textMuted }]}>Dismiss</Text>
                        </TouchableOpacity>
                    </View>
                )}
                {!isPending && (
                    <TouchableOpacity
                        style={styles.deleteReportBtn}
                        onPress={() => handleDeleteReport(item.id)}
                    >
                        <Text style={styles.deleteBtnText}>Delete Report</Text>
                    </TouchableOpacity>
                )}
            </View>
        );
    };

    const pendingReports = reports.filter((r: any) => r.status === 'pending');

    return (
        <View style={styles.container}>
            {/* Stats Dashboard */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statsRow} contentContainerStyle={styles.statsContent}>
                <StatCard label="Total" value={stats.total} color={theme.colors.primary} />
                <StatCard label="Lost" value={stats.lost} color={theme.colors.lostText} />
                <StatCard label="Found" value={stats.found} color={theme.colors.foundText} />
                <StatCard label="Active" value={stats.active} color={theme.colors.warning} />
                <StatCard label="Resolved" value={stats.resolved} color={theme.colors.success} />
                <StatCard label="Users" value={stats.users} color="#8B5CF6" />
                <StatCard label="Reports" value={stats.reports} color={theme.colors.danger} />
            </ScrollView>

            {/* Tab Switcher */}
            <View style={styles.tabRow}>
                <TouchableOpacity
                    style={[styles.tabBtn, tab === 'posts' && styles.tabBtnActive]}
                    onPress={() => setTab('posts')}
                >
                    <Ionicons name="document-text-outline" size={16} color={tab === 'posts' ? '#fff' : theme.colors.textSecondary} />
                    <Text style={[styles.tabText, tab === 'posts' && styles.tabTextActive]}>Posts</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.tabBtn, tab === 'reports' && styles.tabBtnActive]}
                    onPress={() => setTab('reports')}
                >
                    <Ionicons name="flag-outline" size={16} color={tab === 'reports' ? '#fff' : theme.colors.textSecondary} />
                    <Text style={[styles.tabText, tab === 'reports' && styles.tabTextActive]}>
                        Reports{pendingReports.length > 0 ? ` (${pendingReports.length})` : ''}
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.tabBtn, tab === 'settings' && styles.tabBtnActive]}
                    onPress={() => setTab('settings')}
                >
                    <Ionicons name="settings-outline" size={16} color={tab === 'settings' ? '#fff' : theme.colors.textSecondary} />
                    <Text style={[styles.tabText, tab === 'settings' && styles.tabTextActive]}>Settings</Text>
                </TouchableOpacity>
            </View>

            {tab === 'posts' && (
                <>
                    {/* Filter Tabs */}
                    <View style={styles.filterRow}>
                        {(['all', 'lost', 'found', 'resolved'] as const).map(f => (
                            <TouchableOpacity
                                key={f}
                                style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
                                onPress={() => setFilter(f)}
                            >
                                <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                                    {f.charAt(0).toUpperCase() + f.slice(1)}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                    <FlatList
                        data={filteredPosts}
                        keyExtractor={item => item.id}
                        renderItem={renderPost}
                        contentContainerStyle={styles.list}
                        refreshControl={
                            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll(); }} tintColor={theme.colors.primary} />
                        }
                        ListEmptyComponent={
                            <View style={styles.emptyContainer}>
                                <Text style={styles.emptyText}>No posts matching this filter.</Text>
                            </View>
                        }
                    />
                </>
            )}

            {tab === 'reports' && (
                <FlatList
                    data={reports}
                    keyExtractor={item => item.id}
                    renderItem={renderReport}
                    contentContainerStyle={styles.list}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll(); }} tintColor={theme.colors.primary} />
                    }
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <Ionicons name="checkmark-circle-outline" size={40} color={theme.colors.success} />
                            <Text style={[styles.emptyText, { marginTop: 8 }]}>No reports yet. All clear!</Text>
                        </View>
                    }
                />
            )}

            {tab === 'settings' && (
                <ScrollView contentContainerStyle={styles.list}>
                    <View style={styles.settingsSection}>
                        <Text style={styles.settingsTitle}>Admin Emails</Text>
                        <Text style={styles.settingsDesc}>Users with these emails have full access to this admin panel.</Text>
                        
                        {config.adminEmails.map((email, idx) => (
                            <View key={idx} style={styles.emailRow}>
                                <Text style={styles.emailText}>{email}</Text>
                                <TouchableOpacity onPress={async () => {
                                    const newConfig = { ...config, adminEmails: config.adminEmails.filter(e => e !== email) };
                                    setConfig(newConfig);
                                    await saveAccessConfig({ ...getAccessConfig(), ...newConfig });
                                }}>
                                    <Ionicons name="trash-outline" size={20} color={theme.colors.danger} />
                                </TouchableOpacity>
                            </View>
                        ))}
                        
                        <View style={styles.addEmailRow}>
                            <TextInput
                                style={styles.emailInput}
                                placeholder="Add admin email..."
                                value={newAdminEmail}
                                onChangeText={setNewAdminEmail}
                                autoCapitalize="none"
                                keyboardType="email-address"
                            />
                            <TouchableOpacity style={styles.addEmailBtn} onPress={async () => {
                                if (!newAdminEmail.trim()) return;
                                const newConfig = { ...config, adminEmails: [...new Set([...config.adminEmails, newAdminEmail.trim().toLowerCase()])] };
                                setConfig(newConfig);
                                await saveAccessConfig({ ...getAccessConfig(), ...newConfig });
                                setNewAdminEmail('');
                            }}>
                                <Ionicons name="add" size={24} color="#fff" />
                            </TouchableOpacity>
                        </View>
                    </View>

                    <View style={styles.settingsSection}>
                        <Text style={styles.settingsTitle}>Allowed Exceptions</Text>
                        <Text style={styles.settingsDesc}>Non-Chadwick emails that are allowed to log in (e.g. parents, guests).</Text>
                        
                        {config.allowedEmails.map((email, idx) => (
                            <View key={idx} style={styles.emailRow}>
                                <Text style={styles.emailText}>{email}</Text>
                                <TouchableOpacity onPress={async () => {
                                    const newConfig = { ...config, allowedEmails: config.allowedEmails.filter(e => e !== email) };
                                    setConfig(newConfig);
                                    await saveAccessConfig({ ...getAccessConfig(), ...newConfig });
                                }}>
                                    <Ionicons name="trash-outline" size={20} color={theme.colors.danger} />
                                </TouchableOpacity>
                            </View>
                        ))}
                        
                        <View style={styles.addEmailRow}>
                            <TextInput
                                style={styles.emailInput}
                                placeholder="Add allowed email..."
                                value={newAllowedEmail}
                                onChangeText={setNewAllowedEmail}
                                autoCapitalize="none"
                                keyboardType="email-address"
                            />
                            <TouchableOpacity style={styles.addEmailBtn} onPress={async () => {
                                if (!newAllowedEmail.trim()) return;
                                const newConfig = { ...config, allowedEmails: [...new Set([...config.allowedEmails, newAllowedEmail.trim().toLowerCase()])] };
                                setConfig(newConfig);
                                await saveAccessConfig({ ...getAccessConfig(), ...newConfig });
                                setNewAllowedEmail('');
                            }}>
                                <Ionicons name="add" size={24} color="#fff" />
                            </TouchableOpacity>
                        </View>
                    </View>
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    statsRow: { flexGrow: 0, backgroundColor: theme.colors.surface, ...theme.shadows.sm },
    statsContent: { paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.sm, gap: 6, alignItems: 'center' },
    statCard: {
        backgroundColor: theme.colors.surfaceAlt,
        borderRadius: theme.radius.md,
        paddingHorizontal: 12,
        paddingVertical: 8,
        minWidth: 60,
        height: 52,
        alignItems: 'center',
        justifyContent: 'center',
        borderLeftWidth: 3,
    },
    statValue: { fontSize: 16, fontWeight: '800', lineHeight: 20 },
    statLabel: { fontSize: 10, color: theme.colors.textSecondary, marginTop: 1, fontWeight: '600' },

    // Tab switcher
    tabRow: { flexDirection: 'row', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, gap: theme.spacing.sm, backgroundColor: theme.colors.surface },
    tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceAlt },
    tabBtnActive: { backgroundColor: theme.colors.primary },
    tabText: { ...theme.typography.tag, fontWeight: '600', color: theme.colors.textSecondary },
    tabTextActive: { color: '#fff' },

    filterRow: { flexDirection: 'row', padding: theme.spacing.sm, paddingHorizontal: theme.spacing.md, gap: theme.spacing.xs, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    filterBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: theme.radius.full, backgroundColor: theme.colors.surfaceAlt },
    filterBtnActive: { backgroundColor: theme.colors.primary },
    filterText: { ...theme.typography.tag, color: theme.colors.textSecondary, fontWeight: '600' },
    filterTextActive: { color: '#FFFFFF' },
    list: { padding: theme.spacing.md, paddingBottom: 30 },
    postCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, marginBottom: theme.spacing.sm, overflow: 'hidden', ...theme.shadows.sm },
    postCardResolved: { opacity: 0.65 },
    postMain: { flexDirection: 'row', padding: theme.spacing.sm },
    postImage: { width: 70, height: 70, borderRadius: theme.radius.md, resizeMode: 'cover' },
    noImage: { backgroundColor: theme.colors.surfaceAlt, justifyContent: 'center', alignItems: 'center' },
    postInfo: { flex: 1, marginLeft: theme.spacing.sm, justifyContent: 'center' },
    postTopRow: { flexDirection: 'row', gap: theme.spacing.xs, marginBottom: 2 },
    typeBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: theme.radius.sm },
    badgeFound: { backgroundColor: theme.colors.foundBg },
    badgeLost: { backgroundColor: theme.colors.lostBg },
    typeBadgeText: { fontSize: 9, fontWeight: '700' },
    badgeFoundText: { color: theme.colors.foundText },
    badgeLostText: { color: theme.colors.lostText },
    resolvedBadge: { backgroundColor: '#ECFDF5', paddingHorizontal: 6, paddingVertical: 1, borderRadius: theme.radius.sm },
    resolvedBadgeText: { fontSize: 9, fontWeight: '700', color: theme.colors.success },
    postTitle: { ...theme.typography.body, fontWeight: '600', color: theme.colors.textPrimary },
    postAuthor: { ...theme.typography.caption, color: theme.colors.textSecondary },
    postTime: { ...theme.typography.caption, color: theme.colors.textMuted, fontSize: 10 },
    actionRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.colors.borderLight },
    actionBtn: { flex: 1, paddingVertical: 10, alignItems: 'center' },
    statusBtn: { borderRightWidth: 1, borderRightColor: theme.colors.borderLight },
    statusBtnText: { ...theme.typography.caption, fontWeight: '600', color: theme.colors.success },
    deleteBtn: {},
    deleteBtnText: { ...theme.typography.caption, fontWeight: '600', color: theme.colors.danger },
    emptyContainer: { padding: theme.spacing.xl, alignItems: 'center' },
    emptyText: { ...theme.typography.body, color: theme.colors.textMuted },

    // Report cards
    reportCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, marginBottom: theme.spacing.sm, overflow: 'hidden', ...theme.shadows.sm, borderLeftWidth: 3, borderLeftColor: theme.colors.danger },
    reportCardDone: { opacity: 0.6, borderLeftColor: theme.colors.success },
    reportHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: theme.spacing.sm, paddingBottom: 4 },
    reportStatus: { ...theme.typography.tag, fontWeight: '700' },
    reportTime: { ...theme.typography.caption, color: theme.colors.textMuted, marginLeft: 'auto' },
    reportBody: { paddingHorizontal: theme.spacing.sm, paddingBottom: theme.spacing.sm },
    reportLabel: { ...theme.typography.caption, fontWeight: '600', color: theme.colors.textMuted, fontSize: 10 },
    reportValue: { ...theme.typography.bodySecondary, color: theme.colors.textPrimary, fontWeight: '500' },
    reportReason: { ...theme.typography.body, color: theme.colors.textPrimary, backgroundColor: theme.colors.surfaceAlt, padding: theme.spacing.sm, borderRadius: theme.radius.md, marginTop: 4 },
    deleteReportBtn: { paddingVertical: 10, alignItems: 'center', borderTopWidth: 1, borderTopColor: theme.colors.borderLight },

    // Settings
    settingsSection: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: theme.spacing.md, marginBottom: theme.spacing.md, ...theme.shadows.sm },
    settingsTitle: { ...theme.typography.h3, color: theme.colors.textPrimary, marginBottom: 4 },
    settingsDesc: { ...theme.typography.caption, color: theme.colors.textSecondary, marginBottom: theme.spacing.md },
    emailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.colors.surfaceAlt, padding: theme.spacing.sm, borderRadius: theme.radius.md, marginBottom: 8 },
    emailText: { ...theme.typography.body, color: theme.colors.textPrimary },
    addEmailRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginTop: theme.spacing.xs },
    emailInput: { flex: 1, backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.sm, paddingVertical: 10, ...theme.typography.body, color: theme.colors.textPrimary },
    addEmailBtn: { backgroundColor: theme.colors.primary, borderRadius: theme.radius.md, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
