import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import {
    View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList,
    KeyboardAvoidingView, Platform, Alert, Image, Modal, ScrollView,
    ActionSheetIOS, ActivityIndicator, Dimensions, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, r } from '../theme/theme';
import { auth, db } from '../config/firebase';
import {
    collection, addDoc, query, orderBy, onSnapshot, serverTimestamp,
    doc, setDoc, getDoc, updateDoc, arrayUnion, Timestamp,
} from 'firebase/firestore';
import { sendPushNotification, sendPushToUser } from '../utils/notifications';
import { formatPrice } from '../utils/price';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useGlow } from '../context/GlowContext';
import { showReportBlockMenu } from '../utils/moderation';

const STORAGE_BUCKET = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || 'lost-and-found-20c10.firebasestorage.app';

// Global active chat ID — used to suppress notifications for the currently open chat
export let activeChatId: string | null = null;

// ─── Helpers ───
function formatDateLabel(date: Date): string {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = today.getTime() - d.getTime();
    if (diff === 0) return 'Today';
    if (diff === 86400000) return 'Yesterday';
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatTime(ts: any): string {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// ─── Typing Dots Animation ───
function TypingDots({ name }: { name: string }) {
    const dot1 = useRef(new Animated.Value(0)).current;
    const dot2 = useRef(new Animated.Value(0)).current;
    const dot3 = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const bounce = (dot: Animated.Value, delay: number) =>
            Animated.loop(
                Animated.sequence([
                    Animated.delay(delay),
                    Animated.timing(dot, { toValue: -6, duration: 250, useNativeDriver: true }),
                    Animated.timing(dot, { toValue: 0, duration: 250, useNativeDriver: true }),
                    Animated.delay(600 - delay),
                ])
            );
        const a1 = bounce(dot1, 0);
        const a2 = bounce(dot2, 200);
        const a3 = bounce(dot3, 400);
        a1.start(); a2.start(); a3.start();
        return () => { a1.stop(); a2.stop(); a3.stop(); };
    }, []);

    const dotStyle = (anim: Animated.Value) => ({
        ...typingStyles.dot,
        transform: [{ translateY: anim }],
    });

    return (
        <View style={typingStyles.wrap}>
            <View style={typingStyles.bubble}>
                <Animated.View style={dotStyle(dot1)} />
                <Animated.View style={dotStyle(dot2)} />
                <Animated.View style={dotStyle(dot3)} />
            </View>
            <Text style={typingStyles.text}>{name} is typing...</Text>
        </View>
    );
}

const typingStyles = StyleSheet.create({
    wrap: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
    bubble: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#E2E8F0', borderRadius: r(16), paddingHorizontal: 12, paddingVertical: 10 },
    dot: { width: 7, height: 7, borderRadius: r(3.5), backgroundColor: '#94A3B8' },
    text: { fontSize: 12, color: '#94A3B8', fontStyle: 'italic' },
});

// ─── Appointment Modal ───
function AppointmentModal({ visible, onClose, onSubmit, otherUserName }: any) {
    const [date, setDate] = useState(new Date(Date.now() + 86400000));
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [showTimePicker, setShowTimePicker] = useState(false);
    const [location, setLocation] = useState('');
    const [reminder, setReminder] = useState('30min');

    const reminderOptions = [
        { label: '5 min', value: '5min' },
        { label: '15 min', value: '15min' },
        { label: '30 min', value: '30min' },
        { label: '1 hour', value: '1hour' },
        { label: '2 hours', value: '2hours' },
    ];

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
            <View style={ms.container}>
                <View style={ms.header}>
                    <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color={theme.colors.textPrimary} /></TouchableOpacity>
                    <Text style={ms.headerTitle}>Schedule Meetup</Text>
                    <View style={{ width: 24 }} />
                </View>
                <ScrollView style={ms.body} contentContainerStyle={{ paddingBottom: 40 }}>
                    <Text style={ms.subtitle}>Arrange a meetup with {otherUserName}</Text>

                    {/* Date */}
                    <TouchableOpacity style={ms.row} onPress={() => setShowDatePicker(true)}>
                        <View style={ms.rowLeft}><Ionicons name="calendar-outline" size={20} color="#F97316" /><Text style={ms.rowLabel}>Date</Text></View>
                        <Text style={ms.rowValue}>{date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
                    </TouchableOpacity>
                    {showDatePicker && (
                        <DateTimePicker value={date} mode="date" minimumDate={new Date()} onChange={(e, d) => { setShowDatePicker(false); if (d) setDate(prev => { const n = new Date(prev); n.setFullYear(d.getFullYear(), d.getMonth(), d.getDate()); return n; }); }} />
                    )}

                    {/* Time */}
                    <TouchableOpacity style={ms.row} onPress={() => setShowTimePicker(true)}>
                        <View style={ms.rowLeft}><Ionicons name="time-outline" size={20} color="#F97316" /><Text style={ms.rowLabel}>Time</Text></View>
                        <Text style={ms.rowValue}>{date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</Text>
                    </TouchableOpacity>
                    {showTimePicker && (
                        <DateTimePicker value={date} mode="time" onChange={(e, d) => { setShowTimePicker(false); if (d) setDate(prev => { const n = new Date(prev); n.setHours(d.getHours(), d.getMinutes()); return n; }); }} />
                    )}

                    {/* Location */}
                    <View style={ms.row}>
                        <View style={ms.rowLeft}><Ionicons name="location-outline" size={20} color="#F97316" /><Text style={ms.rowLabel}>Location</Text></View>
                    </View>
                    <TextInput
                        style={ms.locationInput}
                        placeholder="e.g. Main Gate, Library 2F, Cafeteria..."
                        placeholderTextColor={theme.colors.textMuted}
                        value={location}
                        onChangeText={setLocation}
                        multiline
                    />

                    {/* Reminder */}
                    <View style={ms.reminderSection}>
                        <View style={ms.rowLeft}><Ionicons name="notifications-outline" size={20} color="#F97316" /><Text style={ms.rowLabel}>Reminder before meetup</Text></View>
                        <View style={ms.reminderRow}>
                            {reminderOptions.map(opt => (
                                <TouchableOpacity
                                    key={opt.value}
                                    style={[ms.reminderChip, reminder === opt.value && ms.reminderChipActive]}
                                    onPress={() => setReminder(opt.value)}
                                >
                                    <Text style={[ms.reminderChipText, reminder === opt.value && ms.reminderChipTextActive]}>{opt.label}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>
                </ScrollView>

                <View style={ms.footer}>
                    <TouchableOpacity
                        style={[ms.createBtn, !location.trim() && { opacity: 0.5 }]}
                        disabled={!location.trim()}
                        onPress={() => onSubmit({ date: date.toISOString(), location: location.trim(), reminder })}
                    >
                        <Text style={ms.createBtnText}>Create Meetup</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
}

const ms = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.borderLight },
    headerTitle: { fontSize: 17, fontWeight: '700', color: theme.colors.textPrimary },
    body: { flex: 1, padding: 20 },
    subtitle: { fontSize: 14, color: theme.colors.textMuted, marginBottom: 24 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.borderLight },
    rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    rowLabel: { fontSize: 16, fontWeight: '600', color: theme.colors.textPrimary },
    rowValue: { fontSize: 15, color: theme.colors.textSecondary },
    locationInput: { backgroundColor: theme.colors.surfaceAlt, borderRadius: r(12), padding: 14, fontSize: 15, color: theme.colors.textPrimary, minHeight: 50, marginTop: 8, marginBottom: 8 },
    reminderSection: { marginTop: 20 },
    reminderRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    reminderChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: r(20), backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.borderLight },
    reminderChipActive: { backgroundColor: '#FFF7ED', borderColor: '#F97316' },
    reminderChipText: { fontSize: 13, fontWeight: '600', color: theme.colors.textMuted },
    reminderChipTextActive: { color: '#F97316' },
    footer: { padding: 20, paddingBottom: 36, backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.borderLight },
    createBtn: { backgroundColor: '#F97316', padding: 16, borderRadius: r(14), alignItems: 'center' },
    createBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});

// ─── Main Component ───
export function ChatRoomScreen({ route, navigation }: any) {
    const {
        chatId, otherUserId, otherUserName,
        listingName, listingId, listingPhoto,
        listingPrice, listingCurrency, postType,
        chatSource,
    } = route.params;
    const currentUser = auth.currentUser;

    const [messages, setMessages] = useState<any[]>([]);
    const [inputText, setInputText] = useState('');
    const [isPostOwner, setIsPostOwner] = useState(false);
    const [showAppointment, setShowAppointment] = useState(false);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [showBankConfirm, setShowBankConfirm] = useState(false);
    const [showBankSetup, setShowBankSetup] = useState(false);
    const [bankInfo, setBankInfo] = useState<{ bankName: string; accountNumber: string; accountHolder: string } | null>(null);
    const [bankName, setBankName] = useState('');
    const [bankAccount, setBankAccount] = useState('');
    const [bankHolder, setBankHolder] = useState('');
    const bankFadeAnim = useState(new Animated.Value(0))[0];
    const [fetchedPrice, setFetchedPrice] = useState<number | undefined>(listingPrice);
    const [fetchedCurrency, setFetchedCurrency] = useState<string | undefined>(listingCurrency);
    const [stagedImage, setStagedImage] = useState<string | null>(null);
    const [viewImage, setViewImage] = useState<string | null>(null);
    const [isConfirmedBuyerChat, setIsConfirmedBuyerChat] = useState(false);
    const [showChatPassConfirm, setShowChatPassConfirm] = useState(false);
    const [showCancelConfirm, setShowCancelConfirm] = useState(false);
    const [showSoldConfirm, setShowSoldConfirm] = useState(false);
    const [otherLastRead, setOtherLastRead] = useState<any>(null);
    const [otherIsTyping, setOtherIsTyping] = useState(false);
    const typingTimeoutRef = useRef<any>(null);
    const flatListRef = useRef<FlatList>(null);

    // Track active chat for notification suppression + dismiss on entry
    useEffect(() => {
        activeChatId = chatId;
        try { Notifications.dismissAllNotificationsAsync(); } catch {}
        return () => {
            activeChatId = null;
            // Clear typing state on exit
            if (currentUser) {
                setDoc(doc(db, 'dolphin_chats', chatId), {
                    typing: { [currentUser.uid]: null }
                }, { merge: true }).catch(() => {});
            }
        };
    }, [chatId]);

    const [actualSource, setActualSource] = useState(chatSource || postType || 'lounge');

    // Resolve actual source from Firestore if not provided via route params
    useEffect(() => {
        if (chatSource || postType) return; // already known
        const unsub = onSnapshot(doc(db, 'dolphin_chats', chatId), (snap) => {
            if (!snap.exists()) return;
            const data = snap.data();
            const resolved = data.chatSource || data.postType || 'lounge';
            setActualSource(resolved);
        });
        return unsub;
    }, [chatId, chatSource, postType]);

    const myBubbleColor = actualSource === 'market'    ? '#F97316'
        : actualSource === 'lostfound'                 ? '#059669'
        : '#6366F1'; // lounge = purple

    // ── Glow border follows chat source ──────────────────────────────────────
    const { glowColor: currentGlow, setGlowColor } = useGlow();
    const prevGlowRef = useRef(currentGlow);
    useEffect(() => {
        setGlowColor(myBubbleColor);
        return () => {
            setGlowColor(prevGlowRef.current);
        };
    }, [myBubbleColor]);

    useLayoutEffect(() => {
        navigation.setOptions({ headerTitle: otherUserName || 'Chat', headerBackTitle: 'Back' });
    }, [navigation, otherUserName]);

    useEffect(() => {
        if (!currentUser) return;
        const unsubs: (() => void)[] = [];

        setDoc(doc(db, 'dolphin_chats', chatId), {
            lastRead: { [currentUser.uid]: Timestamp.now() }
        }, { merge: true });

        if (listingId && (chatSource === 'lostfound' || postType === 'lostfound')) {
            getDoc(doc(db, 'posts', listingId)).then((snap) => {
                if (snap.exists()) setIsPostOwner(snap.data().authorId === currentUser.uid);
            }).catch(() => {});
        }

        // Fetch price for market chats if not provided
        if (actualSource === 'market' && listingId && fetchedPrice === undefined) {
            getDoc(doc(db, 'market_listings', listingId)).then((snap) => {
                if (snap.exists()) {
                    const data = snap.data();
                    setFetchedPrice(data.price);
                    setFetchedCurrency(data.currency);
                }
            }).catch(() => {});
        }

        const q = query(collection(db, 'dolphin_chats', chatId, 'messages'), orderBy('createdAt', 'asc'));
        unsubs.push(onSnapshot(q, (snapshot) => {
            setMessages(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
            setDoc(doc(db, 'dolphin_chats', chatId), {
                lastRead: { [currentUser.uid]: Timestamp.now() }
            }, { merge: true });
        }));

        return () => {
            setDoc(doc(db, 'dolphin_chats', chatId), {
                lastRead: { [currentUser.uid]: Timestamp.now() }
            }, { merge: true });
            unsubs.forEach(u => u());
        };
    }, [chatId]);

    // Check if this is a confirmed buyer's chat (seller only)
    useEffect(() => {
        if (!currentUser || !listingId || actualSource !== 'market') return;
        const unsub = onSnapshot(doc(db, 'market_listings', listingId), (snap) => {
            if (!snap.exists()) return;
            const data = snap.data();
            const isSeller = data.sellerId === currentUser.uid;
            const isConfirmedChat = isSeller && data.confirmedBuyerId === otherUserId && data.status === 'reserved';
            setIsConfirmedBuyerChat(isConfirmedChat);
        });
        return unsub;
    }, [listingId, currentUser, otherUserId]);

    // Listen for other user's lastRead + typing state
    useEffect(() => {
        if (!currentUser) return;
        const unsub = onSnapshot(doc(db, 'dolphin_chats', chatId), (snap) => {
            if (!snap.exists()) return;
            const data = snap.data();
            // Read receipts
            const lr = data.lastRead?.[otherUserId];
            setOtherLastRead(lr || null);
            // Typing indicator
            const typing = data.typing?.[otherUserId];
            if (typing) {
                const typingTs = typing.toDate ? typing.toDate() : new Date(typing);
                setOtherIsTyping(Date.now() - typingTs.getTime() < 5000);
            } else {
                setOtherIsTyping(false);
            }
        });
        return unsub;
    }, [chatId, currentUser, otherUserId]);

    // Update typing state when user types
    const handleTextChange = (text: string) => {
        setInputText(text);
        if (!currentUser) return;
        // Set typing timestamp
        setDoc(doc(db, 'dolphin_chats', chatId), {
            typing: { [currentUser.uid]: serverTimestamp() }
        }, { merge: true }).catch(() => {});
        // Clear typing after 3s of inactivity
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            setDoc(doc(db, 'dolphin_chats', chatId), {
                typing: { [currentUser.uid]: null }
            }, { merge: true }).catch(() => {});
        }, 3000);
    };

    // Check if recipient has muted this chat
    const isRecipientMuted = async (): Promise<boolean> => {
        try {
            const chatDoc = await getDoc(doc(db, 'dolphin_chats', chatId));
            if (!chatDoc.exists()) return false;
            const data = chatDoc.data();
            return data.mutedBy?.includes(otherUserId) || false;
        } catch { return false; }
    };

    const sendMessage = async () => {
        if (!inputText.trim() || !currentUser) return;
        const text = inputText;
        setInputText('');
        try {
            await addDoc(collection(db, 'dolphin_chats', chatId, 'messages'), {
                text, senderId: currentUser.uid, createdAt: serverTimestamp(),
            });
            await setDoc(doc(db, 'dolphin_chats', chatId), {
                updatedAt: serverTimestamp(), lastMessage: text, deletedBy: [],
            }, { merge: true });

            try {
                const muted = await isRecipientMuted();
                if (!muted) {
                    const recipientDoc = await getDoc(doc(db, 'users', otherUserId));
                    if (recipientDoc.exists()) {
                        const pushToken = recipientDoc.data().pushToken;
                        if (pushToken) await sendPushNotification(pushToken, currentUser.displayName || 'Someone', text, {
                            chatId, senderId: currentUser.uid, senderName: currentUser.displayName || 'Someone',
                            listingId, listingName, chatSource: actualSource,
                        });
                    }
                }
            } catch {}
        } catch (error) { console.error('Send error:', error); }
    };

    const handleCreateAppointment = async (data: { date: string; location: string; reminder: string }) => {
        if (!currentUser) return;
        setShowAppointment(false);
        try {
            await addDoc(collection(db, 'dolphin_chats', chatId, 'messages'), {
                type: 'appointment',
                senderId: currentUser.uid,
                createdAt: serverTimestamp(),
                appointment: {
                    date: data.date,
                    location: data.location,
                    reminder: data.reminder,
                    createdBy: currentUser.displayName || 'User',
                },
            });
            await setDoc(doc(db, 'dolphin_chats', chatId), {
                updatedAt: serverTimestamp(),
                lastMessage: 'Meetup scheduled',
                deletedBy: [],
            }, { merge: true });

            // Push to other user (skip if muted)
            try {
                const muted = await isRecipientMuted();
                if (!muted) {
                    const recipientDoc = await getDoc(doc(db, 'users', otherUserId));
                    if (recipientDoc.exists()) {
                        const pushToken = recipientDoc.data().pushToken;
                        if (pushToken) await sendPushNotification(pushToken, '📅 Meetup Scheduled', `${currentUser.displayName || 'Someone'} scheduled a meetup with you`, { chatId, type: 'meetup' });
                    }
                }
            } catch {}

            // Schedule local reminders — make them as prominent as possible
            try {
                const meetupTime = new Date(data.date).getTime();
                const reminderMs: Record<string, number> = { '5min': 5*60000, '15min': 15*60000, '30min': 30*60000, '1hour': 3600000, '2hours': 7200000 };
                const offset = reminderMs[data.reminder] || 30*60000;
                const triggerTime = meetupTime - offset;
                const meetupDate = new Date(data.date);
                const timeStr = meetupDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

                // Main reminder (user-selected time before)
                if (triggerTime > Date.now()) {
                    await Notifications.scheduleNotificationAsync({
                        content: {
                            title: '⏰ Meetup in ' + data.reminder + '!',
                            subtitle: `With ${otherUserName}`,
                            body: `📍 ${data.location}\n🕐 ${timeStr}\n\nDon't be late! Tap to open chat.`,
                            data: { chatId, type: 'meetup_reminder' },
                            sound: 'default',
                            badge: 1,
                            interruptionLevel: 'timeSensitive',
                            categoryIdentifier: 'meetup_reminder',
                        },
                        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(triggerTime) },
                    });
                }

                // Extra: 5-min warning if the main reminder is > 5 min
                const fiveMinBefore = meetupTime - 5 * 60000;
                if (offset > 5 * 60000 && fiveMinBefore > Date.now()) {
                    await Notifications.scheduleNotificationAsync({
                        content: {
                            title: '🚨 Meetup in 5 minutes!',
                            subtitle: `With ${otherUserName}`,
                            body: `📍 ${data.location}\n🕐 ${timeStr}\n\nHeading there now?`,
                            data: { chatId, type: 'meetup_urgent' },
                            sound: 'default',
                            badge: 1,
                            interruptionLevel: 'timeSensitive',
                            categoryIdentifier: 'meetup_reminder',
                        },
                        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(fiveMinBefore) },
                    });
                }
            } catch {}
        } catch (e) { Alert.alert('Error', 'Failed to create meetup.'); }
    };

    const handleReschedule = (existingApptMsgId: string) => {
        Alert.alert('Reschedule Meetup', 'Would you like to reschedule this meetup?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Reschedule', onPress: () => setShowAppointment(true) },
        ]);
    };

    // ─── Bank Info ───
    useEffect(() => {
        AsyncStorage.getItem('@bank_info').then(val => {
            if (val) {
                const info = JSON.parse(val);
                setBankInfo(info);
                setBankName(info.bankName || '');
                setBankAccount(info.accountNumber || '');
                setBankHolder(info.accountHolder || '');
            }
        });
    }, []);

    const handleBankPress = () => {
        if (!bankInfo || !bankInfo.bankName) {
            setShowBankSetup(true);
        } else {
            setShowBankConfirm(true);
        }
    };

    const handleSaveBankInfo = async () => {
        if (!bankName.trim() || !bankAccount.trim() || !bankHolder.trim()) {
            Alert.alert('Missing Info', 'Please fill in all fields.');
            return;
        }
        const info = { bankName: bankName.trim(), accountNumber: bankAccount.trim(), accountHolder: bankHolder.trim() };
        await AsyncStorage.setItem('@bank_info', JSON.stringify(info));
        setBankInfo(info);
        setShowBankSetup(false);
        setShowBankConfirm(true);
    };

    const handleSendBankInfo = async () => {
        if (!currentUser || !bankInfo) return;
        setShowBankConfirm(false);
        try {
            await addDoc(collection(db, 'dolphin_chats', chatId, 'messages'), {
                type: 'bank_info',
                senderId: currentUser.uid,
                senderName: currentUser.displayName || 'User',
                createdAt: serverTimestamp(),
                bankInfo: bankInfo,
            });
            await setDoc(doc(db, 'dolphin_chats', chatId), {
                updatedAt: serverTimestamp(),
                lastMessage: 'Bank account info shared',
                deletedBy: [],
            }, { merge: true });
        } catch (e) { Alert.alert('Error', 'Failed to send bank info.'); }
    };

    // ─── Photo Upload ───
    const uploadChatImage = async (localUri: string): Promise<string> => {
        const user = auth.currentUser;
        if (!user) throw new Error('Not authenticated');
        const idToken = await user.getIdToken();
        const fileName = `chat_images/${chatId}/${Date.now()}.jpg`;
        const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(fileName)}?uploadType=media`;
        const response = await FileSystem.uploadAsync(uploadUrl, localUri, {
            httpMethod: 'POST',
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
            headers: { 'Content-Type': 'image/jpeg', 'Authorization': `Bearer ${idToken}` },
        });
        if (response.status < 200 || response.status >= 300) throw new Error('Upload failed');
        const result = JSON.parse(response.body);
        return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(fileName)}?alt=media&token=${result.downloadTokens}`;
    };

    const handleSendImage = async (uri: string) => {
        if (!currentUser) return;
        setStagedImage(null);
        setUploadingImage(true);
        try {
            const imageUrl = await uploadChatImage(uri);
            await addDoc(collection(db, 'dolphin_chats', chatId, 'messages'), {
                type: 'image', imageUrl, senderId: currentUser.uid, createdAt: serverTimestamp(),
            });
            await setDoc(doc(db, 'dolphin_chats', chatId), {
                updatedAt: serverTimestamp(), lastMessage: 'Sent a photo', deletedBy: [],
            }, { merge: true });

            // Push notification (skip if muted)
            try {
                const muted = await isRecipientMuted();
                if (!muted) {
                    const recipientDoc = await getDoc(doc(db, 'users', otherUserId));
                    if (recipientDoc.exists()) {
                        const pushToken = recipientDoc.data().pushToken;
                        if (pushToken) await sendPushNotification(pushToken, currentUser.displayName || 'Someone', '📷 Sent a photo', {
                            chatId, senderId: currentUser.uid, senderName: currentUser.displayName || 'Someone',
                            listingId, listingName, chatSource: actualSource,
                        });
                    }
                }
            } catch {}
        } catch (e) { Alert.alert('Error', 'Failed to send photo.'); }
        setUploadingImage(false);
    };

    const stageImage = (uri: string) => { setStagedImage(uri); };

    const showImageOptions = () => {
        if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
                { options: ['Cancel', 'Take Photo', 'Choose from Gallery'], cancelButtonIndex: 0 },
                async (idx) => {
                    if (idx === 1) {
                        const { status } = await ImagePicker.requestCameraPermissionsAsync();
                        if (status !== 'granted') { Alert.alert('Permission needed'); return; }
                        const r = await ImagePicker.launchCameraAsync({ quality: 0.7 });
                        if (!r.canceled && r.assets[0]) stageImage(r.assets[0].uri);
                    } else if (idx === 2) {
                        const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ['images'] });
                        if (!r.canceled && r.assets[0]) stageImage(r.assets[0].uri);
                    }
                }
            );
        } else {
            Alert.alert('Send Photo', '', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Take Photo', onPress: async () => {
                    const { status } = await ImagePicker.requestCameraPermissionsAsync();
                    if (status !== 'granted') { Alert.alert('Permission needed'); return; }
                    const r = await ImagePicker.launchCameraAsync({ quality: 0.7 });
                    if (!r.canceled && r.assets[0]) stageImage(r.assets[0].uri);
                }},
                { text: 'Gallery', onPress: async () => {
                    const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ['images'] });
                    if (!r.canceled && r.assets[0]) stageImage(r.assets[0].uri);
                }},
            ]);
        }
    };

    const handleLeaveChat = () => {
        Alert.alert('Leave Chat', 'Are you sure?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Leave', style: 'destructive', onPress: async () => {
                if (!currentUser) return;
                try { await updateDoc(doc(db, 'dolphin_chats', chatId), { deletedBy: arrayUnion(currentUser.uid) }); navigation.goBack(); } catch { Alert.alert('Error', 'Failed.'); }
            }},
        ]);
    };

    // Build messages with date separators + smart time grouping
    const buildDisplayData = () => {
        const result: any[] = [];
        let lastDateStr = '';
        messages.forEach((msg, idx) => {
            const ts = msg.createdAt;
            if (ts) {
                const d = ts.toDate ? ts.toDate() : new Date(ts);
                const dateStr = d.toDateString();
                if (dateStr !== lastDateStr) {
                    result.push({ id: 'date_' + dateStr, type: 'dateSeparator', date: d });
                    lastDateStr = dateStr;
                }
            }
            // Determine if we should hide timestamp (same sender, < 1 min gap)
            let hideTime = false;
            if (idx < messages.length - 1) {
                const next = messages[idx + 1];
                if (next.senderId === msg.senderId && ts && next.createdAt) {
                    const t1 = ts.toDate ? ts.toDate().getTime() : new Date(ts).getTime();
                    const t2 = next.createdAt.toDate ? next.createdAt.toDate().getTime() : new Date(next.createdAt).getTime();
                    if (t2 - t1 < 60000) hideTime = true;
                }
            }
            result.push({ ...msg, type: msg.type || 'message', _hideTime: hideTime });
        });
        return result;
    };

    // ─── Message Deletion ───
    const canDelete = (item: any) => {
        if (item.senderId !== currentUser?.uid) return false;
        if (!item.createdAt) return true; // just sent, no timestamp yet
        const sentTime = item.createdAt.toDate ? item.createdAt.toDate().getTime() : new Date(item.createdAt).getTime();
        return Date.now() - sentTime < 60000; // 1 minute
    };

    const handleDeleteMessage = (messageId: string) => {
        Alert.alert(
            'Delete Message',
            'This message will be removed for everyone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete', style: 'destructive', onPress: async () => {
                        try {
                            await updateDoc(doc(db, 'dolphin_chats', chatId, 'messages', messageId), {
                                deleted: true,
                                text: null,
                                imageUrl: null,
                            });
                        } catch (e) { /* ignore */ }
                    }
                },
            ]
        );
    };

    const renderItem = ({ item }: { item: any }) => {
        if (item.type === 'dateSeparator') {
            return (
                <View style={styles.dateSeparator}>
                    <View style={styles.dateLine} />
                    <Text style={styles.dateText}>{formatDateLabel(item.date)}</Text>
                    <View style={styles.dateLine} />
                </View>
            );
        }
        if (item.type === 'appointment') {
            const appt = item.appointment;
            const apptDate = new Date(appt.date);
            return (
                <View style={styles.appointmentCard}>
                    <View style={styles.appointmentHeader}>
                        <Ionicons name="calendar" size={18} color="#F97316" />
                        <Text style={styles.appointmentTitle}>Meetup Scheduled</Text>
                    </View>
                    <View style={styles.appointmentBody}>
                        <View style={styles.appointmentRow}>
                            <Ionicons name="calendar-outline" size={16} color={theme.colors.textMuted} />
                            <Text style={styles.appointmentInfo}>{apptDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
                        </View>
                        <View style={styles.appointmentRow}>
                            <Ionicons name="time-outline" size={16} color={theme.colors.textMuted} />
                            <Text style={styles.appointmentInfo}>{apptDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</Text>
                        </View>
                        <View style={styles.appointmentRow}>
                            <Ionicons name="location-outline" size={16} color={theme.colors.textMuted} />
                            <Text style={styles.appointmentInfo}>{appt.location}</Text>
                        </View>
                        <View style={styles.appointmentRow}>
                            <Ionicons name="notifications-outline" size={16} color={theme.colors.textMuted} />
                            <Text style={styles.appointmentInfo}>Reminder: {appt.reminder} before</Text>
                        </View>
                    </View>
                    <Text style={styles.appointmentCreator}>Created by {appt.createdBy}</Text>
                    <TouchableOpacity style={styles.rescheduleBtn} onPress={() => handleReschedule(item.id)}>
                        <Ionicons name="refresh" size={13} color="#F97316" />
                        <Text style={styles.rescheduleBtnText}>Reschedule</Text>
                    </TouchableOpacity>
                </View>
            );
        }
        if (item.type === 'bank_info') {
            const bi = item.bankInfo;
            return (
                <View style={styles.bankCard}>
                    <View style={styles.bankCardHeader}>
                        <Ionicons name="card" size={18} color="#0EA5E9" />
                        <Text style={styles.bankCardTitle}>Bank Account Info</Text>
                    </View>
                    <View style={styles.bankCardBody}>
                        <View style={styles.bankRow}><Text style={styles.bankLabel}>Bank</Text><Text style={styles.bankValue}>{bi.bankName}</Text></View>
                        <View style={styles.bankRow}><Text style={styles.bankLabel}>Account #</Text><Text style={styles.bankValue}>{bi.accountNumber}</Text></View>
                        <View style={styles.bankRow}><Text style={styles.bankLabel}>Holder</Text><Text style={styles.bankValue}>{bi.accountHolder}</Text></View>
                    </View>
                    <Text style={styles.bankSender}>Sent by {item.senderName}</Text>
                </View>
            );
        }

        // ─── Deleted message ───
        if (item.deleted) {
            const isMe = item.senderId === currentUser?.uid;
            return (
                <View style={styles.messageRow}>
                    <View style={[styles.deletedBubble, isMe ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' }]}>
                        <Ionicons name="ban-outline" size={13} color="#94A3B8" style={{ marginRight: 4 }} />
                        <Text style={styles.deletedText}>This message was deleted</Text>
                    </View>
                </View>
            );
        }

        if (item.type === 'image') {
            const isMe = item.senderId === currentUser?.uid;
            return (
                <TouchableOpacity
                    style={[styles.messageRow, isMe && { alignItems: 'flex-end' }]}
                    activeOpacity={0.8}
                    onLongPress={() => { if (canDelete(item)) handleDeleteMessage(item.id); }}
                    delayLongPress={400}
                >
                    <TouchableOpacity onPress={() => setViewImage(item.imageUrl)} style={[styles.imageBubble, isMe ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' }]}>
                        <Image source={{ uri: item.imageUrl }} style={styles.chatImage} />
                    </TouchableOpacity>
                    {!item._hideTime && <Text style={[styles.timeText, isMe ? { alignSelf: 'flex-end', marginRight: 4 } : { alignSelf: 'flex-start', marginLeft: 4 }]}>{formatTime(item.createdAt)}</Text>}
                </TouchableOpacity>
            );
        }
        const isMe = item.senderId === currentUser?.uid;

        // "Read" logic like KakaoTalk:
        // Only show on the LAST message I sent, and ONLY if the other person
        // hasn't replied after it (their reply proves they read it).
        let showRead = false;
        if (isMe && otherLastRead) {
            const allMsgs = displayData;
            // Find the last non-system message in the conversation
            const lastMsg = allMsgs[allMsgs.length - 1];
            // Find the last message I sent
            const lastMyMsg = [...allMsgs].reverse().find(m => m.senderId === currentUser?.uid && m.type !== 'system');
            // Check if this IS my last message
            if (lastMyMsg && item.id === lastMyMsg.id) {
                // Check if the other person replied AFTER my last message
                const lastOtherMsg = [...allMsgs].reverse().find(m => m.senderId !== currentUser?.uid && m.senderId !== 'system' && m.type !== 'system');
                const myMsgTs = lastMyMsg.createdAt?.toDate ? lastMyMsg.createdAt.toDate() : (lastMyMsg.createdAt?.seconds ? new Date(lastMyMsg.createdAt.seconds * 1000) : null);
                const otherMsgTs = lastOtherMsg?.createdAt?.toDate ? lastOtherMsg.createdAt.toDate() : (lastOtherMsg?.createdAt?.seconds ? new Date(lastOtherMsg.createdAt.seconds * 1000) : null);

                // Only show Read if: no reply from other after my message
                const otherRepliedAfter = otherMsgTs && myMsgTs && otherMsgTs > myMsgTs;
                if (!otherRepliedAfter) {
                    const readTs = otherLastRead.toDate ? otherLastRead.toDate() : new Date(otherLastRead.seconds * 1000);
                    if (myMsgTs && readTs >= myMsgTs) {
                        showRead = true;
                    }
                }
            }
        }

        return (
            <TouchableOpacity
                style={styles.messageRow}
                activeOpacity={0.8}
                onLongPress={() => { if (canDelete(item)) handleDeleteMessage(item.id); }}
                delayLongPress={400}
            >
                <View style={[styles.messageBubble, isMe ? [styles.myMessage, { backgroundColor: myBubbleColor }] : styles.theirMessage]}>
                    <Text style={[styles.messageText, isMe && styles.myMessageText]}>{item.text}</Text>
                </View>
                {!item._hideTime && (
                    <View style={[styles.timeRow, isMe ? { alignSelf: 'flex-end', marginRight: 4 } : { alignSelf: 'flex-start', marginLeft: 4 }]}>
                        <Text style={styles.timeText}>{formatTime(item.createdAt)}</Text>
                        {isMe && showRead && (
                            <Text style={styles.readLabel}>Read</Text>
                        )}
                    </View>
                )}
            </TouchableOpacity>
        );
    };

    const displayData = buildDisplayData();

    return (
        <>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={90} style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={24} color={theme.colors.textPrimary} />
                </TouchableOpacity>
                <View style={styles.headerInfo}><Text style={styles.headerTitle}>{otherUserName}</Text></View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <TouchableOpacity onPress={() => showReportBlockMenu({
                        targetUserId: otherUserId,
                        targetUserName: otherUserName || 'Unknown',
                        contentType: 'chat_message',
                        contentId: chatId,
                        onBlocked: () => navigation.goBack(),
                    })} style={styles.leaveBtn}>
                        <Ionicons name="flag-outline" size={20} color={theme.colors.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={handleLeaveChat} style={styles.leaveBtn}>
                        <Ionicons name="exit-outline" size={22} color={theme.colors.textMuted} />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Context Header */}
            {(listingName || listingPhoto) && (
                <View style={styles.contextCard}>
                    {listingPhoto ? (
                        <Image source={{ uri: listingPhoto }} style={styles.contextImage} />
                    ) : (
                        <View style={[styles.contextImage, styles.contextImagePlaceholder]}>
                            <Ionicons name="cube-outline" size={20} color={theme.colors.textMuted} />
                        </View>
                    )}
                    <View style={styles.contextInfo}>
                        {actualSource && (
                            <View style={styles.sourceLabelRow}>
                                <View style={[styles.sourceLabel, {
                                    backgroundColor: actualSource === 'market' ? '#FFF7ED' : actualSource === 'lostfound' ? '#ECFDF5' : '#EEF2FF'
                                }]}>
                                    <Text style={[styles.sourceLabelText, {
                                        color: actualSource === 'market' ? '#F97316' : actualSource === 'lostfound' ? '#059669' : '#6366F1'
                                    }]}>
                                        {actualSource === 'market' ? 'Market' : actualSource === 'lostfound' ? 'Lost & Found' : 'Lounge'}
                                    </Text>
                                </View>
                            </View>
                        )}
                        <Text style={styles.contextTitle} numberOfLines={1}>{listingName}</Text>
                    </View>
                    {/* Price for Market */}
                    {actualSource === 'market' && fetchedPrice !== undefined && (
                        <Text style={styles.contextPrice}>{formatPrice(String(fetchedPrice), fetchedCurrency || 'KRW')}</Text>
                    )}
                    {/* Resolved — L&F only, post owner only */}
                    {actualSource === 'lostfound' && isPostOwner && (
                        <TouchableOpacity style={styles.resolvedBtn} onPress={() => {
                            Alert.alert('Mark as Resolved', 'Has this item been returned/found?', [
                                { text: 'Cancel', style: 'cancel' },
                                { text: 'Resolved', onPress: async () => {
                                    if (listingId) { try { await updateDoc(doc(db, 'posts', listingId), { status: 'resolved' }); Alert.alert('Done', 'Marked as resolved!'); } catch { Alert.alert('Error', 'Failed.'); } }
                                }},
                            ]);
                        }}>
                            <Ionicons name="checkmark-circle" size={16} color="#059669" />
                            <Text style={styles.resolvedBtnText}>Resolved</Text>
                        </TouchableOpacity>
                    )}
                </View>
            )}

            {/* Market Action Buttons */}
            {actualSource === 'market' && (
                <View style={styles.marketActions}>
                    <TouchableOpacity style={styles.meetupBtn} onPress={() => setShowAppointment(true)}>
                        <Ionicons name="calendar" size={16} color={myBubbleColor} />
                        <Text style={[styles.meetupBtnText, { color: myBubbleColor }]}>Schedule Meetup</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.meetupBtn, { borderColor: myBubbleColor, backgroundColor: myBubbleColor + '15' }]} onPress={() => handleBankPress()}>
                        <Ionicons name="card" size={16} color={myBubbleColor} />
                        <Text style={[styles.meetupBtnText, { color: myBubbleColor }]}>Send Bank Info</Text>
                    </TouchableOpacity>
                </View>
            )}

            {/* Seller-only: Confirmed Buyer Actions */}
            {isConfirmedBuyerChat && (
                <>
                <View style={styles.sellerActionBar}>
                    <TouchableOpacity
                        style={styles.sellerPassBtn}
                        onPress={() => setShowChatPassConfirm(true)}
                    >
                        <Ionicons name="arrow-forward-circle" size={16} color="#F97316" />
                        <Text style={styles.sellerPassBtnText}>Pass Buyer</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={styles.sellerCancelBtn}
                        onPress={() => setShowCancelConfirm(true)}
                    >
                        <Ionicons name="close-circle" size={16} color="#DC2626" />
                        <Text style={styles.sellerCancelBtnText}>Cancel Confirmation</Text>
                    </TouchableOpacity>
                </View>
                {/* Sold to this buyer button */}
                <View style={styles.sellerSoldBar}>
                    <TouchableOpacity
                        style={styles.sellerSoldBtn}
                        onPress={() => setShowSoldConfirm(true)}
                    >
                        <Ionicons name="checkmark-done-circle" size={16} color="#fff" />
                        <Text style={styles.sellerSoldBtnText}>Mark Sold to This Buyer</Text>
                    </TouchableOpacity>
                </View>
                </>
            )}

            <FlatList
                ref={flatListRef}
                data={[...displayData].reverse()}
                inverted
                keyExtractor={item => item.id}
                renderItem={renderItem}
                contentContainerStyle={styles.list}
            />

            {/* Typing indicator */}
            {otherIsTyping && <TypingDots name={otherUserName} />}

            {/* Staged image preview */}
            {stagedImage && (
                <View style={styles.stagedImageWrap}>
                    <Image source={{ uri: stagedImage }} style={styles.stagedImage} />
                    <TouchableOpacity style={styles.stagedImageClose} onPress={() => setStagedImage(null)}>
                        <Ionicons name="close-circle" size={22} color="#EF4444" />
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.stagedImageSend, { backgroundColor: myBubbleColor }]} onPress={() => handleSendImage(stagedImage)}>
                        <Ionicons name="send" size={14} color="#fff" />
                        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Send</Text>
                    </TouchableOpacity>
                </View>
            )}

            <View style={styles.inputContainer}>
                <TouchableOpacity style={styles.addBtn} onPress={showImageOptions} disabled={uploadingImage}>
                    {uploadingImage ? (
                        <ActivityIndicator size="small" color={myBubbleColor} />
                    ) : (
                        <Ionicons name="add-circle" size={32} color={myBubbleColor} />
                    )}
                </TouchableOpacity>
                <TextInput
                    style={styles.input}
                    placeholder="Message..."
                    placeholderTextColor={theme.colors.textMuted}
                    value={inputText}
                    onChangeText={handleTextChange}
                    returnKeyType="send"
                    onSubmitEditing={sendMessage}
                />
                <TouchableOpacity style={[styles.sendButton, { backgroundColor: myBubbleColor }]} onPress={stagedImage ? () => handleSendImage(stagedImage) : sendMessage} activeOpacity={0.7} disabled={!inputText.trim() && !stagedImage}>
                    <Ionicons name="send" size={18} color={(inputText.trim() || stagedImage) ? '#fff' : 'rgba(255,255,255,0.5)'} />
                </TouchableOpacity>
            </View>

            {/* Fullscreen image viewer */}
            <Modal visible={!!viewImage} transparent animationType="fade" onRequestClose={() => setViewImage(null)}>
                <TouchableOpacity style={styles.imageViewerOverlay} activeOpacity={1} onPress={() => setViewImage(null)}>
                    <TouchableOpacity style={styles.imageViewerClose} onPress={() => setViewImage(null)}>
                        <Ionicons name="close" size={28} color="#fff" />
                    </TouchableOpacity>
                    {viewImage && <Image source={{ uri: viewImage }} style={styles.imageViewerImage} resizeMode="contain" />}
                </TouchableOpacity>
            </Modal>

            <AppointmentModal
                visible={showAppointment}
                onClose={() => setShowAppointment(false)}
                onSubmit={handleCreateAppointment}
                otherUserName={otherUserName}
            />

            {/* Bank Confirm Modal */}
            <Modal visible={showBankConfirm} transparent animationType="fade" onRequestClose={() => setShowBankConfirm(false)}>
                <TouchableOpacity style={styles.bankOverlay} activeOpacity={1} onPress={() => setShowBankConfirm(false)}>
                    <View style={styles.bankPopup}>
                        <View style={[styles.bankPopupIcon, { backgroundColor: myBubbleColor + '20' }]}>
                            <Ionicons name="card" size={28} color={myBubbleColor} />
                        </View>
                        <Text style={styles.bankPopupTitle}>Send Bank Info</Text>
                        <Text style={styles.bankPopupDesc}>Send your bank account details to <Text style={{ fontWeight: '800' }}>{otherUserName}</Text>?</Text>
                        <View style={styles.bankPopupInfo}>
                            <Text style={styles.bankPopupInfoText}>{bankInfo?.bankName}</Text>
                            <Text style={styles.bankPopupInfoText}>{bankInfo?.accountNumber}</Text>
                            <Text style={styles.bankPopupInfoText}>{bankInfo?.accountHolder}</Text>
                        </View>
                        <View style={styles.bankPopupBtns}>
                            <TouchableOpacity style={styles.bankPopupBtnCancel} onPress={() => setShowBankConfirm(false)}>
                                <Text style={styles.bankPopupBtnCancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.bankPopupBtnSend, { backgroundColor: myBubbleColor }]} onPress={() => handleSendBankInfo()}>
                                <Ionicons name="send" size={14} color="#fff" />
                                <Text style={styles.bankPopupBtnSendText}>Send</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </TouchableOpacity>
            </Modal>

            {/* Bank Setup Modal */}
            <Modal visible={showBankSetup} animationType="slide" presentationStyle="pageSheet">
                <View style={ms.container}>
                    <View style={ms.header}>
                        <TouchableOpacity onPress={() => setShowBankSetup(false)}><Ionicons name="close" size={24} color={theme.colors.textPrimary} /></TouchableOpacity>
                        <Text style={ms.headerTitle}>Set Up Bank Account</Text>
                        <TouchableOpacity onPress={handleSaveBankInfo}><Text style={{ color: theme.colors.primary, fontWeight: '700', fontSize: 16 }}>Save</Text></TouchableOpacity>
                    </View>
                    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
                        <Text style={{ fontSize: 14, color: theme.colors.textMuted, marginBottom: 4 }}>Set up your bank account to quickly share it in market chats.</Text>
                        <View>
                            <Text style={styles.bankSetupLabel}>Bank Name</Text>
                            <TextInput style={styles.bankSetupInput} value={bankName} onChangeText={setBankName} placeholder="e.g. Shinhan Bank" placeholderTextColor={theme.colors.textMuted} />
                        </View>
                        <View>
                            <Text style={styles.bankSetupLabel}>Account Number</Text>
                            <TextInput style={styles.bankSetupInput} value={bankAccount} onChangeText={setBankAccount} placeholder="e.g. 110-123-456789" placeholderTextColor={theme.colors.textMuted} keyboardType="default" />
                        </View>
                        <View>
                            <Text style={styles.bankSetupLabel}>Account Holder Name</Text>
                            <TextInput style={styles.bankSetupInput} value={bankHolder} onChangeText={setBankHolder} placeholder="e.g. Junyoung Yang" placeholderTextColor={theme.colors.textMuted} />
                        </View>
                    </ScrollView>
                </View>
            </Modal>
        </KeyboardAvoidingView>

        {/* ── Chat Pass Confirmation Center Modal ── */}
        <Modal visible={showChatPassConfirm} transparent animationType="fade" onRequestClose={() => setShowChatPassConfirm(false)}>
            <View style={styles.chatPassOverlay}>
                <View style={styles.chatPassCard}>
                    <TouchableOpacity style={styles.chatPassCloseX} onPress={() => setShowChatPassConfirm(false)}>
                        <Ionicons name="close" size={22} color={theme.colors.textMuted} />
                    </TouchableOpacity>
                    <View style={styles.chatPassIconWrap}>
                        <Ionicons name="alert-circle" size={40} color="#F97316" />
                    </View>
                    <Text style={styles.chatPassTitle}>Pass this buyer?</Text>
                    <Text style={styles.chatPassDesc}>
                        Have you discussed this with{' '}
                        <Text style={{ fontWeight: '800' }}>{otherUserName}</Text>?
                        {`\n\n`}Passing will remove the confirmation, set the listing back on sale, and move to the next buyer in the queue.
                        {`\n\n`}Please make sure you've reached an agreement before proceeding.
                    </Text>
                    <View style={styles.chatPassActions}>
                        <TouchableOpacity style={styles.chatPassCancelBtn} onPress={() => setShowChatPassConfirm(false)}>
                            <Text style={styles.chatPassCancelText}>Go Back</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.chatPassConfirmBtn} onPress={async () => {
                            setShowChatPassConfirm(false);
                            try {
                                const snap = await getDoc(doc(db, 'market_listings', listingId));
                                const data = snap.data() || {};
                                const cur: any[] = data.waitlist || [];
                                const updated = cur.map((e: any) => e.userId === otherUserId ? { ...e, status: 'passed' } : e);
                                await updateDoc(doc(db, 'market_listings', listingId), {
                                    waitlist: updated,
                                    status: 'available',
                                    confirmedBuyerId: null,
                                    confirmedBuyerName: null,
                                });
                                // Notify next #1
                                const next = updated.find((e: any) => e.status === 'active');
                                if (next) {
                                    await sendPushNotification(next.userId, '\ud83c\udf89 You\'re #1!', `You're first in line for "${listingName}"`, { listingId });
                                    await addDoc(collection(db, 'dolphin_notifications'), {
                                        recipientId: next.userId, type: 'queue',
                                        title: '\ud83c\udf89 You\'re #1 in Queue!',
                                        body: `You're first in line for "${listingName}"`,
                                        listingId, read: false, createdAt: serverTimestamp(),
                                    });
                                }
                                // System message
                                await addDoc(collection(db, 'dolphin_chats', chatId, 'messages'), {
                                    text: '\ud83d\ude14 The seller has passed. The listing is back on sale.',
                                    senderId: 'system', senderName: 'System',
                                    createdAt: serverTimestamp(), type: 'system',
                                });
                                Alert.alert('Passed', 'The buyer has been passed. The listing is back on sale.');
                            } catch { Alert.alert('Error', 'Failed to pass buyer.'); }
                        }}>
                            <Text style={styles.chatPassConfirmText}>Yes, Pass</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>

        {/* ── Cancel Confirmation Modal ── */}
        <Modal visible={showCancelConfirm} transparent animationType="fade" onRequestClose={() => setShowCancelConfirm(false)}>
            <View style={styles.chatPassOverlay}>
                <View style={styles.chatPassCard}>
                    <TouchableOpacity style={styles.chatPassCloseX} onPress={() => setShowCancelConfirm(false)}>
                        <Ionicons name="close" size={22} color={theme.colors.textMuted} />
                    </TouchableOpacity>
                    <View style={[styles.chatPassIconWrap, { backgroundColor: '#FEE2E2' }]}>
                        <Ionicons name="close-circle" size={40} color="#DC2626" />
                    </View>
                    <Text style={styles.chatPassTitle}>Cancel Confirmation?</Text>
                    <Text style={styles.chatPassDesc}>
                        This will remove the buyer confirmation and set the listing back to On Sale.{'\n\n'}The buyer will be notified.
                    </Text>
                    <View style={styles.chatPassActions}>
                        <TouchableOpacity style={styles.chatPassCancelBtn} onPress={() => setShowCancelConfirm(false)}>
                            <Text style={styles.chatPassCancelText}>Keep</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.chatPassConfirmBtn, { backgroundColor: '#DC2626' }]} onPress={async () => {
                            setShowCancelConfirm(false);
                            try {
                                const snap = await getDoc(doc(db, 'market_listings', listingId));
                                const cur: any[] = snap.data()?.waitlist || [];
                                const updated = cur.map((e: any) => e.userId === otherUserId ? { ...e, status: 'active' } : e);
                                await updateDoc(doc(db, 'market_listings', listingId), {
                                    waitlist: updated,
                                    status: 'available',
                                    confirmedBuyerId: null,
                                    confirmedBuyerName: null,
                                });
                                await addDoc(collection(db, 'dolphin_chats', chatId, 'messages'), {
                                    text: '⚠️ The seller has cancelled the buyer confirmation. The listing is now back on sale.',
                                    senderId: 'system', senderName: 'System',
                                    createdAt: serverTimestamp(), type: 'system',
                                });
                            } catch { Alert.alert('Error', 'Failed to cancel.'); }
                        }}>
                            <Text style={styles.chatPassConfirmText}>Cancel Confirmation</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>

        {/* ── Sold to This Buyer Modal ── */}
        <Modal visible={showSoldConfirm} transparent animationType="fade" onRequestClose={() => setShowSoldConfirm(false)}>
            <View style={styles.chatPassOverlay}>
                <View style={styles.chatPassCard}>
                    <TouchableOpacity style={styles.chatPassCloseX} onPress={() => setShowSoldConfirm(false)}>
                        <Ionicons name="close" size={22} color={theme.colors.textMuted} />
                    </TouchableOpacity>
                    <View style={[styles.chatPassIconWrap, { backgroundColor: '#D1FAE5' }]}>
                        <Ionicons name="checkmark-done-circle" size={40} color="#059669" />
                    </View>
                    <Text style={styles.chatPassTitle}>Mark as Sold?</Text>
                    <Text style={styles.chatPassDesc}>
                        Confirm that you sold "{listingName}" to {otherUserName}.{'\n\n'}All other waiters will be notified that this item has been sold.
                    </Text>
                    <View style={styles.chatPassActions}>
                        <TouchableOpacity style={styles.chatPassCancelBtn} onPress={() => setShowSoldConfirm(false)}>
                            <Text style={styles.chatPassCancelText}>Go Back</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.chatPassConfirmBtn, { backgroundColor: '#059669' }]} onPress={async () => {
                            setShowSoldConfirm(false);
                            try {
                                const snap = await getDoc(doc(db, 'market_listings', listingId));
                                const currentWaitlist: any[] = snap.data()?.waitlist || [];

                                // Mark as sold with this buyer
                                await updateDoc(doc(db, 'market_listings', listingId), {
                                    status: 'sold',
                                    waitlist: [],
                                    soldAt: serverTimestamp(),
                                    confirmedBuyerId: otherUserId,
                                    confirmedBuyerName: otherUserName,
                                });

                                // System message in chat
                                await addDoc(collection(db, 'dolphin_chats', chatId, 'messages'), {
                                    text: `✅ The seller has marked this item as sold to ${otherUserName}. Thank you!`,
                                    senderId: 'system', senderName: 'System',
                                    createdAt: serverTimestamp(), type: 'system',
                                });

                                // Notify buyer
                                await sendPushToUser(otherUserId, '✅ Sale Complete!',
                                    `"${listingName}" has been marked as sold to you!`,
                                    { listingId });
                                await addDoc(collection(db, 'dolphin_notifications'), {
                                    recipientId: otherUserId, type: 'queue',
                                    title: '✅ Sale Complete!',
                                    body: `"${listingName}" has been marked as sold to you. Enjoy!`,
                                    listingId, read: false, createdAt: serverTimestamp(),
                                });

                                // Notify all other waiters
                                const otherWaiters = currentWaitlist.filter(e =>
                                    e.status === 'active' && e.userId !== otherUserId
                                );
                                for (const entry of otherWaiters) {
                                    await sendPushToUser(entry.userId, '😔 Item Sold',
                                        `"${listingName}" has been sold to another buyer.`,
                                        { listingId });
                                    await addDoc(collection(db, 'dolphin_notifications'), {
                                        recipientId: entry.userId, type: 'queue',
                                        title: '😔 Item Sold',
                                        body: `"${listingName}" has been sold to another buyer.`,
                                        listingId, read: false, createdAt: serverTimestamp(),
                                    });
                                }

                                Alert.alert('Sold!', `"${listingName}" has been marked as sold.`);
                            } catch { Alert.alert('Error', 'Failed to mark as sold.'); }
                        }}>
                            <Text style={styles.chatPassConfirmText}>Yes, Mark Sold</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
        </>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    header: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 8, paddingTop: 60, paddingBottom: 12,
        backgroundColor: theme.colors.surface, ...theme.shadows.sm, zIndex: 10,
    },
    backBtn: { padding: 8 },
    headerInfo: { flex: 1, marginLeft: 4 },
    headerTitle: { ...theme.typography.h3, color: theme.colors.textPrimary },
    leaveBtn: { padding: 8 },

    contextCard: {
        flexDirection: 'row', alignItems: 'center',
        padding: 12, backgroundColor: theme.colors.surface,
        borderBottomWidth: 1, borderBottomColor: theme.colors.borderLight, gap: 12,
    },
    contextImage: { width: 44, height: 44, borderRadius: r(6), resizeMode: 'cover' },
    contextImagePlaceholder: { backgroundColor: theme.colors.surfaceAlt, justifyContent: 'center', alignItems: 'center' },
    contextInfo: { flex: 1, justifyContent: 'center' },
    sourceLabelRow: { flexDirection: 'row', marginBottom: 2 },
    sourceLabel: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: r(4) },
    sourceLabelText: { fontSize: 10, fontWeight: '800' },
    contextTitle: { fontSize: 15, fontWeight: '600', color: theme.colors.textPrimary, marginBottom: 4 },
    contextPrice: { fontSize: 16, fontWeight: '800', color: '#F97316' },
    resolvedBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: 10, paddingVertical: 6, borderRadius: r(8),
        backgroundColor: '#D1FAE5', borderWidth: 1, borderColor: '#A7F3D0',
    },
    resolvedBtnText: { fontSize: 12, fontWeight: '700', color: '#059669' },

    // Deleted message
    deletedBubble: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#F1F5F9', borderRadius: r(16),
        paddingHorizontal: 14, paddingVertical: 8,
        borderWidth: 1, borderColor: '#E2E8F0',
        borderStyle: 'dashed',
    },
    deletedText: {
        fontSize: 13, color: '#94A3B8', fontStyle: 'italic',
    },

    marketActions: {
        flexDirection: 'row', padding: 10, gap: 8,
        backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.borderLight,
    },
    meetupBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 14, paddingVertical: 8, borderRadius: r(20),
        backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FDBA74',
    },
    meetupBtnText: { fontSize: 13, fontWeight: '700', color: '#F97316' },

    list: { padding: theme.spacing.md, flexGrow: 1 },

    dateSeparator: { flexDirection: 'row', alignItems: 'center', marginVertical: 16, gap: 10 },
    dateLine: { flex: 1, height: 1, backgroundColor: theme.colors.borderLight },
    dateText: { fontSize: 12, fontWeight: '600', color: theme.colors.textMuted },

    messageRow: { flexDirection: 'column', marginBottom: 8 },
    messageBubble: { padding: 12, borderRadius: r(18), maxWidth: '78%' },
    myMessage: { backgroundColor: '#0EA5E9', alignSelf: 'flex-end', borderBottomRightRadius: 4 },
    theirMessage: { backgroundColor: theme.colors.surfaceAlt, alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
    messageText: { ...theme.typography.body, color: theme.colors.textPrimary, fontSize: 15 },
    myMessageText: { color: '#fff' },
    timeText: { fontSize: 10, color: theme.colors.textMuted, marginTop: 3 },

    appointmentCard: {
        backgroundColor: '#FFF7ED', borderRadius: r(16), padding: 16,
        marginVertical: 8, borderWidth: 1, borderColor: '#FDBA74',
        alignSelf: 'center', width: '90%',
    },
    appointmentHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
    appointmentTitle: { fontSize: 15, fontWeight: '700', color: '#F97316' },
    appointmentBody: { gap: 8 },
    appointmentRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    appointmentInfo: { fontSize: 14, color: theme.colors.textPrimary, fontWeight: '500' },
    appointmentCreator: { fontSize: 11, color: theme.colors.textMuted, marginTop: 10, textAlign: 'right' },

    inputContainer: {
        flexDirection: 'row', padding: theme.spacing.sm, alignItems: 'center',
        backgroundColor: theme.colors.surface, borderTopWidth: 1, borderColor: theme.colors.borderLight,
        paddingBottom: Platform.OS === 'ios' ? 30 : theme.spacing.sm, gap: 6,
    },
    addBtn: { padding: 4 },
    input: { flex: 1, backgroundColor: theme.colors.surfaceAlt, borderRadius: r(20), paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: theme.colors.textPrimary },
    sendButton: { backgroundColor: '#0EA5E9', borderRadius: r(20), width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
    imageBubble: { borderRadius: r(14), overflow: 'hidden', maxWidth: '70%' },
    chatImage: { width: 260, minHeight: 120, maxHeight: 340, borderRadius: r(14), resizeMode: 'cover' },
    // Bank info card in chat
    bankCard: {
        backgroundColor: '#E0F7FF', borderRadius: r(16), padding: 16,
        marginVertical: 8, borderWidth: 1, borderColor: '#7DD3FC',
        alignSelf: 'center', width: '90%',
    },
    bankCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
    bankCardTitle: { fontSize: 15, fontWeight: '700', color: '#0EA5E9' },
    bankCardBody: { gap: 6 },
    bankRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    bankLabel: { fontSize: 13, fontWeight: '600', color: theme.colors.textMuted },
    bankValue: { fontSize: 14, fontWeight: '700', color: theme.colors.textPrimary },
    bankSender: { fontSize: 11, color: theme.colors.textMuted, marginTop: 10, textAlign: 'right' },
    // Bank confirm modal
    bankOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
    bankPopup: {
        backgroundColor: '#fff', borderRadius: r(24), padding: 28, width: '85%',
        alignItems: 'center', ...theme.shadows.lg,
    },
    bankPopupIcon: {
        width: 56, height: 56, borderRadius: r(16), backgroundColor: '#E0F7FF',
        justifyContent: 'center', alignItems: 'center', marginBottom: 12,
    },
    bankPopupTitle: { fontSize: 20, fontWeight: '800', color: theme.colors.textPrimary, marginBottom: 6 },
    bankPopupDesc: { fontSize: 14, color: theme.colors.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
    bankPopupInfo: {
        backgroundColor: '#F8FAFC', borderRadius: r(12), padding: 14, width: '100%',
        gap: 4, marginBottom: 20, borderWidth: 1, borderColor: theme.colors.borderLight,
    },
    bankPopupInfoText: { fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary, textAlign: 'center' },
    bankPopupBtns: { flexDirection: 'row', gap: 12, width: '100%' },
    bankPopupBtnCancel: {
        flex: 1, paddingVertical: 14, borderRadius: r(14),
        backgroundColor: theme.colors.surfaceAlt, alignItems: 'center',
    },
    bankPopupBtnCancelText: { fontSize: 15, fontWeight: '700', color: theme.colors.textSecondary },
    bankPopupBtnSend: {
        flex: 1, paddingVertical: 14, borderRadius: r(14),
        backgroundColor: '#0EA5E9', alignItems: 'center',
        flexDirection: 'row', justifyContent: 'center', gap: 6,
    },
    bankPopupBtnSendText: { fontSize: 15, fontWeight: '700', color: '#fff' },
    // Bank setup form
    bankSetupLabel: { fontSize: 13, fontWeight: '700', color: theme.colors.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
    bankSetupInput: {
        backgroundColor: theme.colors.surfaceAlt, borderRadius: r(14), padding: 16,
        fontSize: 15, color: theme.colors.textPrimary, borderWidth: 1, borderColor: theme.colors.borderLight,
    },

    // Staged image preview
    stagedImageWrap: {
        backgroundColor: '#F8FAFC', borderTopWidth: 1, borderTopColor: theme.colors.borderLight,
        padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10,
    },
    stagedImage: { width: 60, height: 60, borderRadius: r(10) },
    stagedImageClose: { position: 'absolute', top: 4, left: 4, zIndex: 2 },
    stagedImageSend: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: theme.colors.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: r(20),
        marginLeft: 'auto',
    },

    // Fullscreen image viewer
    imageViewerOverlay: {
        flex: 1, backgroundColor: 'rgba(0,0,0,0.92)',
        justifyContent: 'center', alignItems: 'center',
    },
    imageViewerClose: {
        position: 'absolute', top: 60, right: 20, zIndex: 10,
        width: 40, height: 40, borderRadius: r(20),
        backgroundColor: 'rgba(255,255,255,0.15)',
        justifyContent: 'center', alignItems: 'center',
    },
    imageViewerImage: {
        width: Dimensions.get('window').width - 20,
        height: Dimensions.get('window').height * 0.7,
    },

    // Reschedule button on appointment card
    rescheduleBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        marginTop: 8, alignSelf: 'flex-end',
        paddingHorizontal: 10, paddingVertical: 5, borderRadius: r(12),
        backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FDBA74',
    },
    rescheduleBtnText: { fontSize: 11, fontWeight: '700', color: '#F97316' },
    // Seller action bar (confirmed buyer chat)
    sellerActionBar: {
        flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 10,
        backgroundColor: '#FFFBEB', borderBottomWidth: 1, borderBottomColor: '#FDE68A',
    },
    sellerPassBtn: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        paddingVertical: 10, borderRadius: r(12), backgroundColor: '#FFF7ED',
        borderWidth: 1, borderColor: '#FDBA74',
    },
    sellerPassBtnText: { fontSize: 13, fontWeight: '700', color: '#F97316' },
    sellerCancelBtn: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        paddingVertical: 10, borderRadius: r(12), backgroundColor: '#FEF2F2',
        borderWidth: 1, borderColor: '#FCA5A5',
    },
    sellerCancelBtnText: { fontSize: 13, fontWeight: '700', color: '#DC2626' },
    sellerSoldBar: {
        paddingHorizontal: 14, paddingVertical: 8,
        backgroundColor: '#F0FDF4', borderBottomWidth: 1, borderBottomColor: '#BBF7D0',
    },
    sellerSoldBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        paddingVertical: 11, borderRadius: r(12), backgroundColor: '#059669',
    },
    sellerSoldBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' },
    // Chat pass confirmation modal
    chatPassOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
    chatPassCard: { backgroundColor: '#fff', borderRadius: r(24), padding: 28, width: '100%', alignItems: 'center', ...theme.shadows.lg },
    chatPassCloseX: { position: 'absolute', top: 14, right: 14, width: 32, height: 32, borderRadius: r(16), backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center', zIndex: 10 },
    chatPassIconWrap: { width: 64, height: 64, borderRadius: r(32), backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
    chatPassTitle: { fontSize: 20, fontWeight: '800', color: theme.colors.textPrimary, marginBottom: 12 },
    chatPassDesc: { fontSize: 14, color: theme.colors.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
    chatPassActions: { flexDirection: 'row', gap: 12, width: '100%' },
    chatPassCancelBtn: { flex: 1, paddingVertical: 14, borderRadius: r(14), backgroundColor: '#F1F5F9', alignItems: 'center' },
    chatPassCancelText: { fontSize: 15, fontWeight: '700', color: theme.colors.textPrimary },
    chatPassConfirmBtn: { flex: 1, paddingVertical: 14, borderRadius: r(14), backgroundColor: '#F97316', alignItems: 'center' },
    chatPassConfirmText: { fontSize: 15, fontWeight: '700', color: '#fff' },
    // Read receipts
    timeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
    readLabel: { fontSize: 10, fontWeight: '600', color: '#F97316' },
    // Typing indicator
    typingWrap: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingHorizontal: 16, paddingVertical: 8,
    },
    typingBubble: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        backgroundColor: '#E2E8F0', borderRadius: r(16),
        paddingHorizontal: 12, paddingVertical: 8,
    },
    typingDot: {
        width: 7, height: 7, borderRadius: r(3.5),
        backgroundColor: '#94A3B8',
    },
    typingText: { fontSize: 12, color: theme.colors.textMuted, fontStyle: 'italic' },
});
