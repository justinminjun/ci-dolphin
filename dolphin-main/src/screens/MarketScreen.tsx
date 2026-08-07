import React, { useEffect, useState, useRef } from 'react';
import {
    View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
    Image, Dimensions, Platform, Alert, TextInput, Modal, Animated, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, r } from '../theme/theme';
import { db, auth } from '../config/firebase';
import { MARKET_CATEGORIES } from '../utils/gemini';
import {
    collection, query, orderBy, onSnapshot,
    doc, setDoc, deleteDoc, getDoc, where,
} from 'firebase/firestore';
import { formatPrice } from '../utils/price';
import { useScrollToTop } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { getBlockedUsers } from '../utils/moderation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SpotlightGuide, SpotlightStep } from '../components/SpotlightGuide';
import { PositionPicker } from '../components/PositionPicker';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_GAP = 10;
const CARD_WIDTH = (SCREEN_WIDTH - 16 * 2 - CARD_GAP) / 2;
const IMG_HEIGHT = CARD_WIDTH;

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
    buying: { label: 'Looking to Buy', color: '#6366F1', bg: '#EEF2FF' },
};

// Photo grid component for batch items
function PhotoGrid({ items, size }: { items: any[]; size: number }) {
    const photos = items.map(i => i.photos?.[0]).filter(Boolean);
    const count = photos.length;
    const gap = 2;

    if (count === 0) {
        return (
            <View style={[{ width: size, height: size, backgroundColor: theme.colors.surfaceAlt }, { justifyContent: 'center', alignItems: 'center' }]}>
                <Ionicons name="cube-outline" size={32} color={theme.colors.textMuted} />
            </View>
        );
    }

    if (count === 1) {
        return <Image source={{ uri: photos[0] }} style={{ width: size, height: size }} resizeMode="cover" />;
    }

    if (count === 2) {
        const half = (size - gap) / 2;
        return (
            <View style={{ width: size, height: size, flexDirection: 'row', gap }}>
                <Image source={{ uri: photos[0] }} style={{ width: half, height: size }} resizeMode="cover" />
                <Image source={{ uri: photos[1] }} style={{ width: half, height: size }} resizeMode="cover" />
            </View>
        );
    }

    if (count === 3) {
        const half = (size - gap) / 2;
        return (
            <View style={{ width: size, height: size, gap }}>
                <View style={{ flexDirection: 'row', gap, height: half }}>
                    <Image source={{ uri: photos[0] }} style={{ width: half, height: half }} resizeMode="cover" />
                    <Image source={{ uri: photos[1] }} style={{ width: half, height: half }} resizeMode="cover" />
                </View>
                <Image source={{ uri: photos[2] }} style={{ width: size, height: half }} resizeMode="cover" />
            </View>
        );
    }

    const half = (size - gap) / 2;
    const showMore = count > 4;
    return (
        <View style={{ width: size, height: size, gap }}>
            <View style={{ flexDirection: 'row', gap, height: half }}>
                <Image source={{ uri: photos[0] }} style={{ width: half, height: half }} resizeMode="cover" />
                <Image source={{ uri: photos[1] }} style={{ width: half, height: half }} resizeMode="cover" />
            </View>
            <View style={{ flexDirection: 'row', gap, height: half }}>
                <Image source={{ uri: photos[2] }} style={{ width: half, height: half }} resizeMode="cover" />
                <View style={{ width: half, height: half }}>
                    <Image source={{ uri: photos[3] }} style={{ width: half, height: half }} resizeMode="cover" />
                    {showMore && (
                        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
                            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>+{count - 4}</Text>
                        </View>
                    )}
                </View>
            </View>
        </View>
    );
}

export function MarketScreen({ navigation }: any) {
    const [listings, setListings] = useState<any[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [loading, setLoading] = useState(true);
    const [activeFilter, setActiveFilter] = useState<'all' | 'selling' | 'buying'>('all');
    const [categoryFilter, setCategoryFilter] = useState<string>('');
    const [searchQuery, setSearchQuery] = useState('');
    const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
    const [blockedUsers, setBlockedUsers] = useState<string[]>([]);

    const uid = auth.currentUser?.uid;
    const scrollRef = useRef<FlatList>(null);
    useScrollToTop(scrollRef);

    const [showGuide, setShowGuide] = useState(false);

    useFocusEffect(
        React.useCallback(() => {
            AsyncStorage.getItem('@guide_market').then(val => {
                if (val === null) setTimeout(() => setShowGuide(true), 600);
            });
        }, [])
    );

    const SAFE_TOP = Platform.OS === 'ios' ? 60 : 30;
    const SCREEN_H = Dimensions.get('window').height;
    const MARKET_STEPS: SpotlightStep[] = [
        {
            target: null,
            title: '🏪 Dolphin Market',
            description: 'Buy and sell items within the school community.\nPost listings or browse what others are offering.',
            tooltipPosition: 'center',
        },
        {
            target: { x: 16, y: SAFE_TOP + 45, width: SCREEN_WIDTH - 32, height: 36 },
            title: 'Filter by Type',
            description: 'Switch between All, For Sale, or Looking to Buy to find exactly what you need.',
            tooltipPosition: 'bottom',
            borderRadius: 8,
        },
        {
            target: { x: 16, y: SAFE_TOP + 85, width: SCREEN_WIDTH - 32, height: 36 },
            title: 'Category Filters',
            description: 'Filter by category like Electronics, Books, Clothing and more.',
            tooltipPosition: 'bottom',
            borderRadius: 20,
        },
        {
            target: { x: 278, y: 717, width: 106, height: 49 },
            title: '➕ Post a Listing',
            description: 'Tap the + button to sell an item or post a wanted request. Add photos, set a price, and choose a category.',
            tooltipPosition: 'top',
            borderRadius: 28,
        },
    ];

    useEffect(() => {
        const q = query(collection(db, 'market_listings'), orderBy('createdAt', 'desc'));
        const unsub = onSnapshot(q, (snap) => {
            setListings(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setLoading(false);
            setRefreshing(false);
        }, () => { setLoading(false); setRefreshing(false); });
        return unsub;
    }, []);

    // Load blocked users
    useEffect(() => {
        getBlockedUsers().then(setBlockedUsers);
    }, []);

    // Load user's saved/wishlisted items
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

    // Timeout fallback for pull-to-refresh
    useEffect(() => {
        if (!refreshing) return;
        const timer = setTimeout(() => setRefreshing(false), 1500);
        return () => clearTimeout(timer);
    }, [refreshing]);

    // Filter + search + auto-archive (hide sold items older than 3 days)
    const SOLD_ARCHIVE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
    const filtered = listings.filter(item => {
        // Auto-archive: hide sold items older than 3 days
        if (item.status === 'sold' && item.createdAt) {
            const itemDate = item.createdAt.toDate ? item.createdAt.toDate() : new Date(item.createdAt);
            if (Date.now() - itemDate.getTime() > SOLD_ARCHIVE_MS) return false;
        }
        // Filter blocked users
        if (blockedUsers.includes(item.sellerId)) return false;
        if (activeFilter === 'selling' && item.listingType === 'buying') return false;
        if (activeFilter === 'buying' && item.listingType !== 'buying') return false;
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            return (item.name || '').toLowerCase().includes(q) ||
                   (item.description || '').toLowerCase().includes(q) ||
                   (item.sellerName || '').toLowerCase().includes(q);
        }
        if (categoryFilter && (item.category || '') !== categoryFilter) return false;
        return true;
    });

    // ── My Queue: listings where current user is in the active waitlist ──
    const myQueueItems = uid ? listings.filter(item => {
        if (item.sellerId === uid) return false;
        if (item.status === 'sold') return false;
        const wl: any[] = item.waitlist || [];
        return wl.some(e => e.userId === uid && e.status === 'active');
    }).map(item => {
        const wl: any[] = item.waitlist || [];
        const active = wl.filter(e => e.status === 'active');
        const pos = active.findIndex(e => e.userId === uid) + 1;
        return { ...item, queuePos: pos };
    }) : [];

    // ── My Listings Queue: my own listings that have active waitlist requests ──
    const myListingsQueue = uid ? listings.filter(item => {
        if (item.sellerId !== uid) return false;
        const wl: any[] = item.waitlist || [];
        return wl.some(e => e.status === 'active');
    }).map(item => {
        const wl: any[] = item.waitlist || [];
        const activeCount = wl.filter(e => e.status === 'active').length;
        return { ...item, activeWaiters: activeCount };
    }) : [];

    const [expandQueue, setExpandQueue] = useState(false);
    const [expandRequests, setExpandRequests] = useState(false);

    // Group by batchId
    const grouped: any[] = [];
    const batchMap = new Map<string, any[]>();
    
    for (const item of filtered) {
        if (item.batchId) {
            if (!batchMap.has(item.batchId)) batchMap.set(item.batchId, []);
            batchMap.get(item.batchId)!.push(item);
        } else {
            grouped.push({ type: 'single', item, key: item.id });
        }
    }
    
    for (const [batchId, items] of batchMap) {
        if (items.length === 1) {
            grouped.push({ type: 'single', item: items[0], key: items[0].id });
        } else {
            grouped.push({ type: 'batch', items, batchId, key: `batch_${batchId}` });
        }
    }

    grouped.sort((a, b) => {
        // Push sold items to the bottom
        const aStatus = a.type === 'single' ? a.item.status : a.items[0]?.status;
        const bStatus = b.type === 'single' ? b.item.status : b.items[0]?.status;
        const aSold = aStatus === 'sold' ? 1 : 0;
        const bSold = bStatus === 'sold' ? 1 : 0;
        if (aSold !== bSold) return aSold - bSold;

        const aTime = a.type === 'single' ? a.item.createdAt : a.items[0]?.createdAt;
        const bTime = b.type === 'single' ? b.item.createdAt : b.items[0]?.createdAt;
        if (!aTime || !bTime) return 0;
        const aMs = aTime.toDate ? aTime.toDate().getTime() : new Date(aTime).getTime();
        const bMs = bTime.toDate ? bTime.toDate().getTime() : new Date(bTime).getTime();
        return bMs - aMs;
    });

    // ─── Post Modal ───
    const [showPostModal, setShowPostModal] = useState(false);
    const [postStep, setPostStep] = useState<'choose' | 'sell-mode'>('choose');
    const fadeAnim = useState(new Animated.Value(0))[0];

    const openPostModal = (step: 'choose' | 'sell-mode' = 'choose') => {
        setPostStep(step);
        setShowPostModal(true);
        fadeAnim.setValue(0);
        Animated.spring(fadeAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 10 }).start();
    };

    const closePostModal = () => {
        Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
            setShowPostModal(false);
            setPostStep('choose');
        });
    };

    const handlePostChoice = (choice: string) => {
        if (choice === 'sell') {
            setPostStep('sell-mode');
        } else if (choice === 'buy') {
            closePostModal();
            navigation.navigate('CreateListing', { mode: 'single', listingType: 'buying' });
        } else if (choice === 'single') {
            closePostModal();
            navigation.navigate('CreateListing', { mode: 'single', listingType: 'selling' });
        } else if (choice === 'multi') {
            closePostModal();
            navigation.navigate('CreateListing', { mode: 'multi', listingType: 'selling' });
        }
    };

    const renderSingleItem = (item: any) => {
        const isBuying = item.listingType === 'buying';
        const statusInfo = isBuying
            ? STATUS_META.buying
            : (STATUS_META[item.status] || STATUS_META.available);
        const isSaved = savedIds.has(item.id);
        const isSold = item.status === 'sold';

        return (
            <TouchableOpacity
                style={[styles.itemCard, isSold && { opacity: 0.5 }]}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('ListingDetail', { listing: item })}
            >
                {item.photos && item.photos[0] ? (
                    <Image source={{ uri: item.photos[0] }} style={styles.itemImage} />
                ) : (
                    <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                        <Ionicons name={isBuying ? 'search' : 'cube-outline'} size={32} color={isBuying ? '#6366F1' : theme.colors.textMuted} />
                    </View>
                )}

                {/* Status badge */}
                <View style={[styles.statusBadge, { backgroundColor: statusInfo.bg }]}>
                    <Text style={[styles.statusBadgeText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
                </View>

                {/* Heart / Save button */}
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
                    {isBuying ? (
                        <Text style={styles.buyingBudget} numberOfLines={1}>
                            {item.currency === 'Flexible' ? 'Budget: Flexible' :
                             item.currency === 'NoBudget' ? 'Make an offer' :
                             item.price ? `Budget: ${formatPrice(item.price, item.currency)}` : 'Budget: Flexible'}
                        </Text>
                    ) : (
                        <Text style={styles.itemPrice}>{formatPrice(item.price, item.currency)}</Text>
                    )}
                    <View style={styles.itemMeta}>
                        <Text style={styles.itemSeller} numberOfLines={1}>{item.sellerName}</Text>
                        <Text style={styles.itemTime}>{timeAgo(item.createdAt)}</Text>
                    </View>
                </View>
            </TouchableOpacity>
        );
    };

    const renderBatchItem = (items: any[]) => {
        const first = items[0];
        const batchId = first.batchId;
        const isSaved = savedIds.has(batchId);
        return (
            <TouchableOpacity
                style={styles.itemCard}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('BatchDetail', { items, sellerName: first.sellerName })}
            >
                <PhotoGrid items={items} size={CARD_WIDTH} />
                <View style={styles.batchCountBadge}>
                    <Text style={styles.batchCountText}>{items.length} items</Text>
                </View>
                <TouchableOpacity
                    style={styles.heartBtn}
                    activeOpacity={0.7}
                    onPress={() => toggleSave(batchId)}
                >
                    <Ionicons
                        name={isSaved ? 'heart' : 'heart-outline'}
                        size={20}
                        color={isSaved ? '#EF4444' : theme.colors.textMuted}
                    />
                </TouchableOpacity>
                <View style={styles.itemInfo}>
                    <Text style={styles.itemName} numberOfLines={1}>{first.sellerName}'s Bundle</Text>
                    <Text style={styles.itemPrice}>
                        {formatPrice(items[0].price, items[0].currency)}
                        {items.length > 1 ? ' ~' : ''}
                    </Text>
                    <View style={styles.itemMeta}>
                        <Text style={styles.itemSeller} numberOfLines={1}>{first.sellerName}</Text>
                        <Text style={styles.itemTime}>{timeAgo(first.createdAt)}</Text>
                    </View>
                </View>
            </TouchableOpacity>
        );
    };

    const renderGroupedItem = ({ item: entry }: { item: any }) => {
        if (entry.type === 'single') return renderSingleItem(entry.item);
        else return renderBatchItem(entry.items);
    };

    // Unread notification count for bell badge
    const [unreadCount, setUnreadCount] = useState(0);
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

    return (
        <PositionPicker enabled={false}>
        <View style={styles.container}>
            {/* Header — Lounge style */}
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Dolphin Market</Text>
                <View style={styles.headerRight}>
                    <TouchableOpacity style={styles.headerIconBtn} onPress={() => navigation.navigate('Notifications')}>
                        <Ionicons name="notifications-outline" size={24} color={theme.colors.textPrimary} />
                        {unreadCount > 0 && (
                            <View style={styles.notifBadge}>
                                <Text style={styles.notifBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                            </View>
                        )}
                    </TouchableOpacity>
                </View>
            </View>

            {/* Filter links */}
            <View style={styles.topLinksRow}>
                {[
                    { key: 'all', label: 'All' },
                    { key: 'selling', label: 'For Sale' },
                    { key: 'buying', label: 'Looking to Buy' },
                ].map(f => (
                    <TouchableOpacity key={f.key} onPress={() => setActiveFilter(f.key as any)}>
                        <Text style={[
                            styles.filterLinkText,
                            activeFilter === f.key && styles.filterLinkTextActive,
                        ]}>{f.label}</Text>
                    </TouchableOpacity>
                ))}
            </View>

            {/* Category filter pills */}
            <View style={styles.pillContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillScroll}>
                    <TouchableOpacity
                        style={[styles.pill, !categoryFilter && styles.pillActive]}
                        onPress={() => setCategoryFilter('')}
                    >
                        <Text style={[styles.pillText, !categoryFilter && styles.pillTextActive]}>All</Text>
                    </TouchableOpacity>
                    {MARKET_CATEGORIES.map(cat => (
                        <TouchableOpacity
                            key={cat}
                            style={[styles.pill, categoryFilter === cat && styles.pillActive]}
                            onPress={() => setCategoryFilter(categoryFilter === cat ? '' : cat)}
                        >
                            <Text style={[styles.pillText, categoryFilter === cat && styles.pillTextActive]}>{cat}</Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            <FlatList
                ref={scrollRef}
                data={grouped}
                keyExtractor={entry => entry.key}
                renderItem={renderGroupedItem}
                numColumns={2}
                columnWrapperStyle={styles.row}
                contentContainerStyle={styles.list}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={() => setRefreshing(true)} tintColor={theme.colors.primary} />
                }
                ListHeaderComponent={
                    <>
                        {/* tagline */}
                        <Text style={styles.tagline}>
                            Don't toss it,{'\n'}sell it to a Dolphin.
                        </Text>

                        {/* Search Bar */}
                        <View style={styles.searchBar}>
                            <Ionicons name="search-outline" size={18} color={theme.colors.textMuted} />
                            <TextInput
                                style={styles.searchInput}
                                placeholder="What are you looking for?"
                                placeholderTextColor={theme.colors.textMuted}
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                            />
                            {searchQuery.length > 0 && (
                                <TouchableOpacity onPress={() => setSearchQuery('')}>
                                    <Ionicons name="close-circle" size={18} color={theme.colors.textMuted} />
                                </TouchableOpacity>
                            )}
                        </View>

                        {/* ── Queue Row (side by side) ── */}
                        {(myQueueItems.length > 0 || myListingsQueue.length > 0) && (
                            <View style={styles.queueRow}>
                                {/* My Queue */}
                                {myQueueItems.length > 0 && (
                                    <View style={styles.queueCol}>
                                        <View style={styles.myQueueHeader}>
                                            <Ionicons name="time" size={14} color="#F97316" />
                                            <Text style={styles.myQueueTitle}>My Queue</Text>
                                            <View style={styles.myQueueBadge}>
                                                <Text style={styles.myQueueBadgeText}>{myQueueItems.length}</Text>
                                            </View>
                                            {myQueueItems.length > 1 && (
                                                <TouchableOpacity onPress={() => setExpandQueue(!expandQueue)} style={styles.expandBtn}>
                                                    <Ionicons name={expandQueue ? 'remove' : 'add'} size={14} color="#F97316" />
                                                </TouchableOpacity>
                                            )}
                                        </View>
                                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                                            {(expandQueue ? myQueueItems : myQueueItems.slice(0, 1)).map(item => {
                                                const posIcons = ['🥇', '🥈', '🥉'];
                                                const photo = (item.photos || [])[0];
                                                return (
                                                    <TouchableOpacity key={item.id} style={styles.myQueueCard} activeOpacity={0.8}
                                                        onPress={() => navigation.navigate('ListingDetail', { listing: item })}>
                                                        {photo
                                                            ? <Image source={{ uri: photo }} style={styles.myQueueImg} />
                                                            : <View style={[styles.myQueueImg, { backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' }]}>
                                                                <Ionicons name="cube-outline" size={20} color="#CBD5E1" />
                                                              </View>}
                                                        <View style={styles.myQueueInfo}>
                                                            <Text style={styles.myQueuePos}>{posIcons[item.queuePos - 1] || `#${item.queuePos}`}</Text>
                                                            <Text style={styles.myQueueName} numberOfLines={1}>{item.name}</Text>
                                                            <Text style={styles.myQueuePrice}>{formatPrice(item.price, item.currency)}</Text>
                                                        </View>
                                                    </TouchableOpacity>
                                                );
                                            })}
                                        </ScrollView>
                                    </View>
                                )}
                                {/* Buyer Requests */}
                                {myListingsQueue.length > 0 && (
                                    <View style={styles.queueCol}>
                                        <View style={styles.myQueueHeader}>
                                            <Ionicons name="people" size={14} color="#F97316" />
                                            <Text style={styles.myQueueTitle}>Requests</Text>
                                            <View style={styles.myQueueBadge}>
                                                <Text style={styles.myQueueBadgeText}>{myListingsQueue.length}</Text>
                                            </View>
                                            {myListingsQueue.length > 1 && (
                                                <TouchableOpacity onPress={() => setExpandRequests(!expandRequests)} style={styles.expandBtn}>
                                                    <Ionicons name={expandRequests ? 'remove' : 'add'} size={14} color="#F97316" />
                                                </TouchableOpacity>
                                            )}
                                        </View>
                                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                                            {(expandRequests ? myListingsQueue : myListingsQueue.slice(0, 1)).map(item => {
                                                const photo = (item.photos || [])[0];
                                                return (
                                                    <TouchableOpacity key={item.id} style={styles.myQueueCard} activeOpacity={0.8}
                                                        onPress={() => navigation.navigate('ListingDetail', { listing: item })}>
                                                        {photo
                                                            ? <Image source={{ uri: photo }} style={styles.myQueueImg} />
                                                            : <View style={[styles.myQueueImg, { backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center' }]}>
                                                                <Ionicons name="cube-outline" size={20} color="#FDBA74" />
                                                              </View>}
                                                        <View style={styles.myQueueInfo}>
                                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                                                                <Ionicons name="people" size={11} color="#F97316" />
                                                                <Text style={styles.myQueuePos}>{item.activeWaiters} waiting</Text>
                                                            </View>
                                                            <Text style={styles.myQueueName} numberOfLines={1}>{item.name}</Text>
                                                            <Text style={styles.myQueuePrice}>{formatPrice(item.price, item.currency)}</Text>
                                                        </View>
                                                    </TouchableOpacity>
                                                );
                                            })}
                                        </ScrollView>
                                    </View>
                                )}
                            </View>
                        )}

                        {/* Results count */}
                        <View style={styles.resultRow}>
                            <Text style={styles.resultCount}>{filtered.length} item{filtered.length !== 1 ? 's' : ''}</Text>
                        </View>
                    </>
                }
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Ionicons name="storefront-outline" size={64} color={theme.colors.textMuted} />
                        <Text style={styles.emptyTitle}>{loading ? 'Loading...' : 'No listings yet'}</Text>
                        <Text style={styles.emptySubtitle}>Tap + to list your items!</Text>
                    </View>
                }
            />

            {/* FAB */}
            <TouchableOpacity style={styles.fab} activeOpacity={0.85} onPress={() => openPostModal()}>
                <Ionicons name="add" size={24} color="#fff" />
                <Text style={styles.fabText}>Post</Text>
            </TouchableOpacity>

            {/* ─── Custom Post Modal ─── */}
            <Modal visible={showPostModal} transparent animationType="none" onRequestClose={closePostModal}>
                <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={closePostModal}>
                    <Animated.View style={[
                        styles.modalSheet,
                        { transform: [{ scale: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }], opacity: fadeAnim }
                    ]}>
                        <TouchableOpacity activeOpacity={1}>
                            {/* Handle bar */}
                            <View style={styles.modalHandle} />

                            {postStep === 'choose' ? (
                                <>
                                    <Text style={styles.modalTitle}>What would you like to post?</Text>
                                    <View style={styles.modalOptions}>
                                        <TouchableOpacity style={styles.modalOptionCard} activeOpacity={0.75} onPress={() => handlePostChoice('sell')}>
                                            <View style={[styles.modalOptionIcon, { backgroundColor: '#EEF2FF' }]}>
                                                <Ionicons name="pricetag" size={24} color="#6366F1" />
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <Text style={styles.modalOptionTitle}>Sell an Item</Text>
                                                <Text style={styles.modalOptionDesc}>List something for sale</Text>
                                            </View>
                                            <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                                        </TouchableOpacity>
                                        <TouchableOpacity style={styles.modalOptionCard} activeOpacity={0.75} onPress={() => handlePostChoice('buy')}>
                                            <View style={[styles.modalOptionIcon, { backgroundColor: '#FEF3C7' }]}>
                                                <Ionicons name="search" size={24} color="#F59E0B" />
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <Text style={styles.modalOptionTitle}>Looking to Buy</Text>
                                                <Text style={styles.modalOptionDesc}>Post a wanted item request</Text>
                                            </View>
                                            <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                                        </TouchableOpacity>
                                    </View>
                                </>
                            ) : (
                                <>
                                    <View style={styles.modalBackRow}>
                                        <TouchableOpacity onPress={() => setPostStep('choose')} style={{ padding: 4 }}>
                                            <Ionicons name="chevron-back" size={22} color={theme.colors.textPrimary} />
                                        </TouchableOpacity>
                                        <Text style={styles.modalTitle}>How many items?</Text>
                                    </View>
                                    <View style={styles.modalOptions}>
                                        <TouchableOpacity style={styles.modalOptionCard} activeOpacity={0.75} onPress={() => handlePostChoice('single')}>
                                            <View style={[styles.modalOptionIcon, { backgroundColor: '#F0FDF4' }]}>
                                                <Ionicons name="cube-outline" size={24} color="#059669" />
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <Text style={styles.modalOptionTitle}>Single Item</Text>
                                                <Text style={styles.modalOptionDesc}>List one item for sale</Text>
                                            </View>
                                            <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                                        </TouchableOpacity>
                                        <TouchableOpacity style={styles.modalOptionCard} activeOpacity={0.75} onPress={() => handlePostChoice('multi')}>
                                            <View style={[styles.modalOptionIcon, { backgroundColor: '#EFF6FF' }]}>
                                                <Ionicons name="layers-outline" size={24} color="#2563EB" />
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <Text style={styles.modalOptionTitle}>Multiple Items</Text>
                                                <Text style={styles.modalOptionDesc}>List a bundle of items at once</Text>
                                            </View>
                                            <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                                        </TouchableOpacity>
                                    </View>
                                </>
                            )}

                            {/* Cancel */}
                            <TouchableOpacity style={styles.modalCancelBtn} activeOpacity={0.8} onPress={closePostModal}>
                                <Text style={styles.modalCancelText}>Cancel</Text>
                            </TouchableOpacity>
                        </TouchableOpacity>
                    </Animated.View>
                </TouchableOpacity>
            </Modal>

            <SpotlightGuide
                storageKey="@guide_market"
                steps={MARKET_STEPS}
                visible={showGuide}
                onDismiss={() => setShowGuide(false)}
            />
        </View>
        </PositionPicker>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },

    // Header
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingTop: 60, paddingBottom: 10,
        backgroundColor: theme.colors.surface, ...theme.shadows.sm,
    },
    headerTitle: { fontSize: 24, fontWeight: '900', color: '#0C2340' },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    headerIconBtn: { padding: 6, position: 'relative' },
    notifBadge: {
        position: 'absolute', top: 0, right: -2,
        minWidth: 16, height: 16, borderRadius: 8,
        backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center',
        paddingHorizontal: 3, borderWidth: 1.5, borderColor: theme.colors.surface,
    },
    notifBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
    topLinksRow: {
        flexDirection: 'row', alignItems: 'center', gap: 20,
        paddingHorizontal: 16, paddingBottom: 12,
        backgroundColor: theme.colors.surface,
    },
    filterLinkText: { fontSize: 18, fontWeight: '700', color: theme.colors.textMuted },
    filterLinkTextActive: { color: theme.colors.textPrimary },
    pillContainer: { backgroundColor: theme.colors.surface, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.borderLight },
    pillScroll: { paddingHorizontal: 16, gap: 8 },
    pill: {
        paddingHorizontal: 14, paddingVertical: 8, borderRadius: r(20),
        backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.borderLight,
    },
    pillActive: { backgroundColor: '#F97316', borderColor: '#F97316' },
    pillText: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
    pillTextActive: { color: '#fff' },

    // Content
    tagline: { fontSize: 22, fontWeight: '800', color: theme.colors.textPrimary, paddingHorizontal: 16, marginTop: 20, marginBottom: 16, lineHeight: 30 },
    quickRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginBottom: 16 },
    quickCard: {
        flex: 1, backgroundColor: '#fff', borderRadius: r(14), padding: 14,
        ...theme.shadows.sm, borderWidth: 1.5, borderColor: '#F97316',
    },
    quickIconWrap: {
        width: 36, height: 36, borderRadius: r(10),
        justifyContent: 'center', alignItems: 'center', marginBottom: 8,
    },
    quickLabel: { fontSize: 14, fontWeight: '800', color: theme.colors.textPrimary },
    quickDesc: { fontSize: 11, color: theme.colors.textMuted, marginTop: 2 },

    searchBar: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#fff', borderRadius: r(12), paddingHorizontal: 14, paddingVertical: 12,
        marginHorizontal: 16, marginBottom: 12,
        borderWidth: 1.5, borderColor: '#F97316',
    },
    searchInput: { flex: 1, marginLeft: 8, fontSize: 14, color: theme.colors.textPrimary },

    resultRow: { paddingHorizontal: 16, marginBottom: 8, alignItems: 'flex-end' },
    resultCount: { fontSize: 12, color: theme.colors.textMuted },

    // Grid
    list: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: 100 },
    row: { gap: CARD_GAP, marginBottom: CARD_GAP },
    itemCard: {
        width: CARD_WIDTH, backgroundColor: theme.colors.surface,
        borderRadius: r(14), overflow: 'hidden', ...theme.shadows.sm,
    },
    itemImage: { width: '100%', height: CARD_WIDTH, resizeMode: 'cover' },
    itemImagePlaceholder: {
        backgroundColor: theme.colors.surfaceAlt,
        justifyContent: 'center', alignItems: 'center',
    },
    buyingBudget: {
        fontSize: 13, fontWeight: '700', color: '#0C2340', marginTop: 2,
    },
    heartBtn: {
        position: 'absolute', top: CARD_WIDTH - 32, right: 8,
        width: 32, height: 32, borderRadius: r(16),
        backgroundColor: 'rgba(255,255,255,0.95)',
        justifyContent: 'center', alignItems: 'center',
        ...theme.shadows.sm,
    },
    statusBadge: {
        position: 'absolute', top: 8, left: 8,
        paddingHorizontal: 8, paddingVertical: 3, borderRadius: r(4),
    },
    statusBadgeText: { fontSize: 10, fontWeight: '800' },
    batchCountBadge: {
        position: 'absolute', top: 8, right: 8,
        backgroundColor: 'rgba(0,0,0,0.6)',
        paddingHorizontal: 8, paddingVertical: 3, borderRadius: r(10),
    },
    batchCountText: { fontSize: 10, fontWeight: '700', color: '#fff' },
    itemInfo: { padding: 10 },
    itemName: { fontSize: 13, fontWeight: '600', color: theme.colors.textPrimary },
    itemPrice: { fontSize: 16, fontWeight: '800', color: theme.colors.textPrimary, marginTop: 2 },
    itemMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
    itemSeller: { fontSize: 11, color: theme.colors.textMuted, flex: 1 },
    itemTime: { fontSize: 11, color: theme.colors.textMuted },

    // Empty
    emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
    emptyTitle: { ...theme.typography.h3, color: theme.colors.textPrimary, marginTop: 16 },
    emptySubtitle: { ...theme.typography.body, color: theme.colors.textMuted, textAlign: 'center', marginTop: 8 },

    fab: {
        position: 'absolute', bottom: 20, right: 20,
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 20, paddingVertical: 14, borderRadius: r(28),
        backgroundColor: '#F97316', ...theme.shadows.lg,
    },
    fabText: { color: '#fff', fontSize: 15, fontWeight: '800' },

    // Post Modal
    modalOverlay: {
        flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
        justifyContent: 'flex-end',
    },
    modalSheet: {
        backgroundColor: theme.colors.surface,
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        paddingHorizontal: 20, paddingTop: 12, paddingBottom: 36,
        ...theme.shadows.lg,
    },
    modalHandle: {
        width: 40, height: 4, borderRadius: r(2),
        backgroundColor: theme.colors.borderLight,
        alignSelf: 'center', marginBottom: 16,
    },
    modalTitle: {
        fontSize: 20, fontWeight: '800', color: theme.colors.textPrimary,
        marginBottom: 16,
    },
    modalBackRow: {
        flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4,
    },
    modalOptions: { gap: 10 },
    modalOptionCard: {
        flexDirection: 'row', alignItems: 'center', gap: 14,
        backgroundColor: theme.colors.surfaceAlt,
        paddingHorizontal: 16, paddingVertical: 16,
        borderRadius: r(16), ...theme.shadows.sm,
    },
    modalOptionIcon: {
        width: 48, height: 48, borderRadius: r(14),
        justifyContent: 'center', alignItems: 'center',
    },
    modalOptionTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary },
    modalOptionDesc: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
    modalCancelBtn: {
        marginTop: 16, alignItems: 'center', paddingVertical: 14,
        borderRadius: r(14), backgroundColor: theme.colors.surfaceAlt,
    },
    modalCancelText: { fontSize: 15, fontWeight: '600', color: theme.colors.textMuted },

    // My Queue
    myQueueSection: { paddingLeft: 16, marginBottom: 16 },
    queueRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, marginBottom: 16 },
    queueCol: { flex: 1, minWidth: 0 },
    myQueueHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 },
    myQueueTitle: { fontSize: 14, fontWeight: '800', color: theme.colors.textPrimary },
    myQueueBadge: {
        backgroundColor: '#F97316', borderRadius: r(8),
        paddingHorizontal: 5, paddingVertical: 1,
    },
    myQueueBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
    myQueueCard: {
        width: 125, backgroundColor: '#fff', borderRadius: r(14),
        overflow: 'hidden', borderWidth: 1.5, borderColor: '#F97316',
        ...theme.shadows.sm,
    },
    myQueueImg: { width: 125, height: 85, resizeMode: 'cover' },
    myQueueInfo: { padding: 7 },
    myQueuePos: { fontSize: 13, fontWeight: '800' },
    myQueueName: { fontSize: 11, fontWeight: '600', color: theme.colors.textPrimary, marginTop: 2 },
    myQueuePrice: { fontSize: 11, fontWeight: '800', color: '#0F172A', marginTop: 2 },
    expandBtn: {
        width: 22, height: 22, borderRadius: r(11),
        backgroundColor: '#FFF7ED', borderWidth: 1.5, borderColor: '#F97316',
        justifyContent: 'center', alignItems: 'center',
    },
});
