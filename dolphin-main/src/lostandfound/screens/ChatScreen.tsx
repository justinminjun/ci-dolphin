import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, Image, Alert, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme/theme';
import { auth, db } from '../config/firebase';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, setDoc, getDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { getRoleLabel } from '../utils/userRole';
import { sendPushNotification } from '../utils/notifications';

export function ChatScreen({ route, navigation }: any) {
    const { recipientId, recipientName, postId, postTitle, postImage, chatId: existingChatId } = route.params;
    const currentUser = auth.currentUser;

    const [messages, setMessages] = useState<any[]>([]);
    const [inputText, setInputText] = useState('');
    const [postInfo, setPostInfo] = useState<any>(null);
    const [postStatus, setPostStatus] = useState<string>('active');
    const [recipientEmail, setRecipientEmail] = useState<string>('');
    const [showReport, setShowReport] = useState(false);
    const [reportReason, setReportReason] = useState('');
    const flatListRef = useRef<FlatList>(null);

    // Use existing chatId from ChatListScreen (exact Firestore doc ID), or compute for new chats
    const userPair = [currentUser?.uid, recipientId].sort().join('_');
    const chatId = existingChatId || (postId ? `${userPair}_${postId}` : userPair);

    useLayoutEffect(() => {
        navigation.setOptions({
            headerRight: () => (
                <TouchableOpacity
                    onPress={() => setShowReport(true)}
                    style={{ marginRight: 4, paddingHorizontal: 10, paddingVertical: 8 }}
                    activeOpacity={0.7}
                >
                    <Ionicons name="flag-outline" size={20} color={theme.colors.danger} />
                </TouchableOpacity>
            ),
        });
    }, [navigation]);

    useEffect(() => {
        if (!currentUser) return;
        const unsubs: (() => void)[] = [];

        // Build chat metadata (no updatedAt — only set on message send)
        const chatMeta: any = {
            participants: [currentUser.uid, recipientId],
            participantNames: { [currentUser.uid]: currentUser.displayName || currentUser.email, [recipientId]: recipientName },
        };

        if (postId) {
            chatMeta.postId = postId;
            if (postTitle) chatMeta.postTitle = postTitle;
            if (postImage) chatMeta.postImage = postImage;
        }

        setDoc(doc(db, 'chats', chatId), chatMeta, { merge: true });

        // Mark as read
        setDoc(doc(db, 'chats', chatId), {
            lastRead: { [currentUser.uid]: Timestamp.now() }
        }, { merge: true });

        // Fetch recipient email from users collection
        getDoc(doc(db, 'users', recipientId)).then((snap) => {
            if (snap.exists()) {
                setRecipientEmail(snap.data().email || '');
            }
        });

        // Listen to messages
        const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'asc'));
        unsubs.push(onSnapshot(q, (snapshot) => {
            setMessages(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
            setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
        }, (error) => console.error('Chat error:', error)));

        // Listen to chat doc
        unsubs.push(onSnapshot(doc(db, 'chats', chatId), (docSnap) => {
            if (!docSnap.exists()) return;
            const data = docSnap.data();
            const thePostId = postId || data.postId;

            if (thePostId) {
                getDoc(doc(db, 'posts', thePostId)).then((postSnap) => {
                    if (postSnap.exists()) {
                        const postData = postSnap.data();
                        const img = postData.imageUrls?.[0] || postData.imageUrl || null;
                        const title = postData.title || null;

                        setPostInfo({ id: thePostId, title, image: img });
                        setPostStatus(postData.status || 'active');

                        if (!data.postImage && img) {
                            setDoc(doc(db, 'chats', chatId), {
                                postId: thePostId,
                                postTitle: title,
                                postImage: img,
                            }, { merge: true });
                        }
                    }
                });

                unsubs.push(onSnapshot(doc(db, 'posts', thePostId), (postSnap) => {
                    if (postSnap.exists()) {
                        setPostStatus(postSnap.data().status || 'active');
                    }
                }));
            }
        }));

        return () => {
            setDoc(doc(db, 'chats', chatId), {
                lastRead: { [currentUser.uid]: Timestamp.now() }
            }, { merge: true });
            unsubs.forEach(u => u());
        };
    }, [chatId]);

    const sendMessage = async () => {
        if (!inputText.trim() || !currentUser) return;
        const text = inputText;
        setInputText('');

        try {
            await addDoc(collection(db, 'chats', chatId, 'messages'), {
                text,
                senderId: currentUser.uid,
                createdAt: serverTimestamp(),
            });
            await setDoc(doc(db, 'chats', chatId), {
                updatedAt: serverTimestamp(),
                lastMessage: text,
            }, { merge: true });

            // Send push notification to recipient
            try {
                const recipientDoc = await getDoc(doc(db, 'users', recipientId));
                if (recipientDoc.exists()) {
                    const pushToken = recipientDoc.data().pushToken;
                    if (pushToken) {
                        const senderName = currentUser.displayName || 'Someone';
                        await sendPushNotification(
                            pushToken,
                            senderName,
                            text,
                            { chatId, senderId: currentUser.uid }
                        );
                    }
                }
            } catch (pushErr) {
                // Silently fail — push is best-effort
                console.log('Push notification failed:', pushErr);
            }
        } catch (error) { console.error('Send error:', error); }
    };

    const handleResolve = () => {
        const thePostId = postInfo?.id || postId;
        if (!thePostId) return;

        const newStatus = postStatus === 'resolved' ? 'active' : 'resolved';
        Alert.alert(
            newStatus === 'resolved' ? 'Mark as Resolved' : 'Reopen Post',
            newStatus === 'resolved'
                ? 'Has this item been returned or found?'
                : 'Do you want to reopen this post?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: newStatus === 'resolved' ? 'Resolve' : 'Reopen',
                    onPress: async () => {
                        try {
                            await updateDoc(doc(db, 'posts', thePostId), { status: newStatus });
                            setPostStatus(newStatus);
                        } catch (e) {
                            Alert.alert('Error', 'Failed to update status.');
                        }
                    }
                }
            ]
        );
    };

    const handleReport = async () => {
        if (!reportReason.trim()) {
            Alert.alert('Error', 'Please enter a reason for reporting.');
            return;
        }
        try {
            await addDoc(collection(db, 'reports'), {
                chatId,
                reporterId: currentUser?.uid,
                reporterName: currentUser?.displayName || currentUser?.email,
                reporterEmail: currentUser?.email,
                reportedUserId: recipientId,
                reportedUserName: recipientName,
                reportedUserEmail: recipientEmail,
                reason: reportReason.trim(),
                postId: postInfo?.id || postId || null,
                postTitle: postInfo?.title || postTitle || null,
                createdAt: serverTimestamp(),
                status: 'pending', // pending | reviewed | dismissed
            });
            setShowReport(false);
            setReportReason('');
            Alert.alert('Reported', 'Your report has been submitted to the admin for review.');
        } catch (e) {
            Alert.alert('Error', 'Failed to submit report.');
        }
    };

    const renderMessage = ({ item }: { item: any }) => {
        const isMe = item.senderId === currentUser?.uid;
        return (
            <View style={[styles.messageBubble, isMe ? styles.myMessage : styles.theirMessage]}>
                <Text style={[styles.messageText, isMe && styles.myMessageText]}>{item.text}</Text>
            </View>
        );
    };

    const displayImage = postInfo?.image || postImage;
    const displayTitle = postInfo?.title || postTitle;
    const hasPostContext = displayImage || displayTitle;
    const roleLabel = recipientEmail ? getRoleLabel(recipientEmail) : '';

    return (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container} keyboardVerticalOffset={90}>
            {/* Item context header */}
            {hasPostContext && (
                <View style={styles.itemHeader}>
                    {displayImage && (
                        <Image source={{ uri: displayImage }} style={styles.itemImage} />
                    )}
                    <View style={styles.itemInfo}>
                        <Text style={styles.itemTitle} numberOfLines={1}>{displayTitle || 'Item'}</Text>
                        <View style={styles.itemMetaRow}>
                            <Text style={styles.itemStatus}>
                                {postStatus === 'resolved' ? 'Resolved' : 'Active'}
                            </Text>
                            {roleLabel !== '' && (
                                <View style={[styles.roleBadge, roleLabel === 'Student' ? styles.roleBadgeStudent : styles.roleBadgeFaculty]}>
                                    <Text style={[styles.roleBadgeText, roleLabel === 'Student' ? styles.roleBadgeTextStudent : styles.roleBadgeTextFaculty]}>
                                        {recipientName} · {roleLabel}
                                    </Text>
                                </View>
                            )}
                        </View>
                    </View>
                    {(postInfo?.id || postId) && (
                        <TouchableOpacity
                            style={[styles.resolveChip, postStatus === 'resolved' && styles.resolveChipDone]}
                            onPress={handleResolve}
                            activeOpacity={0.7}
                        >
                            <Text style={[styles.resolveChipText, postStatus === 'resolved' && styles.resolveChipTextDone]}>
                                {postStatus === 'resolved' ? 'Reopen' : 'Resolve'}
                            </Text>
                        </TouchableOpacity>
                    )}
                </View>
            )}

            {/* If no post context, show minimal role badge row */}
            {!hasPostContext && roleLabel !== '' && (
                <View style={styles.minimalHeader}>
                    <View style={[styles.roleBadge, roleLabel === 'Student' ? styles.roleBadgeStudent : styles.roleBadgeFaculty]}>
                        <Text style={[styles.roleBadgeText, roleLabel === 'Student' ? styles.roleBadgeTextStudent : styles.roleBadgeTextFaculty]}>
                            {recipientName} · {roleLabel}
                        </Text>
                    </View>
                </View>
            )}

            <FlatList
                ref={flatListRef}
                data={messages}
                keyExtractor={item => item.id}
                renderItem={renderMessage}
                contentContainerStyle={styles.list}
                onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
            />
            <View style={styles.inputContainer}>
                <TextInput
                    style={styles.input}
                    placeholder="Type a message..."
                    placeholderTextColor={theme.colors.textMuted}
                    value={inputText}
                    onChangeText={setInputText}
                    returnKeyType="send"
                    onSubmitEditing={sendMessage}
                />
                <TouchableOpacity style={styles.sendButton} onPress={sendMessage} activeOpacity={0.7}>
                    <Ionicons name="send" size={18} color="#fff" />
                </TouchableOpacity>
            </View>

            {/* Report Modal */}
            <Modal visible={showReport} transparent animationType="fade">
                <View style={styles.modalOverlay}>
                    <View style={styles.modalCard}>
                        <Text style={styles.modalTitle}>Report User</Text>
                        <Text style={styles.modalSubtitle}>Report {recipientName} for inappropriate behavior</Text>
                        <TextInput
                            style={styles.modalInput}
                            placeholder="Describe the issue..."
                            placeholderTextColor={theme.colors.textMuted}
                            value={reportReason}
                            onChangeText={setReportReason}
                            multiline
                            numberOfLines={4}
                            textAlignVertical="top"
                        />
                        <View style={styles.modalActions}>
                            <TouchableOpacity style={styles.modalCancel} onPress={() => { setShowReport(false); setReportReason(''); }}>
                                <Text style={styles.modalCancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.modalSubmit} onPress={handleReport}>
                                <Text style={styles.modalSubmitText}>Submit Report</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },

    // Item context header
    itemHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border, gap: theme.spacing.sm },
    itemImage: { width: 44, height: 44, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt },
    itemInfo: { flex: 1 },
    itemTitle: { ...theme.typography.body, fontWeight: '600', color: theme.colors.textPrimary },
    itemMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
    itemStatus: { ...theme.typography.caption, color: theme.colors.textMuted },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },

    // Minimal header (no post context)
    minimalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border },

    // Role badge
    roleBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: theme.radius.sm },
    roleBadgeStudent: { backgroundColor: '#EEF2FF' },
    roleBadgeFaculty: { backgroundColor: '#FEF3C7' },
    roleBadgeText: { fontSize: 10, fontWeight: '600' },
    roleBadgeTextStudent: { color: '#4338CA' },
    roleBadgeTextFaculty: { color: '#D97706' },

    // Resolve chip
    resolveChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: theme.radius.full, backgroundColor: '#ECFDF5', borderWidth: 1, borderColor: '#A7F3D0' },
    resolveChipDone: { backgroundColor: theme.colors.surfaceAlt, borderColor: theme.colors.border },
    resolveChipText: { fontSize: 11, fontWeight: '600', color: theme.colors.success },
    resolveChipTextDone: { color: theme.colors.textMuted },

    // Report button
    reportBtn: { padding: 6 },

    list: { padding: theme.spacing.md, flexGrow: 1, justifyContent: 'flex-end' },
    messageBubble: { padding: 12, borderRadius: theme.radius.lg, maxWidth: '78%', marginBottom: theme.spacing.xs },
    myMessage: { backgroundColor: theme.colors.chatMe, alignSelf: 'flex-end', borderBottomRightRadius: 4 },
    theirMessage: { backgroundColor: theme.colors.chatThem, alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
    messageText: { ...theme.typography.body, color: theme.colors.textPrimary },
    myMessageText: { color: '#fff' },
    inputContainer: { flexDirection: 'row', padding: theme.spacing.md, backgroundColor: theme.colors.surface, borderTopWidth: 1, borderColor: theme.colors.border, paddingBottom: Platform.OS === 'ios' ? 30 : theme.spacing.md, gap: theme.spacing.sm },
    input: { flex: 1, backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.full, paddingHorizontal: theme.spacing.md, paddingVertical: 10, fontSize: 15, color: theme.colors.textPrimary },
    sendButton: { backgroundColor: theme.colors.primary, borderRadius: theme.radius.full, width: 42, height: 42, justifyContent: 'center', alignItems: 'center' },
    sendButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },

    // Report modal
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    modalCard: { backgroundColor: '#fff', borderRadius: theme.radius.xl, padding: theme.spacing.lg, width: '100%', maxWidth: 360 },
    modalTitle: { ...theme.typography.h2, color: theme.colors.textPrimary, marginBottom: 4 },
    modalSubtitle: { ...theme.typography.bodySecondary, color: theme.colors.textSecondary, marginBottom: theme.spacing.md },
    modalInput: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.lg, padding: 14, fontSize: 15, color: theme.colors.textPrimary, minHeight: 100, borderWidth: 1, borderColor: theme.colors.border },
    modalActions: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.md },
    modalCancel: { flex: 1, paddingVertical: 12, borderRadius: theme.radius.lg, alignItems: 'center', backgroundColor: theme.colors.surfaceAlt },
    modalCancelText: { fontWeight: '600', color: theme.colors.textSecondary },
    modalSubmit: { flex: 1, paddingVertical: 12, borderRadius: theme.radius.lg, alignItems: 'center', backgroundColor: theme.colors.danger },
    modalSubmitText: { fontWeight: '600', color: '#fff' },
});
