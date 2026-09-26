import React, { useEffect, useState, useRef } from 'react';
import {
    View, Text, StyleSheet, FlatList, Image, TouchableOpacity,
    RefreshControl, ActivityIndicator, TextInput, Animated, Dimensions,
    Platform, StatusBar, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme, r } from '../theme/theme';
import { useIsWebDesktop } from '../utils/useResponsive';
import { auth, db } from '../config/firebase';
import { collection, query, orderBy, onSnapshot, doc, getDoc, where } from 'firebase/firestore';
import { LOSTFOUND_ZONES, LOSTFOUND_CATEGORIES, STALE_DAYS, isStale, lastActiveMs } from '../lostandfound/utils/constants';
import { getUserRole } from '../lostandfound/utils/userRole';
import { useLFLang } from '../lostandfound/i18n';
import { HoverCard } from '../components/HoverCard';
import { useScrollToTop } from '@react-navigation/native';
import { getBlockedUsers } from '../utils/moderation';

const CARD_GAP = 10;
const FEED_MAX_WIDTH = 1024;
const FRAME = { width: '100%', maxWidth: FEED_MAX_WIDTH, alignSelf: 'center' } as const;

// Grid geometry from the feed's measured width (not the window's), so the
// desktop sidebar and browser resizes are accounted for.
function gridFor(availW: number) {
    const w = Math.min(availW, FEED_MAX_WIDTH);
    const pad = w >= 700 ? 24 : 16;
    const cols = w >= 1000 ? 4 : w >= 600 ? 3 : 2;
    const cardW = Math.floor((w - pad * 2 - CARD_GAP * (cols - 1)) / cols);
    return { pad, cols, cardW };
}

type SortKey = 'newest' | 'oldest' | 'event';

function eventMs(p: any): number {
    const ms = p.eventDate ? new Date(p.eventDate).getTime() : NaN;
    return isNaN(ms) ? lastActiveMs(p) : ms;
}

// ─── Main Feed Screen ───
export function LostFoundScreen({ navigation }: any) {
    const isWebDesktop = useIsWebDesktop();
    const { lang, setLang, t, zoneLabel, categoryLabel, timeAgo } = useLFLang();
    const [sort, setSort] = useState<SortKey>('newest');
    const [feedW, setFeedW] = useState(() => Dimensions.get('window').width);
    const { pad, cols, cardW } = gridFor(feedW);
    const [showOlder, setShowOlder] = useState(false);
    const [posts, setPosts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<'all' | 'lost' | 'found' | 'resolved'>('all');
    const [categoryFilter, setCategoryFilter] = useState<string>('');
    const [zoneFilter, setZoneFilter] = useState<string>('');
    const [authorPhotos, setAuthorPhotos] = useState<Record<string, string | null>>({});
    const [unreadCount, setUnreadCount] = useState(0);
    const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
    const feedRef = useRef<FlatList>(null);
    useScrollToTop(feedRef);

    // Unread notifications
    useEffect(() => {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        const q = query(collection(db, 'dolphin_notifications'), where('recipientId', '==', uid), where('read', '==', false));
        return onSnapshot(q, snap => setUnreadCount(snap.size), () => {});
    }, []);

    const fetchAuthorPhoto = async (authorId: string, postAuthorPhoto?: string | null) => {
        if (!authorId || authorId in authorPhotos) return;
        // 1. Use photo stored directly on the post if available
        if (postAuthorPhoto) { setAuthorPhotos(p => ({ ...p, [authorId]: postAuthorPhoto })); return; }
        // 2. Current user
        const cu = auth.currentUser;
        if (cu?.uid === authorId && cu.photoURL) { setAuthorPhotos(p => ({ ...p, [authorId]: cu.photoURL })); return; }
        // 3. Fetch from Firestore
        try {
            const snap = await getDoc(doc(db, 'users', authorId));
            setAuthorPhotos(p => ({ ...p, [authorId]: snap.exists() ? (snap.data().photoURL || null) : null }));
        } catch { setAuthorPhotos(p => ({ ...p, [authorId]: null })); }
    };

    // Live posts
    useEffect(() => {
        setLoading(true);
        const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'));
        const unsub = onSnapshot(q, snap => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setPosts(data);
            data.forEach((p: any) => { if (p.authorId) fetchAuthorPhoto(p.authorId, p.authorPhoto); });
            setLoading(false);
            setRefreshing(false);
        }, () => { setLoading(false); setRefreshing(false); });
        return unsub;
    }, []);

    // Load blocked users
    useEffect(() => {
        getBlockedUsers().then(setBlockedUsers);
    }, []);

    const handleRefresh = () => {
        setRefreshing(true);
        // onSnapshot already live — just reset flag after short delay
        setTimeout(() => setRefreshing(false), 1000);
    };

    const filtered = posts.filter(item => {
        if (blockedUsers.includes(item.authorId)) return false;
        if (filter === 'lost' && item.postType !== 'lost') return false;
        if (filter === 'found' && item.postType !== 'found') return false;
        if (filter === 'resolved' && item.status !== 'resolved') return false;
        if (filter === 'all' && item.status === 'resolved') return false;
        if (!search.trim()) return true;
        const q = search.trim().toLowerCase();
        const haystack = [
            item.title, item.description, item.location, item.locationDetail, item.locationZoneCustom, item.color,
            item.category, item.category && categoryLabel(item.category),
            item.locationZone && zoneLabel(item.locationZone),
            ...(item.tags || []),
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(q);
    });
    // Apply category + zone filters
    const categoryFiltered = categoryFilter
        ? filtered.filter(item => (item.category || '') === categoryFilter)
        : filtered;
    const zoneFiltered = zoneFilter
        ? categoryFiltered.filter(item => (item.locationZone || '') === zoneFilter)
        : categoryFiltered;

    const sorted = [...zoneFiltered].sort((a, b) => {
        if (sort === 'oldest') return lastActiveMs(a) - lastActiveMs(b);
        if (sort === 'event') return eventMs(b) - eventMs(a);
        return lastActiveMs(b) - lastActiveMs(a);
    });

    // Active posts with no activity for STALE_DAYS are tucked behind a toggle
    // (the Resolved tab shows everything).
    const olderCount = filter === 'resolved' ? 0 : sorted.filter(isStale).length;
    const finalFiltered = filter === 'resolved' || showOlder ? sorted : sorted.filter(p => !isStale(p));
    const hasActiveFilters = !!search.trim() || !!categoryFilter || !!zoneFilter || filter !== 'all';

    const renderItem = ({ item }: { item: any }) => {
        const isLost = item.postType === 'lost';
        const isResolved = item.status === 'resolved';
        const img = item.imageUrls?.[0] || item.imageUrl;
        const imgCount = item.imageUrls ? item.imageUrls.length : (item.imageUrl ? 1 : 0);
        const stale = isStale(item);
        const isFaculty = item.authorEmail ? getUserRole(item.authorEmail) === 'faculty' : false;
        const locationText = item.locationZone
            ? (item.locationZoneCustom || zoneLabel(item.locationZone)) + (item.locationDetail ? ` · ${item.locationDetail}` : '')
            : (item.location || t('unknownLocation'));
        const typeLabel = isLost ? t('badgeLost') : t('badgeFound');
        return (
            <HoverCard
                style={[s.card, { width: cardW }, isResolved && { opacity: 0.6 }]}
                hoverStyle={s.cardHover}
                onPress={() => navigation.navigate('LFDetail', { post: item })}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t('cardA11y', { type: typeLabel, title: item.title, location: locationText })}
            >
                <View>
                    {img
                        ? <Image source={{ uri: img }} style={[s.cardImg, { height: Math.round(cardW * 0.75) }]} accessibilityIgnoresInvertColors />
                        : <View style={[s.cardImg, { height: Math.round(cardW * 0.75), backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' }]}><Ionicons name="image-outline" size={36} color="#CBD5E1" /></View>
                    }
                    <View style={s.badgeRow}>
                        <View style={[s.badge, { backgroundColor: isLost ? '#FEE2E2' : '#D1FAE5' }]}>
                            <Text style={[s.badgeText, { color: isLost ? '#B91C1C' : '#047857' }]}>{typeLabel}</Text>
                        </View>
                        {item.foundStatus === 'holding' && !isResolved && (
                            <View style={[s.badge, { backgroundColor: '#FEF3C7' }]}>
                                <Text style={[s.badgeText, { color: '#92400E' }]}>🤝 {t('withFinderBadge')}</Text>
                            </View>
                        )}
                    </View>
                    {imgCount > 1 && <View style={s.imgCount}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{t('photosCount', { n: imgCount })}</Text></View>}
                    {isResolved && <View style={s.resolvedBadge}><Text style={s.resolvedText}>{t('resolvedBadge')}</Text></View>}
                    {stale && !isResolved && <View style={s.staleBadge}><Text style={s.staleText}>{t('olderBadge')}</Text></View>}
                </View>
                <View style={s.cardBody}>
                    <Text style={s.cardTitle} numberOfLines={1}>{item.title}</Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 6, marginBottom: 6 }}>
                        <Text style={s.cardLocation} numberOfLines={1}>📍 {locationText}</Text>
                        <Text style={s.cardTime}>{item.createdAt ? timeAgo(item.bumpedAt || item.createdAt) : ''}</Text>
                    </View>
                    {item.tags?.length > 0 && (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                            {item.tags.slice(0, 3).map((tg: string, i: number) => (
                                <View key={i} style={s.tag}><Text style={s.tagText}>#{tg}</Text></View>
                            ))}
                        </View>
                    )}
                    <View style={s.authorRow}>
                        {authorPhotos[item.authorId]
                            ? <Image source={{ uri: authorPhotos[item.authorId]! }} style={s.avatar} />
                            : <View style={[s.avatar, { backgroundColor: '#047857', justifyContent: 'center', alignItems: 'center' }]}>
                                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{(item.authorName || 'U')[0].toUpperCase()}</Text>
                              </View>
                        }
                        <Text style={s.authorName} numberOfLines={1}>{item.authorName}</Text>
                        {item.authorEmail && (
                            <View style={[s.roleBadge, { backgroundColor: isFaculty ? '#FEF3C7' : '#EEF2FF' }]}>
                                <Text style={[s.roleText, { color: isFaculty ? '#92400E' : '#4338CA' }]}>{isFaculty ? t('roleFaculty') : t('roleStudent')}</Text>
                            </View>
                        )}
                    </View>
                </View>
            </HoverCard>
        );
    };

    return (
        <View style={s.root}>
            {/* Header — Lounge style */}
            <View style={[s.header, isWebDesktop && { paddingTop: 24 }]}>
              <View style={[s.headerInner, FRAME, { paddingHorizontal: pad }]}>
                <Text style={s.headerTitle} accessibilityRole="header">{t('lostAndFound')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <TouchableOpacity
                        style={s.langToggle}
                        onPress={() => setLang(lang === 'en' ? 'ko' : 'en')}
                        accessibilityRole="button"
                        accessibilityLabel={t('switchLanguage')}
                    >
                        <Text style={[s.langOpt, lang === 'en' && s.langOptActive]}>EN</Text>
                        <Text style={s.langSep}>|</Text>
                        <Text style={[s.langOpt, lang === 'ko' && s.langOptActive]}>한</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={s.headerIconBtn}
                        onPress={() => navigation.navigate('Notifications')}
                        accessibilityRole="button"
                        accessibilityLabel={unreadCount > 0 ? `${t('notifications')} (${unreadCount})` : t('notifications')}
                    >
                        <Ionicons name="notifications-outline" size={24} color={theme.colors.textPrimary} />
                        {unreadCount > 0 && (
                            <View style={s.notifBadge}>
                                <Text style={s.notifBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                            </View>
                        )}
                    </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* Filter links */}
            <View style={s.topLinksRow}>
                <View style={[s.topLinksInner, FRAME, { paddingHorizontal: pad }]} accessibilityRole="tablist">
                    {([
                        { key: 'all', label: t('filterAll') },
                        { key: 'lost', label: t('filterLost') },
                        { key: 'found', label: t('filterFound') },
                        { key: 'resolved', label: t('filterResolved') },
                    ] as const).map(f => (
                        <TouchableOpacity
                            key={f.key}
                            onPress={() => setFilter(f.key)}
                            accessibilityRole="tab"
                            accessibilityState={{ selected: filter === f.key }}
                            accessibilityLabel={f.label}
                            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                        >
                            <Text style={[s.filterLinkText, filter === f.key && s.filterLinkTextActive]}>{f.label}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>

            {/* Category filter pills */}
            <View style={s.pillContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={FRAME} contentContainerStyle={[s.pillScroll, { paddingHorizontal: pad }]}>
                    <TouchableOpacity
                        style={[s.pill, !categoryFilter && s.pillActive]}
                        onPress={() => setCategoryFilter('')}
                        accessibilityRole="button"
                        accessibilityState={{ selected: !categoryFilter }}
                        accessibilityLabel={t('allCategories')}
                    >
                        <Text style={[s.pillText, !categoryFilter && s.pillTextActive]}>{t('allCategories')}</Text>
                    </TouchableOpacity>
                    {LOSTFOUND_CATEGORIES.map(cat => (
                        <TouchableOpacity
                            key={cat}
                            style={[s.pill, categoryFilter === cat && s.pillActive]}
                            onPress={() => setCategoryFilter(categoryFilter === cat ? '' : cat)}
                            accessibilityRole="button"
                            accessibilityState={{ selected: categoryFilter === cat }}
                            accessibilityLabel={categoryLabel(cat)}
                        >
                            <Text style={[s.pillText, categoryFilter === cat && s.pillTextActive]}>{categoryLabel(cat)}</Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            {/* Zone filter pills — lets users narrow a large campus down to one area */}
            <View style={s.pillContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={FRAME} contentContainerStyle={[s.pillScroll, { paddingHorizontal: pad }]}>
                    <TouchableOpacity
                        style={[s.pill, !zoneFilter && s.pillActiveZone]}
                        onPress={() => setZoneFilter('')}
                        accessibilityRole="button"
                        accessibilityState={{ selected: !zoneFilter }}
                        accessibilityLabel={t('anyLocation')}
                    >
                        <Ionicons name="location" size={12} color={!zoneFilter ? '#fff' : theme.colors.textSecondary} />
                        <Text style={[s.pillText, !zoneFilter && s.pillTextActive]}>{t('anyLocation')}</Text>
                    </TouchableOpacity>
                    {LOSTFOUND_ZONES.map(zone => (
                        <TouchableOpacity
                            key={zone}
                            style={[s.pill, zoneFilter === zone && s.pillActiveZone]}
                            onPress={() => setZoneFilter(zoneFilter === zone ? '' : zone)}
                            accessibilityRole="button"
                            accessibilityState={{ selected: zoneFilter === zone }}
                            accessibilityLabel={zoneLabel(zone)}
                        >
                            <Text style={[s.pillText, zoneFilter === zone && s.pillTextActive]}>{zoneLabel(zone)}</Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            {/* Scrollable list with header content */}
            <View style={{ flex: 1 }} onLayout={e => { const w = e.nativeEvent.layout.width; if (w && Math.abs(w - feedW) > 1) setFeedW(w); }}>
            <FlatList
                ref={feedRef}
                key={'cols-' + cols}
                data={finalFiltered}
                keyExtractor={item => item.id}
                renderItem={renderItem}
                contentContainerStyle={[s.list, FRAME, { paddingHorizontal: pad }]}
                numColumns={cols}
                columnWrapperStyle={s.row}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.colors.primary} />}
                ListHeaderComponent={
                    <View>
                        {/* Tagline */}
                        <Text style={s.tagline}>
                            {t('taglineTop')}{'\n'}{t('taglineBottom')}
                        </Text>

                        {/* Search bar */}
                        <View style={s.searchBar}>
                            <Ionicons name="search-outline" size={18} color={theme.colors.textMuted} />
                            <TextInput
                                style={s.searchInput}
                                placeholder={t('searchPlaceholder')}
                                placeholderTextColor={theme.colors.textMuted}
                                value={search}
                                onChangeText={setSearch}
                                accessibilityLabel={t('searchPlaceholder')}
                                returnKeyType="search"
                            />
                            {search.length > 0 && (
                                <TouchableOpacity onPress={() => setSearch('')} accessibilityRole="button" accessibilityLabel={t('clearSearch')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                                    <Ionicons name="close-circle" size={18} color={theme.colors.textMuted} />
                                </TouchableOpacity>
                            )}
                        </View>

                        {/* Sort + results count */}
                        <View style={s.resultRow}>
                            <View style={s.sortRow} accessibilityRole="radiogroup" accessibilityLabel={t('sortBy')}>
                                {([
                                    { key: 'newest', label: t('sortNewest') },
                                    { key: 'oldest', label: t('sortOldest') },
                                    { key: 'event', label: t('sortEventDate') },
                                ] as const).map(o => (
                                    <TouchableOpacity
                                        key={o.key}
                                        style={[s.sortOpt, sort === o.key && s.sortOptActive]}
                                        onPress={() => setSort(o.key)}
                                        accessibilityRole="radio"
                                        accessibilityState={{ selected: sort === o.key }}
                                        accessibilityLabel={o.label}
                                    >
                                        <Text style={[s.sortOptText, sort === o.key && s.sortOptTextActive]}>{o.label}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                            <Text style={s.resultCount} accessibilityLiveRegion="polite">
                                {t(finalFiltered.length === 1 ? 'itemCountOne' : 'itemCountMany', { n: finalFiltered.length })}
                            </Text>
                        </View>

                        {loading && <ActivityIndicator size="large" color="#047857" style={{ marginTop: 20, marginBottom: 10 }} />}
                    </View>
                }
                ListEmptyComponent={
                    !loading && olderCount === 0 ? (
                        <View style={s.emptyContainer}>
                            <Ionicons name="search-outline" size={64} color={theme.colors.textMuted} />
                            <Text style={s.emptyTitle}>{hasActiveFilters ? t('noResults') : t('nothingPosted')}</Text>
                            <Text style={s.emptySubtitle}>{hasActiveFilters ? t('tryDifferent') : t('tapToReport')}</Text>
                        </View>
                    ) : null
                }
                ListFooterComponent={
                    olderCount > 0 ? (
                        <View style={s.olderWrap}>
                            <TouchableOpacity
                                style={s.olderBtn}
                                onPress={() => setShowOlder(v => !v)}
                                accessibilityRole="button"
                                accessibilityState={{ expanded: showOlder }}
                                accessibilityLabel={showOlder ? t('hideOlder') : t('showOlder', { n: olderCount })}
                            >
                                <Ionicons name={showOlder ? 'chevron-up' : 'time-outline'} size={16} color={theme.colors.textSecondary} />
                                <Text style={s.olderBtnText}>{showOlder ? t('hideOlder') : t('showOlder', { n: olderCount })}</Text>
                            </TouchableOpacity>
                            <Text style={s.olderNote}>{t('olderNote', { d: STALE_DAYS })}</Text>
                        </View>
                    ) : null
                }
            />
            </View>

            {/* + Post FAB */}
            <TouchableOpacity
                style={s.fab}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('LFAddPost', {})}
                accessibilityRole="button"
                accessibilityLabel={t('postA11y')}
            >
                <Ionicons name="add" size={22} color="#fff" />
                <Text style={s.fabText}>{t('post')}</Text>
            </TouchableOpacity>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },

    // Header — unified with Market
    header: {
        paddingTop: 60, paddingBottom: 10,
        backgroundColor: theme.colors.surface, ...theme.shadows.sm,
    },
    headerInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headerTitle: { fontSize: 24, fontWeight: '900', color: '#0C2340' },
    headerIconBtn: { padding: 6, position: 'relative' },
    langToggle: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: 10, paddingVertical: 6, borderRadius: r(16),
        backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.borderLight,
    },
    langOpt: { fontSize: 12, fontWeight: '600', color: theme.colors.textMuted },
    langOptActive: { color: '#047857', fontWeight: '800' },
    langSep: { fontSize: 11, color: theme.colors.border },
    notifBadge: {
        position: 'absolute', top: 0, right: -2,
        minWidth: 16, height: 16, borderRadius: 8,
        backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center',
        paddingHorizontal: 3, borderWidth: 1.5, borderColor: theme.colors.surface,
    },
    notifBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
    topLinksRow: {
        paddingBottom: 12,
        backgroundColor: theme.colors.surface,
    },
    topLinksInner: {
        flexDirection: 'row', alignItems: 'center', gap: 20,
    },
    filterLinkText: { fontSize: 18, fontWeight: '700', color: theme.colors.textMuted },
    // #047857 (emerald-700) for text/fills behind white text: the brand #10B981
    // is only ~2.5:1 against white and fails WCAG AA.
    filterLinkTextActive: { color: '#047857' },
    pillContainer: { backgroundColor: theme.colors.surface, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.borderLight },
    pillScroll: { gap: 8 },
    pill: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: 14, paddingVertical: 8, borderRadius: r(20),
        backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.borderLight,
    },
    pillActive: { backgroundColor: '#047857', borderColor: '#047857' },
    pillActiveZone: { backgroundColor: '#4338CA', borderColor: '#4338CA' },
    pillText: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
    pillTextActive: { color: '#fff' },

    // List content — matched exactly to Market
    tagline: { fontSize: 22, fontWeight: '800', color: theme.colors.textPrimary, marginTop: 20, marginBottom: 16, lineHeight: 30 },
    quickRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginBottom: 16 },
    quickCard: {
        flex: 1, backgroundColor: '#fff', borderRadius: r(14), padding: 14,
        ...theme.shadows.sm, borderWidth: 1.5, borderColor: '#10B981',
    },
    quickIconWrap: { width: 36, height: 36, borderRadius: r(10), justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
    quickLabel: { fontSize: 14, fontWeight: '800', color: theme.colors.textPrimary },
    quickDesc: { fontSize: 11, color: theme.colors.textMuted, marginTop: 2 },

    searchBar: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#fff', borderRadius: r(12), paddingHorizontal: 14, paddingVertical: 12,
        marginBottom: 12,
        borderWidth: 1.5, borderColor: '#10B981',
    },
    searchInput: { flex: 1, marginLeft: 8, fontSize: 14, color: theme.colors.textPrimary },

    resultRow: { marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
    resultCount: { fontSize: 12, color: theme.colors.textMuted },
    sortRow: { flexDirection: 'row', gap: 4, backgroundColor: theme.colors.surfaceAlt, borderRadius: r(10), padding: 3 },
    sortOpt: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: r(8) },
    sortOptActive: { backgroundColor: '#fff', ...theme.shadows.sm },
    sortOptText: { fontSize: 12, fontWeight: '600', color: theme.colors.textMuted },
    sortOptTextActive: { color: theme.colors.textPrimary, fontWeight: '700' },
    olderWrap: { alignItems: 'center', paddingTop: 8, paddingBottom: 16 },
    olderBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 16, paddingVertical: 10, borderRadius: r(20),
        backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    },
    olderBtnText: { fontSize: 13, fontWeight: '700', color: theme.colors.textSecondary },
    olderNote: { fontSize: 11, color: theme.colors.textMuted, marginTop: 6 },

    list: { paddingTop: 0, paddingBottom: 100 },
    row: { gap: CARD_GAP, marginBottom: CARD_GAP },
    card: { backgroundColor: '#fff', borderRadius: r(12), overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
    cardImg: { width: '100%', resizeMode: 'cover' },
    cardHover: Platform.OS === 'web' ? {
        transform: [{ translateY: -3 }],
        shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
    } : {},
    badgeRow: { position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: r(16) },
    badgeText: { fontSize: 10, fontWeight: '800' },
    staleBadge: { position: 'absolute', bottom: 8, left: 8, backgroundColor: 'rgba(15,23,42,0.7)', paddingHorizontal: 7, paddingVertical: 2, borderRadius: r(8) },
    staleText: { fontSize: 10, fontWeight: '700', color: '#fff' },
    imgCount: { position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: r(8) },
    resolvedBadge: { position: 'absolute', top: 8, right: 8, backgroundColor: '#ECFDF5', paddingHorizontal: 8, paddingVertical: 3, borderRadius: r(16), borderWidth: 1, borderColor: '#A7F3D0' },
    resolvedText: { fontSize: 10, fontWeight: '700', color: '#059669' },
    cardBody: { padding: 10 },
    cardTitle: { fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary, marginBottom: 2 },
    cardLocation: { fontSize: 11, color: theme.colors.textSecondary, flex: 1 },
    cardTime: { fontSize: 11, color: theme.colors.textMuted },
    tag: { backgroundColor: '#F0FDF4', paddingHorizontal: 6, paddingVertical: 2, borderRadius: r(16) },
    tagText: { fontSize: 10, color: '#059669', fontWeight: '600' },
    authorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: 1, borderColor: '#F1F5F9', paddingTop: 8 },
    avatar: { width: 20, height: 20, borderRadius: r(10) },
    authorName: { fontSize: 11, color: theme.colors.textSecondary, fontWeight: '500', flexShrink: 1 },
    roleBadge: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: r(4), marginLeft: 'auto' },
    roleText: { fontSize: 8, fontWeight: '700' },

    emptyContainer: { alignItems: 'center', paddingTop: 40 },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: theme.colors.textPrimary, marginTop: 16 },
    emptySubtitle: { fontSize: 14, color: theme.colors.textMuted, marginTop: 4, textAlign: 'center' },
    fab: {
        position: 'absolute', bottom: 20, right: 20,
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 20, paddingVertical: 14, borderRadius: r(28),
        backgroundColor: '#047857',
        shadowColor: '#047857', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4, shadowRadius: 8, elevation: 6,
    },
    fabText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

