import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
    View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
    KeyboardAvoidingView, Platform, Image, Alert, Share, ScrollView, Dimensions, ActionSheetIOS,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, r } from '../theme/theme';
import { db, auth } from '../config/firebase';
import {
    collection, query, orderBy, onSnapshot, addDoc, doc,
    updateDoc, increment, serverTimestamp, deleteDoc, setDoc, getDoc,
} from 'firebase/firestore';
import { sendPushToUser } from '../utils/notifications';
import { HyperlinkText } from '../components/HyperlinkText';
import { useGlow } from '../context/GlowContext';
import { useFocusEffect } from '@react-navigation/native';
import { showReportBlockMenu } from '../utils/moderation';
import { useIsWebDesktop } from '../utils/useResponsive';

function timeAgo(timestamp: any): string {
    if (!timestamp) return '';
    const now = Date.now();
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const diff = Math.floor((now - date.getTime()) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString();
}

export function PostDetailScreen({ route, navigation }: any) {
    const isWebDesktop = useIsWebDesktop();
    const { post } = route.params;
    const [comments, setComments] = useState<any[]>([]);
    const [input, setInput] = useState('');
    const [isLiked, setIsLiked] = useState(false);
    const [likeCount, setLikeCount] = useState(post.likes || 0);
    const [isSaved, setIsSaved] = useState(false);
    const [viewCount, setViewCount] = useState(post.views || 0);
    const flatListRef = useRef<FlatList>(null);

    const { setGlowColor, glowColor: currentGlow } = useGlow();
    const prevGlowRef = useRef(currentGlow);
    useFocusEffect(
        useCallback(() => {
            prevGlowRef.current = currentGlow;
            setGlowColor('#6366F1'); // lounge purple
            return () => setGlowColor(prevGlowRef.current);
        }, [])
    );

    // Check if post is saved
    useEffect(() => {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        getDoc(doc(db, 'users', uid, 'saved_items', post.id)).then(snap => {
            if (snap.exists()) setIsSaved(true);
        }).catch(() => {});
    }, []);

    useEffect(() => {
        // Listen comments
        const q = query(
            collection(db, 'lounge_posts', post.id, 'comments'),
            orderBy('createdAt', 'asc')
        );
        const unsubComments = onSnapshot(q, (snap) => {
            setComments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });

        // Listen to post doc for real-time views/likes
        const unsubPost = onSnapshot(doc(db, 'lounge_posts', post.id), (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                setViewCount(data.views || 0);
                setLikeCount(data.likes || 0);
            }
        });

        // Check like status
        const uid = auth.currentUser?.uid;
        if (uid) {
            getDoc(doc(db, 'lounge_posts', post.id, 'likes', uid)).then(snap => {
                if (snap.exists()) setIsLiked(true);
            }).catch(() => { });
        }

        return () => { unsubComments(); unsubPost(); };
    }, [post.id]);

    const sendComment = async () => {
        if (!input.trim()) return;
        const user = auth.currentUser;
        if (!user) return;

        try {
            await addDoc(collection(db, 'lounge_posts', post.id, 'comments'), {
                text: input.trim(),
                authorId: user.uid,
                authorName: user.displayName || 'Anonymous',
                authorPhoto: user.photoURL || null,
                createdAt: serverTimestamp(),
            });
            await updateDoc(doc(db, 'lounge_posts', post.id), {
                commentCount: increment(1),
            });
            // Notify post author
            if (user.uid !== post.authorId) {
                const commentTitle = `${user.displayName || 'Someone'} commented on your post`;
                const commentBody = input.trim().substring(0, 100);
                addDoc(collection(db, 'dolphin_notifications'), {
                    recipientId: post.authorId,
                    type: 'comment',
                    title: commentTitle,
                    body: commentBody,
                    postId: post.id,
                    createdAt: serverTimestamp(),
                    read: false,
                }).catch(() => { });
                sendPushToUser(post.authorId, commentTitle, commentBody, { type: 'comment', postId: post.id });
            }
            setInput('');
            setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 200);
        } catch { }
    };

    const toggleLike = async () => {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        const likeRef = doc(db, 'lounge_posts', post.id, 'likes', uid);
        const postRef = doc(db, 'lounge_posts', post.id);
        if (isLiked) {
            setIsLiked(false);
            setLikeCount((prev: number) => Math.max(0, prev - 1));
            try {
                await deleteDoc(likeRef);
                await updateDoc(postRef, { likes: increment(-1) });
            } catch { }
        } else {
            setIsLiked(true);
            setLikeCount((prev: number) => prev + 1);
            try {
                await setDoc(likeRef, { userId: uid, createdAt: new Date() });
                await updateDoc(postRef, { likes: increment(1) });
                // Notify post author (not on self-like)
                const user = auth.currentUser;
                if (user && post.authorId && post.authorId !== uid) {
                    const likeTitle = `${user.displayName || 'Someone'} liked your post`;
                    const likeBody = (post.title || post.text || '').substring(0, 80);
                    addDoc(collection(db, 'dolphin_notifications'), {
                        recipientId: post.authorId,
                        type: 'like',
                        title: likeTitle,
                        body: likeBody,
                        postId: post.id,
                        createdAt: serverTimestamp(),
                        read: false,
                    }).catch(() => { });
                    sendPushToUser(post.authorId, likeTitle, likeBody, { type: 'like', postId: post.id });
                }
            } catch { }
        }
    };

    const handleShare = async () => {
        try {
            await Share.share({
                message: `${post.title}\n\n${post.body}\n\n— via Dolphin App`,
            });
        } catch { }
    };

    const toggleSave = async () => {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        const savedRef = doc(db, 'users', uid, 'saved_items', post.id);
        if (isSaved) {
            setIsSaved(false);
            try { await deleteDoc(savedRef); } catch { }
        } else {
            setIsSaved(true);
            try {
                await setDoc(savedRef, {
                    type: 'post',
                    title: post.title,
                    body: post.body || '',
                    authorName: post.authorName || '',
                    imageUrl: post.imageUrl || null,
                    savedAt: serverTimestamp(),
                });
            } catch { }
        }
    };

    const postPhotos: string[] = post.photos && post.photos.length > 0
        ? post.photos
        : (post.imageUrl ? [post.imageUrl] : []);

    const renderHeader = () => (
        <View style={styles.postSection}>
            {/* Photos — Hero */}
            {postPhotos.length > 0 && (
                <View style={styles.photoHeroWrap}>
                    <ScrollView
                        horizontal
                        pagingEnabled
                        showsHorizontalScrollIndicator={false}
                    >
                        {postPhotos.map((uri: string, idx: number) => (
                            <View key={idx} style={styles.photoHeroSlide}>
                                <Image
                                    source={{ uri }}
                                    style={styles.photoHeroImage}
                                    resizeMode="contain"
                                />
                            </View>
                        ))}
                    </ScrollView>
                    {postPhotos.length > 1 && (
                        <View style={styles.photoCountBadge}>
                            <Text style={styles.photoCountText}>{postPhotos.length} photos</Text>
                        </View>
                    )}
                </View>
            )}

            <View style={styles.authorRow}>
                {post.authorPhoto ? (
                    <Image source={{ uri: post.authorPhoto }} style={styles.avatar} />
                ) : (
                    <View style={[styles.avatar, styles.avatarFallback]}>
                        <Text style={styles.avatarText}>{(post.authorName || 'U')[0]}</Text>
                    </View>
                )}
                <View style={{ flex: 1 }}>
                    <Text style={styles.authorName}>{post.authorName}</Text>
                    <Text style={styles.postTime}>{timeAgo(post.createdAt)} · {viewCount} views</Text>
                </View>
            </View>
            <Text style={styles.postTitle}>{post.title}</Text>
            {post.bodyStyle ? (
                <HyperlinkText text={post.body} style={[
                    styles.postBody,
                    post.bodyStyle.bold && { fontWeight: '700' },
                    post.bodyStyle.italic && { fontStyle: 'italic' },
                    post.bodyStyle.fontSize && { fontSize: post.bodyStyle.fontSize },
                    post.bodyStyle.color && { color: post.bodyStyle.color },
                ]} />
            ) : (
                <HyperlinkText text={post.body} style={styles.postBody} />
            )}
            <View style={styles.actionsRow}>
                <TouchableOpacity style={styles.actionBtn} onPress={toggleLike}>
                    <Ionicons name={isLiked ? 'thumbs-up' : 'thumbs-up-outline'} size={20} color={isLiked ? '#2563EB' : theme.colors.textMuted} />
                    <Text style={[styles.actionText, isLiked && { color: '#2563EB' }]}>{likeCount}</Text>
                </TouchableOpacity>
                <View style={styles.actionBtn}>
                    <Ionicons name="chatbox-outline" size={18} color={theme.colors.textMuted} />
                    <Text style={styles.actionText}>{comments.length}</Text>
                </View>
                <TouchableOpacity style={styles.actionBtn} onPress={handleShare}>
                    <Ionicons name="share-outline" size={18} color={theme.colors.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={toggleSave}>
                    <Ionicons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={18} color={isSaved ? '#F59E0B' : theme.colors.textMuted} />
                </TouchableOpacity>
                <View style={{ flex: 1 }} />
                {post.chatEnabled && auth.currentUser?.uid !== post.authorId && (
                    <TouchableOpacity
                        style={styles.chatActionBtn}
                        onPress={async () => {
                            if (!auth.currentUser) return;
                            try {
                                const chatId = [auth.currentUser.uid, post.authorId].sort().join('_') + '_post_' + post.id;
                                const chatRef = doc(db, 'dolphin_chats', chatId);
                                const snap = await getDoc(chatRef);

                                if (!snap.exists()) {
                                    await setDoc(chatRef, {
                                        participants: [auth.currentUser.uid, post.authorId],
                                        participantNames: {
                                            [auth.currentUser.uid]: auth.currentUser.displayName || 'User',
                                            [post.authorId]: post.authorName || 'Author'
                                        },
                                        postId: post.id,
                                        postTitle: post.title,
                                        postType: 'lounge',
                                        chatSource: 'lounge',
                                        listingName: post.title,
                                        listingPhoto: post.imageUrl || null,
                                        lastMessage: '',
                                        updatedAt: serverTimestamp(),
                                        createdAt: serverTimestamp(),
                                    });
                                    // Notify post author about new chat
                                    const chatTitle = `${auth.currentUser.displayName || 'Someone'} wants to chat`;
                                    const chatBody = `About: ${post.title}`;
                                    addDoc(collection(db, 'dolphin_notifications'), {
                                        recipientId: post.authorId,
                                        type: 'chat',
                                        title: chatTitle,
                                        body: chatBody,
                                        postId: post.id,
                                        createdAt: serverTimestamp(),
                                        read: false,
                                    }).catch(() => { });
                                    sendPushToUser(post.authorId, chatTitle, chatBody, { type: 'chat', postId: post.id });
                                }
                                navigation.navigate('ChatRoom', {
                                    chatId,
                                    otherUserId: post.authorId,
                                    otherUserName: post.authorName,
                                    listingName: post.title,
                                    listingId: post.id,
                                    listingPhoto: post.imageUrl || null,
                                    chatSource: 'lounge',
                                });
                            } catch (e) {
                                console.error(e);
                            }
                        }}
                    >
                        <Ionicons name="chatbubbles" size={16} color="#fff" />
                        <Text style={styles.chatActionText}>Chat</Text>
                    </TouchableOpacity>
                )}
            </View>
            {comments.length > 0 && (
                <Text style={styles.commentsHeader}>Comments</Text>
            )}
        </View>
    );

    const handleDeleteComment = (comment: any) => {
        const uid = auth.currentUser?.uid;
        if (uid !== comment.authorId && uid !== post.authorId) return;
        Alert.alert('Delete Comment', 'Are you sure you want to delete this comment?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete', style: 'destructive', onPress: async () => {
                    try {
                        await deleteDoc(doc(db, 'lounge_posts', post.id, 'comments', comment.id));
                        await updateDoc(doc(db, 'lounge_posts', post.id), { commentCount: increment(-1) });
                    } catch { }
                }
            },
        ]);
    };

    const renderComment = ({ item }: any) => {
        const canDelete = auth.currentUser?.uid === item.authorId || auth.currentUser?.uid === post.authorId;
        return (
            <TouchableOpacity
                style={styles.commentCard}
                activeOpacity={0.8}
                onLongPress={() => canDelete && handleDeleteComment(item)}
                delayLongPress={500}
            >
                <View style={styles.commentAuthorRow}>
                    {item.authorPhoto ? (
                        <Image source={{ uri: item.authorPhoto }} style={styles.commentAvatar} />
                    ) : (
                        <View style={[styles.commentAvatar, styles.avatarFallback]}>
                            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 10 }}>{(item.authorName || 'U')[0]}</Text>
                        </View>
                    )}
                    <Text style={styles.commentAuthor}>{item.authorName}</Text>
                    <Text style={styles.commentTime}>{timeAgo(item.createdAt)}</Text>
                </View>
                <Text style={styles.commentText}>{item.text}</Text>
            </TouchableOpacity>
        );
    };

    const isPostOwner = auth.currentUser?.uid === post.authorId;

    const handlePostOptions = () => {
        if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    options: ['Cancel', 'Edit Post', 'Delete Post'],
                    destructiveButtonIndex: 2,
                    cancelButtonIndex: 0,
                },
                (index) => {
                    if (index === 1) navigation.navigate('CreatePost', { editPost: post });
                    else if (index === 2) {
                        Alert.alert('Delete Post', 'Are you sure?', [
                            { text: 'Cancel', style: 'cancel' },
                            {
                                text: 'Delete', style: 'destructive', onPress: async () => {
                                    try {
                                        await deleteDoc(doc(db, 'lounge_posts', post.id));
                                        navigation.goBack();
                                    } catch { Alert.alert('Error', 'Failed to delete.'); }
                                }
                            },
                        ]);
                    }
                }
            );
        } else {
            Alert.alert('Post Options', '', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Edit', onPress: () => navigation.navigate('CreatePost', { editPost: post }) },
                {
                    text: 'Delete', style: 'destructive', onPress: () => {
                        Alert.alert('Delete Post', 'Are you sure?', [
                            { text: 'Cancel', style: 'cancel' },
                            {
                                text: 'Delete', style: 'destructive', onPress: async () => {
                                    try {
                                        await deleteDoc(doc(db, 'lounge_posts', post.id));
                                        navigation.goBack();
                                    } catch { Alert.alert('Error', 'Failed to delete.'); }
                                }
                            },
                        ]);
                    }
                },
            ]);
        }
    };

    return (
        <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            {/* Header */}
            <View style={[styles.header, isWebDesktop && { paddingTop: 20 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Post</Text>
                {isPostOwner ? (
                    <TouchableOpacity onPress={handlePostOptions} style={{ padding: 4 }}>
                        <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.textPrimary} />
                    </TouchableOpacity>
                ) : (
                    <TouchableOpacity onPress={() => showReportBlockMenu({
                        targetUserId: post.authorId,
                        targetUserName: post.authorName || 'Unknown',
                        contentType: 'post',
                        contentId: post.id,
                        onBlocked: () => navigation.goBack(),
                    })} style={{ padding: 4 }}>
                        <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.textPrimary} />
                    </TouchableOpacity>
                )}
            </View>

            <FlatList
                ref={flatListRef}
                data={comments}
                keyExtractor={item => item.id}
                renderItem={renderComment}
                ListHeaderComponent={renderHeader}
                contentContainerStyle={{ paddingBottom: 20 }}
            />

            {/* Comment Input */}
            <View style={styles.inputRow}>
                <TextInput
                    style={styles.input}
                    placeholder="Write a comment..."
                    placeholderTextColor={theme.colors.textMuted}
                    value={input}
                    onChangeText={setInput}
                    returnKeyType="send"
                    onSubmitEditing={sendComment}
                />
                <TouchableOpacity style={styles.sendBtn} onPress={sendComment} disabled={!input.trim()}>
                    <Ionicons name="send" size={18} color={input.trim() ? '#fff' : '#ffffff80'} />
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: theme.spacing.md, paddingTop: 60, paddingBottom: 12,
        backgroundColor: theme.colors.surface, ...theme.shadows.sm,
    },
    backBtn: { padding: 4 },
    headerTitle: { ...theme.typography.h3, color: theme.colors.textPrimary },
    postSection: { padding: theme.spacing.md, backgroundColor: theme.colors.surface, marginBottom: 8 },
    authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
    avatar: { width: 40, height: 40, borderRadius: r(20), backgroundColor: theme.colors.surfaceAlt },
    avatarFallback: { justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.primaryLight },
    avatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
    authorName: { ...theme.typography.bodyBold, color: theme.colors.textPrimary },
    postTime: { ...theme.typography.tiny, color: theme.colors.textMuted },
    postTitle: { ...theme.typography.h2, color: theme.colors.textPrimary, marginBottom: 8, fontSize: 20 },
    postImage: { width: '100%', height: 250, borderRadius: r(12), marginBottom: 16, backgroundColor: theme.colors.surfaceAlt },
    photoHeroWrap: { position: 'relative', marginBottom: 16, marginHorizontal: -theme.spacing.md, backgroundColor: '#000' },
    photoHeroSlide: { width: Dimensions.get('window').width, height: 280, justifyContent: 'center', alignItems: 'center' },
    photoHeroImage: { width: '100%', height: '100%' },
    photoCountBadge: {
        position: 'absolute', bottom: 10, right: 14,
        backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: r(12),
    },
    photoCountText: { color: '#fff', fontSize: 12, fontWeight: '600' },
    postBody: { ...theme.typography.body, color: theme.colors.textSecondary, lineHeight: 22, fontSize: 15, marginBottom: 16 },
    actionsRow: { flexDirection: 'row', gap: 24, borderTopWidth: 1, borderTopColor: theme.colors.borderLight, paddingTop: 12 },
    actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    actionText: { ...theme.typography.caption, color: theme.colors.textMuted, fontWeight: '600' },
    chatActionBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        backgroundColor: '#2563EB', paddingHorizontal: 12, paddingVertical: 6,
        borderRadius: r(16),
    },
    chatActionText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    commentsHeader: { ...theme.typography.h3, color: theme.colors.textPrimary, marginTop: 20, fontSize: 16 },
    commentCard: {
        paddingHorizontal: theme.spacing.md, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: theme.colors.borderLight,
        backgroundColor: theme.colors.surface,
    },
    commentAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
    commentAvatar: { width: 24, height: 24, borderRadius: r(12), backgroundColor: theme.colors.surfaceAlt },
    commentAuthor: { ...theme.typography.caption, fontWeight: '700', color: theme.colors.textPrimary },
    commentTime: { ...theme.typography.tiny, color: theme.colors.textMuted },
    commentText: { ...theme.typography.body, color: theme.colors.textSecondary, fontSize: 14, lineHeight: 20, marginLeft: 32 },
    inputRow: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        padding: 12, paddingBottom: 34, backgroundColor: theme.colors.surface,
        borderTopWidth: 1, borderTopColor: theme.colors.border,
    },
    input: {
        flex: 1, backgroundColor: theme.colors.surfaceAlt, borderRadius: r(20),
        paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, color: theme.colors.textPrimary,
    },
    sendBtn: {
        width: 36, height: 36, borderRadius: r(18), backgroundColor: theme.colors.primary,
        justifyContent: 'center', alignItems: 'center',
    },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheetContainer: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: Platform.OS === 'ios' ? 40 : 20 },
    sheetHandle: { width: 40, height: 4, backgroundColor: '#E2E8F0', borderRadius: r(2), alignSelf: 'center', marginBottom: 16 },
    sheetTitle: { fontSize: 17, fontWeight: '800', color: theme.colors.textPrimary, marginBottom: 16 },
    menuOption: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: r(14), backgroundColor: '#F8FAFC', marginBottom: 10 },
    menuOptionDanger: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: r(14), backgroundColor: '#FEF2F2', marginBottom: 10 },
    menuOptionText: { fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary },
    sheetCancel: { backgroundColor: '#F1F5F9', padding: 16, borderRadius: r(14), alignItems: 'center', marginTop: 4 },
    sheetCancelText: { fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary },
});
