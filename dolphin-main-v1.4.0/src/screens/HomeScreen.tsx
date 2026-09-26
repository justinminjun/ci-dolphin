import React, { useEffect, useState, useRef, useCallback } from 'react';
import { InteractionManager, Linking, AppState } from 'react-native';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
    Dimensions, FlatList, RefreshControl, Modal, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme, r } from '../theme/theme';
import { db, auth } from '../config/firebase';
import { collection, query, orderBy, limit, onSnapshot, doc, where } from 'firebase/firestore';
import { formatPrice } from '../utils/price';
import { useScrollToTop } from '@react-navigation/native';
import { FeedbackModal } from '../components/FeedbackModal';
import { CalendarWidget } from '../components/CalendarWidget';
import { LunchMenuWidget } from '../components/LunchMenuWidget';
import { WeatherAQIWidget } from '../components/WeatherAQIWidget';
import { useAuth } from '../config/AuthContext';
import { AppIntro } from '../components/AppIntro';
import { getNotificationPermissionStatus } from '../utils/notifications';
import { isTablet, screenPadding, centerContent, WIDE_MAX_WIDTH } from '../theme/responsive';
import { useIsWebDesktop } from '../utils/useResponsive';
import { HoverCard } from '../components/HoverCard';

const SIDEBAR_W = 320;

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_PADDING = 16;
const CARD_GAP = 12;
// Tablet-aware sizing (phone values unchanged)
const H_PAD = isTablet ? screenPadding : CARD_PADDING;
const MARKET_CARD_W = isTablet ? 200 : 150;
const MARKET_IMG_H = isTablet ? 150 : 120;
const LOUNGE_CARD_W = isTablet ? 230 : 180;
const LOUNGE_IMG_H = isTablet ? 125 : 100;

function timeAgo(timestamp: any): string {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const diff = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
}

export function HomeScreen({ navigation }: any) {
    const isWebDesktop = useIsWebDesktop();
    const [marketItems, setMarketItems] = useState<any[]>([]);
    const [loungePosts, setLoungePosts] = useState<any[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [zoomedImage, setZoomedImage] = useState<string | null>(null);
    const [unreadCount, setUnreadCount] = useState(0);
    const [showFeedback, setShowFeedback] = useState(false);
    const [showFeaturesIntro, setShowFeaturesIntro] = useState(false);
    const [announcementPopup, setAnnouncementPopup] = useState<any>(null);
    const [showNotifBanner, setShowNotifBanner] = useState(false);
    // Re-render on the minute so the header date rolls over at midnight
    // instead of staying stuck on whatever day the tab happened to load.
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 60 * 1000);
        return () => clearInterval(id);
    }, []);
    const scrollRef = useRef<ScrollView>(null);
    useScrollToTop(scrollRef);
    const { isStudent } = useAuth();

    // "Notifications are off" banner: shown when OS permission is denied, so
    // teachers who dismissed the iOS prompt can re-enable in Settings. Snoozes
    // for 7 days on dismiss; auto-hides once permission is granted (re-checked
    // when the app returns to foreground from Settings).
    useEffect(() => {
        let mounted = true;
        const check = async () => {
            const status = await getNotificationPermissionStatus();
            if (!mounted) return;
            if (status !== 'denied') { setShowNotifBanner(false); return; }
            const snoozedAt = await AsyncStorage.getItem('@notif_banner_snooze');
            const snoozed = snoozedAt && (Date.now() - Number(snoozedAt)) < 7 * 24 * 3600 * 1000;
            if (mounted) setShowNotifBanner(!snoozed);
        };
        check();
        const sub = AppState.addEventListener('change', s => { if (s === 'active') check(); });
        return () => { mounted = false; sub.remove(); };
    }, []);

    const snoozeNotifBanner = () => {
        setShowNotifBanner(false);
        AsyncStorage.setItem('@notif_banner_snooze', String(Date.now()));
    };

    // One-time app intro for new installs AND updaters (the only home intro —
    // old onboarding/spotlight tours removed)
    useEffect(() => {
        AsyncStorage.getItem('@app_intro_v141').then(seen => {
            if (seen === null) setTimeout(() => setShowFeaturesIntro(true), 800);
        });
        // Mark legacy intro flags so they can never resurface if old code paths return
        AsyncStorage.multiSet([
            ['@has_onboarded_dolphin', 'true'],
            ['@guide_home', 'seen'],
            ['@guide_lounge', 'seen'],
            ['@guide_market', 'seen'],
            ['@has_onboarded_lf', 'true'],
            ['@home_features_v140', 'seen'],
        ]).catch(() => {});
    }, []);

    const dismissFeaturesIntro = () => {
        setShowFeaturesIntro(false);
        AsyncStorage.setItem('@app_intro_v141', 'seen').catch(() => {});
    };

    // Load data with staggered listeners
    useEffect(() => {
        const unsubs: (() => void)[] = [];

        const task = InteractionManager.runAfterInteractions(() => {
            // Market listings
            const qMarket = query(collection(db, 'market_listings'), orderBy('createdAt', 'desc'), limit(10));
            unsubs.push(onSnapshot(qMarket, snap => {
                setMarketItems(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter((i: any) => i.status !== 'sold'));
            }, (err) => { console.warn('Market query error:', err); }));

            // Lounge posts
            const qLounge = query(collection(db, 'lounge_posts'), orderBy('createdAt', 'desc'), limit(6));
            unsubs.push(onSnapshot(qLounge, snap => {
                setLoungePosts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            }, () => {}));

            // Unread notifications
            const uid = auth.currentUser?.uid;
            if (uid) {
                const qNotif = query(
                    collection(db, 'dolphin_notifications'),
                    where('recipientId', '==', uid),
                    where('read', '==', false)
                );
                unsubs.push(onSnapshot(qNotif, snap => setUnreadCount(snap.size), () => {}));
            }
        });

        return () => {
            task.cancel();
            unsubs.forEach(u => u());
        };
    }, []);

    useEffect(() => {
        if (refreshing) {
            const timer = setTimeout(() => setRefreshing(false), 1000);
            return () => clearTimeout(timer);
        }
    }, [refreshing]);

    const onRefresh = useCallback(() => setRefreshing(true), []);

    // Announcements — the latest doc is the live popup; if the admin deletes it,
    // the popup closes everywhere in realtime
    useEffect(() => {
        const q = query(collection(db, 'dolphin_announcements'), orderBy('createdAt', 'desc'), limit(1));
        return onSnapshot(q, async snap => {
            if (snap.empty) {
                setAnnouncementPopup(null);
                return;
            }
            const latest = { id: snap.docs[0].id, ...snap.docs[0].data() } as any;
            const seenKey = `seen_announcement_${latest.id}`;
            const seen = await AsyncStorage.getItem(seenKey);
            if (!seen) {
                setAnnouncementPopup(latest);
            } else {
                // The previously shown popup was deleted and the next-latest is already seen
                setAnnouncementPopup((prev: any) => (prev && prev.id !== latest.id ? null : prev));
            }
        }, () => {});
    }, []);

    const dismissAnnouncement = async () => {
        if (announcementPopup?.id) {
            await AsyncStorage.setItem(`seen_announcement_${announcementPopup.id}`, 'true');
        }
        setAnnouncementPopup(null);
    };

    // Quick Access items
    const quickAccessItems = [
        ...(isStudent ? [] : [
            { key: 'lounge', label: 'F&S Lounge', icon: 'chatbubbles' as const, accent: '#6366F1', bg: '#EEF2FF', route: 'Community' },
        ]),
        { key: 'market', label: 'Marketplace', icon: 'storefront' as const, accent: '#EA580C', bg: '#FFF7ED', route: 'Community', params: { initialTab: 'market' } },
        { key: 'lostfound', label: 'Lost & Found', icon: 'search' as const, accent: '#059669', bg: '#ECFDF5', route: 'LostFound' },
    ];

    const renderMarketCard = (item: any, grid?: boolean) => (
        <HoverCard
            key={item.id}
            style={[styles.marketCard, grid && styles.marketCardGrid, item.status === 'sold' && { opacity: 0.5 }]}
            hoverStyle={styles.cardHover}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('ListingDetail', { listing: item })}
        >
            {item.photos && item.photos[0] ? (
                <Image source={{ uri: item.photos[0] }} style={styles.marketImage} />
            ) : (
                <View style={[styles.marketImage, styles.marketImagePlaceholder]}>
                    <Ionicons name="cube-outline" size={28} color={theme.colors.textMuted} />
                </View>
            )}
            <View style={styles.marketInfo}>
                <Text style={styles.marketName} numberOfLines={1}>{item.name}</Text>
                <Text
                    style={[
                        styles.marketPrice,
                        formatPrice(item.price, item.currency) === 'Free' && { color: '#10B981' },
                    ]}
                    numberOfLines={1}
                >
                    {formatPrice(item.price, item.currency)}
                </Text>
                <Text style={styles.marketSeller} numberOfLines={1}>{item.sellerName}</Text>
            </View>
        </HoverCard>
    );

    const LOUNGE_CAT_META: any = {
        general: { color: '#0EA5E9', bg: '#E0F2FE' },
        question: { color: '#8B5CF6', bg: '#F3E8FF' },
        event: { color: '#F59E0B', bg: '#FEF3C7' },
        tip: { color: '#10B981', bg: '#D1FAE5' },
    };

    const renderLoungeCard = (post: any, grid?: boolean) => {
        const cm = LOUNGE_CAT_META[post.category] || LOUNGE_CAT_META.general;
        return (
            <HoverCard
                key={post.id}
                style={[styles.loungeCard, grid && styles.loungeCardGrid]}
                hoverStyle={styles.cardHover}
                activeOpacity={0.8}
                onPress={() => navigation.navigate('PostDetail', { post })}
            >
                {(post.photos?.[0] || post.imageUrl) ? (
                    <Image source={{ uri: post.photos?.[0] || post.imageUrl }} style={styles.loungeImage} />
                ) : (
                    <View style={[styles.loungeImage, { backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' }]}>
                        <Ionicons name="chatbubbles-outline" size={28} color="#94A3B8" />
                    </View>
                )}
                <View style={[styles.loungeBadge, { backgroundColor: cm.bg }]}>
                    <Text style={[styles.loungeBadgeText, { color: cm.color }]}>
                        {(post.category || 'general').toUpperCase()}
                    </Text>
                </View>
                <Text style={styles.loungeTitle} numberOfLines={2}>{post.title}</Text>
                <View style={styles.loungeFooter}>
                    <Text style={styles.loungeAuthor}>{post.authorName}</Text>
                    <Text style={styles.loungeMeta}>♥ {post.likes || 0}</Text>
                </View>
            </HoverCard>
        );
    };

    const quickAccessRail = (
        <View style={styles.quickAccessSection}>
            <Text style={styles.sectionLabel}>Quick Access</Text>
            <View style={styles.quickAccessRow}>
                {quickAccessItems.map(item => (
                    <HoverCard
                        key={item.key}
                        style={[styles.quickAccessCard, isTablet && styles.quickAccessCardTablet]}
                        hoverStyle={styles.cardHover}
                        activeOpacity={0.85}
                        onPress={() => navigation.navigate(item.route, item.params || {})}
                    >
                        <View style={[styles.quickAccessIconWrap, isTablet && styles.quickAccessIconWrapTablet, { backgroundColor: item.bg }]}>
                            <Ionicons name={item.icon} size={isTablet ? 26 : 21} color={item.accent} />
                        </View>
                        <Text style={[styles.quickAccessLabel, isTablet && styles.quickAccessLabelTablet]}>{item.label}</Text>
                    </HoverCard>
                ))}
            </View>
        </View>
    );

    return (
        <View style={styles.container}>
            {/* ─── Header ─── */}
            <View style={[styles.header, isWebDesktop && { paddingTop: 24 }, centerContent(WIDE_MAX_WIDTH)]}>
                <View>
                    <Text style={styles.headerDate}>
                        {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                    </Text>
                    <Text style={styles.headerTitle}>Dolphin</Text>
                </View>
                <View style={styles.headerRight}>
                    <TouchableOpacity
                        style={styles.feedbackBtn}
                        onPress={() => setShowFeedback(true)}
                    >
                        <Ionicons name="chatbox-ellipses-outline" size={14} color="#fff" />
                        <Text style={styles.feedbackBtnText}>Feedback</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.navigate('Notifications')}>
                        <Ionicons name="notifications-outline" size={22} color="#64748B" />
                        {unreadCount > 0 && (
                            <View style={styles.notifBadge}>
                                <Text style={styles.notifBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                            </View>
                        )}
                    </TouchableOpacity>
                </View>
            </View>

            <ScrollView
                ref={scrollRef}
                style={{ flex: 1 }}
                contentContainerStyle={[styles.scrollContent, centerContent(WIDE_MAX_WIDTH)]}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
            >
                {/* ─── Notifications-off banner ─── */}
                {showNotifBanner && (
                    <View style={styles.notifBanner}>
                        <Ionicons name="notifications-off" size={18} color="#B45309" />
                        <View style={{ flex: 1 }}>
                            <Text style={styles.notifBannerTitle}>Notifications are off</Text>
                            <Text style={styles.notifBannerBody}>You're missing Market listings, Lounge posts & messages.</Text>
                        </View>
                        <TouchableOpacity style={styles.notifBannerBtn} onPress={() => Linking.openSettings()}>
                            <Text style={styles.notifBannerBtnText}>Turn on</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={snoozeNotifBanner} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                            <Ionicons name="close" size={16} color="#B45309" />
                        </TouchableOpacity>
                    </View>
                )}

                {isWebDesktop ? (
                    /* ─── Desktop dashboard: main feed column + widget rail ─── */
                    <View style={styles.dashboardRow}>
                        <View style={styles.dashboardMain}>
                            {quickAccessRail}

                            <View style={styles.sectionHeader}>
                                <Text style={styles.sectionTitle}>Marketplace</Text>
                                <TouchableOpacity onPress={() => navigation.navigate('Community', { initialTab: 'market' })}>
                                    <Text style={styles.seeAll}>See all &gt;</Text>
                                </TouchableOpacity>
                            </View>
                            {marketItems.length > 0 ? (
                                <View style={styles.cardGrid}>
                                    {marketItems.slice(0, 8).map(item => renderMarketCard(item, true))}
                                </View>
                            ) : (
                                <View style={styles.emptySection}>
                                    <Ionicons name="storefront-outline" size={32} color={theme.colors.textMuted} />
                                    <Text style={styles.emptyText}>No items listed yet</Text>
                                </View>
                            )}

                            {!isStudent && (
                                <>
                                    <View style={[styles.sectionHeader, { marginTop: 24 }]}>
                                        <Text style={styles.sectionTitle}>F&S Lounge</Text>
                                        <TouchableOpacity onPress={() => navigation.navigate('Community')}>
                                            <Text style={styles.seeAll}>See all &gt;</Text>
                                        </TouchableOpacity>
                                    </View>
                                    {loungePosts.length > 0 ? (
                                        <View style={styles.cardGrid}>
                                            {loungePosts.slice(0, 8).map(post => renderLoungeCard(post, true))}
                                        </View>
                                    ) : (
                                        <View style={styles.emptySection}>
                                            <Ionicons name="chatbubbles-outline" size={32} color={theme.colors.textMuted} />
                                            <Text style={styles.emptyText}>No posts yet</Text>
                                        </View>
                                    )}
                                </>
                            )}
                        </View>

                        <View style={styles.dashboardSidebar}>
                            <CalendarWidget compact />
                            <LunchMenuWidget compact />
                            <WeatherAQIWidget compact />
                        </View>
                    </View>
                ) : (
                    /* ─── Mobile / tablet: single stacked column ─── */
                    <>
                        <View style={styles.heroRow}>
                            <CalendarWidget compact />
                            <LunchMenuWidget compact />
                        </View>

                        <View style={styles.calendarBanner}>
                            <WeatherAQIWidget banner />
                        </View>

                        {quickAccessRail}

                        <View style={styles.sectionHeader}>
                            <Text style={styles.sectionTitle}>Marketplace</Text>
                            <TouchableOpacity onPress={() => navigation.navigate('Community', { initialTab: 'market' })}>
                                <Text style={styles.seeAll}>See all &gt;</Text>
                            </TouchableOpacity>
                        </View>
                        {marketItems.length > 0 ? (
                            <FlatList
                                data={marketItems.slice(0, 6)}
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={{ paddingHorizontal: H_PAD, gap: 12 }}
                                keyExtractor={item => item.id}
                                renderItem={({ item }) => renderMarketCard(item)}
                            />
                        ) : (
                            <View style={styles.emptySection}>
                                <Ionicons name="storefront-outline" size={32} color={theme.colors.textMuted} />
                                <Text style={styles.emptyText}>No items listed yet</Text>
                            </View>
                        )}

                        {!isStudent && (
                            <>
                                <View style={[styles.sectionHeader, { marginTop: 24 }]}>
                                    <Text style={styles.sectionTitle}>F&S Lounge</Text>
                                    <TouchableOpacity onPress={() => navigation.navigate('Community')}>
                                        <Text style={styles.seeAll}>See all &gt;</Text>
                                    </TouchableOpacity>
                                </View>
                                {loungePosts.length > 0 ? (
                                    <FlatList
                                        data={loungePosts.slice(0, 6)}
                                        horizontal
                                        showsHorizontalScrollIndicator={false}
                                        contentContainerStyle={{ paddingHorizontal: H_PAD, gap: 12 }}
                                        keyExtractor={item => item.id}
                                        renderItem={({ item: post }) => renderLoungeCard(post)}
                                    />
                                ) : (
                                    <View style={styles.emptySection}>
                                        <Ionicons name="chatbubbles-outline" size={32} color={theme.colors.textMuted} />
                                        <Text style={styles.emptyText}>No posts yet</Text>
                                    </View>
                                )}
                            </>
                        )}
                    </>
                )}

                <View style={{ height: 40 }} />
            </ScrollView>

            {/* Image zoom modal */}
            <Modal visible={!!zoomedImage} transparent animationType="fade" onRequestClose={() => setZoomedImage(null)}>
                <TouchableOpacity
                    style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' }}
                    activeOpacity={1}
                    onPress={() => setZoomedImage(null)}
                >
                    {zoomedImage && (
                        <Image
                            source={{ uri: zoomedImage }}
                            style={{ width: SCREEN_W - 32, height: SCREEN_W - 32, borderRadius: r(12) }}
                            resizeMode="contain"
                        />
                    )}
                    <Text style={{ color: '#fff', marginTop: 16, fontSize: 14 }}>Tap to close</Text>
                </TouchableOpacity>
            </Modal>

            <FeedbackModal visible={showFeedback} onClose={() => setShowFeedback(false)} />

            {/* Announcement Popup */}
            <Modal visible={!!announcementPopup} transparent animationType="fade" onRequestClose={dismissAnnouncement}>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 }}>
                    <View style={{ backgroundColor: '#fff', borderRadius: theme.radius.xl, padding: 24 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                            <Ionicons name="megaphone" size={22} color="#F59E0B" />
                            <Text style={{ fontSize: 12, fontWeight: '800', color: '#F59E0B', textTransform: 'uppercase', letterSpacing: 1 }}>Announcement</Text>
                        </View>
                        <Text style={{ fontSize: 18, fontWeight: '800', color: '#0F172A', marginBottom: 8 }}>{announcementPopup?.title}</Text>
                        <Text style={{ fontSize: 14, color: '#475569', lineHeight: 22, marginBottom: 20 }}>{announcementPopup?.body}</Text>
                        <TouchableOpacity style={{ backgroundColor: '#0EA5E9', paddingVertical: 14, borderRadius: theme.radius.lg, alignItems: 'center' }} onPress={dismissAnnouncement}>
                            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Got it</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* One-time app intro (new installs & updaters) */}
            <AppIntro visible={showFeaturesIntro} onClose={dismissFeaturesIntro} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F8FAFC' },

    // ─── Desktop dashboard ───
    dashboardRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingHorizontal: 32,
        paddingTop: 20,
        gap: 28,
    },
    dashboardMain: { flex: 1, minWidth: 0 },
    dashboardSidebar: { width: SIDEBAR_W, gap: 16 },
    cardGrid: {
        flexDirection: 'row', flexWrap: 'wrap', gap: 14,
        paddingHorizontal: H_PAD,
    },
    marketCardGrid: { width: 190 },
    loungeCardGrid: { width: 240 },
    // Hover has no native equivalent — web-only lift + shadow, applied via HoverCard
    cardHover: Platform.OS === 'web' ? {
        transform: [{ translateY: -3 }],
        shadowOpacity: 0.14, shadowRadius: 16, shadowOffset: { width: 0, height: 8 },
        // @ts-ignore — cursor is a web-only CSS property, valid via RNW's style passthrough
        cursor: 'pointer',
    } : {},

    // Header
    header: {
        flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
        paddingHorizontal: CARD_PADDING, paddingTop: 58, paddingBottom: 10,
    },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4 },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 2 },

    // ─── Notifications-off banner ───
    notifBanner: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        marginHorizontal: H_PAD, marginBottom: 12,
        backgroundColor: theme.colors.warningBg, borderWidth: 1, borderColor: '#FDE68A',
        borderRadius: r(12), paddingHorizontal: 12, paddingVertical: 10,
    },
    notifBannerTitle: { fontSize: 13, fontWeight: '700', color: '#92400E' },
    notifBannerBody: { fontSize: 11, color: '#B45309', marginTop: 1 },
    notifBannerBtn: {
        backgroundColor: theme.colors.warning, borderRadius: r(8),
        paddingHorizontal: 12, paddingVertical: 7,
    },
    notifBannerBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
    headerLogo: { width: 28, height: 28, borderRadius: 6 },
    headerDate: {
        fontSize: 12, fontWeight: '600', color: '#94A3B8',
        letterSpacing: 0.2, marginBottom: 1,
    },
    headerTitle: { fontSize: 26, fontWeight: '800', color: '#0F172A', letterSpacing: -0.6 },
    feedbackBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        backgroundColor: '#0F172A', paddingHorizontal: 12, paddingVertical: 6,
        borderRadius: 20,
    },
    feedbackBtnText: { fontSize: 11, fontWeight: '600', color: '#fff', letterSpacing: 0.3 },
    headerBtn: { padding: 6, position: 'relative' },
    notifBadge: {
        position: 'absolute', top: 2, right: 0,
        minWidth: 16, height: 16, borderRadius: r(8),
        backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center',
        paddingHorizontal: 3, borderWidth: 1.5, borderColor: '#fff',
    },
    notifBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },

    scrollContent: { paddingBottom: 100 },

    // ─── Hero Cards ───
    heroRow: {
        flexDirection: 'row',
        paddingHorizontal: H_PAD,
        paddingTop: 16,
        gap: CARD_GAP,
    },

    // ─── Calendar Banner ───
    calendarBanner: {
        paddingHorizontal: H_PAD,
        marginTop: 12,
    },


    // ─── Quick Access ───
    quickAccessSection: {
        paddingHorizontal: H_PAD,
        marginTop: 20,
    },
    sectionLabel: {
        fontSize: 12,
        fontWeight: '800',
        color: '#94A3B8',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        marginBottom: 10,
    },
    quickAccessRow: {
        flexDirection: 'row',
        gap: 10,
    },
    quickAccessCard: {
        flex: 1,
        borderRadius: r(18),
        paddingVertical: 16,
        paddingHorizontal: 12,
        alignItems: 'center',
        gap: 9,
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#F1F5F9',
        ...theme.shadows.sm,
    },
    quickAccessGradient: {
        paddingVertical: 18,
        paddingHorizontal: 14,
        alignItems: 'center',
        gap: 8,
    },
    quickAccessIconWrap: {
        width: 44,
        height: 44,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
    },
    quickAccessLabel: {
        fontSize: 12,
        fontWeight: '700',
        textAlign: 'center',
        color: '#334155',
        letterSpacing: -0.2,
    },
    // Tablet-only overrides (never applied on phone)
    quickAccessCardTablet: {
        paddingVertical: 22,
        paddingHorizontal: 16,
        gap: 12,
    },
    quickAccessIconWrapTablet: {
        width: 52,
        height: 52,
        borderRadius: 16,
    },
    quickAccessLabelTablet: {
        fontSize: 13,
    },

    // Section Headers
    sectionHeader: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: H_PAD, marginTop: 28, marginBottom: 12,
    },
    sectionTitle: {
        fontSize: 12, fontWeight: '800', color: '#94A3B8',
        letterSpacing: 0.8, textTransform: 'uppercase',
    },
    seeAll: { fontSize: 12, fontWeight: '700', color: '#10B981', letterSpacing: -0.1 },

    // Market Items
    // (no overflow:hidden — it clips the card shadow; round the image corners instead)
    marketCard: {
        width: MARKET_CARD_W, backgroundColor: '#fff',
        borderRadius: r(18),
        borderWidth: 1, borderColor: '#F1F5F9',
        ...theme.shadows.sm,
    },
    marketImage: {
        width: '100%', height: MARKET_IMG_H, resizeMode: 'cover',
        borderTopLeftRadius: r(18) - 1, borderTopRightRadius: r(18) - 1,
    },
    marketImagePlaceholder: {
        backgroundColor: '#F1F5F9',
        justifyContent: 'center', alignItems: 'center',
    },
    marketInfo: { padding: 10 },
    marketName: { fontSize: 13, fontWeight: '600', color: '#2D3748', marginBottom: 2, letterSpacing: -0.2 },
    marketPrice: { fontSize: 14, fontWeight: '700', color: '#1A202C', letterSpacing: -0.3 },
    marketSeller: { fontSize: 11, fontWeight: '400', color: '#A0AEC0', marginTop: 2 },
    emptySection: {
        alignItems: 'center', justifyContent: 'center', paddingVertical: 30,
        marginHorizontal: H_PAD,
        backgroundColor: '#fff', borderRadius: r(16),
        ...theme.shadows.sm,
    },
    emptyText: { fontSize: 12, fontWeight: '400', color: '#A0AEC0', marginTop: 6, letterSpacing: -0.2 },

    // Lounge Posts
    loungeCard: {
        width: LOUNGE_CARD_W, backgroundColor: '#fff', borderRadius: r(16),
        ...theme.shadows.sm,
    },
    loungeImage: {
        width: LOUNGE_CARD_W, height: LOUNGE_IMG_H,
        resizeMode: 'cover',
        borderTopLeftRadius: r(16), borderTopRightRadius: r(16),
    },
    loungeBadge: {
        alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2,
        borderRadius: r(6), marginBottom: 4, marginTop: 10, marginLeft: 10,
    },
    loungeBadgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
    loungeTitle: { fontSize: 13, fontWeight: '600', color: '#2D3748', marginBottom: 6, paddingHorizontal: 10, letterSpacing: -0.2 },
    loungeFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10, paddingBottom: 10 },
    loungeAuthor: { fontSize: 10, fontWeight: '500', color: '#A0AEC0' },
    loungeMeta: { fontSize: 10, fontWeight: '400', color: '#A0AEC0' },
});
