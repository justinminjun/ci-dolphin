import React, { useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
    Alert, Image, ActivityIndicator, Switch, Modal, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, r } from '../theme/theme';
import { db, auth, storage } from '../config/firebase';
import {
    collection, doc, getDoc, setDoc, addDoc, deleteDoc,
    onSnapshot, query, orderBy, updateDoc, getDocs, serverTimestamp, where,
} from 'firebase/firestore';
import { sendPushNotification } from '../utils/notifications';
import Constants from 'expo-constants';

// ─── Admin Panel ───
export function AdminScreen({ navigation }: any) {
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('reports');

    // Admin state
    const [admins, setAdmins] = useState<string[]>([]);
    const [newAdmin, setNewAdmin] = useState('');

    // Stats
    const [stats, setStats] = useState({ posts: 0, listings: 0, recs: 0 });

    // Posts & Listings for moderation
    const [posts, setPosts] = useState<any[]>([]);
    const [listings, setListings] = useState<any[]>([]);
    const [lfPosts, setLfPosts] = useState<any[]>([]);
    const [lfFilter, setLfFilter] = useState<'all' | 'lost' | 'found' | 'resolved'>('all');
    const [zoomedImage, setZoomedImage] = useState<string | null>(null);
    const [announceTitle, setAnnounceTitle] = useState('');
    const [announceBody, setAnnounceBody] = useState('');
    const [announcements, setAnnouncements] = useState<any[]>([]);
    const [feedbacks, setFeedbacks] = useState<any[]>([]);
    const [selectedFeedback, setSelectedFeedback] = useState<any>(null);

    // Reports moderation queue
    const [reports, setReports] = useState<any[]>([]);
    const [reportFilter, setReportFilter] = useState<'pending' | 'all'>('pending');

    // Local Guide recommendations
    const [recs, setRecs] = useState<any[]>([]);

    // App settings (force update config: app_config/version)
    const [verMinimum, setVerMinimum] = useState('');
    const [verLatest, setVerLatest] = useState('');
    const [verMessage, setVerMessage] = useState('');
    const [verSaving, setVerSaving] = useState(false);

    // ─── Check Admin ───
    useEffect(() => {
        const checkAdmin = async () => {
            const email = auth.currentUser?.email;
            if (!email) { setLoading(false); return; }
            try {
                const snap = await getDoc(doc(db, 'app_config', 'admins'));
                if (snap.exists()) {
                    const data = snap.data();
                    const emails: string[] = data.emails || [];
                    setAdmins(emails);
                    setIsAdmin(emails.includes(email));
                } else {
                    // First time: auto-create with default admin
                    const defaultAdmins = ['jyyang@chadwickschool.org'];
                    await setDoc(doc(db, 'app_config', 'admins'), { emails: defaultAdmins });
                    setAdmins(defaultAdmins);
                    setIsAdmin(defaultAdmins.includes(email));
                }
            } catch {
                setIsAdmin(false);
            }
            setLoading(false);
        };
        checkAdmin();
    }, []);

    // ─── Load Data ───
    useEffect(() => {
        if (!isAdmin) return;

        // Posts
        const unsubPosts = onSnapshot(
            query(collection(db, 'lounge_posts'), orderBy('createdAt', 'desc')),
            snap => {
                setPosts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
                setStats(prev => ({ ...prev, posts: snap.size }));
            }
        );

        // Listings
        const unsubListings = onSnapshot(
            query(collection(db, 'market_listings'), orderBy('createdAt', 'desc')),
            snap => {
                setListings(snap.docs.map(d => ({ id: d.id, ...d.data() })));
                setStats(prev => ({ ...prev, listings: snap.size }));
            }
        );

        // Lost & Found posts
        const unsubLF = onSnapshot(
            query(collection(db, 'posts'), orderBy('createdAt', 'desc')),
            snap => setLfPosts(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        );

        // Feedback
        const unsubFeedback = onSnapshot(
            query(collection(db, 'dolphin_feedback'), orderBy('createdAt', 'desc')),
            snap => setFeedbacks(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        );

        // Reports queue
        const unsubReports = onSnapshot(
            query(collection(db, 'reports'), orderBy('createdAt', 'desc')),
            snap => setReports(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        );

        // Local Guide recommendations
        const unsubRecs = onSnapshot(
            collection(db, 'local_recommendations'),
            snap => {
                const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
                items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
                setRecs(items);
                setStats(prev => ({ ...prev, recs: snap.size }));
            }
        );

        // Announcements (latest one is the live home popup)
        const unsubAnnounce = onSnapshot(
            query(collection(db, 'dolphin_announcements'), orderBy('createdAt', 'desc')),
            snap => setAnnouncements(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        );

        // Force update config
        getDoc(doc(db, 'app_config', 'version')).then(snap => {
            if (snap.exists()) {
                const v = snap.data();
                setVerMinimum(v.minimumVersion || '');
                setVerLatest(v.latestVersion || '');
                setVerMessage(v.updateMessage || '');
            }
        }).catch(() => {});

        return () => { unsubPosts(); unsubListings(); unsubLF(); unsubFeedback(); unsubReports(); unsubRecs(); unsubAnnounce(); };
    }, [isAdmin]);

    // ─── Admin Management ───
    const addAdmin = async () => {
        const email = newAdmin.trim().toLowerCase();
        if (!email || !email.includes('@')) { Alert.alert('Invalid', 'Enter a valid email.'); return; }
        if (admins.includes(email)) { Alert.alert('Exists', 'Already an admin.'); return; }
        const updated = [...admins, email];
        await setDoc(doc(db, 'app_config', 'admins'), { emails: updated });
        setAdmins(updated);
        setNewAdmin('');
    };

    const removeAdmin = (email: string) => {
        if (email === auth.currentUser?.email) { Alert.alert('Error', 'Cannot remove yourself.'); return; }
        Alert.alert('Remove Admin', `Remove ${email}?`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Remove', style: 'destructive', onPress: async () => {
                    const updated = admins.filter(a => a !== email);
                    await setDoc(doc(db, 'app_config', 'admins'), { emails: updated });
                    setAdmins(updated);
                },
            },
        ]);
    };

    // ─── Reports Moderation ───
    const REPORT_COLLECTION_BY_TYPE: Record<string, string> = {
        post: 'lounge_posts',
        listing: 'market_listings',
        comment: 'lounge_posts', // comment reports point at the parent post
        chat_message: 'dolphin_chats',
        recommendation: 'local_recommendations',
    };

    const setReportStatus = async (id: string, status: 'reviewed' | 'dismissed' | 'pending') => {
        try { await updateDoc(doc(db, 'reports', id), { status }); } catch {}
    };

    const deleteReportedContent = (report: any) => {
        const coll = REPORT_COLLECTION_BY_TYPE[report.contentType];
        if (!coll) { Alert.alert('Unknown type', `Cannot resolve collection for "${report.contentType}".`); return; }
        Alert.alert(
            'Delete Reported Content',
            `Permanently delete this ${report.contentType} by ${report.contentOwnerName || 'Unknown'}?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete', style: 'destructive',
                    onPress: async () => {
                        try {
                            await deleteDoc(doc(db, coll, report.contentId));
                            await updateDoc(doc(db, 'reports', report.id), { status: 'reviewed' });
                        } catch (e: any) {
                            Alert.alert('Error', e.message);
                        }
                    },
                },
            ],
        );
    };

    // ─── Local Guide Moderation ───
    const deleteRec = (rec: any) => {
        Alert.alert('Delete Recommendation', `Delete "${rec.title}" by ${rec.authorName || 'Unknown'}?`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => deleteDoc(doc(db, 'local_recommendations', rec.id)).catch(() => {}) },
        ]);
    };

    // ─── App Settings (force update) ───
    const saveVersionConfig = async () => {
        if (!verMinimum.trim()) { Alert.alert('Error', 'Minimum version is required (e.g. 1.3.0).'); return; }
        setVerSaving(true);
        try {
            await setDoc(doc(db, 'app_config', 'version'), {
                minimumVersion: verMinimum.trim(),
                latestVersion: verLatest.trim() || verMinimum.trim(),
                updateMessage: verMessage.trim(),
            }, { merge: true });
            Alert.alert('Saved', 'Users below the minimum version will now see the forced-update screen.');
        } catch (e: any) {
            Alert.alert('Error', e.message);
        }
        setVerSaving(false);
    };

    // ─── Content Moderation ───
    const deletePost = (id: string) => {
        Alert.alert('Delete Post', 'This will permanently delete this post.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => deleteDoc(doc(db, 'lounge_posts', id)).catch(() => {}) },
        ]);
    };

    const deleteListing = (id: string) => {
        Alert.alert('Delete Listing', 'This will permanently remove this listing.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => deleteDoc(doc(db, 'market_listings', id)).catch(() => {}) },
        ]);
    };

    const deleteLfPost = (id: string) => {
        Alert.alert('Delete L&F Post', 'This will permanently remove this post.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => deleteDoc(doc(db, 'posts', id)).catch(() => {}) },
        ]);
    };

    const toggleLfStatus = async (id: string, current: string) => {
        const newStatus = current === 'resolved' ? 'active' : 'resolved';
        try { await updateDoc(doc(db, 'posts', id), { status: newStatus }); } catch {}
    };

    // ─── Loading / Not Admin ───
    if (loading) {
        return (
            <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
        );
    }

    if (!isAdmin) {
        return (
            <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
                <Ionicons name="lock-closed" size={64} color={theme.colors.textMuted} />
                <Text style={styles.lockTitle}>Access Denied</Text>
                <Text style={styles.lockSubtitle}>Only administrators can access this panel.</Text>
                <TouchableOpacity style={styles.backBtnLarge} onPress={() => navigation.goBack()}>
                    <Text style={styles.backBtnText}>Go Back</Text>
                </TouchableOpacity>
            </View>
        );
    }

    // ─── TABS ───
    const pendingReports = reports.filter(rp => rp.status === 'pending').length;

    const TABS = [
        { key: 'reports', label: 'Reports', icon: 'flag-outline' },
        { key: 'announce', label: 'Announce', icon: 'megaphone-outline' },
        { key: 'posts', label: 'Lounge', icon: 'chatbubbles-outline' },
        { key: 'listings', label: 'Market', icon: 'storefront-outline' },
        { key: 'local', label: 'Local Guide', icon: 'map-outline' },
        { key: 'lostfound', label: 'L&F', icon: 'search-outline' },
        { key: 'feedback', label: 'Feedback', icon: 'chatbox-ellipses-outline' },
        { key: 'stats', label: 'Stats', icon: 'analytics-outline' },
        { key: 'admins', label: 'Admins', icon: 'people-outline' },
        { key: 'app', label: 'App', icon: 'settings-outline' },
    ];

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4 }}>
                    <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Admin Panel</Text>
                <View style={{ width: 32 }} />
            </View>

            {/* Tab Bar */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={styles.tabBarContent}>
                {TABS.map(tab => (
                    <TouchableOpacity
                        key={tab.key}
                        style={[styles.tab, activeTab === tab.key && styles.tabActive]}
                        onPress={() => setActiveTab(tab.key)}
                    >
                        <Ionicons name={tab.icon as any} size={16} color={activeTab === tab.key ? '#fff' : theme.colors.textSecondary} />
                        <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
                        {tab.key === 'reports' && pendingReports > 0 && (
                            <View style={styles.tabBadge}>
                                <Text style={styles.tabBadgeText}>{pendingReports}</Text>
                            </View>
                        )}
                    </TouchableOpacity>
                ))}
            </ScrollView>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
                {/* ════════ REPORTS TAB ════════ */}
                {activeTab === 'reports' && (() => {
                    const shown = reportFilter === 'pending'
                        ? reports.filter(rp => rp.status === 'pending')
                        : reports;
                    return (
                        <>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Text style={styles.sectionTitle}>Reports ({shown.length})</Text>
                                <View style={{ flexDirection: 'row', gap: 6 }}>
                                    {(['pending', 'all'] as const).map(f => (
                                        <TouchableOpacity
                                            key={f}
                                            style={[styles.filterChip, reportFilter === f && styles.filterChipActive]}
                                            onPress={() => setReportFilter(f)}
                                        >
                                            <Text style={[styles.filterChipText, reportFilter === f && styles.filterChipTextActive]}>
                                                {f === 'pending' ? 'Pending' : 'All'}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </View>
                            {shown.length === 0 ? (
                                <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                                    <Ionicons name="shield-checkmark" size={44} color="#10B981" />
                                    <Text style={{ marginTop: 8, fontSize: 14, fontWeight: '600', color: theme.colors.textSecondary }}>
                                        {reportFilter === 'pending' ? 'No pending reports 🎉' : 'No reports yet'}
                                    </Text>
                                </View>
                            ) : shown.map(rp => (
                                <View key={rp.id} style={styles.reportCard}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                        <View style={[styles.reportTypeBadge, rp.status !== 'pending' && { backgroundColor: '#E2E8F0' }]}>
                                            <Text style={[styles.reportTypeText, rp.status !== 'pending' && { color: '#64748B' }]}>
                                                {rp.contentType}
                                            </Text>
                                        </View>
                                        <Text style={styles.reportReason}>{rp.reason}</Text>
                                        <Text style={[
                                            styles.reportStatus,
                                            rp.status === 'pending' ? { color: '#F59E0B' }
                                                : rp.status === 'reviewed' ? { color: '#10B981' } : { color: '#94A3B8' },
                                        ]}>
                                            {rp.status}
                                        </Text>
                                    </View>
                                    <Text style={styles.reportMeta}>
                                        Against: {rp.contentOwnerName || 'Unknown'} · By: {rp.reporterName || 'Unknown'}
                                    </Text>
                                    {rp.additionalInfo ? (
                                        <Text style={styles.reportInfo} numberOfLines={3}>"{rp.additionalInfo}"</Text>
                                    ) : null}
                                    {rp.status === 'pending' && (
                                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                                            <TouchableOpacity
                                                style={styles.reportActionDanger}
                                                onPress={() => deleteReportedContent(rp)}
                                            >
                                                <Ionicons name="trash-outline" size={14} color="#fff" />
                                                <Text style={styles.reportActionDangerText}>Delete Content</Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                style={styles.reportActionNeutral}
                                                onPress={() => setReportStatus(rp.id, 'dismissed')}
                                            >
                                                <Text style={styles.reportActionNeutralText}>Dismiss</Text>
                                            </TouchableOpacity>
                                        </View>
                                    )}
                                </View>
                            ))}
                        </>
                    );
                })()}

                {/* ════════ LOCAL GUIDE TAB ════════ */}
                {activeTab === 'local' && (
                    <>
                        <Text style={styles.sectionTitle}>Local Guide ({recs.length})</Text>
                        {recs.map(rec => (
                            <View key={rec.id} style={styles.listCard}>
                                {(rec.photos?.[0] || rec.photo) ? (
                                    <TouchableOpacity onPress={() => setZoomedImage(rec.photos?.[0] || rec.photo)}>
                                        <Image source={{ uri: rec.photos?.[0] || rec.photo }} style={styles.listThumb} />
                                    </TouchableOpacity>
                                ) : (
                                    <View style={[styles.listThumb, { backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' }]}>
                                        <Ionicons name="map-outline" size={18} color={theme.colors.textMuted} />
                                    </View>
                                )}
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.listCardTitle} numberOfLines={1}>{rec.title}</Text>
                                    <Text style={styles.listCardSub} numberOfLines={1}>
                                        {rec.category} · {rec.authorName || 'Unknown'} · ❤️ {rec.likes || 0}
                                    </Text>
                                </View>
                                <TouchableOpacity onPress={() => deleteRec(rec)} style={{ padding: 6 }}>
                                    <Ionicons name="trash-outline" size={18} color="#EF4444" />
                                </TouchableOpacity>
                            </View>
                        ))}
                    </>
                )}

                {/* ════════ APP SETTINGS TAB ════════ */}
                {activeTab === 'app' && (
                    <>
                        <Text style={styles.sectionTitle}>Force Update</Text>
                        <Text style={styles.fieldLabel}>
                            Users on a version below "Minimum" are blocked until they update from the App Store.
                        </Text>
                        <TextInput
                            style={styles.input}
                            placeholder="Minimum version (e.g. 1.3.0)"
                            placeholderTextColor={theme.colors.textMuted}
                            value={verMinimum}
                            onChangeText={setVerMinimum}
                            autoCapitalize="none"
                        />
                        <TextInput
                            style={styles.input}
                            placeholder="Latest version (e.g. 1.4.0)"
                            placeholderTextColor={theme.colors.textMuted}
                            value={verLatest}
                            onChangeText={setVerLatest}
                            autoCapitalize="none"
                        />
                        <TextInput
                            style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
                            placeholder="Update message shown to users"
                            placeholderTextColor={theme.colors.textMuted}
                            value={verMessage}
                            onChangeText={setVerMessage}
                            multiline
                        />
                        <TouchableOpacity style={styles.primaryBtn} onPress={saveVersionConfig} disabled={verSaving}>
                            {verSaving ? (
                                <ActivityIndicator size="small" color="#fff" />
                            ) : (
                                <Text style={styles.primaryBtnText}>Save Version Config</Text>
                            )}
                        </TouchableOpacity>
                    </>
                )}

                {/* ════════ ANNOUNCE TAB ════════ */}
                {activeTab === 'announce' && (
                    <>
                        <Text style={styles.sectionTitle}>Send Announcement</Text>
                        <Text style={{ fontSize: 13, color: theme.colors.textMuted, marginBottom: 16 }}>
                            Send a notification to all Dolphin users. This will appear as "Announcement" in their notifications.
                        </Text>
                        <TextInput style={styles.input} placeholder="Title" placeholderTextColor={theme.colors.textMuted}
                            value={announceTitle} onChangeText={setAnnounceTitle} />
                        <TextInput style={[styles.input, { minHeight: 100 }]} placeholder="Body" placeholderTextColor={theme.colors.textMuted}
                            value={announceBody} onChangeText={setAnnounceBody} multiline textAlignVertical="top" />
                        <TouchableOpacity
                            style={[styles.primaryBtn, (!announceTitle.trim() || !announceBody.trim()) && { opacity: 0.4 }]}
                            disabled={!announceTitle.trim() || !announceBody.trim()}
                            onPress={async () => {
                                try {
                                    const title = announceTitle.trim();
                                    const body = announceBody.trim();
                                    await addDoc(collection(db, 'dolphin_announcements'), {
                                        title, body, createdAt: serverTimestamp(),
                                    });
                                    // Push to all users with tokens
                                    const usersSnap = await getDocs(collection(db, 'users'));
                                    usersSnap.forEach((userDoc) => {
                                        const pushToken = userDoc.data().pushToken;
                                        if (pushToken) {
                                            sendPushNotification(pushToken, `📢 ${title}`, body, { type: 'announcement' });
                                        }
                                    });
                                    Alert.alert('Sent', 'Announcement sent to all users.');
                                    setAnnounceTitle('');
                                    setAnnounceBody('');
                                } catch (e: any) {
                                    Alert.alert('Error', e.message);
                                }
                            }}
                        >
                            <Ionicons name="megaphone" size={16} color="#fff" />
                            <Text style={styles.primaryBtnText}>  Send Announcement</Text>
                        </TouchableOpacity>

                        {/* ── Self-only test notification (only you see it) ── */}
                        <TouchableOpacity
                            style={[styles.primaryBtn, { backgroundColor: '#6366F1', marginTop: 10 }]}
                            onPress={async () => {
                                const uid = auth.currentUser?.uid;
                                if (!uid) return;
                                try {
                                    await addDoc(collection(db, 'dolphin_notifications'), {
                                        recipientId: uid,
                                        type: 'lounge',
                                        title: '[F&S Lounge] Welcome to the new Dolphin!',
                                        body: 'This is a test notification — only you can see it. New posts in the Lounge and Market will look like this.',
                                        createdAt: serverTimestamp(),
                                        read: false,
                                    });
                                    Alert.alert('Test sent', 'Check the notification bell — only you received this.');
                                } catch (e: any) { Alert.alert('Error', e.message); }
                            }}
                        >
                            <Ionicons name="flask" size={16} color="#fff" />
                            <Text style={styles.primaryBtnText}>  Send test notification (only me)</Text>
                        </TouchableOpacity>

                        {/* ── Sent announcements (latest = live home popup) ── */}
                        <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Sent Announcements</Text>
                        <Text style={{ fontSize: 13, color: theme.colors.textMuted, marginBottom: 12 }}>
                            The most recent announcement shows as a popup on every user's home screen until they tap "Got it".
                            Delete it to stop showing it (the popup disappears for everyone instantly).
                        </Text>
                        {announcements.length === 0 ? (
                            <Text style={{ fontSize: 13, color: theme.colors.textMuted, fontStyle: 'italic' }}>No announcements yet.</Text>
                        ) : announcements.map((a, i) => (
                            <View key={a.id} style={styles.announceCard}>
                                <View style={{ flex: 1 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                                        {i === 0 && (
                                            <View style={styles.liveBadge}>
                                                <View style={styles.liveDot} />
                                                <Text style={styles.liveBadgeText}>LIVE POPUP</Text>
                                            </View>
                                        )}
                                        <Text style={{ fontSize: 11, color: theme.colors.textMuted }}>
                                            {a.createdAt?.toDate ? a.createdAt.toDate().toLocaleDateString() : ''}
                                        </Text>
                                    </View>
                                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#0F172A' }} numberOfLines={1}>{a.title}</Text>
                                    <Text style={{ fontSize: 12, color: '#64748B', marginTop: 2 }} numberOfLines={2}>{a.body}</Text>
                                </View>
                                <TouchableOpacity
                                    style={styles.announceDeleteBtn}
                                    onPress={() => {
                                        Alert.alert(
                                            'Delete Announcement',
                                            i === 0
                                                ? 'This is the LIVE popup — deleting it removes the popup from all users\' home screens. Delete?'
                                                : 'Delete this announcement?',
                                            [
                                                { text: 'Cancel', style: 'cancel' },
                                                { text: 'Delete', style: 'destructive', onPress: async () => {
                                                    try { await deleteDoc(doc(db, 'dolphin_announcements', a.id)); } catch (e: any) { Alert.alert('Error', e.message); }
                                                }},
                                            ],
                                        );
                                    }}
                                >
                                    <Ionicons name="trash-outline" size={17} color="#EF4444" />
                                </TouchableOpacity>
                            </View>
                        ))}
                    </>
                )}

                {/* ════════ ADMINS TAB ════════ */}
                {activeTab === 'admins' && (
                    <>
                        <Text style={styles.sectionTitle}>Admin Emails</Text>
                        <View style={styles.addRow}>
                            <TextInput
                                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                                placeholder="email@school.org"
                                placeholderTextColor={theme.colors.textMuted}
                                value={newAdmin}
                                onChangeText={setNewAdmin}
                                keyboardType="email-address"
                                autoCapitalize="none"
                            />
                            <TouchableOpacity style={styles.addBtn} onPress={addAdmin}>
                                <Ionicons name="add" size={22} color="#fff" />
                            </TouchableOpacity>
                        </View>
                        {admins.map(email => (
                            <View key={email} style={styles.listCard}>
                                <Ionicons name="shield-checkmark" size={20} color="#10B981" />
                                <Text style={[styles.listCardTitle, { flex: 1 }]}>{email}</Text>
                                {email === auth.currentUser?.email ? (
                                    <Text style={styles.youBadge}>You</Text>
                                ) : (
                                    <TouchableOpacity onPress={() => removeAdmin(email)} style={{ padding: 6 }}>
                                        <Ionicons name="close-circle" size={20} color="#EF4444" />
                                    </TouchableOpacity>
                                )}
                            </View>
                        ))}
                    </>
                )}

                {/* ════════ POSTS TAB ════════ */}
                {activeTab === 'posts' && (
                    <>
                        <Text style={styles.sectionTitle}>Lounge Posts ({posts.length})</Text>
                        {posts.map(p => (
                            <View key={p.id} style={styles.listCard}>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.listCardTitle}>{p.title}</Text>
                                    <Text style={styles.listCardSub}>
                                        by {p.authorName} · {p.likes || 0} likes · {p.commentCount || 0} comments
                                    </Text>
                                </View>
                                <TouchableOpacity onPress={() => deletePost(p.id)} style={{ padding: 6 }}>
                                    <Ionicons name="trash-outline" size={18} color="#EF4444" />
                                </TouchableOpacity>
                            </View>
                        ))}
                        {posts.length === 0 && <Text style={styles.emptyText}>No posts</Text>}
                    </>
                )}

                {/* ════════ LISTINGS TAB ════════ */}
                {activeTab === 'listings' && (
                    <>
                        <Text style={styles.sectionTitle}>Market Listings ({listings.length})</Text>
                        {listings.map(l => (
                            <View key={l.id} style={styles.listCard}>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.listCardTitle}>{l.name}</Text>
                                    <Text style={styles.listCardSub}>
                                        {l.price} · by {l.sellerName} · {l.status || 'available'}
                                    </Text>
                                </View>
                                <TouchableOpacity onPress={() => deleteListing(l.id)} style={{ padding: 6 }}>
                                    <Ionicons name="trash-outline" size={18} color="#EF4444" />
                                </TouchableOpacity>
                            </View>
                        ))}
                        {listings.length === 0 && <Text style={styles.emptyText}>No listings</Text>}
                    </>
                )}

                {/* ════════ LOST & FOUND TAB ════════ */}
                {activeTab === 'lostfound' && (() => {
                    const lfFiltered = lfPosts.filter(p => {
                        if (lfFilter === 'all') return true;
                        if (lfFilter === 'resolved') return p.status === 'resolved';
                        return p.postType === lfFilter;
                    });
                    const lfLost = lfPosts.filter(p => p.postType === 'lost').length;
                    const lfFound = lfPosts.filter(p => p.postType === 'found').length;
                    const lfResolved = lfPosts.filter(p => p.status === 'resolved').length;
                    return (
                        <>
                            {/* L&F Stats Mini Grid */}
                            <Text style={styles.sectionTitle}>Lost & Found Overview</Text>
                            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                                {[
                                    { label: 'Total', val: lfPosts.length, bg: '#EEF2FF', color: '#6366F1' },
                                    { label: 'Lost', val: lfLost, bg: '#FEE2E2', color: '#DC2626' },
                                    { label: 'Found', val: lfFound, bg: '#D1FAE5', color: '#059669' },
                                    { label: 'Resolved', val: lfResolved, bg: '#F0FDF4', color: '#16A34A' },
                                ].map(item => (
                                    <View key={item.label} style={{ flex: 1, backgroundColor: item.bg, borderRadius: r(12), padding: 10, alignItems: 'center' }}>
                                        <Text style={{ fontSize: 20, fontWeight: '800', color: item.color }}>{item.val}</Text>
                                        <Text style={{ fontSize: 10, fontWeight: '600', color: item.color, marginTop: 2 }}>{item.label}</Text>
                                    </View>
                                ))}
                            </View>

                            {/* Filter Pills */}
                            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                                {(['all', 'lost', 'found', 'resolved'] as const).map(f => (
                                    <TouchableOpacity key={f}
                                        style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: r(20), backgroundColor: lfFilter === f ? theme.colors.primary : theme.colors.surfaceAlt }}
                                        onPress={() => setLfFilter(f)}
                                    >
                                        <Text style={{ fontSize: 12, fontWeight: '700', color: lfFilter === f ? '#fff' : theme.colors.textSecondary }}>
                                            {f.charAt(0).toUpperCase() + f.slice(1)}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            {/* Post List */}
                            <Text style={styles.sectionTitle}>Posts ({lfFiltered.length})</Text>
                            {lfFiltered.map(p => {
                                const isLost = p.postType === 'lost';
                                const isResolved = p.status === 'resolved';
                                return (
                                    <View key={p.id} style={[styles.listCard, { opacity: isResolved ? 0.65 : 1 }]}>
                                        {p.imageUrl
                                            ? <Image source={{ uri: p.imageUrl }} style={{ width: 50, height: 50, borderRadius: r(10), resizeMode: 'cover' }} />
                                            : <View style={{ width: 50, height: 50, borderRadius: r(10), backgroundColor: theme.colors.surfaceAlt, justifyContent: 'center', alignItems: 'center' }}><Ionicons name="image-outline" size={20} color={theme.colors.textMuted} /></View>
                                        }
                                        <View style={{ flex: 1 }}>
                                            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                                                <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: r(4), backgroundColor: isLost ? '#FEE2E2' : '#D1FAE5' }}>
                                                    <Text style={{ fontSize: 9, fontWeight: '800', color: isLost ? '#DC2626' : '#059669' }}>{isLost ? 'LOST' : 'FOUND'}</Text>
                                                </View>
                                                {isResolved && <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: r(4), backgroundColor: '#ECFDF5' }}><Text style={{ fontSize: 9, fontWeight: '700', color: '#16A34A' }}>Resolved</Text></View>}
                                            </View>
                                            <Text style={styles.listCardTitle} numberOfLines={1}>{p.title}</Text>
                                            <Text style={styles.listCardSub}>by {p.authorName || 'Unknown'}</Text>
                                        </View>
                                        <View style={{ gap: 6, alignItems: 'center' }}>
                                            <TouchableOpacity onPress={() => toggleLfStatus(p.id, p.status)} style={{ padding: 6 }}>
                                                <Ionicons name={isResolved ? 'refresh-outline' : 'checkmark-circle-outline'} size={18} color={isResolved ? '#6366F1' : '#10B981'} />
                                            </TouchableOpacity>
                                            <TouchableOpacity onPress={() => deleteLfPost(p.id)} style={{ padding: 6 }}>
                                                <Ionicons name="trash-outline" size={18} color="#EF4444" />
                                            </TouchableOpacity>
                                        </View>
                                    </View>
                                );
                            })}
                            {lfFiltered.length === 0 && <Text style={styles.emptyText}>No L&F posts</Text>}
                        </>
                    );
                })()}

                {/* ════════ STATS TAB ════════ */}
                {activeTab === 'stats' && (
                    <>
                        <Text style={styles.sectionTitle}>App Statistics</Text>
                        <View style={styles.statsGrid}>
                            <View style={[styles.statCard, { backgroundColor: '#EEF2FF' }]}>
                                <Ionicons name="chatbubbles" size={28} color="#6366F1" />
                                <Text style={styles.statNumber}>{posts.length}</Text>
                                <Text style={styles.statLabel}>Lounge Posts</Text>
                            </View>
                            <View style={[styles.statCard, { backgroundColor: '#E0F2FE' }]}>
                                <Ionicons name="storefront" size={28} color="#0EA5E9" />
                                <Text style={styles.statNumber}>{listings.length}</Text>
                                <Text style={styles.statLabel}>Market Listings</Text>
                            </View>
                            <View style={[styles.statCard, { backgroundColor: '#FEF3C7' }]}>
                                <Ionicons name="map" size={28} color="#F59E0B" />
                                <Text style={styles.statNumber}>{recs.length}</Text>
                                <Text style={styles.statLabel}>Local Guides</Text>
                            </View>
                            <View style={[styles.statCard, { backgroundColor: '#D1FAE5' }]}>
                                <Ionicons name="people" size={28} color="#10B981" />
                                <Text style={styles.statNumber}>{admins.length}</Text>
                                <Text style={styles.statLabel}>Admins</Text>
                            </View>
                        </View>

                        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>App Info</Text>
                        <View style={styles.infoCard}>
                            <View style={styles.infoRow}>
                                <Text style={styles.infoLabel}>App Name</Text>
                                <Text style={styles.infoValue}>Dolphin</Text>
                            </View>
                            <View style={styles.infoRow}>
                                <Text style={styles.infoLabel}>Version</Text>
                                <Text style={styles.infoValue}>{Constants.expoConfig?.version || '?'}</Text>
                            </View>
                            <View style={styles.infoRow}>
                                <Text style={styles.infoLabel}>Pending Reports</Text>
                                <Text style={styles.infoValue}>{pendingReports}</Text>
                            </View>
                            <View style={styles.infoRow}>
                                <Text style={styles.infoLabel}>Firebase Project</Text>
                                <Text style={styles.infoValue}>lost-and-found-20c10</Text>
                            </View>
                            <View style={styles.infoRow}>
                                <Text style={styles.infoLabel}>Logged in as</Text>
                                <Text style={styles.infoValue}>{auth.currentUser?.email}</Text>
                            </View>
                        </View>
                        <TouchableOpacity 
                            style={{ marginTop: 20, padding: 12, backgroundColor: '#EF4444', borderRadius: r(8), alignItems: 'center' }}
                            onPress={async () => {
                                Alert.alert('Fixing prices...');
                                try {
                                    const snap = await getDocs(collection(db, 'market_listings'));
                                    let count = 0;
                                    for (const d of snap.docs) {
                                        const data = d.data();
                                        if (data.price && typeof data.price === 'string' && data.price.includes('$')) {
                                            const newPrice = data.price.replace(/[^0-9]/g, '');
                                            await updateDoc(doc(db, 'market_listings', d.id), {
                                                price: newPrice,
                                                currency: 'USD'
                                            });
                                            count++;
                                        } else if (!data.currency) {
                                            // Fallback for items with no currency
                                            const newPrice = data.price ? data.price.replace(/[^0-9]/g, '') : '';
                                            await updateDoc(doc(db, 'market_listings', d.id), {
                                                price: newPrice,
                                                currency: newPrice ? 'USD' : 'Free'
                                            });
                                            count++;
                                        }
                                    }
                                    Alert.alert('Done', `Fixed ${count} items.`);
                                } catch (e: any) {
                                    Alert.alert('Error', e.message);
                                }
                            }}
                        >
                            <Text style={{ color: '#fff', fontWeight: '700' }}>Fix Old Listing Prices</Text>
                        </TouchableOpacity>
                    </>
                )}

                {/* ════════ FEEDBACK TAB ════════ */}
                {activeTab === 'feedback' && (
                    <>
                        <Text style={styles.sectionTitle}>User Feedback ({feedbacks.length})</Text>
                        {feedbacks.length === 0 && <Text style={styles.emptyText}>No feedback yet</Text>}
                        {feedbacks.map(fb => {
                            const catColor = fb.category === 'bug' ? '#EF4444' : fb.category === 'suggestion' ? '#0EA5E9' : '#6366F1';
                            const catLabel = fb.category === 'bug' ? 'Bug' : fb.category === 'suggestion' ? 'Suggestion' : 'Other';
                            const time = fb.createdAt?.toDate ? fb.createdAt.toDate().toLocaleString() : '';
                            return (
                                <TouchableOpacity key={fb.id} style={[styles.listCard, { flexDirection: 'column', alignItems: 'stretch', gap: 8 }]} onPress={() => setSelectedFeedback(fb)} activeOpacity={0.7}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                            <View style={{ backgroundColor: catColor, paddingHorizontal: 8, paddingVertical: 3, borderRadius: r(6) }}>
                                                <Text style={{ fontSize: 10, fontWeight: '800', color: '#fff' }}>{catLabel}</Text>
                                            </View>
                                            <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.textPrimary }}>{fb.userName}</Text>
                                        </View>
                                        <TouchableOpacity onPress={() => {
                                            Alert.alert('Delete Feedback?', '', [
                                                { text: 'Cancel', style: 'cancel' },
                                                { text: 'Delete', style: 'destructive', onPress: () => deleteDoc(doc(db, 'dolphin_feedback', fb.id)).catch(() => {}) },
                                            ]);
                                        }} style={{ padding: 4 }}>
                                            <Ionicons name="trash-outline" size={16} color="#EF4444" />
                                        </TouchableOpacity>
                                    </View>
                                    {fb.text ? <Text style={{ fontSize: 13, color: theme.colors.textPrimary, lineHeight: 20 }} numberOfLines={2}>{fb.text}</Text> : null}
                                    {fb.photos && fb.photos.length > 0 && (
                                        <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                                            {fb.photos.map((uri: string, idx: number) => (
                                                <Image key={idx} source={{ uri }} style={{ width: 50, height: 50, borderRadius: r(8) }} />
                                            ))}
                                        </View>
                                    )}
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <Text style={{ fontSize: 10, color: theme.colors.textMuted }}>{fb.userEmail}</Text>
                                        <Text style={{ fontSize: 10, color: theme.colors.textMuted }}>{time}</Text>
                                    </View>
                                </TouchableOpacity>
                            );
                        })}
                    </>
                )}
            </ScrollView>

            {/* ── Feedback Detail Modal ── */}
            <Modal visible={!!selectedFeedback} transparent animationType="fade" onRequestClose={() => setSelectedFeedback(null)}>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 16 }}>
                    <View style={{ backgroundColor: '#fff', borderRadius: r(20), padding: 20, maxHeight: '80%' }}>
                        <TouchableOpacity onPress={() => setSelectedFeedback(null)} style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, width: 32, height: 32, borderRadius: r(16), backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' }}>
                            <Ionicons name="close" size={20} color="#64748B" />
                        </TouchableOpacity>

                        {selectedFeedback && (() => {
                            const fb = selectedFeedback;
                            const catColor = fb.category === 'bug' ? '#EF4444' : fb.category === 'suggestion' ? '#0EA5E9' : '#6366F1';
                            const catLabel = fb.category === 'bug' ? 'Bug / Error' : fb.category === 'suggestion' ? 'Suggestion' : 'Other';
                            const time = fb.createdAt?.toDate ? fb.createdAt.toDate().toLocaleString() : '';
                            return (
                                <ScrollView showsVerticalScrollIndicator={false}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                        <View style={{ backgroundColor: catColor, paddingHorizontal: 10, paddingVertical: 4, borderRadius: r(8) }}>
                                            <Text style={{ fontSize: 12, fontWeight: '800', color: '#fff' }}>{catLabel}</Text>
                                        </View>
                                    </View>
                                    <Text style={{ fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary, marginBottom: 4 }}>{fb.userName}</Text>
                                    <Text style={{ fontSize: 12, color: theme.colors.textMuted, marginBottom: 16 }}>{fb.userEmail} · {time}</Text>

                                    {fb.text ? (
                                        <View style={{ backgroundColor: '#F8FAFC', borderRadius: r(12), padding: 14, marginBottom: 16 }}>
                                            <Text style={{ fontSize: 15, color: theme.colors.textPrimary, lineHeight: 24 }}>{fb.text}</Text>
                                        </View>
                                    ) : null}

                                    {fb.photos && fb.photos.length > 0 && (
                                        <View style={{ gap: 10, marginBottom: 16 }}>
                                            <Text style={{ fontSize: 13, fontWeight: '700', color: theme.colors.textSecondary, marginBottom: 4 }}>Attached Photos</Text>
                                            {fb.photos.map((uri: string, idx: number) => (
                                                <TouchableOpacity key={idx} onPress={() => { setSelectedFeedback(null); setTimeout(() => setZoomedImage(uri), 300); }}>
                                                    <Image source={{ uri }} style={{ width: '100%', height: 200, borderRadius: r(12) }} resizeMode="cover" />
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    )}

                                    <TouchableOpacity style={{ backgroundColor: '#EF4444', paddingVertical: 12, borderRadius: r(12), alignItems: 'center', marginTop: 4 }}
                                        onPress={() => {
                                            Alert.alert('Delete?', '', [
                                                { text: 'Cancel', style: 'cancel' },
                                                { text: 'Delete', style: 'destructive', onPress: () => {
                                                    deleteDoc(doc(db, 'dolphin_feedback', fb.id)).catch(() => {});
                                                    setSelectedFeedback(null);
                                                }},
                                            ]);
                                        }}>
                                        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Delete Feedback</Text>
                                    </TouchableOpacity>
                                </ScrollView>
                            );
                        })()}
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
    headerTitle: { ...theme.typography.h2, color: theme.colors.textPrimary, fontSize: 18 },

    // Tabs
    tabBar: { backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border, maxHeight: 52 },
    tabBarContent: { paddingHorizontal: 12, gap: 8, alignItems: 'center', paddingVertical: 8 },
    tab: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 14, paddingVertical: 8, borderRadius: r(20),
        backgroundColor: theme.colors.surfaceAlt,
    },
    tabActive: { backgroundColor: theme.colors.primary },
    tabText: { fontSize: 12, fontWeight: '700', color: theme.colors.textSecondary },
    tabTextActive: { color: '#fff' },
    tabBadge: {
        backgroundColor: '#EF4444', borderRadius: 9,
        paddingHorizontal: 5, paddingVertical: 1, marginLeft: 2,
    },
    tabBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },

    // Reports
    filterChip: {
        paddingHorizontal: 12, paddingVertical: 5, borderRadius: 9999,
        backgroundColor: '#F1F5F9',
    },
    filterChipActive: { backgroundColor: '#1E293B' },
    filterChipText: { fontSize: 12, fontWeight: '700', color: theme.colors.textSecondary },
    filterChipTextActive: { color: '#fff' },
    reportCard: {
        backgroundColor: theme.colors.surface, borderRadius: r(14),
        padding: 14, marginBottom: 10, ...theme.shadows.sm,
    },
    reportTypeBadge: {
        backgroundColor: '#FEE2E2', borderRadius: 6,
        paddingHorizontal: 7, paddingVertical: 2,
    },
    reportTypeText: { fontSize: 11, fontWeight: '800', color: '#DC2626' },
    reportReason: { fontSize: 13, fontWeight: '700', color: theme.colors.textPrimary, flex: 1 },
    reportStatus: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
    reportMeta: { fontSize: 12, color: theme.colors.textMuted, marginTop: 6 },
    reportInfo: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 4, fontStyle: 'italic' },
    reportActionDanger: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
        flex: 1, backgroundColor: '#EF4444', borderRadius: 9, paddingVertical: 9,
    },
    reportActionDangerText: { fontSize: 12.5, fontWeight: '700', color: '#fff' },
    reportActionNeutral: {
        flex: 1, alignItems: 'center', justifyContent: 'center',
        borderRadius: 9, paddingVertical: 9, borderWidth: 1, borderColor: '#E2E8F0',
    },
    reportActionNeutralText: { fontSize: 12.5, fontWeight: '700', color: theme.colors.textSecondary },
    listThumb: { width: 42, height: 42, borderRadius: 8, marginRight: 4 },

    // Section
    sectionTitle: { ...theme.typography.h3, color: theme.colors.textPrimary, marginBottom: 12, fontSize: 16 },
    fieldLabel: { ...theme.typography.caption, fontWeight: '600', color: theme.colors.textMuted, marginBottom: 8 },

    // Banner Preview
    bannerPreview: {
        height: 90, borderRadius: r(14), padding: 16, marginBottom: 14,
        flexDirection: 'row', alignItems: 'center', overflow: 'hidden',
    },
    bannerPreviewImage: {
        ...StyleSheet.absoluteFillObject, width: '100%', height: '100%',
        resizeMode: 'cover', opacity: 0.4,
    },
    bannerPreviewTitle: { color: '#fff', fontSize: 16, fontWeight: '800', zIndex: 2 },
    bannerPreviewSub: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2, zIndex: 2 },
    bannerImgSlot: {
        width: 64, height: 64, borderRadius: r(10), backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center', alignItems: 'center', overflow: 'hidden', marginLeft: 12,
    },
    bannerSlotImage: { width: 64, height: 64, borderRadius: r(10), resizeMode: 'cover' },
    bannerSlotEmpty: { alignItems: 'center', gap: 2 },
    bannerSlotText: { color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '600' },

    // Inputs
    input: {
        backgroundColor: theme.colors.surface, borderRadius: r(12), borderWidth: 1, borderColor: theme.colors.border,
        paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: theme.colors.textPrimary, marginBottom: 10,
    },
    addRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
    addBtn: {
        width: 44, height: 44, borderRadius: r(12), backgroundColor: theme.colors.primary,
        justifyContent: 'center', alignItems: 'center',
    },

    // Colors
    colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
    colorDot: { width: 32, height: 32, borderRadius: r(16) },
    colorDotActive: { borderWidth: 3, borderColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 },

    // Buttons
    btnRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
    primaryBtn: {
        flex: 1, backgroundColor: theme.colors.primary, paddingVertical: 12,
        borderRadius: r(12), alignItems: 'center',
    },
    primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    cancelBtn: {
        paddingHorizontal: 20, paddingVertical: 12,
        borderRadius: r(12), backgroundColor: theme.colors.surfaceAlt,
    },
    cancelBtnText: { fontWeight: '600', color: theme.colors.textSecondary },

    // List Cards
    listCard: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: theme.colors.surface, borderRadius: r(12),
        padding: 12, marginBottom: 8, ...theme.shadows.sm,
    },
    listColorDot: { width: 6, height: 40, borderRadius: r(3) },
    listCardTitle: { fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary },
    listCardSub: { fontSize: 11, color: theme.colors.textMuted, marginTop: 2 },
    youBadge: {
        fontSize: 10, fontWeight: '800', color: '#10B981',
        backgroundColor: '#D1FAE5', paddingHorizontal: 8, paddingVertical: 3, borderRadius: r(6),
    },

    // Stats
    statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    statCard: {
        width: '47%', borderRadius: r(16), padding: 16, alignItems: 'center',
    },
    statNumber: { fontSize: 28, fontWeight: '800', color: theme.colors.textPrimary, marginTop: 8 },
    statLabel: { fontSize: 12, fontWeight: '600', color: theme.colors.textMuted, marginTop: 2 },

    // Info
    infoCard: {
        backgroundColor: theme.colors.surface, borderRadius: r(14), ...theme.shadows.sm,
    },
    announceCard: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: theme.colors.surface, borderRadius: r(14),
        padding: 14, marginBottom: 10, ...theme.shadows.sm,
    },
    liveBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        backgroundColor: '#FEF3C7', paddingHorizontal: 7, paddingVertical: 2.5,
        borderRadius: 9999,
    },
    liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#F59E0B' },
    liveBadgeText: { fontSize: 9, fontWeight: '800', color: '#B45309', letterSpacing: 0.5 },
    announceDeleteBtn: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: '#FEF2F2', justifyContent: 'center', alignItems: 'center',
    },
    infoRow: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingHorizontal: 16, paddingVertical: 14,
        borderBottomWidth: 1, borderBottomColor: theme.colors.borderLight,
    },
    infoLabel: { fontSize: 13, color: theme.colors.textMuted },
    infoValue: { fontSize: 13, fontWeight: '600', color: theme.colors.textPrimary },

    emptyText: { fontSize: 14, color: theme.colors.textMuted, textAlign: 'center', marginTop: 20 },

    // Lock screen
    lockTitle: { ...theme.typography.h2, color: theme.colors.textPrimary, marginTop: 16 },
    lockSubtitle: { ...theme.typography.body, color: theme.colors.textMuted, marginTop: 8, textAlign: 'center', paddingHorizontal: 40 },
    backBtnLarge: {
        marginTop: 20, backgroundColor: theme.colors.primary, paddingHorizontal: 24, paddingVertical: 12,
        borderRadius: r(12),
    },
    backBtnText: { color: '#fff', fontWeight: '700' },
});
