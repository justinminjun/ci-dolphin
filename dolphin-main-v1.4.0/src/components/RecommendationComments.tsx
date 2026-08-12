import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Image, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/theme';
import { db, auth } from '../config/firebase';
import {
    collection, query, orderBy, onSnapshot, addDoc, doc,
    updateDoc, increment, serverTimestamp, deleteDoc,
} from 'firebase/firestore';
import { sendPushToUser } from '../utils/notifications';

function timeAgo(timestamp: any): string {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const diff = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString();
}

interface RecComment {
    id: string;
    text: string;
    authorId: string;
    authorName: string;
    authorPhoto?: string;
    createdAt: any;
}

interface Props {
    recId: string;
    recTitle: string;
    recAuthorId?: string;
    /** Called when the input gains focus (e.g. to expand the map bottom sheet) */
    onInputFocus?: () => void;
}

export function RecommendationComments({ recId, recTitle, recAuthorId, onInputFocus }: Props) {
    const [comments, setComments] = useState<RecComment[]>([]);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const uid = auth.currentUser?.uid;

    useEffect(() => {
        const q = query(
            collection(db, 'local_recommendations', recId, 'comments'),
            orderBy('createdAt', 'asc'),
        );
        return onSnapshot(q, snap => {
            setComments(snap.docs.map(d => ({ id: d.id, ...d.data() } as RecComment)));
        }, () => {});
    }, [recId]);

    const submit = async () => {
        const user = auth.currentUser;
        const text = input.trim();
        if (!user || !text || sending) return;
        setSending(true);
        setInput('');
        try {
            await addDoc(collection(db, 'local_recommendations', recId, 'comments'), {
                text,
                authorId: user.uid,
                authorName: user.displayName || 'Anonymous',
                authorPhoto: user.photoURL || null,
                createdAt: serverTimestamp(),
            });
            updateDoc(doc(db, 'local_recommendations', recId), {
                commentCount: increment(1),
            }).catch(() => {});
            // Notify the recommendation author
            if (recAuthorId && recAuthorId !== user.uid) {
                const title = `${user.displayName || 'Someone'} commented on your recommendation`;
                const body = text.substring(0, 100);
                addDoc(collection(db, 'dolphin_notifications'), {
                    recipientId: recAuthorId,
                    type: 'comment',
                    title,
                    body: `${recTitle}: ${body}`,
                    createdAt: serverTimestamp(),
                    read: false,
                }).catch(() => {});
                sendPushToUser(recAuthorId, title, body, { type: 'comment' });
            }
        } catch {
            Alert.alert('Error', 'Failed to post comment.');
        } finally {
            setSending(false);
        }
    };

    const handleDelete = (comment: RecComment) => {
        if (comment.authorId !== uid) return;
        Alert.alert('Delete Comment', 'Delete this comment?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete', style: 'destructive',
                onPress: async () => {
                    try {
                        await deleteDoc(doc(db, 'local_recommendations', recId, 'comments', comment.id));
                        updateDoc(doc(db, 'local_recommendations', recId), {
                            commentCount: increment(-1),
                        }).catch(() => {});
                    } catch {}
                },
            },
        ]);
    };

    return (
        <View style={styles.container}>
            <Text style={styles.header}>
                Comments{comments.length > 0 ? ` (${comments.length})` : ''}
            </Text>

            {comments.length === 0 ? (
                <Text style={styles.emptyText}>Be the first to comment!</Text>
            ) : (
                comments.map(c => (
                    <View key={c.id} style={styles.commentRow}>
                        {c.authorPhoto ? (
                            <Image source={{ uri: c.authorPhoto }} style={styles.avatar} />
                        ) : (
                            <View style={[styles.avatar, styles.avatarPlaceholder]}>
                                <Ionicons name="person" size={13} color="#94A3B8" />
                            </View>
                        )}
                        <View style={{ flex: 1 }}>
                            <View style={styles.commentMetaRow}>
                                <Text style={styles.commentAuthor} numberOfLines={1}>{c.authorName}</Text>
                                <Text style={styles.commentTime}>{timeAgo(c.createdAt)}</Text>
                                {c.authorId === uid && (
                                    <TouchableOpacity
                                        onPress={() => handleDelete(c)}
                                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                    >
                                        <Ionicons name="trash-outline" size={13} color="#94A3B8" />
                                    </TouchableOpacity>
                                )}
                            </View>
                            <Text style={styles.commentText}>{c.text}</Text>
                        </View>
                    </View>
                ))
            )}

            {/* Input */}
            <View style={styles.inputRow}>
                <TextInput
                    style={styles.input}
                    placeholder="Add a comment…"
                    placeholderTextColor="#94A3B8"
                    value={input}
                    onChangeText={setInput}
                    onFocus={onInputFocus}
                    multiline
                    maxLength={300}
                />
                <TouchableOpacity
                    style={[styles.sendBtn, (!input.trim() || sending) && { opacity: 0.4 }]}
                    onPress={submit}
                    disabled={!input.trim() || sending}
                >
                    <Ionicons name="arrow-up" size={17} color="#fff" />
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginTop: 14,
    },
    header: {
        fontSize: 14, fontWeight: '800', color: '#0F172A', marginBottom: 8,
    },
    emptyText: {
        fontSize: 12, color: '#94A3B8', marginBottom: 4,
    },
    commentRow: {
        flexDirection: 'row', gap: 8, paddingVertical: 7,
    },
    avatar: {
        width: 26, height: 26, borderRadius: 13,
    },
    avatarPlaceholder: {
        backgroundColor: '#E2E8F0', justifyContent: 'center', alignItems: 'center',
    },
    commentMetaRow: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
    },
    commentAuthor: {
        fontSize: 12, fontWeight: '700', color: '#334155', flexShrink: 1,
    },
    commentTime: {
        fontSize: 11, color: '#94A3B8', flex: 1,
    },
    commentText: {
        fontSize: 13, color: '#475569', lineHeight: 18, marginTop: 2,
    },
    inputRow: {
        flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 8,
    },
    input: {
        flex: 1, minHeight: 38, maxHeight: 90,
        backgroundColor: '#F1F5F9', borderRadius: 19,
        paddingHorizontal: 14, paddingVertical: 9,
        fontSize: 13, color: '#1E293B',
    },
    sendBtn: {
        width: 38, height: 38, borderRadius: 19,
        backgroundColor: theme.colors.primary,
        justifyContent: 'center', alignItems: 'center',
    },
});
