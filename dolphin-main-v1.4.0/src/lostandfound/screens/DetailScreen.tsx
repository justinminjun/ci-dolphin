import React, { useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, Image, ScrollView, TouchableOpacity,
    Alert, Dimensions, Platform, StatusBar, Modal, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme/theme';
import { auth, db } from '../config/firebase';
import {
    deleteDoc, doc, updateDoc, collection, query, where,
    getDocs, addDoc, serverTimestamp, getDoc,
} from 'firebase/firestore';
import { timeAgo } from '../utils/timeAgo';
import { isAdmin } from '../utils/admin';
import { getRoleLabel } from '../utils/userRole';

const SW = Dimensions.get('window').width;
const SH = Dimensions.get('window').height;
const SAFE_TOP = Platform.OS === 'ios' ? 60 : (StatusBar.currentHeight || 24) + 10;

export function DetailScreen({ route, navigation }: any) {
    const { post } = route.params;
    const currentUser = auth.currentUser;
    const isOwner = currentUser?.uid === post.authorId;
    const isLost = post.postType === 'lost';
    const admin = isAdmin();
    const [status, setStatus] = useState(post.status || 'active');
    const [imgIdx, setImgIdx] = useState(0);
    const [showPhoto, setShowPhoto] = useState(false);
    const [photoIdx, setPhotoIdx] = useState(0);
    const [showOwnerMenu, setShowOwnerMenu] = useState(false);
    const [authorPhoto, setAuthorPhoto] = useState<string | null>(null);

    // Fetch author's real Google profile photo
    useEffect(() => {
        // 1. Check if post already has authorPhoto saved
        if (post.authorPhoto) { setAuthorPhoto(post.authorPhoto); return; }
        if (!post.authorId) return;
        // 2. Current user — use directly from auth
        if (currentUser && currentUser.uid === post.authorId && currentUser.photoURL) {
            setAuthorPhoto(currentUser.photoURL); return;
        }
        // 3. Fetch from Firestore users collection
        getDoc(doc(db, 'users', post.authorId))
            .then(snap => { if (snap.exists()) setAuthorPhoto(snap.data().photoURL || null); })
            .catch(() => {});
    }, [post.authorId]);

    const allImages: string[] = post.imageUrls?.length > 0
        ? post.imageUrls
        : post.imageUrl ? [post.imageUrl] : [];

    const handleToggleResolved = async () => {
        const newStatus = status === 'resolved' ? 'active' : 'resolved';
        try {
            await updateDoc(doc(db, 'posts', post.id), { status: newStatus });
            setStatus(newStatus);
        } catch (e: any) {
            Alert.alert('Error', `Failed to update: ${e.message}`);
        }
    };

    const handleDelete = async () => {
        try { await deleteDoc(doc(db, 'posts', post.id)); navigation.goBack(); }
        catch { Alert.alert('Error', 'Failed to delete.'); }
    };

    const confirmDelete = () => Alert.alert('Delete Report', 'Are you sure you want to delete this post?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: handleDelete },
    ]);

    const handleChat = async () => {
        if (!currentUser) return;
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

    const badgeColor = isLost ? '#DC2626' : '#059669';
    const badgeBg = isLost ? '#FEE2E2' : '#D1FAE5';
    const badgeLabel = isLost ? 'Lost' : 'Found';

    return (
        <View style={s.root}>
            {/* Floating back + menu buttons — always on top */}
            <View style={s.floatHead}>
                <TouchableOpacity style={s.circleBtn} onPress={() => navigation.goBack()}>
                    <Ionicons name="chevron-back" size={22} color="#fff" />
                </TouchableOpacity>
                {(isOwner || admin) && (
                    <TouchableOpacity style={s.circleBtn} onPress={() => setShowOwnerMenu(true)}>
                        <Ionicons name="ellipsis-horizontal" size={20} color="#fff" />
                    </TouchableOpacity>
                )}
            </View>

            <ScrollView bounces showsVerticalScrollIndicator={false}>
                {/* Image gallery */}
                <View style={{ width: SW, height: SW, backgroundColor: '#F1F5F9' }}>
                    {allImages.length > 0 ? (
                        <ScrollView
                            horizontal pagingEnabled showsHorizontalScrollIndicator={false}
                            onMomentumScrollEnd={e => setImgIdx(Math.round(e.nativeEvent.contentOffset.x / SW))}
                        >
                            {allImages.map((uri, i) => (
                                <TouchableOpacity key={i} activeOpacity={0.95} onPress={() => { setPhotoIdx(i); setShowPhoto(true); }}>
                                    <Image source={{ uri }} style={{ width: SW, height: SW, resizeMode: 'cover' }} />
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    ) : (
                        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                            <Ionicons name="image-outline" size={64} color={theme.colors.textMuted} />
                        </View>
                    )}

                    {/* Badge — bottom LEFT */}
                    <View style={[s.statusBadge, { backgroundColor: badgeBg }]}>
                        <Text style={[s.statusBadgeText, { color: badgeColor }]}>{badgeLabel}</Text>
                    </View>

                    {/* Resolved badge */}
                    {status === 'resolved' && (
                        <View style={s.resolvedBadge}>
                            <Text style={s.resolvedBadgeText}>✓ Resolved</Text>
                        </View>
                    )}

                    {/* Image counter */}
                    {allImages.length > 1 && (
                        <View style={s.imgCounter}>
                            <Text style={s.imgCounterTxt}>{imgIdx + 1}/{allImages.length}</Text>
                        </View>
                    )}
                </View>

                {/* Author profile — right below image */}
                <View style={s.authorRow}>
                    {authorPhoto
                        ? <Image source={{ uri: authorPhoto }} style={s.avatar} />
                        : <View style={[s.avatar, { backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center' }]}>
                            <Text style={s.avatarText}>{(post.authorName || 'U')[0].toUpperCase()}</Text>
                          </View>
                    }
                    <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={s.authorName}>{post.authorName}</Text>
                        {post.authorEmail && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <Text style={s.authorEmail} numberOfLines={1}>{post.authorEmail}</Text>
                                <View style={[s.roleBadge, { backgroundColor: getRoleLabel(post.authorEmail) === 'Faculty' ? '#FEF3C7' : '#EEF2FF' }]}>
                                    <Text style={[s.roleText, { color: getRoleLabel(post.authorEmail) === 'Faculty' ? '#D97706' : '#4338CA' }]}>{getRoleLabel(post.authorEmail)}</Text>
                                </View>
                            </View>
                        )}
                    </View>
                    <Text style={s.timeAgo}>{timeAgo(post.createdAt)}</Text>
                </View>

                <View style={s.divider} />

                {/* Title */}
                <View style={s.section}>
                    <Text style={s.title}>{post.title}</Text>

                    {/* Tags */}
                    {post.tags?.length > 0 && (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                            {post.tags.map((t: string, i: number) => (
                                <View key={i} style={s.tag}><Text style={s.tagText}>#{t}</Text></View>
                            ))}
                        </View>
                    )}
                </View>

                <View style={s.divider} />

                {/* Info cards */}
                <View style={s.section}>
                    {/* Location */}
                    <View style={s.infoCard}>
                        <View style={[s.infoIcon, { backgroundColor: '#EEF2FF' }]}>
                            <Ionicons name="location-outline" size={16} color="#6366F1" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={s.infoLabel}>Location</Text>
                            <Text style={s.infoValue}>{post.location || 'Not specified'}</Text>
                        </View>
                    </View>

                    {/* Drop-off location */}
                    {post.dropOffLocation ? (
                        <View style={s.infoCard}>
                            <View style={[s.infoIcon, { backgroundColor: '#ECFDF5' }]}>
                                <Ionicons name="arrow-down-circle-outline" size={16} color="#10B981" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={s.infoLabel}>Dropped off at</Text>
                                <Text style={s.infoValue}>{post.dropOffLocation}</Text>
                            </View>
                        </View>
                    ) : null}

                    {/* Date */}
                    {post.eventDate && (
                        <View style={s.infoCard}>
                            <View style={[s.infoIcon, { backgroundColor: '#F0FDF4' }]}>
                                <Ionicons name="calendar-outline" size={16} color="#16A34A" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={s.infoLabel}>{isLost ? 'Date Lost' : 'Date Found'}</Text>
                                <Text style={s.infoValue}>
                                    {new Date(post.eventDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                                    {post.eventTime === 'unknown' ? ' (Time unknown)' : ` at ${new Date(post.eventDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`}
                                </Text>
                            </View>
                        </View>
                    )}

                    {/* Color */}
                    {post.color ? (
                        <View style={s.infoCard}>
                            <View style={[s.infoIcon, { backgroundColor: '#FEF3C7' }]}>
                                <Ionicons name="color-palette-outline" size={16} color="#D97706" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={s.infoLabel}>Color</Text>
                                <Text style={s.infoValue}>{post.color}</Text>
                            </View>
                        </View>
                    ) : null}
                </View>

                <View style={s.divider} />

                {/* Description */}
                <View style={s.section}>
                    <Text style={s.sectionTitle}>Description</Text>
                    <Text style={s.description}>{post.description || 'No description provided.'}</Text>
                </View>

                <View style={{ height: 120 }} />
            </ScrollView>

            {/* Bottom action bar */}
            <View style={s.bottomBar}>
                {isOwner ? (
                    <TouchableOpacity
                        style={[s.actionBtn, { backgroundColor: status === 'resolved' ? '#94A3B8' : '#059669' }]}
                        onPress={() => Alert.alert(
                            status === 'resolved' ? 'Reopen Post' : 'Mark as Resolved',
                            status === 'resolved' ? 'Reopen this post?' : 'Has the item been returned? Mark as resolved.',
                            [{ text: 'Cancel', style: 'cancel' }, { text: status === 'resolved' ? 'Reopen' : 'Resolve', onPress: handleToggleResolved }]
                        )}
                        activeOpacity={0.8}
                    >
                        <Ionicons name={status === 'resolved' ? 'refresh' : 'checkmark-circle'} size={18} color="#fff" />
                        <Text style={s.actionBtnText}>{status === 'resolved' ? 'Reopen Post' : 'Mark as Resolved'}</Text>
                    </TouchableOpacity>
                ) : (
                    <TouchableOpacity style={s.actionBtn} onPress={handleChat} activeOpacity={0.8}>
                        <Ionicons name="chatbubble" size={18} color="#fff" />
                        <Text style={s.actionBtnText}>Message {isLost ? 'Owner' : 'Finder'}</Text>
                    </TouchableOpacity>
                )}
            </View>

            {/* Fullscreen photo viewer */}
            <Modal visible={showPhoto} transparent animationType="fade" onRequestClose={() => setShowPhoto(false)}>
                <View style={{ flex: 1, backgroundColor: '#000' }}>
                    <TouchableOpacity style={s.photoClose} onPress={() => setShowPhoto(false)}>
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
                <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowOwnerMenu(false)}>
                    <View style={s.sheetContainer}>
                        <View style={s.sheetHandle} />
                        <Text style={s.sheetTitle}>Manage Post</Text>

                        {isOwner && (
                            <TouchableOpacity style={s.menuOption} onPress={() => { setShowOwnerMenu(false); navigation.navigate('LFAddPost', { editPost: post }); }}>
                                <Ionicons name="pencil" size={20} color={theme.colors.textPrimary} />
                                <Text style={s.menuOptionText}>Edit Report</Text>
                            </TouchableOpacity>
                        )}

                        {/* Resolve toggle */}
                        <TouchableOpacity style={s.menuOption} onPress={() => { setShowOwnerMenu(false); handleToggleResolved(); }}>
                            <Ionicons name={status === 'resolved' ? 'refresh' : 'checkmark-circle'} size={20} color="#059669" />
                            <Text style={[s.menuOptionText, { color: '#059669' }]}>{status === 'resolved' ? 'Reopen Post' : 'Mark as Resolved'}</Text>
                        </TouchableOpacity>

                        {(isOwner || admin) && (
                            <TouchableOpacity style={s.menuOption} onPress={() => { setShowOwnerMenu(false); confirmDelete(); }}>
                                <Ionicons name="trash" size={20} color="#DC2626" />
                                <Text style={[s.menuOptionText, { color: '#DC2626' }]}>Delete Post</Text>
                            </TouchableOpacity>
                        )}

                        <TouchableOpacity style={s.sheetCancel} onPress={() => setShowOwnerMenu(false)}>
                            <Text style={s.sheetCancelText}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </TouchableOpacity>
            </Modal>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#fff' },
    floatHead: { position: 'absolute', top: SAFE_TOP, left: 16, right: 16, zIndex: 100, flexDirection: 'row', justifyContent: 'space-between' },
    circleBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },

    statusBadge: { position: 'absolute', bottom: 14, left: 14, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
    statusBadgeText: { fontSize: 12, fontWeight: '800' },
    resolvedBadge: { position: 'absolute', top: 14, right: 14, backgroundColor: '#ECFDF5', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: '#A7F3D0' },
    resolvedBadgeText: { fontSize: 12, fontWeight: '700', color: '#059669' },
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

    divider: { height: 1, backgroundColor: theme.colors.borderLight, marginHorizontal: 16 },
    section: { padding: 16 },
    title: { fontSize: 22, fontWeight: '800', color: theme.colors.textPrimary, letterSpacing: -0.3 },
    tag: { backgroundColor: '#F0FDF4', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
    tagText: { fontSize: 11, color: '#059669', fontWeight: '600' },

    infoCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, marginBottom: 10 },
    infoIcon: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
    infoLabel: { fontSize: 11, color: theme.colors.textMuted, marginBottom: 2 },
    infoValue: { fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary },

    sectionTitle: { fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary, marginBottom: 8 },
    description: { fontSize: 15, color: theme.colors.textPrimary, lineHeight: 24 },

    bottomBar: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 32 : 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: theme.colors.borderLight },
    actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#0EA5E9', paddingVertical: 16, borderRadius: 14 },
    actionBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

    photoClose: { position: 'absolute', top: SAFE_TOP, right: 16, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheetContainer: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: Platform.OS === 'ios' ? 40 : 20 },
    sheetHandle: { width: 40, height: 4, backgroundColor: '#E2E8F0', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
    sheetTitle: { fontSize: 17, fontWeight: '800', color: theme.colors.textPrimary, marginBottom: 16 },
    menuOption: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, backgroundColor: '#F8FAFC', marginBottom: 10 },
    menuOptionText: { fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary },
    sheetCancel: { backgroundColor: '#F1F5F9', padding: 16, borderRadius: 14, alignItems: 'center', marginTop: 4 },
    sheetCancelText: { fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary },
});
