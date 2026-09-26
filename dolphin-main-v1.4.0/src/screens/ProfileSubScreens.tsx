import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Image, Switch, ScrollView, TextInput, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, r } from '../theme/theme';
import { isTablet, screenPadding, centerContent } from '../theme/responsive';
import { db, auth } from '../config/firebase';
import { collection, query, where, orderBy, onSnapshot, deleteDoc, doc, updateDoc, getDocs, addDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { deleteUser } from 'firebase/auth';
import { formatPrice } from '../utils/price';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sendPushToUser } from '../utils/notifications';
import { LOCAL_CATEGORIES } from '../components/LocalGuideCards';
import { getBlockedUsers, unblockUser } from '../utils/moderation';
import Constants from 'expo-constants';
import { useIsWebDesktop } from '../utils/useResponsive';

function timeAgo(timestamp: any): string {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const diff = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString();
}

export function MyPostsScreen({ navigation }: any) {
    const isWebDesktop = useIsWebDesktop();
    const [posts, setPosts] = useState<any[]>([]);
    const [recs, setRecs] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState<'lounge' | 'local'>('lounge');
    const uid = auth.currentUser?.uid;

    useEffect(() => {
        if (!uid) return;
        const q = query(collection(db, 'lounge_posts'), where('authorId', '==', uid));
        return onSnapshot(q, snap => {
            const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            items.sort((a: any, b: any) => {
                const tA = a.createdAt?.toDate?.()?.getTime?.() || 0;
                const tB = b.createdAt?.toDate?.()?.getTime?.() || 0;
                return tB - tA;
            });
            setPosts(items);
        }, () => { });
    }, [uid]);

    // My local guide recommendations
    useEffect(() => {
        if (!uid) return;
        const q = query(collection(db, 'local_recommendations'), where('authorId', '==', uid));
        return onSnapshot(q, snap => {
            const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            items.sort((a: any, b: any) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            setRecs(items);
        }, () => { });
    }, [uid]);

    const handleDelete = (id: string) => {
        Alert.alert('Delete Post', 'Are you sure?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => deleteDoc(doc(db, 'lounge_posts', id)).catch(() => { }) },
        ]);
    };

    const handleDeleteRec = (id: string) => {
        Alert.alert('Delete Recommendation', 'Are you sure?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => deleteDoc(doc(db, 'local_recommendations', id)).catch(() => { }) },
        ]);
    };

    const openRec = (item: any, startEdit: boolean) => {
        const cat = LOCAL_CATEGORIES.find(c => c.key === item.category);
        if (!cat) return;
        navigation.navigate('LocalGuide', { category: cat, openItemId: item.id, startEdit });
    };

    return (
        <View style={styles.container}>
            <View style={[styles.header, isWebDesktop && { paddingTop: 20 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()}><Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} /></TouchableOpacity>
                <Text style={styles.headerTitle}>My Posts</Text>
                <View style={{ width: 24 }} />
            </View>
            {/* Source tabs */}
            <View style={[styles.myPostsTabRow, centerContent()]}>
                {([['lounge', 'Lounge'], ['local', 'Local Guide']] as const).map(([key, label]) => (
                    <TouchableOpacity
                        key={key}
                        style={[styles.myPostsTab, activeTab === key && styles.myPostsTabActive]}
                        onPress={() => setActiveTab(key)}
                    >
                        <Text style={[styles.myPostsTabText, activeTab === key && styles.myPostsTabTextActive]}>
                            {label} ({key === 'lounge' ? posts.length : recs.length})
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>
            {activeTab === 'local' ? (
                <FlatList
                    data={recs}
                    keyExtractor={i => i.id}
                    contentContainerStyle={[{ padding: screenPadding, paddingBottom: 40 }, centerContent()]}
                    renderItem={({ item }) => (
                        <TouchableOpacity
                            style={styles.listingCard}
                            activeOpacity={0.85}
                            onPress={() => openRec(item, false)}
                        >
                            {(item.photos?.[0] || item.photo) ? (
                                <Image source={{ uri: item.photos?.[0] || item.photo }} style={styles.listingThumb} />
                            ) : (
                                <View style={[styles.listingThumb, styles.listingThumbPlaceholder]}>
                                    <Ionicons name="map-outline" size={24} color={theme.colors.textMuted} />
                                </View>
                            )}
                            <View style={styles.listingInfo}>
                                <Text style={styles.listingName} numberOfLines={1}>{item.title}</Text>
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                                    <View style={{ backgroundColor: theme.colors.primaryGhost, paddingHorizontal: 6, paddingVertical: 1, borderRadius: r(4) }}>
                                        <Text style={{ fontSize: 10, fontWeight: '600', color: theme.colors.primary }}>
                                            {LOCAL_CATEGORIES.find(c => c.key === item.category)?.label || item.category}
                                        </Text>
                                    </View>
                                </View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                                        <Ionicons name="heart" size={12} color={theme.colors.textMuted} />
                                        <Text style={styles.listingTime}>{item.likes || 0}</Text>
                                    </View>
                                    <Text style={styles.listingTime}>· {timeAgo(item.createdAt)}</Text>
                                </View>
                            </View>
                            <View style={styles.listingActions}>
                                <TouchableOpacity style={styles.listingActionBtn} onPress={() => openRec(item, true)}>
                                    <Ionicons name="pencil" size={14} color={theme.colors.primary} />
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.listingActionBtn} onPress={() => handleDeleteRec(item.id)}>
                                    <Ionicons name="trash-outline" size={14} color="#EF4444" />
                                </TouchableOpacity>
                            </View>
                        </TouchableOpacity>
                    )}
                    ListEmptyComponent={<Text style={styles.empty}>No recommendations yet</Text>}
                />
            ) : (
            <FlatList
                data={posts}
                keyExtractor={i => i.id}
                contentContainerStyle={[{ padding: screenPadding, paddingBottom: 40 }, centerContent()]}
                renderItem={({ item }) => (
                    <TouchableOpacity
                        style={styles.listingCard}
                        activeOpacity={0.85}
                        onPress={() => navigation.navigate('PostDetail', { post: item })}
                    >
                        {/* Thumbnail */}
                        {item.photos?.[0] ? (
                            <Image source={{ uri: item.photos[0] }} style={styles.listingThumb} />
                        ) : (
                            <View style={[styles.listingThumb, styles.listingThumbPlaceholder]}>
                                <Ionicons name="document-text-outline" size={24} color={theme.colors.textMuted} />
                            </View>
                        )}
                        {/* Info */}
                        <View style={styles.listingInfo}>
                            <Text style={styles.listingName} numberOfLines={1}>{item.title}</Text>
                            {item.category ? (
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                                    <View style={{ backgroundColor: theme.colors.primaryGhost, paddingHorizontal: 6, paddingVertical: 1, borderRadius: r(4) }}>
                                        <Text style={{ fontSize: 10, fontWeight: '600', color: theme.colors.primary }}>{item.category}</Text>
                                    </View>
                                </View>
                            ) : null}
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                                    <Ionicons name="heart" size={12} color={theme.colors.textMuted} />
                                    <Text style={styles.listingTime}>{item.likes || 0}</Text>
                                </View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                                    <Ionicons name="chatbubble" size={11} color={theme.colors.textMuted} />
                                    <Text style={styles.listingTime}>{item.commentCount || 0}</Text>
                                </View>
                                <Text style={styles.listingTime}>· {timeAgo(item.createdAt)}</Text>
                            </View>
                        </View>
                        {/* Actions */}
                        <View style={styles.listingActions}>
                            <TouchableOpacity
                                style={styles.listingActionBtn}
                                onPress={() => navigation.navigate('CreatePost', { editPost: item })}
                            >
                                <Ionicons name="pencil" size={14} color={theme.colors.primary} />
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.listingActionBtn} onPress={() => handleDelete(item.id)}>
                                <Ionicons name="trash-outline" size={14} color="#EF4444" />
                            </TouchableOpacity>
                        </View>
                    </TouchableOpacity>
                )}
                ListEmptyComponent={<Text style={styles.empty}>No posts yet</Text>}
            />
            )}
        </View>
    );
}

export function MyListingsScreen({ navigation }: any) {
    const isWebDesktop = useIsWebDesktop();
    const [listings, setListings] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState<'active' | 'sold' | 'reserved'>('active');
    const [soldPopup, setSoldPopup] = useState<any>(null);
    const [chatBuyers, setChatBuyers] = useState<any[]>([]);
    const [selectedBuyerId, setSelectedBuyerId] = useState<string | null>(null);
    const uid = auth.currentUser?.uid;

    useEffect(() => {
        if (!uid) return;
        const q = query(collection(db, 'market_listings'), where('sellerId', '==', uid));
        return onSnapshot(q, snap => {
            const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            items.sort((a: any, b: any) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            setListings(items);
        }, () => {});
    }, [uid]);

    const handleDelete = (id: string) => Alert.alert('Delete Listing', 'Are you sure?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteDoc(doc(db, 'market_listings', id)).catch(() => {}) },
    ]);

    const setStatus = async (id: string, status: string) => {
        try {
            const updates: any = { status };
            if (status === 'sold' || status === 'fulfilled') {
                updates.status = 'sold';
                updates.waitlist = [];
                updates.confirmedBuyerId = null;
                updates.confirmedBuyerName = null;
            }
            if (status === 'available') {
                updates.confirmedBuyerId = null;
                updates.confirmedBuyerName = null;
            }
            await updateDoc(doc(db, 'market_listings', id), updates);
        } catch {}
    };

    const filtered = listings.filter(item => {
        if (activeTab === 'active') return item.status === 'available' || (!item.status);
        if (activeTab === 'sold') return item.status === 'sold';
        if (activeTab === 'reserved') return item.status === 'reserved';
        return true;
    });

    const countFor = (tab: string) => listings.filter(item => {
        if (tab === 'active') return item.status === 'available' || (!item.status);
        if (tab === 'sold') return item.status === 'sold';
        if (tab === 'reserved') return item.status === 'reserved';
        return false;
    }).length;

    return (
        <View style={styles.container}>
            <View style={[styles.header, isWebDesktop && { paddingTop: 20 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()}><Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} /></TouchableOpacity>
                <Text style={styles.headerTitle}>My Listings</Text>
                <View style={{ width: 24 }} />
            </View>

            {/* Status Tabs — Karrot style */}
            <View style={[styles.karrotTabs, centerContent()]}>
                {([['active', 'On Sale'], ['sold', 'Sold'], ['reserved', 'Reserved']] as const).map(([tab, label]) => (
                    <TouchableOpacity key={tab} style={[styles.karrotTab, activeTab === tab && styles.karrotTabActive]} onPress={() => setActiveTab(tab)}>
                        <Text style={[styles.karrotTabText, activeTab === tab && styles.karrotTabTextActive]}>
                            {label} {countFor(tab) > 0 ? countFor(tab) : ''}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            <FlatList
                data={filtered}
                keyExtractor={i => i.id}
                contentContainerStyle={[{ paddingHorizontal: 0, paddingBottom: 40 }, centerContent()]}
                renderItem={({ item }) => {
                    const isBuying = item.listingType === 'buying';
                    const isSold = item.status === 'sold';
                    const isReserved = item.status === 'reserved';
                    return (
                        <TouchableOpacity
                            style={styles.karrotCard}
                            activeOpacity={0.8}
                            onPress={() => navigation.navigate('ListingDetail', { listing: item })}
                        >
                            {/* Status Banner */}
                            {(isSold || isReserved) && (
                                <View style={[styles.karrotStatusBar, { backgroundColor: isSold ? '#FEE2E2' : '#FEF3C7' }]}>
                                    <Text style={[styles.karrotStatusBarText, { color: isSold ? '#DC2626' : '#D97706' }]}>{isSold ? (isBuying ? 'Fulfilled' : 'Sold') : 'Reserved'}</Text>
                                </View>
                            )}
                            <View style={styles.karrotCardInner}>
                                {/* Thumbnail */}
                                {item.photos?.[0]
                                    ? <Image source={{ uri: item.photos[0] }} style={styles.karrotThumb} />
                                    : <View style={[styles.karrotThumb, styles.karrotThumbEmpty]}><Ionicons name={isBuying ? 'search' : 'cube-outline'} size={22} color={theme.colors.textMuted} /></View>
                                }
                                {/* Info */}
                                <View style={styles.karrotInfo}>
                                    <Text style={[styles.karrotName, (isSold || isReserved) && { color: theme.colors.textMuted }]} numberOfLines={2}>{item.name}</Text>
                                    <Text style={styles.karrotPrice}>
                                        {isBuying
                                            ? (item.currency === 'Flexible' ? 'Budget: Flexible' : item.currency === 'NoBudget' ? 'Make an offer' : `Budget: ${formatPrice(item.price, item.currency)}`)
                                            : formatPrice(item.price, item.currency)}
                                    </Text>
                                    <Text style={styles.karrotMeta}>{timeAgo(item.createdAt)}</Text>
                                </View>
                                {/* Action buttons */}
                                <View style={styles.karrotActions}>
                                    <TouchableOpacity style={[styles.karrotActionBtn, { flexDirection: 'row', gap: 4, backgroundColor: '#EFF6FF', paddingHorizontal: 10, paddingVertical: 6, borderRadius: r(8) }]} onPress={() => navigation.navigate('CreateListing', { editListing: item, mode: 'single', listingType: item.listingType || 'selling' })}>
                                        <Ionicons name="create-outline" size={14} color={theme.colors.primary} />
                                        <Text style={{ fontSize: 11, fontWeight: '700', color: theme.colors.primary }}>Edit</Text>
                                    </TouchableOpacity>
                                    {!isBuying && !isSold && (
                                        <TouchableOpacity style={[styles.karrotActionBtn, { flexDirection: 'row', gap: 4, backgroundColor: '#FFF7ED', paddingHorizontal: 10, paddingVertical: 6, borderRadius: r(8) }]} onPress={async () => {
                                            // Fetch chat participants for this listing
                                            try {
                                                const chatQ = query(collection(db, 'dolphin_chats'), where('listingId', '==', item.id));
                                                const chatSnap = await getDocs(chatQ);
                                                const buyers: any[] = [];
                                                chatSnap.docs.forEach(d => {
                                                    const data = d.data();
                                                    const participants = data.participants || [];
                                                    const other = participants.find((p: string) => p !== uid);
                                                    if (other) {
                                                        buyers.push({ userId: other, userName: data.otherUserName || data.participantNames?.[other] || 'Unknown', chatId: d.id });
                                                    }
                                                });
                                                setChatBuyers(buyers);
                                                setSoldPopup(item);
                                            } catch {
                                                setSoldPopup(item);
                                                setChatBuyers([]);
                                            }
                                        }}>
                                            <Ionicons name="checkmark-circle-outline" size={14} color="#F97316" />
                                            <Text style={{ fontSize: 11, fontWeight: '700', color: '#F97316' }}>Mark Sold</Text>
                                        </TouchableOpacity>
                                    )}
                                    {isBuying && !isSold && (
                                        <TouchableOpacity style={[styles.karrotActionBtn, { flexDirection: 'row', gap: 4, backgroundColor: '#D1FAE5', paddingHorizontal: 10, paddingVertical: 6, borderRadius: r(8) }]} onPress={() => setStatus(item.id, 'fulfilled')}>
                                            <Ionicons name="checkmark-done-outline" size={14} color="#059669" />
                                            <Text style={{ fontSize: 11, fontWeight: '700', color: '#059669' }}>Fulfilled</Text>
                                        </TouchableOpacity>
                                    )}
                                    {isSold && (
                                        <TouchableOpacity style={[styles.karrotActionBtn, { flexDirection: 'row', gap: 4, backgroundColor: '#EEF2FF', paddingHorizontal: 10, paddingVertical: 6, borderRadius: r(8) }]} onPress={() => setStatus(item.id, 'available')}>
                                            <Ionicons name="refresh-outline" size={14} color="#6366F1" />
                                            <Text style={{ fontSize: 11, fontWeight: '700', color: '#6366F1' }}>{isBuying ? 'Reopen' : 'Relist'}</Text>
                                        </TouchableOpacity>
                                    )}
                                    <TouchableOpacity style={styles.karrotActionBtn} onPress={() => handleDelete(item.id)}>
                                        <Ionicons name="trash-outline" size={18} color="#EF4444" />
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </TouchableOpacity>
                    );
                }}
                ListEmptyComponent={<View style={{ alignItems: 'center', paddingTop: 60 }}><Ionicons name="cube-outline" size={48} color={theme.colors.textMuted} /><Text style={styles.empty}>No listings here</Text></View>}
            />

            {/* ── Mark Sold: Buyer Selection Modal ── */}
            <Modal visible={!!soldPopup} transparent animationType="fade" onRequestClose={() => { setSoldPopup(null); setSelectedBuyerId(null); }}>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
                    <View style={{ backgroundColor: '#fff', borderRadius: r(20), padding: 20, width: '100%', maxHeight: '60%', ...(isTablet ? { maxWidth: 480 } : {}) }}>
                        <TouchableOpacity onPress={() => { setSoldPopup(null); setSelectedBuyerId(null); }} style={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}>
                            <Ionicons name="close" size={22} color="#94A3B8" />
                        </TouchableOpacity>
                        <Text style={{ fontSize: 18, fontWeight: '800', color: theme.colors.textPrimary, marginBottom: 4 }}>Mark as Sold</Text>
                        <Text style={{ fontSize: 13, color: theme.colors.textMuted, marginBottom: 16 }}>Who did you sell "{soldPopup?.name}" to?</Text>

                        {chatBuyers.length === 0 ? (
                            <Text style={{ textAlign: 'center', color: theme.colors.textMuted, paddingVertical: 16 }}>No chats found for this listing</Text>
                        ) : (
                            <ScrollView showsVerticalScrollIndicator={false}>
                                {chatBuyers.map((buyer, idx) => {
                                    const isSelected = selectedBuyerId === buyer.userId;
                                    return (
                                        <TouchableOpacity key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: r(12), backgroundColor: isSelected ? '#FFF7ED' : '#F8FAFC', marginBottom: 8, borderWidth: 1.5, borderColor: isSelected ? '#F97316' : '#E2E8F0' }}
                                            onPress={() => setSelectedBuyerId(isSelected ? null : buyer.userId)}>
                                            <View style={{ width: 36, height: 36, borderRadius: r(18), backgroundColor: isSelected ? '#F97316' : '#94A3B8', justifyContent: 'center', alignItems: 'center' }}>
                                                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{buyer.userName?.[0]?.toUpperCase() || '?'}</Text>
                                            </View>
                                            <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary }}>{buyer.userName}</Text>
                                            <Ionicons name={isSelected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={isSelected ? '#F97316' : '#CBD5E1'} />
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>
                        )}

                        <TouchableOpacity style={{ marginTop: 12, backgroundColor: selectedBuyerId ? '#F97316' : '#CBD5E1', paddingVertical: 12, borderRadius: r(12), alignItems: 'center' }}
                            disabled={!selectedBuyerId}
                            onPress={async () => {
                                if (!soldPopup || !uid) return;
                                const chosenBuyer = chatBuyers.find(b => b.userId === selectedBuyerId);
                                // Update listing status
                                await updateDoc(doc(db, 'market_listings', soldPopup.id), {
                                    status: 'sold',
                                    waitlist: [],
                                    confirmedBuyerId: chosenBuyer?.userId || null,
                                    confirmedBuyerName: chosenBuyer?.userName || null,
                                });
                                // Notify all waitlist users
                                const waitlist = soldPopup.waitlist || [];
                                for (const entry of waitlist) {
                                    if (entry.userId && entry.userId !== uid) {
                                        try {
                                            await addDoc(collection(db, 'dolphin_notifications'), {
                                                recipientId: entry.userId,
                                                type: 'queue',
                                                title: 'Item Sold',
                                                body: `"${soldPopup.name}" has been sold.`,
                                                listingId: soldPopup.id,
                                                read: false,
                                                createdAt: serverTimestamp(),
                                            });
                                            sendPushToUser(entry.userId, 'Item Sold', `"${soldPopup.name}" has been sold.`);
                                        } catch {}
                                    }
                                }
                                // Notify all chat participants
                                for (const buyer of chatBuyers) {
                                    if (buyer.userId !== uid && !waitlist.some((w: any) => w.userId === buyer.userId)) {
                                        try {
                                            await addDoc(collection(db, 'dolphin_notifications'), {
                                                recipientId: buyer.userId,
                                                type: 'queue',
                                                title: 'Item Sold',
                                                body: `"${soldPopup.name}" has been sold.`,
                                                listingId: soldPopup.id,
                                                read: false,
                                                createdAt: serverTimestamp(),
                                            });
                                            sendPushToUser(buyer.userId, 'Item Sold', `"${soldPopup.name}" has been sold.`);
                                        } catch {}
                                    }
                                }
                                setSoldPopup(null);
                                setSelectedBuyerId(null);
                            }}>
                            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{selectedBuyerId ? 'Confirm & Mark Sold' : 'Select a buyer above'}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={{ marginTop: 8, paddingVertical: 10, alignItems: 'center' }}
                            onPress={async () => {
                                if (!soldPopup || !uid) return;
                                await updateDoc(doc(db, 'market_listings', soldPopup.id), {
                                    status: 'sold', waitlist: [], confirmedBuyerId: null, confirmedBuyerName: null,
                                });
                                const waitlist = soldPopup.waitlist || [];
                                for (const entry of waitlist) {
                                    if (entry.userId && entry.userId !== uid) {
                                        try {
                                            await addDoc(collection(db, 'dolphin_notifications'), {
                                                recipientId: entry.userId, type: 'queue', title: 'Item Sold',
                                                body: `"${soldPopup.name}" has been sold.`,
                                                listingId: soldPopup.id, read: false, createdAt: serverTimestamp(),
                                            });
                                            sendPushToUser(entry.userId, 'Item Sold', `"${soldPopup.name}" has been sold.`);
                                        } catch {}
                                    }
                                }
                                setSoldPopup(null);
                                setSelectedBuyerId(null);
                            }}>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.textMuted }}>Mark as Sold without selecting buyer</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

export function SavedScreen({ navigation }: any) {
    const isWebDesktop = useIsWebDesktop();
    const [saved, setSaved] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const uid = auth.currentUser?.uid;

    useEffect(() => {
        if (!uid) return;
        const unsub = onSnapshot(collection(db, 'users', uid, 'saved_items'), snap => {
            const items = snap.docs.map(d => ({ id: d.id, ...d.data() as any }));
            items.sort((a, b) => {
                const tA = a.savedAt?.seconds || 0;
                const tB = b.savedAt?.seconds || 0;
                return tB - tA;
            });
            setSaved(items);
            setLoading(false);
        });
        return unsub;
    }, [uid]);

    const unsave = async (itemId: string) => {
        if (!uid) return;
        try { await deleteDoc(doc(db, 'users', uid, 'saved_items', itemId)); } catch { }
    };

    return (
        <View style={styles.container}>
            <View style={[styles.header, isWebDesktop && { paddingTop: 20 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()}><Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} /></TouchableOpacity>
                <Text style={styles.headerTitle}>Saved Items</Text>
                <View style={{ width: 24 }} />
            </View>
            <FlatList
                data={saved}
                keyExtractor={i => i.id}
                contentContainerStyle={[{ paddingBottom: 40 }, centerContent()]}
                renderItem={({ item }) => (
                    <TouchableOpacity
                        style={styles.karrotCard}
                        activeOpacity={0.8}
                        onPress={async () => {
                            if (item.type === 'listing') {
                                try {
                                    const snap = await getDoc(doc(db, 'market_listings', item.id));
                                    if (snap.exists()) navigation.navigate('ListingDetail', { listing: { id: snap.id, ...snap.data() } });
                                } catch { }
                            } else {
                                try {
                                    const snap = await getDoc(doc(db, 'lounge_posts', item.id));
                                    if (snap.exists()) navigation.navigate('PostDetail', { post: { id: snap.id, ...snap.data() } });
                                } catch { }
                            }
                        }}
                    >
                        <View style={styles.karrotCardInner}>
                            {item.imageUrl
                                ? <Image source={{ uri: item.imageUrl }} style={styles.karrotThumb} />
                                : <View style={[styles.karrotThumb, styles.karrotThumbEmpty]}>
                                    <Ionicons name={item.type === 'listing' ? 'cube-outline' : 'document-text-outline'} size={22} color={theme.colors.textMuted} />
                                  </View>
                            }
                            <View style={styles.karrotInfo}>
                                <Text style={styles.karrotName} numberOfLines={2}>{item.title}</Text>
                                <Text style={styles.karrotMeta}>
                                    {item.type === 'listing' ? '🛒 Market' : '💬 Lounge'} · by {item.authorName}
                                </Text>
                                <Text style={styles.karrotMeta}>{timeAgo(item.savedAt)}</Text>
                            </View>
                            <TouchableOpacity onPress={() => unsave(item.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                                <Ionicons name="bookmark" size={18} color="#F59E0B" style={{ marginLeft: 8 }} />
                            </TouchableOpacity>
                        </View>
                    </TouchableOpacity>
                )}
                ListEmptyComponent={
                    <Text style={styles.empty}>
                        {loading ? 'Loading...' : 'No saved items yet.\nTap the 🔖 bookmark icon to save!'}
                    </Text>
                }
            />
        </View>
    );
}

export function MarketSavedScreen({ navigation }: any) {
    const isWebDesktop = useIsWebDesktop();
    const [savedListings, setSavedListings] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const uid = auth.currentUser?.uid;

    useEffect(() => {
        if (!uid) return;
        // Listen to saved IDs
        const unsub = onSnapshot(collection(db, 'users', uid, 'market_saved'), async (snap) => {
            const ids = snap.docs.map(d => d.id);
            if (ids.length === 0) { setSavedListings([]); setLoading(false); return; }
            // Fetch each listing
            try {
                const { getDoc: gd } = await import('firebase/firestore');
                const results: any[] = [];
                for (const id of ids) {
                    try {
                        const docSnap = await gd(doc(db, 'market_listings', id));
                        if (docSnap.exists()) results.push({ id: docSnap.id, ...docSnap.data() });
                    } catch { }
                }
                setSavedListings(results);
            } catch { }
            setLoading(false);
        });
        return unsub;
    }, [uid]);

    const formatPrice = (price: string, currency: string) => {
        if (!price || currency === 'Free') return 'Free';
        if (currency === 'KRW') return `₩${Number(price).toLocaleString()}`;
        return `$${Number(price).toLocaleString()}`;
    };

    return (
        <View style={styles.container}>
            <View style={[styles.header, isWebDesktop && { paddingTop: 20 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()}><Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} /></TouchableOpacity>
                <Text style={styles.headerTitle}>Saved Items</Text>
                <View style={{ width: 24 }} />
            </View>
            <FlatList
                data={savedListings}
                keyExtractor={i => i.id}
                contentContainerStyle={[{ paddingBottom: 40 }, centerContent()]}
                renderItem={({ item }) => (
                    <TouchableOpacity
                        style={styles.karrotCard}
                        activeOpacity={0.8}
                        onPress={() => navigation.navigate('ListingDetail', { listing: item })}
                    >
                        <View style={styles.karrotCardInner}>
                            {item.photos?.[0]
                                ? <Image source={{ uri: item.photos[0] }} style={styles.karrotThumb} />
                                : <View style={[styles.karrotThumb, styles.karrotThumbEmpty]}><Ionicons name="cube-outline" size={22} color={theme.colors.textMuted} /></View>
                            }
                            <View style={styles.karrotInfo}>
                                <Text style={styles.karrotName} numberOfLines={2}>{item.name}</Text>
                                <Text style={styles.karrotPrice}>{formatPrice(item.price, item.currency)}</Text>
                                <Text style={styles.karrotMeta}>{item.sellerName} · {timeAgo(item.createdAt)}</Text>
                            </View>
                            <Ionicons name="heart" size={18} color="#EF4444" style={{ marginLeft: 8 }} />
                        </View>
                    </TouchableOpacity>
                )}
                ListEmptyComponent={
                    <Text style={styles.empty}>
                        {loading ? 'Loading...' : 'No saved items yet.\nTap ❤️ in Market to save!'}
                    </Text>
                }
            />
        </View>
    );
}


export function SettingsScreen({ navigation }: any) {
    const isWebDesktop = useIsWebDesktop();
    const user = auth.currentUser;
    const [notifAll, setNotifAll] = useState(true);
    const [notifLounge, setNotifLounge] = useState(true);
    const [notifMarket, setNotifMarket] = useState(true);
    const [notifMessages, setNotifMessages] = useState(true);
    const [notifLostFound, setNotifLostFound] = useState(true);
    const [notifLikes, setNotifLikes] = useState(true);
    const [notifComments, setNotifComments] = useState(true);
    const [sBankName, setSBankName] = useState('');
    const [sBankAccount, setSBankAccount] = useState('');
    const [sBankHolder, setSBankHolder] = useState('');
    const [blockedList, setBlockedList] = useState<{ id: string; name: string }[]>([]);

    // Load blocked users (with display names)
    const loadBlocked = async () => {
        try {
            const ids = await getBlockedUsers();
            const entries = await Promise.all(ids.map(async id => {
                try {
                    const snap = await getDoc(doc(db, 'users', id));
                    return { id, name: snap.data()?.displayName || snap.data()?.name || 'Unknown user' };
                } catch {
                    return { id, name: 'Unknown user' };
                }
            }));
            setBlockedList(entries);
        } catch {
            setBlockedList([]);
        }
    };
    useEffect(() => { loadBlocked(); }, []);

    const handleUnblock = (target: { id: string; name: string }) => {
        Alert.alert('Unblock', `Unblock ${target.name}? Their posts and messages will be visible again.`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Unblock',
                onPress: async () => {
                    await unblockUser(target.id);
                    loadBlocked();
                },
            },
        ]);
    };

    // Load settings (Firestore is source of truth; AsyncStorage as fallback/cache)
    useEffect(() => {
        const applyPrefs = (s: any) => {
            setNotifAll(s.all ?? true);
            setNotifLounge(s.lounge ?? true);
            setNotifMarket(s.market ?? true);
            setNotifMessages(s.messages ?? true);
            setNotifLostFound(s.lostfound ?? true);
            setNotifLikes(s.likes ?? true);
            setNotifComments(s.comments ?? true);
        };
        AsyncStorage.getItem('@notif_settings').then(val => {
            if (val) applyPrefs(JSON.parse(val));
        });
        const uid = auth.currentUser?.uid;
        if (uid) {
            getDoc(doc(db, 'users', uid)).then(snap => {
                const prefs = snap.data()?.notifPrefs;
                if (prefs) {
                    applyPrefs(prefs);
                    AsyncStorage.setItem('@notif_settings', JSON.stringify(prefs)).catch(() => {});
                }
            }).catch(() => {});
        }
        // Load bank info
        AsyncStorage.getItem('@bank_info').then(val => {
            if (val) {
                const b = JSON.parse(val);
                setSBankName(b.bankName || '');
                setSBankAccount(b.accountNumber || '');
                setSBankHolder(b.accountHolder || '');
            }
        });
    }, []);

    const save = (key: string, value: boolean, setter: (v: boolean) => void) => {
        setter(value);
        AsyncStorage.getItem('@notif_settings').then(val => {
            const s = val ? JSON.parse(val) : {};
            s[key] = value;
            AsyncStorage.setItem('@notif_settings', JSON.stringify(s));
            // Mirror to Firestore so senders can respect this preference
            const uid = auth.currentUser?.uid;
            if (uid) {
                updateDoc(doc(db, 'users', uid), { [`notifPrefs.${key}`]: value }).catch(() => {});
            }
        });
    };

    const toggleMaster = (val: boolean) => {
        save('all', val, setNotifAll);
        if (!val) {
            save('lounge', false, setNotifLounge);
            save('market', false, setNotifMarket);
            save('messages', false, setNotifMessages);
            save('lostfound', false, setNotifLostFound);
            save('likes', false, setNotifLikes);
            save('comments', false, setNotifComments);
        } else {
            save('lounge', true, setNotifLounge);
            save('market', true, setNotifMarket);
            save('messages', true, setNotifMessages);
            save('lostfound', true, setNotifLostFound);
            save('likes', true, setNotifLikes);
            save('comments', true, setNotifComments);
        }
    };

    const ToggleRow = ({ icon, iconColor, label, desc, value, onToggle, disabled }: any) => (
        <View style={[styles.toggleRow, disabled && { opacity: 0.4 }]}>
            <View style={[styles.toggleIcon, { backgroundColor: iconColor + '18' }]}>
                <Ionicons name={icon} size={18} color={iconColor} />
            </View>
            <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>{label}</Text>
                {desc ? <Text style={styles.toggleDesc}>{desc}</Text> : null}
            </View>
            <Switch
                value={value}
                onValueChange={onToggle}
                disabled={disabled}
                trackColor={{ false: '#E5E7EB', true: '#6366F1' }}
                thumbColor="#fff"
            />
        </View>
    );

    return (
        <View style={styles.container}>
            <View style={[styles.header, isWebDesktop && { paddingTop: 20 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()}><Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} /></TouchableOpacity>
                <Text style={styles.headerTitle}>Settings</Text>
                <View style={{ width: 24 }} />
            </View>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{flex: 1}} keyboardVerticalOffset={90}>
            <ScrollView contentContainerStyle={[{ padding: screenPadding, paddingBottom: 60 }, centerContent()]}>
                {/* Account */}
                <Text style={styles.sectionLabel}>Account</Text>
                <View style={styles.settingCard}>
                    <View style={styles.settingRow}>
                        <Ionicons name="person-outline" size={18} color={theme.colors.textMuted} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.settingLabel}>Display Name</Text>
                            <Text style={styles.settingValue}>{user?.displayName || 'Unknown'}</Text>
                        </View>
                    </View>
                    <View style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: theme.colors.borderLight }]}>
                        <Ionicons name="mail-outline" size={18} color={theme.colors.textMuted} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.settingLabel}>Email</Text>
                            <Text style={styles.settingValue}>{user?.email || 'Not signed in'}</Text>
                        </View>
                    </View>
                </View>

                {/* Notifications */}
                <Text style={styles.sectionLabel}>Notifications</Text>
                <View style={styles.settingCard}>
                    <ToggleRow icon="notifications" iconColor="#6366F1" label="All Notifications" desc="Master toggle for all alerts" value={notifAll} onToggle={toggleMaster} />
                </View>

                <Text style={[styles.sectionLabel, { marginTop: 12 }]}>By Category</Text>
                <View style={styles.settingCard}>
                    <ToggleRow icon="chatbubbles" iconColor="#6366F1" label="Lounge" desc="Posts, replies, mentions" value={notifLounge} onToggle={(v: boolean) => save('lounge', v, setNotifLounge)} disabled={!notifAll} />
                    <ToggleRow icon="storefront" iconColor="#F97316" label="Market" desc="Listings, offers, price changes" value={notifMarket} onToggle={(v: boolean) => save('market', v, setNotifMarket)} disabled={!notifAll} />
                    <ToggleRow icon="chatbubble-ellipses" iconColor="#0EA5E9" label="Messages" desc="Direct messages & chat" value={notifMessages} onToggle={(v: boolean) => save('messages', v, setNotifMessages)} disabled={!notifAll} />
                    <ToggleRow icon="search-circle" iconColor="#059669" label="Lost & Found" desc="Item updates & matches" value={notifLostFound} onToggle={(v: boolean) => save('lostfound', v, setNotifLostFound)} disabled={!notifAll} />
                </View>

                <Text style={[styles.sectionLabel, { marginTop: 12 }]}>Activity</Text>
                <View style={styles.settingCard}>
                    <ToggleRow icon="heart" iconColor="#EF4444" label="Likes" desc="When someone likes your post" value={notifLikes} onToggle={(v: boolean) => save('likes', v, setNotifLikes)} disabled={!notifAll} />
                    <ToggleRow icon="chatbox" iconColor="#2563EB" label="Comments" desc="When someone comments on your post" value={notifComments} onToggle={(v: boolean) => save('comments', v, setNotifComments)} disabled={!notifAll} />
                </View>

                {/* Privacy */}
                <Text style={[styles.sectionLabel, { marginTop: 12 }]}>Privacy</Text>
                <View style={styles.settingCard}>
                    {blockedList.length === 0 ? (
                        <View style={styles.settingRow}>
                            <Ionicons name="shield-checkmark-outline" size={18} color={theme.colors.textMuted} />
                            <View style={{ flex: 1, marginLeft: 12 }}>
                                <Text style={styles.settingLabel}>Blocked Users</Text>
                                <Text style={styles.settingValue}>No blocked users</Text>
                            </View>
                        </View>
                    ) : (
                        blockedList.map((b, i) => (
                            <View
                                key={b.id}
                                style={[styles.settingRow, i > 0 && { borderTopWidth: 1, borderTopColor: theme.colors.borderLight }]}
                            >
                                <Ionicons name="person-remove-outline" size={18} color="#EF4444" />
                                <View style={{ flex: 1, marginLeft: 12 }}>
                                    <Text style={styles.settingLabel}>{b.name}</Text>
                                </View>
                                <TouchableOpacity
                                    style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 9999, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' }}
                                    onPress={() => handleUnblock(b)}
                                >
                                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#EF4444' }}>Unblock</Text>
                                </TouchableOpacity>
                            </View>
                        ))
                    )}
                </View>

                {/* Bank Account */}
                <Text style={[styles.sectionLabel, { marginTop: 12 }]}>Bank Account</Text>
                <View style={styles.settingCard}>
                    <View style={styles.settingRow}>
                        <Ionicons name="business-outline" size={18} color={theme.colors.textMuted} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.settingLabel}>Bank Name</Text>
                            <TextInput style={styles.bankFieldInput} value={sBankName} onChangeText={setSBankName} placeholder="e.g. Shinhan Bank" placeholderTextColor={theme.colors.textMuted} />
                        </View>
                    </View>
                    <View style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: theme.colors.borderLight }]}>
                        <Ionicons name="card-outline" size={18} color={theme.colors.textMuted} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.settingLabel}>Account Number</Text>
                            <TextInput style={styles.bankFieldInput} value={sBankAccount} onChangeText={setSBankAccount} placeholder="e.g. 110-123-456789" placeholderTextColor={theme.colors.textMuted} />
                        </View>
                    </View>
                    <View style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: theme.colors.borderLight }]}>
                        <Ionicons name="person-outline" size={18} color={theme.colors.textMuted} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.settingLabel}>Account Holder</Text>
                            <TextInput style={styles.bankFieldInput} value={sBankHolder} onChangeText={setSBankHolder} placeholder="e.g. Junyoung Yang" placeholderTextColor={theme.colors.textMuted} />
                        </View>
                    </View>
                </View>
                <TouchableOpacity
                    style={styles.bankSaveBtn}
                    onPress={async () => {
                        if (!sBankName.trim() || !sBankAccount.trim() || !sBankHolder.trim()) {
                            Alert.alert('Missing Info', 'Please fill in all bank fields.');
                            return;
                        }
                        await AsyncStorage.setItem('@bank_info', JSON.stringify({ bankName: sBankName.trim(), accountNumber: sBankAccount.trim(), accountHolder: sBankHolder.trim() }));
                        Alert.alert('Saved', 'Bank account info saved successfully.');
                    }}
                >
                    <Ionicons name="save-outline" size={16} color="#fff" />
                    <Text style={styles.bankSaveBtnText}>Save Bank Info</Text>
                </TouchableOpacity>

                {/* App Info */}
                <Text style={[styles.sectionLabel, { marginTop: 12 }]}>About</Text>
                <View style={styles.settingCard}>
                    <View style={styles.settingRow}>
                        <Ionicons name="information-circle-outline" size={18} color={theme.colors.textMuted} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.settingLabel}>App Version</Text>
                            <Text style={styles.settingValue}>{Constants.expoConfig?.version || '1.3.0'}</Text>
                        </View>
                    </View>
                    <View style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: theme.colors.borderLight }]}>
                        <Ionicons name="people-outline" size={18} color={theme.colors.textMuted} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.settingLabel}>Credits</Text>
                            <Text style={styles.settingValue}>Built by Justin & Junyoung</Text>
                        </View>
                    </View>
                </View>

                {/* Danger Zone */}
                <Text style={[styles.sectionLabel, { marginTop: 12, color: '#EF4444' }]}>Danger Zone</Text>
                <TouchableOpacity
                    style={{ backgroundColor: '#FEF2F2', borderRadius: r(16), padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#FECACA' }}
                    onPress={() => {
                        Alert.alert(
                            'Delete Account',
                            'Are you sure you want to delete your account? This action cannot be undone. All your data will be permanently deleted.',
                            [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                    text: 'Delete My Account',
                                    style: 'destructive',
                                    onPress: async () => {
                                        try {
                                            const currentUser = auth.currentUser;
                                            if (!currentUser) return;
                                            await deleteDoc(doc(db, 'users', currentUser.uid));
                                            await deleteUser(currentUser);
                                            Alert.alert('Account Deleted', 'Your account has been permanently deleted.');
                                        } catch (error: any) {
                                            if (error.code === 'auth/requires-recent-login') {
                                                Alert.alert(
                                                    'Re-authentication Required',
                                                    'For security, please sign out and sign back in, then try deleting your account again.',
                                                    [{ text: 'OK', onPress: () => auth.signOut() }]
                                                );
                                            } else {
                                                Alert.alert('Error', 'Failed to delete account. Please try again.');
                                            }
                                        }
                                    },
                                },
                            ]
                        );
                    }}
                >
                    <View style={{ width: 36, height: 36, borderRadius: r(10), backgroundColor: '#FEE2E2', justifyContent: 'center', alignItems: 'center' }}>
                        <Ionicons name="trash-outline" size={18} color="#EF4444" />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 15, fontWeight: '700', color: '#EF4444' }}>Delete Account</Text>
                        <Text style={{ fontSize: 12, color: '#F87171', marginTop: 2 }}>Permanently delete your account and all data</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#EF4444" />
                </TouchableOpacity>
            </ScrollView>
            </KeyboardAvoidingView>
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
    headerTitle: { ...theme.typography.h3, color: theme.colors.textPrimary },
    myPostsTabRow: {
        flexDirection: 'row', gap: 8,
        paddingHorizontal: 16, paddingTop: 12,
    },
    myPostsTab: {
        paddingHorizontal: 14, paddingVertical: 7,
        borderRadius: 9999, backgroundColor: '#F1F5F9',
    },
    myPostsTabActive: { backgroundColor: theme.colors.primary },
    myPostsTabText: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
    myPostsTabTextActive: { color: '#fff' },
    card: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg,
        padding: 14, marginBottom: 10, ...theme.shadows.sm,
    },
    cardTitle: { ...theme.typography.bodyBold, color: theme.colors.textPrimary, marginBottom: 2 },
    cardMeta: { ...theme.typography.caption, color: theme.colors.textMuted },
    empty: { ...theme.typography.body, color: theme.colors.textMuted, textAlign: 'center', marginTop: 60 },
    savedThumb: {
        width: 48, height: 48, borderRadius: r(10),
        backgroundColor: theme.colors.surfaceAlt,
        marginRight: 12, overflow: 'hidden',
        justifyContent: 'center', alignItems: 'center',
    },
    // Saved items grid
    savedCard: {
        flex: 1, backgroundColor: theme.colors.surface, borderRadius: r(14),
        ...theme.shadows.sm,
        borderWidth: 1, borderColor: theme.colors.borderLight,
    },
    savedImage: {
        width: '100%', aspectRatio: 1, resizeMode: 'cover', backgroundColor: theme.colors.surfaceAlt,
        borderTopLeftRadius: r(14) - 1, borderTopRightRadius: r(14) - 1,
    },
    savedImagePlaceholder: { justifyContent: 'center', alignItems: 'center' },
    savedHeartWrap: {
        position: 'absolute', top: 8, right: 8,
        width: 28, height: 28, borderRadius: r(14),
        backgroundColor: 'rgba(255,255,255,0.9)', justifyContent: 'center', alignItems: 'center',
    },
    savedInfo: { padding: 10 },
    savedName: { fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary },
    savedPrice: { fontSize: 13, fontWeight: '800', color: theme.colors.primary, marginTop: 2 },
    savedSeller: { fontSize: 11, color: theme.colors.textMuted, marginTop: 2 },
    // Listing card (rich)
    listingCard: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: theme.colors.surface, borderRadius: r(16),
        padding: 12, marginBottom: 12, ...theme.shadows.sm,
        borderWidth: 1, borderColor: theme.colors.borderLight,
    },
    listingThumb: { width: 64, height: 64, borderRadius: r(12), resizeMode: 'cover', backgroundColor: theme.colors.surfaceAlt },
    listingThumbPlaceholder: { justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border },
    listingInfo: { flex: 1, marginLeft: 12 },
    listingName: { fontSize: 15, fontWeight: '700', color: theme.colors.textPrimary },
    listingPrice: { fontSize: 14, fontWeight: '800', color: theme.colors.primary, marginTop: 2 },
    listingTime: { fontSize: 11, color: theme.colors.textMuted },
    statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: r(6) },
    statusPillText: { fontSize: 10, fontWeight: '700' },
    listingActions: { gap: 6, alignItems: 'center' },
    listingActionBtn: { padding: 6, borderRadius: r(8), backgroundColor: theme.colors.surfaceAlt },
    // Settings
    sectionLabel: { fontSize: 13, fontWeight: '700', color: theme.colors.textMuted, marginBottom: 8, marginTop: 20, textTransform: 'uppercase', letterSpacing: 0.5 },
    settingCard: {
        backgroundColor: theme.colors.surface, borderRadius: r(16),
        ...theme.shadows.sm,
        borderWidth: 1, borderColor: theme.colors.borderLight,
    },
    settingRow: {
        flexDirection: 'row', alignItems: 'center', padding: 16,
    },
    settingLabel: { fontSize: 12, fontWeight: '600', color: theme.colors.textMuted, marginBottom: 2 },
    settingValue: { fontSize: 15, color: theme.colors.textPrimary, fontWeight: '600' },
    toggleRow: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingHorizontal: 16, paddingVertical: 14,
        borderBottomWidth: 1, borderBottomColor: theme.colors.borderLight,
    },
    toggleIcon: { width: 36, height: 36, borderRadius: r(10), justifyContent: 'center', alignItems: 'center' },
    toggleLabel: { fontSize: 15, fontWeight: '600', color: theme.colors.textPrimary },
    toggleDesc: { fontSize: 12, color: theme.colors.textMuted, marginTop: 1 },
    // Karrot-style My Listings
    karrotTabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.colors.borderLight, backgroundColor: theme.colors.surface },
    karrotTab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
    karrotTabActive: { borderBottomWidth: 2, borderBottomColor: theme.colors.primary },
    karrotTabText: { fontSize: 14, fontWeight: '600', color: theme.colors.textMuted },
    karrotTabTextActive: { color: theme.colors.primary },
    karrotCard: { backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.borderLight },
    karrotStatusBar: { paddingHorizontal: 14, paddingVertical: 6 },
    karrotStatusBarText: { fontSize: 12, fontWeight: '700' },
    karrotCardInner: { flexDirection: 'row', alignItems: 'center', padding: 14 },
    karrotThumb: { width: 72, height: 72, borderRadius: r(12), resizeMode: 'cover', backgroundColor: theme.colors.surfaceAlt },
    karrotThumbEmpty: { justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border },
    karrotInfo: { flex: 1, marginLeft: 12 },
    karrotName: { fontSize: 15, fontWeight: '700', color: theme.colors.textPrimary, marginBottom: 4, lineHeight: 20 },
    karrotPrice: { fontSize: 16, fontWeight: '800', color: '#0F172A', marginBottom: 2 },
    karrotMeta: { fontSize: 11, color: theme.colors.textMuted },
    karrotActions: { gap: 8, alignItems: 'center', marginLeft: 8 },
    karrotActionBtn: { padding: 8, borderRadius: r(10), backgroundColor: theme.colors.surfaceAlt },
    bankFieldInput: {
        fontSize: 15, color: theme.colors.textPrimary, fontWeight: '600',
        paddingVertical: 2, marginTop: 2,
    },
    bankSaveBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        backgroundColor: '#0EA5E9', borderRadius: r(14), paddingVertical: 14, marginTop: 12,
    },
    bankSaveBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
