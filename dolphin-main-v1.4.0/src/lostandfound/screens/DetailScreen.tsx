import React, { useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, Image, ScrollView, TouchableOpacity,
    Alert, Platform, StatusBar, Modal, FlatList, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme/theme';
import { auth, db } from '../config/firebase';
import {
    deleteDoc, doc, updateDoc, collection, query, where,
    getDocs, addDoc, serverTimestamp, getDoc, onSnapshot,
} from 'firebase/firestore';
import { isAdmin } from '../utils/admin';
import { getUserRole } from '../utils/userRole';
import { isStale, STALE_DAYS } from '../utils/constants';
import { fetchMatchesFor } from '../utils/matching';
import { useLFLang } from '../i18n';
import { useIsWebDesktop } from '../../utils/useResponsive';

const SAFE_TOP = Platform.OS === 'ios' ? 60 : (StatusBar.currentHeight || 24) + 10;
const DETAIL_MAX_WIDTH = 720;

export function DetailScreen({ route, navigation }: any) {
    const { t, zoneLabel, categoryLabel, dropOffLabel, locale, timeAgo } = useLFLang();
    const isWebDesktop = useIsWebDesktop();
    const { width: SW, height: SH } = useWindowDimensions();
    const [post, setPost] = useState<any>(route.params.post);
    const currentUser = auth.currentUser;
    const isOwner = currentUser?.uid === post.authorId;
    const isLost = post.postType === 'lost';
    const admin = isAdmin();
    const status = post.status || 'active';
    const [imgIdx, setImgIdx] = useState(0);
    const [showPhoto, setShowPhoto] = useState(false);
    const [photoIdx, setPhotoIdx] = useState(0);
    const [showOwnerMenu, setShowOwnerMenu] = useState(false);
    const [authorPhoto, setAuthorPhoto] = useState<string | null>(null);
    const [matches, setMatches] = useState<any[]>([]);
    const [contentW, setContentW] = useState(Math.min(SW, DETAIL_MAX_WIDTH));
    const galleryH = isWebDesktop ? Math.min(Math.round(contentW * 0.75), 420) : contentW;

    // Keep the screen live so edits, bumps and resolves show up immediately.
    useEffect(() => {
        return onSnapshot(doc(db, 'posts', route.params.post.id), snap => {
            if (snap.exists()) setPost({ id: snap.id, ...snap.data() });
        }, () => {});
    }, [route.params.post.id]);

    // Fetch author's real Google profile photo
    useEffect(() => {
        if (post.authorPhoto) { setAuthorPhoto(post.authorPhoto); return; }
        if (!post.authorId) return;
        if (currentUser && currentUser.uid === post.authorId && currentUser.photoURL) {
            setAuthorPhoto(currentUser.photoURL); return;
        }
        getDoc(doc(db, 'users', post.authorId))
            .then(snap => { if (snap.exists()) setAuthorPhoto(snap.data().photoURL || null); })
            .catch(() => {});
    }, [post.authorId]);

    // Possible lost↔found matches for active posts.
    const matchKey = [post.id, status, post.title, post.category, post.color, post.locationZone, (post.tags || []).join(',')].join('|');
    useEffect(() => {
        if (status !== 'active') { setMatches([]); return; }
        let cancelled = false;
        fetchMatchesFor(post, 6)
            .then(m => { if (!cancelled) setMatches(m.map(x => x.post)); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [matchKey]);

    const allImages: string[] = post.imageUrls?.length > 0
        ? post.imageUrls
        : post.imageUrl ? [post.imageUrl] : [];

    const handleToggleResolved = async () => {
        const newStatus = status === 'resolved' ? 'active' : 'resolved';
        try {
            await updateDoc(doc(db, 'posts', post.id), { status: newStatus });
            setPost((p: any) => ({ ...p, status: newStatus }));
        } catch (e: any) {
            Alert.alert(t('errorTitle'), t('updateFailed', { msg: e.message }));
        }
    };

    const handleBump = async () => {
        try {
            await updateDoc(doc(db, 'posts', post.id), { bumpedAt: serverTimestamp() });
            setPost((p: any) => ({ ...p, bumpedAt: new Date() }));
            Alert.alert(t('bumpedTitle'), t('bumpedBody'));
        } catch (e: any) {
            Alert.alert(t('errorTitle'), t('updateFailed', { msg: e.message }));
        }
    };

    const handleDelete = async () => {
        try { await deleteDoc(doc(db, 'posts', post.id)); navigation.goBack(); }
        catch { Alert.alert(t('errorTitle'), t('deleteFailed')); }
    };

    const confirmDelete = () => Alert.alert(t('deleteReportTitle'), t('deleteConfirm'), [
        { text: t('cancel'), style: 'cancel' },
        { text: t('delete'), style: 'destructive', onPress: handleDelete },
    ]);

    const confirmToggleResolved = () => Alert.alert(
        status === 'resolved' ? t('reopenPost') : t('markResolved'),
        status === 'resolved' ? t('reopenConfirm') : t('resolveConfirm'),
        [{ text: t('cancel'), style: 'cancel' }, { text: status === 'resolved' ? t('reopen') : t('resolve'), onPress: handleToggleResolved }]
    );

    const handleChat = async () => {
        if (!currentUser) {
            Alert.alert(t('signInToMessage'));
            return;
        }
        const q = query(collection(db, 'dolphin_chats'), where('participants', 'array-contains', currentUser.uid));
        const snap = await getDocs(q);
        const existing = snap.docs.find(d => {
            const data = d.data();
            return data.postId === post.id && data.participants?.includes(post.authorId);
        });
        let chatId: string;
        if (existing) {
            chatId = existing.id;
        } else {
            const ref = await addDoc(collection(db, 'dolphin_chats'), {
                participants: [currentUser.uid, post.authorId],
                participantNames: { [currentUser.uid]: currentUser.displayName || 'User', [post.authorId]: post.authorName || 'User' },
                postId: post.id, postTitle: post.title,
                postImage: allImages[0] || null,
                listingName: post.title, listingPhoto: allImages[0] || null,
                chatSource: 'lostfound',
                createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastMessage: '',
            });
            chatId = ref.id;
        }
        navigation.navigate('ChatRoom', {
            chatId, otherUserId: post.authorId, otherUserName: post.authorName,
            listingName: post.title, listingId: post.id, listingPhoto: allImages[0],
            chatSource: 'lostfound',
        });
    };

    const badgeColor = isLost ? '#B91C1C' : '#047857';
    const badgeBg = isLost ? '#FEE2E2' : '#D1FAE5';
    const badgeLabel = isLost ? t('badgeLost') : t('badgeFound');
    const isFaculty = post.authorEmail ? getUserRole(post.authorEmail) === 'faculty' : false;
    const zoneText = post.locationZoneCustom || (post.locationZone ? zoneLabel(post.locationZone) : (post.location || t('notSpecified')));

    return (
        <View style={s.root}>
            {/* Floating back + menu buttons — always on top */}
            <View style={[s.floatHead, { top: SAFE_TOP }]} pointerEvents="box-none">
                <View style={s.floatHeadInner} pointerEvents="box-none">
                    <TouchableOpacity
                        style={s.circleBtn}
                        onPress={() => navigation.goBack()}
                        accessibilityRole="button"
                        accessibilityLabel={t('goBack')}
                    >
                        <Ionicons name="chevron-back" size={22} color="#fff" />
                    </TouchableOpacity>
                    {(isOwner || admin) && (
                        <TouchableOpacity
                            style={s.circleBtn}
                            onPress={() => setShowOwnerMenu(true)}
                            accessibilityRole="button"
                            accessibilityLabel={t('managePost')}
                        >
                            <Ionicons name="ellipsis-horizontal" size={20} color="#fff" />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            <ScrollView bounces showsVerticalScrollIndicator={false}>
                <View style={s.centered} onLayout={e => setContentW(e.nativeEvent.layout.width)}>
                    {/* Image gallery */}
                    <View style={{ width: contentW, height: galleryH, backgroundColor: '#F1F5F9' }}>
                        {allImages.length > 0 ? (
                            <ScrollView
                                horizontal pagingEnabled showsHorizontalScrollIndicator={false}
                                onMomentumScrollEnd={e => setImgIdx(Math.round(e.nativeEvent.contentOffset.x / contentW))}
                                onScroll={Platform.OS === 'web' ? (e => setImgIdx(Math.round(e.nativeEvent.contentOffset.x / contentW))) : undefined}
                                scrollEventThrottle={100}
                            >
                                {allImages.map((uri, i) => (
                                    <TouchableOpacity
                                        key={i}
                                        activeOpacity={0.95}
                                        onPress={() => { setPhotoIdx(i); setShowPhoto(true); }}
                                        accessibilityRole="imagebutton"
                                        accessibilityLabel={`${post.title} — ${t('viewPhoto', { n: i + 1, total: allImages.length })}`}
                                    >
                                        <Image source={{ uri }} style={{ width: contentW, height: galleryH, resizeMode: 'cover' }} />
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        ) : (
                            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                                <Ionicons name="image-outline" size={64} color={theme.colors.textMuted} />
                            </View>
                        )}

                        {/* Badges — bottom left, clear of the floating header buttons */}
                        <View style={s.badgeRow}>
                            <View style={[s.statusBadge, { backgroundColor: badgeBg }]}>
                                <Text style={[s.statusBadgeText, { color: badgeColor }]}>{badgeLabel}</Text>
                            </View>
                            {status === 'resolved' && (
                                <View style={s.resolvedBadge}>
                                    <Text style={s.resolvedBadgeText}>{t('resolvedBadge')}</Text>
                                </View>
                            )}
                        </View>

                        {allImages.length > 1 && (
                            <View style={s.imgCounter}>
                                <Text style={s.imgCounterTxt}>{imgIdx + 1}/{allImages.length}</Text>
                            </View>
                        )}
                    </View>

                    {/* Author profile — right below image */}
                    <View style={s.authorRow}>
                        {authorPhoto
                            ? <Image source={{ uri: authorPhoto }} style={s.avatar} accessibilityIgnoresInvertColors />
                            : <View style={[s.avatar, { backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center' }]}>
                                <Text style={s.avatarText}>{(post.authorName || 'U')[0].toUpperCase()}</Text>
                              </View>
                        }
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={s.authorName}>{post.authorName}</Text>
                            {post.authorEmail && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                    <Text style={s.authorEmail} numberOfLines={1}>{post.authorEmail}</Text>
                                    <View style={[s.roleBadge, { backgroundColor: isFaculty ? '#FEF3C7' : '#EEF2FF' }]}>
                                        <Text style={[s.roleText, { color: isFaculty ? '#B45309' : '#4338CA' }]}>{isFaculty ? t('roleFaculty') : t('roleStudent')}</Text>
                                    </View>
                                </View>
                            )}
                        </View>
                        <Text style={s.timeAgo}>{post.createdAt ? timeAgo(post.createdAt) : t('justNow')}</Text>
                    </View>

                    {/* Stale-post nudge (owner only) */}
                    {isOwner && isStale(post) && (
                        <View style={s.staleBanner} accessibilityRole="alert">
                            <Text style={s.staleTitle}>{t('staleTitle', { d: STALE_DAYS })}</Text>
                            <Text style={s.staleBody}>{t('staleBody')}</Text>
                            <View style={s.staleActions}>
                                <TouchableOpacity style={s.staleBtnPrimary} onPress={handleBump} accessibilityRole="button" accessibilityLabel={t('bump')}>
                                    <Ionicons name="arrow-up-circle" size={16} color="#fff" />
                                    <Text style={s.staleBtnPrimaryText}>{t('bump')}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={s.staleBtnSecondary} onPress={confirmToggleResolved} accessibilityRole="button" accessibilityLabel={t('markResolved')}>
                                    <Ionicons name="checkmark-circle" size={16} color="#047857" />
                                    <Text style={s.staleBtnSecondaryText}>{t('markResolved')}</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}

                    <View style={s.divider} />

                    {/* Title */}
                    <View style={s.section}>
                        <Text style={s.title} accessibilityRole="header">{post.title}</Text>

                        {post.tags?.length > 0 && (
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                                {post.tags.map((tg: string, i: number) => (
                                    <View key={i} style={s.tag}><Text style={s.tagText}>#{tg}</Text></View>
                                ))}
                            </View>
                        )}
                    </View>

                    <View style={s.divider} />

                    {/* Info cards */}
                    <View style={s.section}>
                        {/* Location */}
                        <View style={s.infoCard} accessible accessibilityLabel={`${t('location')}: ${zoneText}${post.locationDetail ? ', ' + post.locationDetail : ''}`}>
                            <View style={[s.infoIcon, { backgroundColor: '#EEF2FF' }]}>
                                <Ionicons name="location-outline" size={16} color="#6366F1" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={s.infoLabel}>{t('location')}</Text>
                                <Text style={s.infoValue}>{zoneText}</Text>
                                {post.locationDetail ? (
                                    <Text style={s.infoSubValue}>{post.locationDetail}</Text>
                                ) : null}
                            </View>
                        </View>

                        {/* Found item: currently held by the finder, or dropped off */}
                        {post.foundStatus === 'holding' ? (
                            <View style={s.infoCard} accessible>
                                <View style={[s.infoIcon, { backgroundColor: '#FEF3C7' }]}>
                                    <Ionicons name="hand-left-outline" size={16} color="#B45309" />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={s.infoLabel}>{t('itemStatus')}</Text>
                                    <Text style={s.infoValue}>{t('finderHolding')}</Text>
                                    <Text style={s.infoSubValue}>{t('messageToArrange', { name: post.authorName || t('theFinder') })}</Text>
                                </View>
                            </View>
                        ) : post.dropOffLocation ? (
                            <View style={s.infoCard} accessible>
                                <View style={[s.infoIcon, { backgroundColor: '#ECFDF5' }]}>
                                    <Ionicons name="arrow-down-circle-outline" size={16} color="#047857" />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={s.infoLabel}>{t('droppedOffAt')}</Text>
                                    <Text style={s.infoValue}>{dropOffLabel(post.dropOffLocation)}</Text>
                                </View>
                            </View>
                        ) : null}

                        {/* Date */}
                        {post.eventDate && (
                            <View style={s.infoCard} accessible>
                                <View style={[s.infoIcon, { backgroundColor: '#F0FDF4' }]}>
                                    <Ionicons name="calendar-outline" size={16} color="#16A34A" />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={s.infoLabel}>{isLost ? t('dateLost') : t('dateFound')}</Text>
                                    <Text style={s.infoValue}>
                                        {new Date(post.eventDate).toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })}
                                        {post.eventTime === 'unknown'
                                            ? ` ${t('timeUnknownParen')}`
                                            : `  ${new Date(post.eventDate).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true })}`}
                                    </Text>
                                </View>
                            </View>
                        )}

                        {/* Category */}
                        {post.category ? (
                            <View style={s.infoCard} accessible>
                                <View style={[s.infoIcon, { backgroundColor: '#F1F5F9' }]}>
                                    <Ionicons name="pricetag-outline" size={16} color="#475569" />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={s.infoLabel}>{t('category')}</Text>
                                    <Text style={s.infoValue}>{categoryLabel(post.category)}</Text>
                                </View>
                            </View>
                        ) : null}

                        {/* Color */}
                        {post.color ? (
                            <View style={s.infoCard} accessible>
                                <View style={[s.infoIcon, { backgroundColor: '#FEF3C7' }]}>
                                    <Ionicons name="color-palette-outline" size={16} color="#B45309" />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={s.infoLabel}>{t('color')}</Text>
                                    <Text style={s.infoValue}>{post.color}</Text>
                                </View>
                            </View>
                        ) : null}
                    </View>

                    <View style={s.divider} />

                    {/* Description */}
                    <View style={s.section}>
                        <Text style={s.sectionTitle} accessibilityRole="header">{t('description')}</Text>
                        <Text style={s.description}>{post.description || t('noDescription')}</Text>
                    </View>

                    {/* Possible matches */}
                    {matches.length > 0 && (
                        <>
                            <View style={s.divider} />
                            <View style={s.section}>
                                <Text style={s.sectionTitle} accessibilityRole="header">🔎 {t('possibleMatches')}</Text>
                                <Text style={s.sectionHint}>{isLost ? t('possibleMatchesForLost') : t('possibleMatchesForFound')}</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingTop: 10 }}>
                                    {matches.map(m => {
                                        const img = m.imageUrls?.[0] || m.imageUrl;
                                        const mLost = m.postType === 'lost';
                                        const mZone = m.locationZoneCustom || (m.locationZone ? zoneLabel(m.locationZone) : (m.location || ''));
                                        return (
                                            <TouchableOpacity
                                                key={m.id}
                                                style={s.matchCard}
                                                activeOpacity={0.85}
                                                onPress={() => navigation.push('LFDetail', { post: m })}
                                                accessibilityRole="button"
                                                accessibilityLabel={t('cardA11y', { type: mLost ? t('badgeLost') : t('badgeFound'), title: m.title, location: mZone })}
                                            >
                                                {img
                                                    ? <Image source={{ uri: img }} style={s.matchImg} />
                                                    : <View style={[s.matchImg, { justifyContent: 'center', alignItems: 'center' }]}><Ionicons name="image-outline" size={28} color="#CBD5E1" /></View>
                                                }
                                                <View style={[s.matchBadge, { backgroundColor: mLost ? '#FEE2E2' : '#D1FAE5' }]}>
                                                    <Text style={[s.matchBadgeText, { color: mLost ? '#B91C1C' : '#047857' }]}>{mLost ? t('badgeLost') : t('badgeFound')}</Text>
                                                </View>
                                                <View style={{ padding: 8 }}>
                                                    <Text style={s.matchTitle} numberOfLines={1}>{m.title}</Text>
                                                    <Text style={s.matchSub} numberOfLines={1}>{mZone}</Text>
                                                </View>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </ScrollView>
                            </View>
                        </>
                    )}

                    <View style={{ height: 120 }} />
                </View>
            </ScrollView>

            {/* Bottom action bar */}
            <View style={s.bottomBar}>
                <View style={[s.centered, { flexDirection: 'row' }]}>
                    {isOwner ? (
                        <TouchableOpacity
                            style={[s.actionBtn, { backgroundColor: status === 'resolved' ? '#64748B' : '#047857' }]}
                            onPress={confirmToggleResolved}
                            activeOpacity={0.8}
                            accessibilityRole="button"
                            accessibilityLabel={status === 'resolved' ? t('reopenPost') : t('markResolved')}
                        >
                            <Ionicons name={status === 'resolved' ? 'refresh' : 'checkmark-circle'} size={18} color="#fff" />
                            <Text style={s.actionBtnText}>{status === 'resolved' ? t('reopenPost') : t('markResolved')}</Text>
                        </TouchableOpacity>
                    ) : (
                        <TouchableOpacity style={s.actionBtn} onPress={handleChat} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={isLost ? t('messageOwner') : t('messageFinder')}>
                            <Ionicons name="chatbubble" size={18} color="#fff" />
                            <Text style={s.actionBtnText}>{isLost ? t('messageOwner') : t('messageFinder')}</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {/* Fullscreen photo viewer */}
            <Modal visible={showPhoto} transparent animationType="fade" onRequestClose={() => setShowPhoto(false)}>
                <View style={{ flex: 1, backgroundColor: '#000' }}>
                    <TouchableOpacity
                        style={[s.photoClose, { top: SAFE_TOP }]}
                        onPress={() => setShowPhoto(false)}
                        accessibilityRole="button"
                        accessibilityLabel={t('closePhoto')}
                    >
                        <Ionicons name="close" size={28} color="#fff" />
                    </TouchableOpacity>
                    <FlatList
                        data={allImages}
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

            {/* Owner / Admin menu */}
            <Modal visible={showOwnerMenu} transparent animationType="fade" onRequestClose={() => setShowOwnerMenu(false)}>
                <TouchableOpacity style={[s.modalOverlay, isWebDesktop && { justifyContent: 'center', alignItems: 'center' }]} activeOpacity={1} onPress={() => setShowOwnerMenu(false)}>
                    <View style={[s.sheetContainer, isWebDesktop && s.sheetDesktop]}>
                        {!isWebDesktop && <View style={s.sheetHandle} />}
                        <Text style={s.sheetTitle}>{t('managePost')}</Text>

                        {isOwner && (
                            <TouchableOpacity style={s.menuOption} accessibilityRole="button" accessibilityLabel={t('editReport')} onPress={() => { setShowOwnerMenu(false); navigation.navigate('LFAddPost', { editPost: post }); }}>
                                <Ionicons name="pencil" size={20} color={theme.colors.textPrimary} />
                                <Text style={s.menuOptionText}>{t('editReport')}</Text>
                            </TouchableOpacity>
                        )}

                        {isOwner && status === 'active' && (
                            <TouchableOpacity style={s.menuOption} accessibilityRole="button" accessibilityLabel={t('bump')} onPress={() => { setShowOwnerMenu(false); handleBump(); }}>
                                <Ionicons name="arrow-up-circle" size={20} color={theme.colors.textPrimary} />
                                <Text style={s.menuOptionText}>{t('bump')}</Text>
                            </TouchableOpacity>
                        )}

                        <TouchableOpacity style={s.menuOption} accessibilityRole="button" accessibilityLabel={status === 'resolved' ? t('reopenPost') : t('markResolved')} onPress={() => { setShowOwnerMenu(false); handleToggleResolved(); }}>
                            <Ionicons name={status === 'resolved' ? 'refresh' : 'checkmark-circle'} size={20} color="#047857" />
                            <Text style={[s.menuOptionText, { color: '#047857' }]}>{status === 'resolved' ? t('reopenPost') : t('markResolved')}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={s.menuOption} accessibilityRole="button" accessibilityLabel={t('deletePost')} onPress={() => { setShowOwnerMenu(false); confirmDelete(); }}>
                            <Ionicons name="trash" size={20} color="#DC2626" />
                            <Text style={[s.menuOptionText, { color: '#DC2626' }]}>{t('deletePost')}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={s.sheetCancel} accessibilityRole="button" accessibilityLabel={t('cancel')} onPress={() => setShowOwnerMenu(false)}>
                            <Text style={s.sheetCancelText}>{t('cancel')}</Text>
                        </TouchableOpacity>
                    </View>
                </TouchableOpacity>
            </Modal>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#fff' },
    centered: { width: '100%', maxWidth: DETAIL_MAX_WIDTH, alignSelf: 'center' },
    floatHead: { position: 'absolute', left: 0, right: 0, zIndex: 100 },
    floatHeadInner: { width: '100%', maxWidth: DETAIL_MAX_WIDTH, alignSelf: 'center', paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between' },
    circleBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },

    badgeRow: { position: 'absolute', bottom: 14, left: 14, flexDirection: 'row', gap: 6 },
    statusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
    statusBadgeText: { fontSize: 12, fontWeight: '800' },
    resolvedBadge: { backgroundColor: '#ECFDF5', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: '#A7F3D0' },
    resolvedBadgeText: { fontSize: 12, fontWeight: '700', color: '#047857' },
    imgCounter: { position: 'absolute', bottom: 14, right: 14, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    imgCounterTxt: { color: '#fff', fontSize: 12, fontWeight: '600' },

    authorRow: { flexDirection: 'row', alignItems: 'center', padding: 16 },
    avatar: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
    avatarText: { color: '#fff', fontSize: 18, fontWeight: '700' },
    authorName: { fontSize: 15, fontWeight: '700', color: theme.colors.textPrimary },
    authorEmail: { fontSize: 11, color: theme.colors.textMuted, flexShrink: 1 },
    timeAgo: { fontSize: 12, color: theme.colors.textMuted },
    roleBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
    roleText: { fontSize: 9, fontWeight: '700' },

    staleBanner: { marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: 12, backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A' },
    staleTitle: { fontSize: 14, fontWeight: '800', color: '#92400E' },
    staleBody: { fontSize: 13, color: '#92400E', marginTop: 4, lineHeight: 18 },
    staleActions: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
    staleBtnPrimary: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#047857', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
    staleBtnPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '700' },
    staleBtnSecondary: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderWidth: 1, borderColor: '#A7F3D0', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
    staleBtnSecondaryText: { color: '#047857', fontSize: 13, fontWeight: '700' },

    divider: { height: 1, backgroundColor: theme.colors.borderLight, marginHorizontal: 16 },
    section: { padding: 16 },
    title: { fontSize: 22, fontWeight: '800', color: theme.colors.textPrimary, letterSpacing: -0.3 },
    tag: { backgroundColor: '#F0FDF4', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
    tagText: { fontSize: 11, color: '#047857', fontWeight: '600' },

    infoCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, marginBottom: 10 },
    infoIcon: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
    infoLabel: { fontSize: 11, color: theme.colors.textMuted, marginBottom: 2 },
    infoValue: { fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary },
    infoSubValue: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },

    sectionTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary, marginBottom: 8 },
    sectionHint: { fontSize: 12, color: theme.colors.textMuted, marginTop: -4 },
    description: { fontSize: 15, color: theme.colors.textPrimary, lineHeight: 24 },

    matchCard: { width: 150, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.borderLight, overflow: 'hidden' },
    matchImg: { width: 150, height: 110, backgroundColor: '#F1F5F9', resizeMode: 'cover' },
    matchBadge: { position: 'absolute', top: 6, left: 6, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
    matchBadgeText: { fontSize: 10, fontWeight: '800' },
    matchTitle: { fontSize: 13, fontWeight: '700', color: theme.colors.textPrimary },
    matchSub: { fontSize: 11, color: theme.colors.textMuted, marginTop: 2 },

    bottomBar: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 32 : 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: theme.colors.borderLight },
    actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#0369A1', paddingVertical: 16, borderRadius: 14 },
    actionBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

    photoClose: { position: 'absolute', right: 16, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheetContainer: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: Platform.OS === 'ios' ? 40 : 20 },
    sheetDesktop: { width: 400, borderRadius: 20 },
    sheetHandle: { width: 40, height: 4, backgroundColor: '#E2E8F0', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
    sheetTitle: { fontSize: 17, fontWeight: '800', color: theme.colors.textPrimary, marginBottom: 16 },
    menuOption: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, backgroundColor: '#F8FAFC', marginBottom: 10 },
    menuOptionText: { fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary },
    sheetCancel: { backgroundColor: '#F1F5F9', padding: 16, borderRadius: 14, alignItems: 'center', marginTop: 4 },
    sheetCancelText: { fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary },
});
