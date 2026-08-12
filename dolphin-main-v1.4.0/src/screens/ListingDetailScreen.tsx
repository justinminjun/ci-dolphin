import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Image, ScrollView, TouchableOpacity, Dimensions, Alert, StatusBar, Platform, Modal, FlatList, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, r } from '../theme/theme';
import { auth, db } from '../config/firebase';
import { doc, getDoc, setDoc, deleteDoc, updateDoc, serverTimestamp, onSnapshot, arrayUnion, arrayRemove, collection, query, where, addDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { formatPrice } from '../utils/price';
import { sendPushToUser } from '../utils/notifications';
import { HyperlinkText } from '../components/HyperlinkText';
import { useGlow } from '../context/GlowContext';
import { useFocusEffect } from '@react-navigation/native';
import { showReportBlockMenu } from '../utils/moderation';

const SW = Dimensions.get('window').width;
const SH = Dimensions.get('window').height;
const SAFE_TOP = Platform.OS === 'ios' ? 60 : (StatusBar.currentHeight || 24) + 10;

function timeAgo(ts: any) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'Just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

export function ListingDetailScreen({ route, navigation }: any) {
    const { listing, openQueue: shouldOpenQueue } = route.params;
    const [imgIdx, setImgIdx] = useState(0);
    const [status, setStatus] = useState<string | null>(listing.status || null);
    const [waitlist, setWaitlist] = useState<any[]>(listing.waitlist || []);
    const [loading, setLoading] = useState(false);
    const [showPhoto, setShowPhoto] = useState(false);
    const [photoIdx, setPhotoIdx] = useState(0);
    const [showStatusPicker, setShowStatusPicker] = useState(false);
    const [showOwnerMenu, setShowOwnerMenu] = useState(false);
    const [showQueue, setShowQueue] = useState(!!shouldOpenQueue);
    const [showChats, setShowChats] = useState(false);
    const [chats, setChats] = useState<any[]>([]);
    const [showPassConfirm, setShowPassConfirm] = useState<any>(null);
    const [showConfirmBuyer, setShowConfirmBuyer] = useState<any>(null);
    const [showConfirmSuccess, setShowConfirmSuccess] = useState<any>(null);
    const [showCancelConfirm, setShowCancelConfirm] = useState(false);
    const [showReserveModal, setShowReserveModal] = useState(false);
    const [showUnreserveModal, setShowUnreserveModal] = useState(false);
    const [selectedReserveUser, setSelectedReserveUser] = useState<string | null>(null);
    const [showSoldModal, setShowSoldModal] = useState(false);
    const [selectedSoldBuyer, setSelectedSoldBuyer] = useState<string | null>(null);
    const [isSaved, setIsSaved] = useState(false);

    const user = auth.currentUser;
    const isOwner = user?.uid === listing.sellerId;
    const isBuying = listing.listingType === 'buying';
    const isSold = status === 'sold';
    const photos: string[] = listing.photos || [];
    const confirmedList = waitlist.filter(e => e.status === 'confirmed');
    const activeList = waitlist.filter(e => e.status === 'active');
    const queueList = [...confirmedList, ...activeList]; // confirmed first, then active
    const myEntry = waitlist.find(e => e.userId === user?.uid);
    const myPos = myEntry ? queueList.indexOf(myEntry) + 1 : null;

    const { setGlowColor, glowColor: currentGlow } = useGlow();
    const prevGlowRef = useRef(currentGlow);
    useFocusEffect(
        useCallback(() => {
            prevGlowRef.current = currentGlow;
            setGlowColor('#F97316'); // market orange
            return () => setGlowColor(prevGlowRef.current);
        }, [])
    );

    useEffect(() => {
        return onSnapshot(doc(db, 'market_listings', listing.id), snap => {
            if (snap.exists()) { setWaitlist(snap.data().waitlist || []); setStatus(snap.data().status || null); }
        });
    }, [listing.id]);

    // Check if listing is saved
    useEffect(() => {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        getDoc(doc(db, 'users', uid, 'saved_items', listing.id)).then(snap => {
            if (snap.exists()) setIsSaved(true);
        }).catch(() => {});
    }, []);

    // Load seller's chats for this listing
    useEffect(() => {
        if (!isOwner) return;
        const q = query(collection(db, 'dolphin_chats'), where('listingId', '==', listing.id));
        return onSnapshot(q, snap => setChats(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    }, [isOwner, listing.id]);

    const doUpdateStatus = async (s: string | null) => {
        // Intercept: reserved → show modal
        if (s === 'reserved' && status !== 'reserved') {
            setShowStatusPicker(false);
            setSelectedReserveUser(null);
            setShowReserveModal(true);
            return;
        }
        // Intercept: unreserve (back to on sale) → show confirmation
        if (s === null && status === 'reserved') {
            setShowStatusPicker(false);
            setShowUnreserveModal(true);
            return;
        }
        // Intercept: sold → show sold confirmation modal
        if (s === 'sold') {
            setShowStatusPicker(false);
            setSelectedSoldBuyer(null);
            setShowSoldModal(true);
            return;
        }

        try {
            const updates: any = { status: s };
            if (s === null) {
                updates.confirmedBuyerId = null;
                updates.confirmedBuyerName = null;
            }
            await updateDoc(doc(db, 'market_listings', listing.id), updates);
            setStatus(s);
        } catch { Alert.alert('Error', 'Failed to update.'); }
        setShowStatusPicker(false);
    };

    // Execute sold after confirmation modal
    const executeSold = async (buyerUserId: string | null, buyerUserName: string | null) => {
        setShowSoldModal(false);
        setLoading(true);
        try {
            const snap = await getDoc(doc(db, 'market_listings', listing.id));
            const currentWaitlist: any[] = snap.data()?.waitlist || [];

            const updates: any = {
                status: 'sold',
                waitlist: [],
                soldAt: serverTimestamp(),
                confirmedBuyerId: buyerUserId,
                confirmedBuyerName: buyerUserName,
            };

            await updateDoc(doc(db, 'market_listings', listing.id), updates);
            setStatus('sold');

            // Notify the buyer (if selected)
            if (buyerUserId) {
                await sendPushToUser(buyerUserId, '✅ Sale Complete!',
                    `"${listing.name}" has been marked as sold to you!`,
                    { listingId: listing.id });
                await addDoc(collection(db, 'dolphin_notifications'), {
                    recipientId: buyerUserId, type: 'queue',
                    title: '✅ Sale Complete!',
                    body: `"${listing.name}" has been marked as sold to you. Enjoy!`,
                    listingId: listing.id, read: false, createdAt: serverTimestamp(),
                });
            }

            // Notify all OTHER active waitlist members that item is sold
            const activeWaiters = currentWaitlist.filter(e =>
                e.status === 'active' && e.userId !== buyerUserId
            );
            for (const entry of activeWaiters) {
                await sendPushToUser(entry.userId, '😔 Item Sold',
                    `"${listing.name}" has been sold to another buyer.`,
                    { listingId: listing.id });
                await addDoc(collection(db, 'dolphin_notifications'), {
                    recipientId: entry.userId, type: 'queue',
                    title: '😔 Item Sold',
                    body: `"${listing.name}" has been sold to another buyer.`,
                    listingId: listing.id, read: false, createdAt: serverTimestamp(),
                });
            }
        } catch { Alert.alert('Error', 'Failed to mark as sold.'); }
        setLoading(false);
    };

    const handleRequestToBuy = async () => {
        if (!user) { Alert.alert('Sign In Required'); return; }
        if (isOwner) { Alert.alert('Cannot request your own listing.'); return; }
        if (isSold) { Alert.alert('Already Sold'); return; }
        if (myEntry && myEntry.status === 'active') {
            setShowCancelConfirm(true);
            return;
        }
        if (myEntry && myEntry.status === 'confirmed') {
            Alert.alert('Already Confirmed', 'You have already been confirmed as the buyer.');
            return;
        }
        if (myEntry && myEntry.status === 'passed') {
            Alert.alert('Passed', 'The seller has passed on your request.');
            return;
        }
        setLoading(true);
        try {
            // Fetch current waitlist and check for duplicates
            const snap = await getDoc(doc(db, 'market_listings', listing.id));
            const currentWaitlist: any[] = snap.data()?.waitlist || [];
            const alreadyInList = currentWaitlist.some(e => e.userId === user.uid);
            if (alreadyInList) {
                Alert.alert('Already Requested', 'You are already in the queue for this item.');
                setLoading(false);
                return;
            }
            const e = { userId: user.uid, userName: user.displayName || 'Anonymous', userPhoto: user.photoURL || null, requestedAt: new Date().toISOString(), status: 'active' };
            await updateDoc(doc(db, 'market_listings', listing.id), { waitlist: [...currentWaitlist, e] });
            // Push + in-app notification to seller
            await sendPushToUser(listing.sellerId, '\ud83d\uded2 New Request', `${user.displayName} wants to buy "${listing.name}"`, { listingId: listing.id });
            await addDoc(collection(db, 'dolphin_notifications'), {
                recipientId: listing.sellerId, type: 'queue',
                title: '\ud83d\uded2 New Purchase Request',
                body: `${user.displayName} wants to buy "${listing.name}"`,
                listingId: listing.id, read: false, createdAt: serverTimestamp(),
            });
        } catch { Alert.alert('Error', 'Failed to submit.'); }
        setLoading(false);
    };

    const handlePassConfirmed = async (entry: any) => {
        setShowPassConfirm(null);
        setLoading(true);
        try {
            const snap = await getDoc(doc(db, 'market_listings', listing.id));
            const cur: any[] = snap.data()?.waitlist || [];
            const updated = cur.map(e => e.userId === entry.userId ? { ...e, status: 'passed' } : e);
            await updateDoc(doc(db, 'market_listings', listing.id), { waitlist: updated });

            // Notify passed buyer
            await sendPushToUser(entry.userId, '😔 Passed', `The seller moved to the next buyer for "${listing.name}"`, { listingId: listing.id });
            await addDoc(collection(db, 'dolphin_notifications'), {
                recipientId: entry.userId, type: 'queue',
                title: '😔 Passed by Seller',
                body: `The seller moved to the next buyer for "${listing.name}"`,
                listingId: listing.id, read: false, createdAt: serverTimestamp(),
            });

            // Notify new #1
            const next = updated.find(e => e.status === 'active');
            if (next) {
                await sendPushToUser(next.userId, '🎉 You\'re #1!', `You're first in line for "${listing.name}"`, { listingId: listing.id });
                await addDoc(collection(db, 'dolphin_notifications'), {
                    recipientId: next.userId, type: 'queue',
                    title: '🎉 You\'re #1 in Queue!',
                    body: `You're first in line for "${listing.name}"`,
                    listingId: listing.id, read: false, createdAt: serverTimestamp(),
                });
            }
        } catch {}
        setLoading(false);
    };

    const handleConfirmBuyerExecute = async (entry: any) => {
        setShowConfirmBuyer(null);
        setLoading(true);
        try {
            const snap = await getDoc(doc(db, 'market_listings', listing.id));
            const cur: any[] = snap.data()?.waitlist || [];
            const updated = cur.map(e => e.userId === entry.userId ? { ...e, status: 'confirmed' } : e);
            await updateDoc(doc(db, 'market_listings', listing.id), {
                waitlist: updated,
                status: 'reserved',
                confirmedBuyerId: entry.userId,
                confirmedBuyerName: entry.userName,
            });

            // Notify confirmed buyer
            await sendPushToUser(entry.userId, '🎉 You\'ve been selected!', `The seller confirmed you as the buyer for "${listing.name}"!`, { listingId: listing.id });
            await addDoc(collection(db, 'dolphin_notifications'), {
                recipientId: entry.userId, type: 'queue',
                title: '🎉 Buyer Confirmed!',
                body: `You\'ve been selected as the buyer for "${listing.name}"! Chat with the seller to schedule.`,
                listingId: listing.id, read: false, createdAt: serverTimestamp(),
            });

            setShowConfirmSuccess(entry);
        } catch {}
        setLoading(false);
    };

    const handleChatWith = async (entry: any) => {
        if (!user) return;
        try {
            const chatId = [user.uid, entry.userId].sort().join('_') + '_' + listing.id;
            const ref = doc(db, 'dolphin_chats', chatId);
            const snap = await getDoc(ref);
            if (!snap.exists()) await setDoc(ref, { participants: [user.uid, entry.userId], participantNames: { [user.uid]: user.displayName || 'Seller', [entry.userId]: entry.userName }, listingId: listing.id, listingName: listing.name, listingPhoto: photos[0] || null, listingPrice: listing.price, listingCurrency: listing.currency, postType: 'market', chatSource: 'market', lastMessage: '', updatedAt: serverTimestamp(), createdAt: serverTimestamp() });
            navigation.navigate('ChatRoom', { chatId, otherUserId: entry.userId, otherUserName: entry.userName, listingName: listing.name, listingId: listing.id, listingPhoto: photos[0] || null, listingPrice: listing.price, listingCurrency: listing.currency, chatSource: 'market' });
            setShowQueue(false);
        } catch { Alert.alert('Error'); }
    };

    const handleDelete = () => Alert.alert('Delete', 'Delete this listing?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { try { await deleteDoc(doc(db, 'market_listings', listing.id)); navigation.goBack(); } catch {} } }]);

    const handleBump = async () => {
        setShowOwnerMenu(false);
        try {
            const snap = await getDoc(doc(db, 'market_listings', listing.id));
            const data = snap.data() || {};
            const lastBump = data.lastBumpAt?.toDate?.() || (data.lastBumpAt ? new Date(data.lastBumpAt) : null);
            const bumpCount = data.bumpCount || 0;
            const now = Date.now();

            // Reset cycle: if last bump was 3+ days ago, reset count to 0
            let effectiveCount = bumpCount;
            if (lastBump && now - lastBump.getTime() > 3 * 24 * 60 * 60 * 1000) {
                effectiveCount = 0;
            }

            // Progressive cooldown: 24h → 36h → 48h
            const cooldowns = [24, 36, 48];
            const cooldownHours = cooldowns[Math.min(effectiveCount, cooldowns.length - 1)];
            const cooldownMs = cooldownHours * 60 * 60 * 1000;

            if (lastBump && now - lastBump.getTime() < cooldownMs) {
                const remaining = cooldownMs - (now - lastBump.getTime());
                const hrs = Math.floor(remaining / (60 * 60 * 1000));
                const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
                Alert.alert('Cooldown Active', `You can bump again in ${hrs}h ${mins}m.\nNext cooldown: ${cooldowns[Math.min(effectiveCount + 1, cooldowns.length - 1)]}h`);
                return;
            }

            await updateDoc(doc(db, 'market_listings', listing.id), {
                createdAt: serverTimestamp(),
                lastBumpAt: serverTimestamp(),
                bumpCount: effectiveCount + 1,
            });
            Alert.alert('Bumped!', 'Your listing has been moved to the top of the feed.');
        } catch { Alert.alert('Error', 'Failed to bump listing.'); }
    };

    const statusLabel = isBuying ? 'Looking to Buy' : (status === 'sold' ? 'Sold' : status === 'reserved' ? 'Reserved' : 'On Sale');
    const statusColor = isBuying ? '#6366F1' : (status === 'sold' ? '#DC2626' : status === 'reserved' ? '#D97706' : '#059669');
    const statusBg = isBuying ? '#EEF2FF' : (status === 'sold' ? '#FEE2E2' : status === 'reserved' ? '#FEF3C7' : '#D1FAE5');

    return (
        <View style={s.root}>
            {/* Floating header */}
            <View style={s.floatHead}>
                <TouchableOpacity style={s.circleBtn} onPress={() => navigation.goBack()}>
                    <Ionicons name="chevron-back" size={22} color="#fff" />
                </TouchableOpacity>
                {isOwner ? (
                    <TouchableOpacity style={s.circleBtn} onPress={() => setShowOwnerMenu(true)}>
                        <Ionicons name="ellipsis-horizontal" size={20} color="#fff" />
                    </TouchableOpacity>
                ) : (
                    <TouchableOpacity style={s.circleBtn} onPress={() => showReportBlockMenu({
                        targetUserId: listing.sellerId,
                        targetUserName: listing.sellerName || 'Unknown',
                        contentType: 'listing',
                        contentId: listing.id,
                        onBlocked: () => navigation.goBack(),
                    })}>
                        <Ionicons name="ellipsis-horizontal" size={20} color="#fff" />
                    </TouchableOpacity>
                )}
                <TouchableOpacity style={s.circleBtn} onPress={async () => {
                    const uid = auth.currentUser?.uid;
                    if (!uid) return;
                    const savedRef = doc(db, 'users', uid, 'saved_items', listing.id);
                    if (isSaved) {
                        setIsSaved(false);
                        try { await deleteDoc(savedRef); } catch { }
                    } else {
                        setIsSaved(true);
                        try {
                            await setDoc(savedRef, {
                                type: 'listing',
                                title: listing.name || listing.title || '',
                                body: listing.description || '',
                                authorName: listing.sellerName || '',
                                imageUrl: photos[0] || null,
                                price: listing.price || 0,
                                savedAt: serverTimestamp(),
                            });
                        } catch { }
                    }
                }}>
                    <Ionicons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={20} color={isSaved ? '#F59E0B' : '#fff'} />
                </TouchableOpacity>
            </View>

            <ScrollView bounces={true} showsVerticalScrollIndicator={false}>
                {/* Images */}
                <View style={{ width: SW, height: SW, backgroundColor: '#F1F5F9' }}>
                    {photos.length > 0 ? (
                        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
                            onMomentumScrollEnd={e => setImgIdx(Math.round(e.nativeEvent.contentOffset.x / SW))}>
                            {photos.map((uri, i) => (
                                <TouchableOpacity key={i} activeOpacity={0.95} onPress={() => { setPhotoIdx(i); setShowPhoto(true); }}>
                                    <Image source={{ uri }} style={{ width: SW, height: SW, resizeMode: 'cover' }} />
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    ) : (
                        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                            <Ionicons name="cube-outline" size={64} color={theme.colors.textMuted} />
                        </View>
                    )}
                    {/* Status badge — bottom LEFT */}
                    {isOwner && !isBuying ? (
                        <TouchableOpacity style={[s.statusBadge, { backgroundColor: statusBg }]} onPress={() => setShowStatusPicker(true)}>
                            <Text style={[s.statusBadgeText, { color: statusColor }]}>{statusLabel}</Text>
                            <Ionicons name="chevron-down" size={12} color={statusColor} />
                        </TouchableOpacity>
                    ) : (
                        <View style={[s.statusBadge, { backgroundColor: statusBg }]}>
                            <Text style={[s.statusBadgeText, { color: statusColor }]}>{statusLabel}</Text>
                        </View>
                    )}
                    {/* Image counter */}
                    {photos.length > 1 && (
                        <View style={s.imgCounter}>
                            <Text style={s.imgCounterTxt}>{imgIdx + 1}/{photos.length}</Text>
                        </View>
                    )}
                    {/* Queue badge — bottom RIGHT */}
                    {!isBuying && (
                        <TouchableOpacity style={s.queueBadgeBtn} onPress={() => setShowQueue(true)}>
                            <Ionicons name="people" size={13} color="#0EA5E9" />
                            <Text style={s.queueBadgeTxt}>Queue {queueList.length > 0 ? `(${queueList.length})` : ''}</Text>
                        </TouchableOpacity>
                    )}
                </View>

                {/* Seller profile — right below image */}
                <View style={s.sellerRow}>
                    {listing.sellerPhoto
                        ? <Image source={{ uri: listing.sellerPhoto }} style={s.avatar} />
                        : <View style={[s.avatar, { backgroundColor: '#E2E8F0', justifyContent: 'center', alignItems: 'center' }]}><Ionicons name="person" size={22} color="#94A3B8" /></View>}
                    <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={s.sellerName}>{listing.sellerName}</Text>
                        <Text style={s.sellerSub}>Verified Dolphin</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        {!isOwner && (
                            <TouchableOpacity style={s.chatSellerBtn} onPress={async () => {
                                if (!user) return;
                                const chatId = [user.uid, listing.sellerId].sort().join('_') + '_' + listing.id;
                                // Ensure chat doc exists with participants
                                const chatRef = doc(db, 'dolphin_chats', chatId);
                                const chatSnap = await getDoc(chatRef);
                                if (!chatSnap.exists()) {
                                    await setDoc(chatRef, {
                                        participants: [user.uid, listing.sellerId],
                                        participantNames: {
                                            [user.uid]: user.displayName || 'Buyer',
                                            [listing.sellerId]: listing.sellerName || 'Seller',
                                        },
                                        listingId: listing.id,
                                        listingName: listing.name,
                                        listingPhoto: photos[0] || null,
                                        listingPrice: listing.price,
                                        listingCurrency: listing.currency,
                                        chatSource: 'market',
                                        postType: 'market',
                                        lastMessage: '',
                                        updatedAt: serverTimestamp(),
                                        createdAt: serverTimestamp(),
                                    });
                                }
                                navigation.navigate('ChatRoom', {
                                    chatId, otherUserId: listing.sellerId, otherUserName: listing.sellerName,
                                    listingId: listing.id, listingName: listing.name, chatSource: 'market',
                                    listingPhoto: photos[0] || '', listingPrice: listing.price, listingCurrency: listing.currency,
                                });
                            }}>
                                <Ionicons name="chatbubble" size={14} color="#fff" />
                                <Text style={s.chatSellerBtnText}>Chat</Text>
                            </TouchableOpacity>
                        )}
                        <Text style={s.timeAgo}>{timeAgo(listing.createdAt)}</Text>
                    </View>
                </View>

                <View style={s.divider} />

                {/* Title & Price */}
                <View style={s.infoSection}>
                    <Text style={s.title}>{listing.name}</Text>
                    <Text style={s.price}>{formatPrice(listing.price, listing.currency)}</Text>
                </View>

                <View style={s.divider} />

                {/* Description */}
                <View style={s.descSection}>
                    <HyperlinkText text={listing.description} style={s.descText} />
                </View>

                <View style={{ height: 120 }} />
            </ScrollView>

            {/* Bottom bar */}
            <View style={s.bottomBar}>
                {isOwner ? (
                    <TouchableOpacity style={s.viewChatsBtn} onPress={() => setShowChats(true)}>
                        <Ionicons name="chatbubbles" size={18} color="#fff" />
                        <Text style={s.viewChatsBtnText}>View Chats for This Listing</Text>
                    </TouchableOpacity>
                ) : loading ? (
                    <ActivityIndicator color={theme.colors.primary} style={{ flex: 1 }} />
                ) : isBuying ? null : (
                    <TouchableOpacity
                        style={[s.buyBtn, (myEntry?.status === 'active' && !isSold) && { backgroundColor: '#EF4444' }, isSold && { backgroundColor: '#94A3B8' }]}
                        onPress={handleRequestToBuy}
                        disabled={isSold || myEntry?.status === 'passed'}
                        activeOpacity={0.8}
                    >
                        <Text style={s.buyBtnText}>
                            {isSold ? 'Sold Out'
                                : myEntry?.status === 'passed' ? 'Passed'
                                : (myEntry?.status === 'active') ? `#${myPos} in Queue · Cancel`
                                : '🛒  Request to Buy'}
                        </Text>
                    </TouchableOpacity>
                )}
            </View>

            {/* ── Fullscreen Photo Viewer ── */}
            <Modal visible={showPhoto} transparent animationType="fade" onRequestClose={() => setShowPhoto(false)}>
                <View style={{ flex: 1, backgroundColor: '#000' }}>
                    <TouchableOpacity style={s.photoClose} onPress={() => setShowPhoto(false)}>
                        <Ionicons name="close" size={28} color="#fff" />
                    </TouchableOpacity>
                    <FlatList
                        data={photos}
                        horizontal pagingEnabled
                        initialScrollIndex={photoIdx}
                        getItemLayout={(_, i) => ({ length: SW, offset: SW * i, index: i })}
                        showsHorizontalScrollIndicator={false}
                        keyExtractor={(_, i) => String(i)}
                        renderItem={({ item }) => (
                            <Image source={{ uri: item }} style={{ width: SW, height: SH, resizeMode: 'contain' }} />
                        )}
                    />
                </View>
            </Modal>

            {/* ── Status Picker Modal ── */}
            <Modal visible={showStatusPicker} transparent animationType="fade" onRequestClose={() => setShowStatusPicker(false)}>
                <View style={s.modalOverlay}>
                    <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setShowStatusPicker(false)} />
                    <View style={s.sheetContainer}>
                        <View style={s.sheetHandle} />
                        <Text style={s.sheetTitle}>Change Status</Text>
                        {[{ key: null, label: 'On Sale', color: '#059669', bg: '#D1FAE5' }, { key: 'reserved', label: 'Reserved', color: '#D97706', bg: '#FEF3C7' }, { key: 'sold', label: 'Sold', color: '#DC2626', bg: '#FEE2E2' }].map(opt => (
                            <TouchableOpacity key={String(opt.key)} style={[s.sheetOption, { backgroundColor: opt.bg }, status === opt.key && { borderWidth: 2, borderColor: opt.color }]} onPress={() => doUpdateStatus(opt.key)}>
                                <Text style={[s.sheetOptionText, { color: opt.color }]}>{opt.label}</Text>
                                {status === opt.key && <Ionicons name="checkmark" size={18} color={opt.color} />}
                            </TouchableOpacity>
                        ))}
                        <TouchableOpacity style={s.sheetCancel} onPress={() => setShowStatusPicker(false)}>
                            <Text style={s.sheetCancelText}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* ── Reserve: Who are you reserving for? ── */}
            <Modal visible={showReserveModal} transparent animationType="fade" onRequestClose={() => setShowReserveModal(false)}>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 }}>
                    <View style={{ backgroundColor: '#fff', borderRadius: r(20), padding: 20, maxHeight: '60%' }}>
                        <TouchableOpacity onPress={() => setShowReserveModal(false)} style={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}>
                            <Ionicons name="close" size={22} color="#94A3B8" />
                        </TouchableOpacity>
                        <Text style={{ fontSize: 18, fontWeight: '800', color: '#0F172A', marginBottom: 4 }}>Reserve Item</Text>
                        <Text style={{ fontSize: 13, color: '#64748B', marginBottom: 16 }}>Who are you reserving this for?</Text>

                        {activeList.length === 0 ? (
                            <Text style={{ textAlign: 'center', color: '#94A3B8', paddingVertical: 16 }}>No one in the waitlist</Text>
                        ) : (
                            <ScrollView showsVerticalScrollIndicator={false}>
                                {activeList.map((entry: any, idx: number) => {
                                    const isSelected = selectedReserveUser === entry.userId;
                                    return (
                                        <TouchableOpacity key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: r(12), backgroundColor: isSelected ? '#FFFBEB' : '#F8FAFC', marginBottom: 8, borderWidth: 1.5, borderColor: isSelected ? '#D97706' : '#E2E8F0' }}
                                            onPress={() => setSelectedReserveUser(isSelected ? null : entry.userId)}>
                                            <View style={{ width: 36, height: 36, borderRadius: r(18), backgroundColor: isSelected ? '#D97706' : '#94A3B8', justifyContent: 'center', alignItems: 'center' }}>
                                                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{entry.userName?.[0]?.toUpperCase() || '?'}</Text>
                                            </View>
                                            <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: '#0F172A' }}>{entry.userName}</Text>
                                            <Ionicons name={isSelected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={isSelected ? '#D97706' : '#CBD5E1'} />
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>
                        )}

                        <TouchableOpacity style={{ marginTop: 12, backgroundColor: selectedReserveUser ? '#D97706' : '#CBD5E1', paddingVertical: 12, borderRadius: r(12), alignItems: 'center' }}
                            disabled={!selectedReserveUser}
                            onPress={async () => {
                                const entry = activeList.find((e: any) => e.userId === selectedReserveUser);
                                try {
                                    await updateDoc(doc(db, 'market_listings', listing.id), {
                                        status: 'reserved',
                                        confirmedBuyerId: entry?.userId || null,
                                        confirmedBuyerName: entry?.userName || null,
                                    });
                                    setStatus('reserved');
                                } catch {}
                                setShowReserveModal(false);
                                setSelectedReserveUser(null);
                            }}>
                            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{selectedReserveUser ? 'Confirm Reservation' : 'Select someone above'}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={{ marginTop: 8, paddingVertical: 10, alignItems: 'center' }}
                            onPress={async () => {
                                try {
                                    await updateDoc(doc(db, 'market_listings', listing.id), {
                                        status: 'reserved', confirmedBuyerId: null, confirmedBuyerName: null,
                                    });
                                    setStatus('reserved');
                                } catch {}
                                setShowReserveModal(false);
                                setSelectedReserveUser(null);
                            }}>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: '#94A3B8' }}>Reserve without selecting anyone</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* ── Unreserve Confirmation ── */}
            <Modal visible={showUnreserveModal} transparent animationType="fade" onRequestClose={() => setShowUnreserveModal(false)}>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 }}>
                    <View style={{ backgroundColor: '#fff', borderRadius: r(20), padding: 24 }}>
                        <Text style={{ fontSize: 18, fontWeight: '800', color: '#0F172A', marginBottom: 8 }}>Back to On Sale?</Text>
                        <Text style={{ fontSize: 14, color: '#475569', lineHeight: 22, marginBottom: 20 }}>Have you discussed this with the person you reserved the item for? The reservation will be removed and the item will be listed as available again.</Text>
                        <TouchableOpacity style={{ backgroundColor: '#059669', paddingVertical: 12, borderRadius: r(12), alignItems: 'center', marginBottom: 8 }}
                            onPress={async () => {
                                try {
                                    await updateDoc(doc(db, 'market_listings', listing.id), {
                                        status: null, confirmedBuyerId: null, confirmedBuyerName: null,
                                    });
                                    setStatus(null);
                                } catch {}
                                setShowUnreserveModal(false);
                            }}>
                            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Yes, put back On Sale</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={{ paddingVertical: 10, alignItems: 'center' }} onPress={() => setShowUnreserveModal(false)}>
                            <Text style={{ fontSize: 14, fontWeight: '600', color: '#94A3B8' }}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* ── Sold Confirmation Modal ── */}
            <Modal visible={showSoldModal} transparent animationType="fade" onRequestClose={() => setShowSoldModal(false)}>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 }}>
                    <View style={{ backgroundColor: '#fff', borderRadius: r(20), padding: 20, maxHeight: '70%' }}>
                        <TouchableOpacity onPress={() => setShowSoldModal(false)} style={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}>
                            <Ionicons name="close" size={22} color="#94A3B8" />
                        </TouchableOpacity>

                        {/* Header icon */}
                        <View style={{ alignItems: 'center', marginBottom: 12 }}>
                            <View style={{ width: 52, height: 52, borderRadius: r(26), backgroundColor: '#FEE2E2', justifyContent: 'center', alignItems: 'center' }}>
                                <Ionicons name="checkmark-done-circle" size={28} color="#DC2626" />
                            </View>
                        </View>

                        <Text style={{ fontSize: 18, fontWeight: '800', color: '#0F172A', textAlign: 'center', marginBottom: 4 }}>
                            Mark as Sold?
                        </Text>

                        {activeList.length > 0 ? (
                            <>
                                <Text style={{ fontSize: 13, color: '#64748B', textAlign: 'center', marginBottom: 6 }}>
                                    {activeList.length} {activeList.length === 1 ? 'person is' : 'people are'} waiting in the queue.{'\n'}Who did you sell it to?
                                </Text>
                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 14, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#FFF7ED', borderRadius: r(8) }}>
                                    <Ionicons name="notifications" size={12} color="#F97316" />
                                    <Text style={{ fontSize: 11, color: '#F97316', fontWeight: '600' }}>All other waiters will be notified that this item is sold</Text>
                                </View>

                                <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 240 }}>
                                    {activeList.map((entry: any, idx: number) => {
                                        const isSelected = selectedSoldBuyer === entry.userId;
                                        return (
                                            <TouchableOpacity key={idx} style={{
                                                flexDirection: 'row', alignItems: 'center', gap: 10,
                                                padding: 12, borderRadius: r(12), marginBottom: 8,
                                                backgroundColor: isSelected ? '#FEF2F2' : '#F8FAFC',
                                                borderWidth: 1.5, borderColor: isSelected ? '#DC2626' : '#E2E8F0',
                                            }} onPress={() => setSelectedSoldBuyer(isSelected ? null : entry.userId)}>
                                                <View style={{
                                                    width: 36, height: 36, borderRadius: r(18),
                                                    backgroundColor: isSelected ? '#DC2626' : '#94A3B8',
                                                    justifyContent: 'center', alignItems: 'center',
                                                }}>
                                                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>
                                                        {entry.userName?.[0]?.toUpperCase() || '?'}
                                                    </Text>
                                                </View>
                                                <View style={{ flex: 1 }}>
                                                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#0F172A' }}>{entry.userName}</Text>
                                                    <Text style={{ fontSize: 11, color: '#94A3B8' }}>#{idx + 1} in queue</Text>
                                                </View>
                                                <Ionicons name={isSelected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={isSelected ? '#DC2626' : '#CBD5E1'} />
                                            </TouchableOpacity>
                                        );
                                    })}
                                </ScrollView>

                                {/* Confirm button */}
                                <TouchableOpacity style={{
                                    marginTop: 12, paddingVertical: 13, borderRadius: r(12), alignItems: 'center',
                                    backgroundColor: selectedSoldBuyer ? '#DC2626' : '#CBD5E1',
                                }} disabled={!selectedSoldBuyer} onPress={() => {
                                    const entry = activeList.find((e: any) => e.userId === selectedSoldBuyer);
                                    executeSold(entry?.userId || null, entry?.userName || null);
                                }}>
                                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>
                                        {selectedSoldBuyer ? 'Confirm Sale' : 'Select the buyer above'}
                                    </Text>
                                </TouchableOpacity>

                                {/* Sold to someone outside queue */}
                                <TouchableOpacity style={{ marginTop: 8, paddingVertical: 10, alignItems: 'center' }}
                                    onPress={() => executeSold(null, null)}>
                                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#94A3B8' }}>
                                        Sold to someone outside the queue
                                    </Text>
                                </TouchableOpacity>
                            </>
                        ) : (
                            <>
                                <Text style={{ fontSize: 14, color: '#475569', textAlign: 'center', lineHeight: 22, marginBottom: 12 }}>
                                    Are you sure you want to mark this item as sold?{'\n'}This action cannot be undone.
                                </Text>

                                <TouchableOpacity style={{
                                    backgroundColor: '#DC2626', paddingVertical: 13, borderRadius: r(12), alignItems: 'center', marginBottom: 8,
                                }} onPress={() => executeSold(null, null)}>
                                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Yes, Mark as Sold</Text>
                                </TouchableOpacity>

                                <TouchableOpacity style={{ paddingVertical: 10, alignItems: 'center' }}
                                    onPress={() => setShowSoldModal(false)}>
                                    <Text style={{ fontSize: 14, fontWeight: '600', color: '#94A3B8' }}>Cancel</Text>
                                </TouchableOpacity>
                            </>
                        )}
                    </View>
                </View>
            </Modal>

            {/* ── Owner Menu Modal ── */}
            <Modal visible={showOwnerMenu} transparent animationType="fade" onRequestClose={() => setShowOwnerMenu(false)}>
                <View style={s.modalOverlay}>
                    <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setShowOwnerMenu(false)} />
                    <View style={s.sheetContainer}>
                        <View style={s.sheetHandle} />
                        <Text style={s.sheetTitle}>Manage Listing</Text>
                        {[
                            { label: 'Edit Listing', icon: 'pencil', color: theme.colors.textPrimary, onPress: () => { setShowOwnerMenu(false); navigation.navigate('CreateListing', { mode: 'single', editListing: listing }); } },
                            { label: 'Bump to Top', icon: 'arrow-up-circle', color: '#0EA5E9', onPress: handleBump },
                            { label: 'Delete Listing', icon: 'trash', color: '#DC2626', onPress: () => { setShowOwnerMenu(false); handleDelete(); } },
                        ].map(opt => (
                            <TouchableOpacity key={opt.label} style={s.menuOption} onPress={opt.onPress}>
                                <Ionicons name={opt.icon as any} size={20} color={opt.color} />
                                <Text style={[s.menuOptionText, { color: opt.color }]}>{opt.label}</Text>
                            </TouchableOpacity>
                        ))}
                        <TouchableOpacity style={s.sheetCancel} onPress={() => setShowOwnerMenu(false)}>
                            <Text style={s.sheetCancelText}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* ── Purchase Queue Modal ── */}
            <Modal visible={showQueue} transparent animationType="fade" onRequestClose={() => setShowQueue(false)}>
                <View style={s.modalOverlay}>
                    <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setShowQueue(false)} />
                    <View style={[s.sheetContainer, { maxHeight: SH * 0.7 }]}>
                        <View style={s.sheetHandle} />
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <Text style={s.sheetTitle}>Purchase Queue</Text>
                            <View style={{ backgroundColor: '#0EA5E9', borderRadius: r(10), paddingHorizontal: 8, paddingVertical: 2 }}>
                                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{queueList.length}</Text>
                            </View>
                        </View>
                        {queueList.length === 0 ? (
                            <Text style={{ textAlign: 'center', color: theme.colors.textMuted, paddingVertical: 24 }}>No requests yet 🙋</Text>
                        ) : (
                            <ScrollView showsVerticalScrollIndicator={false}>
                                {queueList.map((entry, idx) => {
                                    const icons = ['🥇', '🥈', '🥉'];
                                    const isFirst = idx === 0;
                                    const isMe = entry.userId === user?.uid;
                                    const isConfirmed = entry.status === 'confirmed';
                                    return (
                                        <View key={entry.userId} style={[s.queueRow, isConfirmed && { backgroundColor: '#FFF7ED', borderColor: '#FDBA74', borderWidth: 2 }, !isConfirmed && isFirst && { backgroundColor: '#E0F7FF', borderColor: '#7DD3FC' }, isMe && !isFirst && !isConfirmed && { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}>
                                            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                                                <Text style={{ fontSize: 20, width: 28 }}>{isConfirmed ? '✅' : (icons[idx] || `${idx + 1}.`)}</Text>
                                                {entry.userPhoto
                                                    ? <Image source={{ uri: entry.userPhoto }} style={s.queueAvatar} />
                                                    : <View style={[s.queueAvatar, { backgroundColor: '#E2E8F0', justifyContent: 'center', alignItems: 'center' }]}><Ionicons name="person" size={14} color="#94A3B8" /></View>}
                                                <View style={{ flex: 1, marginRight: 6 }}>
                                                    <Text style={s.queueName} numberOfLines={1} ellipsizeMode="tail">{entry.userName}{isMe ? ' (You)' : ''}</Text>
                                                    {isConfirmed ? (
                                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                                            <View style={{ backgroundColor: '#F97316', paddingHorizontal: 6, paddingVertical: 1, borderRadius: r(4) }}>
                                                                <Text style={{ fontSize: 10, fontWeight: '800', color: '#fff' }}>CONFIRMED</Text>
                                                            </View>
                                                            <Text style={{ fontSize: 11, color: '#F97316', fontWeight: '600' }}>Buyer Selected</Text>
                                                        </View>
                                                    ) : isFirst ? (
                                                        <Text style={{ fontSize: 11, color: '#0EA5E9', fontWeight: '600' }}>🔥 First in line</Text>
                                                    ) : null}
                                                </View>
                                            </View>
                                            {isOwner && isConfirmed && (
                                                <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                                                    <TouchableOpacity style={[s.ctrlBtn, { flex: 1 }]} onPress={() => handleChatWith(entry)}>
                                                        <Ionicons name="chatbubble" size={13} color="#0EA5E9" />
                                                        <Text style={[s.ctrlBtnTxt, { color: '#0EA5E9' }]}>Chat</Text>
                                                    </TouchableOpacity>
                                                </View>
                                            )}
                                            {isOwner && !isConfirmed && isFirst && (
                                                <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                                                    <TouchableOpacity style={[s.ctrlBtn, { flex: 1 }]} onPress={() => handleChatWith(entry)}>
                                                        <Ionicons name="chatbubble" size={13} color="#0EA5E9" />
                                                        <Text style={[s.ctrlBtnTxt, { color: '#0EA5E9' }]}>Chat</Text>
                                                    </TouchableOpacity>
                                                    <TouchableOpacity style={[s.ctrlBtn, { flex: 1, backgroundColor: '#FFF7ED', borderColor: '#FDBA74' }]} onPress={() => { setShowQueue(false); setTimeout(() => setShowPassConfirm(entry), 350); }}>
                                                        <Text style={[s.ctrlBtnTxt, { color: '#F97316' }]}>Pass</Text>
                                                    </TouchableOpacity>
                                                    <TouchableOpacity style={[s.ctrlBtn, { flex: 1, backgroundColor: '#D1FAE5', borderColor: '#6EE7B7' }]} onPress={() => { setShowQueue(false); setTimeout(() => setShowConfirmBuyer(entry), 350); }}>
                                                        <Ionicons name="checkmark" size={13} color="#059669" />
                                                        <Text style={[s.ctrlBtnTxt, { color: '#059669' }]}>Confirm</Text>
                                                    </TouchableOpacity>
                                                </View>
                                            )}
                                        </View>
                                    );
                                })}
                            </ScrollView>
                        )}
                    </View>
                </View>
            </Modal>

            {/* ── View Chats Modal ── */}
            <Modal visible={showChats} transparent animationType="fade" onRequestClose={() => setShowChats(false)}>
                <View style={s.modalOverlay}>
                    <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setShowChats(false)} />
                    <View style={[s.sheetContainer, { maxHeight: SH * 0.6 }]}>
                        <View style={s.sheetHandle} />
                        <Text style={s.sheetTitle}>Chats for This Listing</Text>
                        {chats.length === 0 ? (
                            <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                                <Ionicons name="chatbubble-outline" size={40} color="#CBD5E1" />
                                <Text style={{ color: '#94A3B8', fontSize: 15, marginTop: 12, fontWeight: '600' }}>No chats yet</Text>
                                <Text style={{ color: '#CBD5E1', fontSize: 13, marginTop: 4 }}>When buyers request, chats will appear here</Text>
                            </View>
                        ) : (
                            <ScrollView showsVerticalScrollIndicator={false}>
                                {chats.map(chat => {
                                    const otherUid = chat.participants?.find((p: string) => p !== user?.uid);
                                    const otherName = otherUid ? chat.participantNames?.[otherUid] : 'User';
                                    return (
                                        <TouchableOpacity key={chat.id} style={s.chatRow} onPress={() => {
                                            setShowChats(false);
                                            navigation.navigate('ChatRoom', { chatId: chat.id, otherUserId: otherUid, otherUserName: otherName, listingName: listing.name, listingId: listing.id, listingPhoto: photos[0] || null, listingPrice: listing.price, listingCurrency: listing.currency, chatSource: 'market' });
                                        }}>
                                            <View style={[s.queueAvatar, { backgroundColor: '#E2E8F0', justifyContent: 'center', alignItems: 'center' }]}>
                                                <Ionicons name="person" size={16} color="#94A3B8" />
                                            </View>
                                            <View style={{ flex: 1, marginLeft: 12 }}>
                                                <Text style={{ fontSize: 15, fontWeight: '700', color: theme.colors.textPrimary }}>{otherName}</Text>
                                                <Text style={{ fontSize: 12, color: theme.colors.textMuted }} numberOfLines={1}>{chat.lastMessage || 'No messages yet'}</Text>
                                            </View>
                                            <Ionicons name="chevron-forward" size={18} color="#CBD5E1" />
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>
                        )}
                        <TouchableOpacity style={[s.sheetCancel, { marginTop: 12 }]} onPress={() => setShowChats(false)}>
                            <Text style={s.sheetCancelText}>Close</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* ── Pass Confirmation Center Modal ── */}
            <Modal visible={!!showPassConfirm} transparent animationType="fade" onRequestClose={() => setShowPassConfirm(null)}>
                <View style={s.passOverlay}>
                    <View style={s.passCard}>
                        <TouchableOpacity style={s.modalCloseX} onPress={() => setShowPassConfirm(null)}>
                            <Ionicons name="close" size={22} color={theme.colors.textMuted} />
                        </TouchableOpacity>
                        <View style={s.passIconWrap}>
                            <Ionicons name="alert-circle" size={40} color="#F97316" />
                        </View>
                        <Text style={s.passTitle}>Pass this buyer?</Text>
                        <Text style={s.passDesc}>
                            Have you discussed this with{' '}
                            <Text style={{ fontWeight: '800' }}>{showPassConfirm?.userName}</Text>?
                            {`\n\n`}Passing will move the next person in line to #1. The buyer will be notified.
                            {`\n\n`}Please make sure you've reached an agreement before proceeding.
                        </Text>
                        <View style={s.passActions}>
                            <TouchableOpacity style={s.passCancelBtn} onPress={() => setShowPassConfirm(null)}>
                                <Text style={s.passCancelText}>Go Back</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.passConfirmBtn} onPress={() => showPassConfirm && handlePassConfirmed(showPassConfirm)}>
                                <Text style={s.passConfirmText}>Yes, Pass</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ── Confirm Buyer Center Modal ── */}
            <Modal visible={!!showConfirmBuyer} transparent animationType="fade" onRequestClose={() => setShowConfirmBuyer(null)}>
                <View style={s.passOverlay}>
                    <View style={s.passCard}>
                        <TouchableOpacity style={s.modalCloseX} onPress={() => setShowConfirmBuyer(null)}>
                            <Ionicons name="close" size={22} color={theme.colors.textMuted} />
                        </TouchableOpacity>
                        <View style={[s.passIconWrap, { backgroundColor: '#FFF7ED' }]}>
                            <Ionicons name="checkmark-circle" size={40} color="#F97316" />
                        </View>
                        <Text style={s.passTitle}>Confirm this buyer?</Text>
                        <Text style={s.passDesc}>
                            Select{' '}
                            <Text style={{ fontWeight: '800' }}>{showConfirmBuyer?.userName}</Text>
                            {' '}as your buyer for this listing.
                            {`\n\n`}The listing will be marked as <Text style={{ fontWeight: '800', color: '#D97706' }}>Reserved</Text>.
                            {`\n\n`}You can always cancel the reservation later if plans change.
                        </Text>
                        <View style={s.passActions}>
                            <TouchableOpacity style={s.passCancelBtn} onPress={() => setShowConfirmBuyer(null)}>
                                <Text style={s.passCancelText}>Go Back</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[s.passConfirmBtn, { backgroundColor: '#F97316' }]} onPress={() => showConfirmBuyer && handleConfirmBuyerExecute(showConfirmBuyer)}>
                                <Text style={s.passConfirmText}>Yes, Confirm</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ── Confirm Success Center Modal ── */}
            <Modal visible={!!showConfirmSuccess} transparent animationType="fade" onRequestClose={() => setShowConfirmSuccess(null)}>
                <View style={s.passOverlay}>
                    <View style={s.passCard}>
                        <TouchableOpacity style={s.modalCloseX} onPress={() => setShowConfirmSuccess(null)}>
                            <Ionicons name="close" size={22} color={theme.colors.textMuted} />
                        </TouchableOpacity>
                        <View style={[s.passIconWrap, { backgroundColor: '#FFF7ED' }]}>
                            <Ionicons name="checkmark-done-circle" size={44} color="#F97316" />
                        </View>
                        <Text style={[s.passTitle, { color: '#F97316' }]}>Confirmed!</Text>
                        <Text style={s.passDesc}>
                            <Text style={{ fontWeight: '800' }}>{showConfirmSuccess?.userName}</Text>
                            {' '}has been confirmed as the buyer.
                            {`\n\n`}Chat with them now to schedule a meetup!
                        </Text>
                        <TouchableOpacity
                            style={{ flexDirection: 'row', backgroundColor: '#F97316', width: '100%', paddingVertical: 16, borderRadius: r(14), alignItems: 'center', justifyContent: 'center', gap: 6 }}
                            onPress={() => {
                                const entry = showConfirmSuccess;
                                setShowConfirmSuccess(null);
                                if (entry) handleChatWith(entry);
                            }}
                        >
                            <Ionicons name="chatbubble" size={16} color="#fff" />
                            <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>Chat to Schedule</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* ── Cancel Request Confirm Modal ── */}
            <Modal visible={showCancelConfirm} transparent animationType="fade" onRequestClose={() => setShowCancelConfirm(false)}>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
                    <View style={{ backgroundColor: '#fff', borderRadius: r(20), padding: 24, width: '100%', alignItems: 'center' }}>
                        <TouchableOpacity onPress={() => setShowCancelConfirm(false)} style={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}>
                            <Ionicons name="close" size={22} color="#94A3B8" />
                        </TouchableOpacity>
                        <View style={{ width: 48, height: 48, borderRadius: r(24), backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center', marginBottom: 12 }}>
                            <Ionicons name="warning" size={24} color="#F97316" />
                        </View>
                        <Text style={{ fontSize: 17, fontWeight: '800', color: '#0F172A', marginBottom: 4 }}>Cancel Request?</Text>
                        <Text style={{ fontSize: 13, color: '#64748B', textAlign: 'center', marginBottom: 20 }}>
                            You'll lose your #{myPos} spot in the queue. Are you sure?
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
                            <TouchableOpacity style={{ flex: 1, paddingVertical: 13, borderRadius: r(12), backgroundColor: '#F1F5F9', alignItems: 'center' }}
                                onPress={() => setShowCancelConfirm(false)}>
                                <Text style={{ fontWeight: '700', color: '#475569' }}>Keep</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={{ flex: 1, paddingVertical: 13, borderRadius: r(12), backgroundColor: '#EF4444', alignItems: 'center' }}
                                onPress={async () => {
                                    setShowCancelConfirm(false);
                                    setLoading(true);
                                    try {
                                        if (myEntry) {
                                            await updateDoc(doc(db, 'market_listings', listing.id), { waitlist: arrayRemove(myEntry) });
                                            const snap = await getDoc(doc(db, 'market_listings', listing.id));
                                            const updatedList: any[] = snap.data()?.waitlist || [];
                                            const newFirst = updatedList.find(e => e.status === 'active');
                                            if (newFirst && myPos === 1) {
                                                await sendPushToUser(newFirst.userId, '🎉 You\'re #1!', `You moved to first in line for "${listing.name}"`, { listingId: listing.id });
                                                await addDoc(collection(db, 'dolphin_notifications'), {
                                                    recipientId: newFirst.userId, type: 'queue',
                                                    title: '🎉 You\'re #1 in Queue!',
                                                    body: `You moved to first in line for "${listing.name}"`,
                                                    listingId: listing.id, read: false, createdAt: serverTimestamp(),
                                                });
                                            }
                                        }
                                    } catch {}
                                    setLoading(false);
                                }}>
                                <Text style={{ fontWeight: '700', color: '#fff' }}>Cancel Request</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#fff' },
    floatHead: { position: 'absolute', top: SAFE_TOP, left: 16, right: 16, zIndex: 100, flexDirection: 'row', justifyContent: 'space-between' },
    circleBtn: { width: 40, height: 40, borderRadius: r(20), backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
    statusBadge: { position: 'absolute', bottom: 14, left: 14, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: r(20) },
    statusBadgeText: { fontSize: 12, fontWeight: '800' },
    imgCounter: { position: 'absolute', bottom: 14, right: 80, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: r(12) },
    imgCounterTxt: { color: '#fff', fontSize: 12, fontWeight: '600' },
    queueBadgeBtn: { position: 'absolute', bottom: 14, right: 14, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#E0F7FF', paddingHorizontal: 10, paddingVertical: 6, borderRadius: r(20), borderWidth: 1, borderColor: '#7DD3FC' },
    queueBadgeTxt: { fontSize: 12, color: '#0EA5E9', fontWeight: '700' },
    sellerRow: { flexDirection: 'row', alignItems: 'center', padding: 16 },
    avatar: { width: 44, height: 44, borderRadius: r(22) },
    sellerName: { fontSize: 15, fontWeight: '700', color: theme.colors.textPrimary },
    sellerSub: { fontSize: 12, color: theme.colors.textMuted },
    timeAgo: { fontSize: 12, color: theme.colors.textMuted },
    chatSellerBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F97316', paddingHorizontal: 12, paddingVertical: 7, borderRadius: r(20) },
    chatSellerBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
    divider: { height: 1, backgroundColor: theme.colors.borderLight, marginHorizontal: 16 },
    infoSection: { paddingHorizontal: 24, paddingVertical: 16 },
    title: { fontSize: 20, fontWeight: '800', color: theme.colors.textPrimary, marginBottom: 6 },
    price: { fontSize: 24, fontWeight: '800', color: theme.colors.textPrimary },
    descSection: { padding: 16 },
    descText: { fontSize: 15, color: theme.colors.textPrimary, lineHeight: 24 },
    bottomBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 32 : 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: theme.colors.borderLight },
    viewChatsBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#F97316', paddingVertical: 16, borderRadius: r(14) },
    viewChatsBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    buyBtn: { flex: 1, backgroundColor: '#F97316', paddingVertical: 16, borderRadius: r(14), alignItems: 'center' },
    buyBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
    photoClose: { position: 'absolute', top: SAFE_TOP, right: 16, zIndex: 10, width: 40, height: 40, borderRadius: r(20), backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheetContainer: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: Platform.OS === 'ios' ? 40 : 20 },
    sheetHandle: { width: 40, height: 4, backgroundColor: '#E2E8F0', borderRadius: r(2), alignSelf: 'center', marginBottom: 16 },
    sheetTitle: { fontSize: 17, fontWeight: '800', color: theme.colors.textPrimary, marginBottom: 16 },
    sheetOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderRadius: r(14), marginBottom: 10 },
    sheetOptionText: { fontSize: 16, fontWeight: '700' },
    sheetCancel: { backgroundColor: '#F1F5F9', padding: 16, borderRadius: r(14), alignItems: 'center', marginTop: 4 },
    sheetCancelText: { fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary },
    menuOption: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: r(14), backgroundColor: '#F8FAFC', marginBottom: 10 },
    menuOptionText: { fontSize: 16, fontWeight: '700' },
    queueRow: { padding: 12, borderRadius: r(14), marginBottom: 8, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0' },
    queueAvatar: { width: 32, height: 32, borderRadius: r(16) },
    queueName: { fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary },
    ctrlBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 5, borderRadius: r(8), backgroundColor: '#E0F7FF', borderWidth: 1, borderColor: '#7DD3FC' },
    ctrlBtnTxt: { fontSize: 11, fontWeight: '700' },
    chatRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: r(14), backgroundColor: '#F8FAFC', marginBottom: 8, borderWidth: 1, borderColor: '#E2E8F0' },
    // Pass confirmation center modal
    passOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
    passCard: { backgroundColor: '#fff', borderRadius: r(24), padding: 28, width: '100%', alignItems: 'center', ...theme.shadows.lg },
    passIconWrap: { width: 64, height: 64, borderRadius: r(32), backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
    passTitle: { fontSize: 20, fontWeight: '800', color: theme.colors.textPrimary, marginBottom: 12 },
    passDesc: { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
    passActions: { flexDirection: 'row', gap: 12, width: '100%' },
    passCancelBtn: { flex: 1, paddingVertical: 14, borderRadius: r(14), backgroundColor: '#F1F5F9', alignItems: 'center' },
    passCancelText: { fontSize: 15, fontWeight: '700', color: theme.colors.textPrimary },
    passConfirmBtn: { flex: 1, flexDirection: 'row', paddingVertical: 14, borderRadius: r(14), backgroundColor: '#F97316', alignItems: 'center', justifyContent: 'center' },
    passConfirmText: { fontSize: 15, fontWeight: '700', color: '#fff' },
    modalCloseX: { position: 'absolute', top: 14, right: 14, width: 32, height: 32, borderRadius: r(16), backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center', zIndex: 10 },
});
