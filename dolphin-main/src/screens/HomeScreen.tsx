import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
    Dimensions, FlatList, RefreshControl, Modal, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme, r } from '../theme/theme';
import { db, auth } from '../config/firebase';
import { collection, query, orderBy, limit, onSnapshot, doc, where } from 'firebase/firestore';
import { formatPrice } from '../utils/price';
import { useScrollToTop } from '@react-navigation/native';
import { FeedbackModal } from '../components/FeedbackModal';
import { useAuth } from '../config/AuthContext';
import { OnboardingScreen } from './OnboardingScreen';
import { SpotlightGuide, SpotlightStep } from '../components/SpotlightGuide';

const SCREEN_WIDTH = Dimensions.get('window').width;
const BANNER_WIDTH = SCREEN_WIDTH - 32;
const BANNER_HEIGHT = 88;
const CARD_PADDING = 16;

// HomeScreen component will have zoomedImage state added inside
const QUICK_HEIGHT = 170;
const QUICK_GAP = 10;
const SMALL_CARD_H = (QUICK_HEIGHT - QUICK_GAP) / 2;

// Default banners (used if Firestore has none)
const DEFAULT_BANNERS = [
    { id: 'guide', title: '📖 How to Use Dolphin', subtitle: 'Tap to see the app guide' },
    { id: '2', title: 'Dolphin Market', subtitle: 'Buy & sell within school' },
    { id: '3', title: 'Lost & Found', subtitle: 'Help each other find lost items' },
];

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
    const [banners, setBanners] = useState<any[]>(DEFAULT_BANNERS);
    const [marketItems, setMarketItems] = useState<any[]>([]);
    const [loungePosts, setLoungePosts] = useState<any[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [bannerIndex, setBannerIndex] = useState(0);
    const [zoomedImage, setZoomedImage] = useState<string | null>(null);
    const [unreadCount, setUnreadCount] = useState(0);
    const [showFeedback, setShowFeedback] = useState(false);
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [announcementPopup, setAnnouncementPopup] = useState<any>(null);
    const scrollRef = useRef<ScrollView>(null);
    useScrollToTop(scrollRef);
    const bannerTimer = useRef<ReturnType<typeof setInterval> | null>(null);
    const { isStudent } = useAuth();
    const [showGuide, setShowGuide] = useState(false);

    // Spotlight guide steps for HomeScreen
    const SAFE_TOP = Platform.OS === 'ios' ? 60 : 30;
    const HOME_STEPS: SpotlightStep[] = [
        {
            target: null,
            title: '🐬 Welcome to Dolphin!',
            description: 'Let us show you around the app.\nThis quick guide will walk you through the main features.',
            tooltipPosition: 'center',
        },
        {
            target: { x: 16, y: SAFE_TOP + 55, width: SCREEN_WIDTH - 32, height: BANNER_HEIGHT },
            title: '📖 Announcements',
            description: 'Swipe through banners for updates and announcements. Tap the first banner to view the app guide anytime.',
            tooltipPosition: 'bottom',
            borderRadius: 16,
        },
        {
            target: { x: 16, y: SAFE_TOP + 168, width: SCREEN_WIDTH - 32, height: QUICK_HEIGHT },
            title: 'Quick Access',
            description: 'Jump directly into F&S Lounge (community board), Market (buy & sell), or Lost & Found.',
            tooltipPosition: 'bottom',
            borderRadius: 20,
        },
        {
            target: { x: 16, y: SAFE_TOP + 356, width: SCREEN_WIDTH - 32, height: 200 },
            title: 'Marketplace & Posts',
            description: 'Preview the latest market listings and community posts right from the home screen.',
            tooltipPosition: 'top',
            borderRadius: 16,
        },
    ];

    // Check onboarding status + spotlight guide
    useEffect(() => {
        AsyncStorage.getItem('@has_onboarded_dolphin').then(value => {
            if (value === null) {
                setShowOnboarding(true);
            } else {
                // Returning user - check if they've seen the spotlight guide
                AsyncStorage.getItem('@guide_home').then(guideVal => {
                    if (guideVal === null) setTimeout(() => setShowGuide(true), 600);
                });
            }
        });
    }, []);

    // Load dynamic banners from Firestore
    useEffect(() => {
        const q = query(collection(db, 'app_banners'), orderBy('order', 'asc'));
        return onSnapshot(q, snap => {
            const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            if (items.length > 0) setBanners(items);
        }, () => {});
    }, []);

    // Auto-scroll banners
    useEffect(() => {
        if (banners.length <= 1) return;
        bannerTimer.current = setInterval(() => {
            setBannerIndex((prev: number) => {
                const next = (prev + 1) % banners.length;
                scrollRef.current?.scrollTo({ x: next * BANNER_WIDTH, animated: true });
                return next;
            });
        }, 4000);
        return () => { if (bannerTimer.current) clearInterval(bannerTimer.current); };
    }, [banners.length]);

    // Fetch market items
    useEffect(() => {
        const q = query(collection(db, 'market_listings'), orderBy('createdAt', 'desc'), limit(5));
        return onSnapshot(q, snap => {
            setMarketItems(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        }, () => {});
    }, []);

    // Fetch lounge posts
    useEffect(() => {
        const q = query(collection(db, 'lounge_posts'), orderBy('createdAt', 'desc'), limit(6));
        return onSnapshot(q, snap => {
            setLoungePosts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
    }, []);

    // Unread notifications count
    useEffect(() => {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        const q = query(
            collection(db, 'dolphin_notifications'),
            where('recipientId', '==', uid),
            where('read', '==', false)
        );
        return onSnapshot(q, snap => setUnreadCount(snap.size), () => {});
    }, []);

    // Auto-stop refreshing after data loads or timeout
    useEffect(() => {
        if (refreshing) {
            const timer = setTimeout(() => setRefreshing(false), 1000);
            return () => clearTimeout(timer);
        }
    }, [refreshing, marketItems, loungePosts]);

    const onRefresh = useCallback(() => setRefreshing(true), []);

    // Check for unseen announcements
    useEffect(() => {
        const q = query(collection(db, 'dolphin_announcements'), orderBy('createdAt', 'desc'), limit(1));
        return onSnapshot(q, async snap => {
            if (snap.empty) return;
            const latest = { id: snap.docs[0].id, ...snap.docs[0].data() } as any;
            const seenKey = `seen_announcement_${latest.id}`;
            const seen = await AsyncStorage.getItem(seenKey);
            if (!seen) {
                setAnnouncementPopup(latest);
            }
        }, () => {});
    }, []);

    const dismissAnnouncement = async () => {
        if (announcementPopup?.id) {
            await AsyncStorage.setItem(`seen_announcement_${announcementPopup.id}`, 'true');
        }
        setAnnouncementPopup(null);
    };

    const handleBannerScroll = (e: any) => {
        const idx = Math.round(e.nativeEvent.contentOffset.x / BANNER_WIDTH);
        setBannerIndex(idx);
    };

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <View style={styles.headerLeft}>
                    <Text style={styles.headerTitle}>Dolphin</Text>
                </View>
                <View style={styles.headerRight}>
                    <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#0F172A', paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radius.xl }} onPress={() => setShowFeedback(true)}>
                        <Ionicons name="chatbox-ellipses-outline" size={14} color="#fff" />
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>Feedback</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.navigate('Notifications')}>
                        <Ionicons name="notifications-outline" size={22} color={theme.colors.textPrimary} />
                        {unreadCount > 0 && (
                            <View style={styles.notifBadge}>
                                <Text style={styles.notifBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                            </View>
                        )}
                    </TouchableOpacity>
                </View>
            </View>

            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
            >
                {/* ─── Banner Carousel ─── */}
                <View style={styles.bannerSection}>
                    <ScrollView
                        ref={scrollRef}
                        horizontal
                        pagingEnabled
                        showsHorizontalScrollIndicator={false}
                        onMomentumScrollEnd={handleBannerScroll}
                        decelerationRate="fast"
                        snapToInterval={BANNER_WIDTH}
                    >
                        {banners.map((b: any) => (
                            <TouchableOpacity
                                key={b.id}
                                style={styles.bannerCard}
                                activeOpacity={b.id === 'guide' ? 0.7 : 1}
                                onPress={() => { if (b.id === 'guide') setShowOnboarding(true); }}
                            >
                                <View style={styles.bannerTextSide}>
                                    <Text style={styles.bannerTitle} numberOfLines={1}>{b.title}</Text>
                                    <Text style={styles.bannerSubtitle} numberOfLines={1}>{b.subtitle || ''}</Text>
                                </View>
                                {b.imageUrl ? (
                                    <Image source={{ uri: b.imageUrl }} style={styles.bannerThumb} />
                                ) : null}
                                <Text style={styles.bannerCount}>{bannerIndex + 1}/{banners.length}</Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                    <View style={styles.dotsRow}>
                        {banners.map((_: any, i: number) => (
                            <View key={i} style={[styles.dot, bannerIndex === i && styles.dotActive]} />
                        ))}
                    </View>
                </View>

                {/* ─── Quick Access ─── */}
                <View style={[styles.quickAccessRow, isStudent && { flexDirection: 'row', gap: 10 }]}>
                    {/* Lounge - large (Hidden for students) */}
                    {!isStudent && (
                        <TouchableOpacity
                            style={styles.quickCardLarge}
                            activeOpacity={0.8}
                            onPress={() => navigation.navigate('Community')}
                        >
                            <Ionicons name="chatbubbles" size={38} color="#6366F1" />
                            <Text style={styles.quickTitle}>F&S Lounge</Text>
                            <Text style={styles.quickDesc}>Community board</Text>
                        </TouchableOpacity>
                    )}

                    {/* Right column (or full width split for students) */}
                    <View style={isStudent ? { flex: 1, flexDirection: 'row', gap: 10 } : styles.quickCardColumn}>
                        <TouchableOpacity
                            style={[styles.quickCardSmall, isStudent && { flex: 1, height: QUICK_HEIGHT }]}
                            activeOpacity={0.8}
                            onPress={() => navigation.navigate('Market')}
                        >
                            <Ionicons name="storefront" size={isStudent ? 38 : 24} color="#F97316" />
                            <Text style={[isStudent ? styles.quickTitle : styles.quickTitleSm, { color: '#F97316' }]}>Market</Text>
                            {isStudent && <Text style={styles.quickDesc}>Buy & Sell</Text>}
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.quickCardSmall, isStudent && { flex: 1, height: QUICK_HEIGHT }]}
                            activeOpacity={0.8}
                            onPress={() => navigation.navigate('LostFound')}
                        >
                            <Ionicons name="search" size={isStudent ? 38 : 24} color="#10B981" />
                            <Text style={[isStudent ? styles.quickTitle : styles.quickTitleSm, { color: '#10B981' }]}>Lost & Found</Text>
                            {isStudent && <Text style={styles.quickDesc}>Find items</Text>}
                        </TouchableOpacity>
                    </View>
                </View>

                {/* ─── Market Items ─── */}
                <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>Marketplace</Text>
                    <TouchableOpacity onPress={() => navigation.navigate('Market')}>
                        <Text style={styles.seeAll}>See all &gt;</Text>
                    </TouchableOpacity>
                </View>
                {marketItems.length > 0 ? (
                    <FlatList
                        data={marketItems}
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{ paddingHorizontal: CARD_PADDING, gap: 12 }}
                        keyExtractor={item => item.id}
                        renderItem={({ item }) => (
                            <TouchableOpacity 
                                style={[styles.marketCard, item.status === 'sold' && { opacity: 0.5 }]} 
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
                                    <Text style={styles.marketPrice} numberOfLines={1}>
                                        {formatPrice(item.price, item.currency)}
                                    </Text>
                                    <Text style={styles.marketSeller} numberOfLines={1}>{item.sellerName}</Text>
                                </View>
                            </TouchableOpacity>
                        )}
                    />
                ) : (
                    <View style={styles.emptyHorizSection}>
                        <Ionicons name="storefront-outline" size={32} color={theme.colors.textMuted} />
                        <Text style={styles.emptyHorizText}>No items listed yet</Text>
                    </View>
                )}

                {/* ─── Lounge Posts ─── */}
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
                                contentContainerStyle={{ paddingHorizontal: CARD_PADDING, gap: 12 }}
                                keyExtractor={item => item.id}
                                renderItem={({ item: post }) => {
                                    const catMeta: any = {
                                        general: { color: '#0EA5E9', bg: '#E0F2FE' },
                                        question: { color: '#8B5CF6', bg: '#F3E8FF' },
                                        event: { color: '#F59E0B', bg: '#FEF3C7' },
                                        tip: { color: '#10B981', bg: '#D1FAE5' },
                                    };
                                    const cm = catMeta[post.category] || catMeta.general;
                                    return (
                                        <TouchableOpacity
                                            style={styles.loungeCard}
                                            activeOpacity={0.8}
                                            onPress={() => navigation.navigate('PostDetail', { post })}
                                        >
                                            {(post.photos?.[0] || post.imageUrl) ? (
                                                <Image source={{ uri: post.photos?.[0] || post.imageUrl }} style={styles.loungeImage} />
                                            ) : (
                                                <View style={[styles.loungeImage, { backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' }]}>
                                                    <Ionicons name="chatbubbles-outline" size={28} color={theme.colors.textMuted} />
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
                                        </TouchableOpacity>
                                    );
                                }}
                            />
                        ) : (
                            <View style={styles.emptyLounge}>
                                <Ionicons name="chatbubbles-outline" size={32} color={theme.colors.textMuted} />
                                <Text style={styles.emptyHorizText}>No posts yet</Text>
                            </View>
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
                            style={{ width: SCREEN_WIDTH - 32, height: SCREEN_WIDTH - 32, borderRadius: r(12) }}
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

            {/* Onboarding Modal */}
            <Modal visible={showOnboarding} animationType="slide" onRequestClose={() => setShowOnboarding(false)}>
                <OnboardingScreen navigation={navigation} route={{ params: { onComplete: () => { setShowOnboarding(false); setTimeout(() => setShowGuide(true), 500); } } }} />
            </Modal>

            {/* Spotlight Guide */}
            <SpotlightGuide
                storageKey="@guide_home"
                steps={HOME_STEPS}
                visible={showGuide}
                onDismiss={() => setShowGuide(false)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: CARD_PADDING, paddingTop: 60, paddingBottom: 10,
        backgroundColor: theme.colors.surface, ...theme.shadows.sm,
    },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    schoolLogo: { width: 28, height: 28, borderRadius: r(6), resizeMode: 'contain' },
    headerTitle: { ...theme.typography.h1, color: '#0C2340' },
    headerBtn: { padding: 6, position: 'relative' },
    notifBadge: {
        position: 'absolute', top: 2, right: 0,
        minWidth: 16, height: 16, borderRadius: r(8),
        backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center',
        paddingHorizontal: 3, borderWidth: 1.5, borderColor: theme.colors.surface,
    },
    notifBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
    techChip: { display: 'none' },
    techChipText: { display: 'none' },
    scrollContent: { paddingBottom: 100 },

    // Banner — compact, text-left image-right
    bannerSection: { paddingHorizontal: CARD_PADDING, marginTop: 12 },
    bannerCard: {
        width: BANNER_WIDTH, height: BANNER_HEIGHT,
        borderRadius: theme.radius.lg, overflow: 'hidden',
        backgroundColor: '#F8FAFC',
        borderWidth: 1, borderColor: '#E2E8F0',
        flexDirection: 'row', alignItems: 'center',
        paddingLeft: 18, paddingRight: 6,
    },
    bannerTextSide: { flex: 1, paddingRight: 10 },
    bannerThumb: {
        width: 72, height: 72, borderRadius: theme.radius.lg, resizeMode: 'cover',
    },
    bannerTitle: { color: '#0C2340', fontSize: 16, fontWeight: '800' },
    bannerSubtitle: { color: '#64748B', fontSize: 12, fontWeight: '500', marginTop: 3 },
    bannerCount: {
        position: 'absolute', bottom: 6, right: 10,
        color: '#94A3B8', fontSize: 10, fontWeight: '600',
    },
    dotsRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 8, gap: 5 },
    dot: { width: 6, height: 6, borderRadius: r(3), backgroundColor: theme.colors.textMuted + '40' },
    dotActive: { width: 16, backgroundColor: '#63BCFF', borderRadius: r(4) },

    // Quick Access
    quickAccessRow: {
        flexDirection: 'row', paddingHorizontal: CARD_PADDING, marginTop: 16, gap: 10,
        height: QUICK_HEIGHT,
    },
    quickCardLarge: {
        flex: 0.55, height: QUICK_HEIGHT,
        backgroundColor: '#fff', borderRadius: theme.radius.lg, padding: 16,
        justifyContent: 'center', alignItems: 'center',
        ...theme.shadows.sm, borderWidth: 1, borderColor: '#E5E7EB',
    },
    quickTitle: { fontSize: 18, fontWeight: '800', color: '#6366F1', marginTop: 8 },
    quickDesc: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
    quickCardColumn: { flex: 0.45, gap: QUICK_GAP },
    quickCardSmall: {
        height: SMALL_CARD_H,
        backgroundColor: '#fff', borderRadius: theme.radius.lg, padding: 12,
        justifyContent: 'center', alignItems: 'center', gap: 4,
        ...theme.shadows.sm, borderWidth: 1, borderColor: '#E5E7EB',
    },
    quickTitleSm: { fontSize: 13, fontWeight: '800' },

    // Section Headers
    sectionHeader: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: CARD_PADDING, marginTop: 24, marginBottom: 12,
    },
    sectionTitle: { ...theme.typography.h2, color: theme.colors.textPrimary, fontSize: 18 },
    seeAll: { fontSize: 13, fontWeight: '600', color: theme.colors.primary },

    // Market Items
    marketCard: {
        width: 150, backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg, overflow: 'hidden', ...theme.shadows.sm,
    },
    marketImage: { width: '100%', height: 120, resizeMode: 'cover' },
    marketImagePlaceholder: {
        backgroundColor: theme.colors.surfaceAlt,
        justifyContent: 'center', alignItems: 'center',
    },
    marketInfo: { padding: 10 },
    marketName: { fontSize: 13, fontWeight: '700', color: theme.colors.textPrimary, marginBottom: 2 },
    marketPrice: { fontSize: 15, fontWeight: '800', color: '#0C2340' },
    marketSeller: { fontSize: 11, color: theme.colors.textMuted, marginTop: 2 },
    emptyHorizSection: {
        alignItems: 'center', justifyContent: 'center', paddingVertical: 30,
        marginHorizontal: CARD_PADDING,
        backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg,
    },
    emptyHorizText: { fontSize: 13, color: theme.colors.textMuted, marginTop: 6 },

    // Lounge Posts — horizontal scroll
    loungeCard: {
        width: 180, backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg,
        overflow: 'hidden', ...theme.shadows.sm,
    },
    loungeImage: {
        width: 180, height: 100, borderRadius: r(0),
        resizeMode: 'cover',
    },
    loungeBadge: {
        alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2,
        borderRadius: r(6), marginBottom: 4, marginTop: 10, marginLeft: 10,
    },
    loungeBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
    loungeTitle: { fontSize: 13, fontWeight: '700', color: theme.colors.textPrimary, marginBottom: 6, paddingHorizontal: 10 },
    loungeFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10, paddingBottom: 10 },
    loungeAuthor: { fontSize: 10, fontWeight: '600', color: theme.colors.textMuted },
    loungeMeta: { fontSize: 10, color: theme.colors.textMuted },
    emptyLounge: {
        alignItems: 'center', justifyContent: 'center', paddingVertical: 30,
        marginHorizontal: CARD_PADDING,
        backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg,
    },
});
