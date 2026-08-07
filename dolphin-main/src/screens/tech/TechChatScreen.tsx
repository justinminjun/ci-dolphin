import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    View, Text, StyleSheet, TextInput, TouchableOpacity,
    FlatList, KeyboardAvoidingView, Platform, ActivityIndicator,
    Image, Alert, ActionSheetIOS,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { theme, r } from '../../theme/theme';
import { db, auth } from '../../config/firebase';
import { collection, getDocs, query, orderBy, addDoc, serverTimestamp } from 'firebase/firestore';
import { useFocusEffect } from '@react-navigation/native';

const DOLPHIN_LOGO = require('../../../assets/dolphin-logo.png');

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';

const BASE_SYSTEM_PROMPT = `You are the Chadwick International School Tech Office AI Assistant.
You help students and faculty with school technology issues.
Be friendly, concise, and helpful. Keep responses under 200 words.
If you're unsure, suggest visiting the Tech Office (Room B118) or emailing techsupport@chadwickschool.org.

If a user sends an image, analyze it carefully — it could be an error screenshot, a broken device photo, a printer issue, etc. Describe what you see and provide helpful troubleshooting steps.

If the user's question is about something covered in the KNOWLEDGE BASE below, use that information to answer accurately. If the question is not covered, say so honestly and suggest contacting the Tech Office.

--- KNOWLEDGE BASE ---
`;

interface Message {
    id: string;
    text: string;
    sender: 'user' | 'bot';
    timestamp: Date;
    imageUri?: string;
}

export function TechChatScreen() {
    const [messages, setMessages] = useState<Message[]>([
        {
            id: '0',
            text: "Hi! I'm the Chadwick Tech Office Assistant.\n\nI can help you with WiFi, passwords, printing, school apps, and more.\n\nYou can also send me a photo of any tech issue!\n\nWhat do you need help with?",
            sender: 'bot',
            timestamp: new Date(),
        },
    ]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [knowledgeBase, setKnowledgeBase] = useState('');
    const [kbLoading, setKbLoading] = useState(true);
    const [pendingImage, setPendingImage] = useState<string | null>(null);
    const flatListRef = useRef<FlatList>(null);
    const hasUserMessages = useRef(false);

    // Load knowledge base from Firestore on mount
    useEffect(() => {
        loadKnowledgeBase();
    }, []);

    // Save chat log when leaving screen
    useFocusEffect(
        useCallback(() => {
            return () => {
                // Runs when screen loses focus (user navigates away)
                if (hasUserMessages.current && messages.length > 2) {
                    saveChatLog(messages);
                }
            };
        }, [messages])
    );

    const loadKnowledgeBase = async () => {
        try {
            const q = query(collection(db, 'tech_knowledge'), orderBy('order', 'asc'));
            const snap = await getDocs(q);
            if (snap.empty) {
                setKnowledgeBase('No additional knowledge loaded. Use your built-in knowledge about school IT support.');
            } else {
                const entries = snap.docs.map(d => {
                    const data = d.data();
                    let entry = `## ${data.title || 'Untitled'}\n${data.content || ''}`;
                    if (data.imageUrl) {
                        entry += `\n[Reference Image: ${data.imageUrl}]`;
                    }
                    return entry;
                });
                setKnowledgeBase(entries.join('\n\n'));
            }
        } catch (err) {
            console.log('KB load error:', err);
            setKnowledgeBase('Knowledge base unavailable. Use your built-in knowledge.');
        } finally {
            setKbLoading(false);
        }
    };

    const getSystemPrompt = () => BASE_SYSTEM_PROMPT + knowledgeBase + '\n--- END KNOWLEDGE BASE ---';

    // Save conversation log to Firestore for admin review
    const saveChatLog = async (msgs: Message[]) => {
        try {
            const user = auth.currentUser;
            const userMessages = msgs.filter(m => m.sender === 'user').map(m => m.text);
            const botMessages = msgs.filter(m => m.sender === 'bot').slice(1).map(m => m.text); // skip greeting

            if (userMessages.length === 0) return;

            // Use Gemini to summarize the conversation
            const convoText = msgs
                .filter(m => m.id !== '0') // skip greeting
                .map(m => `${m.sender === 'user' ? 'Student' : 'Bot'}: ${m.text}`)
                .join('\n');

            let summary = userMessages.join(' | '); // fallback summary

            try {
                const res = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{
                                role: 'user',
                                parts: [{ text: `Summarize this tech support conversation in 1-2 sentences. Focus on what the student needed help with and whether it was resolved:\n\n${convoText}` }],
                            }],
                            generationConfig: { maxOutputTokens: 100, temperature: 0.3 },
                        }),
                    }
                );
                const data = await res.json();
                const aiSummary = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (aiSummary) summary = aiSummary;
            } catch {
                // Use fallback summary
            }

            // Determine topic category
            const topicKeywords: Record<string, string[]> = {
                wifi: ['wifi', 'wi-fi', 'network', 'internet', 'connection'],
                printer: ['print', 'printer', 'paper', 'ink', 'toner'],
                password: ['password', 'login', 'sign in', 'reset', 'locked'],
                device: ['chromebook', 'laptop', 'ipad', 'macbook', 'charger', 'screen', 'battery'],
                software: ['app', 'software', 'install', 'update', 'canvas', 'veracross', 'google'],
            };
            const allUserText = userMessages.join(' ').toLowerCase();
            let topic = 'general';
            for (const [key, keywords] of Object.entries(topicKeywords)) {
                if (keywords.some(kw => allUserText.includes(kw))) {
                    topic = key;
                    break;
                }
            }

            await addDoc(collection(db, 'tech_chat_logs'), {
                userId: user?.uid || 'anonymous',
                userEmail: user?.email || 'unknown',
                userName: user?.displayName || 'Unknown Student',
                summary,
                topic,
                messageCount: msgs.length - 1, // exclude greeting
                userQuestions: userMessages,
                createdAt: serverTimestamp(),
            });
        } catch (err) {
            console.log('Chat log save error:', err);
        }
    };

    // Image picker
    const pickImage = () => {
        if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
                { options: ['Cancel', 'Take Photo', 'Choose from Library'], cancelButtonIndex: 0 },
                async (buttonIndex) => {
                    if (buttonIndex === 1) await launchCamera();
                    else if (buttonIndex === 2) await launchGallery();
                }
            );
        } else {
            Alert.alert('Add Image', '', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Take Photo', onPress: launchCamera },
                { text: 'Choose from Library', onPress: launchGallery },
            ]);
        }
    };

    const launchCamera = async () => {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { Alert.alert('Permission needed', 'Camera access is required.'); return; }
        const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.5, allowsEditing: true });
        if (!result.canceled && result.assets[0]) {
            setPendingImage(result.assets[0].uri);
        }
    };

    const launchGallery = async () => {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { Alert.alert('Permission needed', 'Photo library access is required.'); return; }
        const result = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.5, allowsEditing: true });
        if (!result.canceled && result.assets[0]) {
            setPendingImage(result.assets[0].uri);
        }
    };

    const uriToBase64 = async (uri: string): Promise<string> => {
        const response = await fetch(uri);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = (reader.result as string).split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    };

    const sendMessage = async () => {
        const hasText = input.trim().length > 0;
        const hasImage = !!pendingImage;
        if ((!hasText && !hasImage) || loading) return;

        hasUserMessages.current = true;

        const userMsg: Message = {
            id: Date.now().toString(),
            text: hasText ? input.trim() : '📷 [Image sent]',
            sender: 'user',
            timestamp: new Date(),
            imageUri: pendingImage || undefined,
        };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        const currentImage = pendingImage;
        setPendingImage(null);
        setLoading(true);

        try {
            // Build conversation history (text only for past messages)
            const history: any[] = messages.map(m => ({
                role: m.sender === 'user' ? 'user' : 'model',
                parts: [{ text: m.text }],
            }));

            // Build current message parts
            const userParts: any[] = [];
            if (hasText) {
                userParts.push({ text: input.trim() });
            }
            if (currentImage) {
                try {
                    const base64 = await uriToBase64(currentImage);
                    userParts.push({
                        inlineData: {
                            mimeType: 'image/jpeg',
                            data: base64,
                        },
                    });
                    if (!hasText) {
                        userParts.unshift({ text: 'Please analyze this image and help me with the tech issue shown.' });
                    }
                } catch (imgErr) {
                    console.log('Image encode error:', imgErr);
                    userParts.push({ text: '[User tried to send an image but it failed to encode]' });
                }
            }
            history.push({ role: 'user', parts: userParts });

            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        systemInstruction: { parts: [{ text: getSystemPrompt() }] },
                        contents: history,
                        generationConfig: { maxOutputTokens: 800, temperature: 0.7 },
                    }),
                }
            );

            const data = await response.json();
            let botText = data?.candidates?.[0]?.content?.parts?.[0]?.text
                || "Sorry, I couldn't process that. Please try again or visit the Tech Office.";

            botText = botText.replace(/\[IMAGE:\s*(https?:\/\/[^\]]+)\]/gi, '\n📷 Reference: $1');

            setMessages(prev => [
                ...prev,
                { id: (Date.now() + 1).toString(), text: botText, sender: 'bot', timestamp: new Date() },
            ]);
        } catch {
            setMessages(prev => [
                ...prev,
                { id: (Date.now() + 1).toString(), text: "I'm having trouble connecting right now. Please try again later or visit the Tech Office in Room B118.", sender: 'bot', timestamp: new Date() },
            ]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (flatListRef.current && messages.length > 0) {
            setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
        }
    }, [messages]);

    const renderMessage = ({ item }: { item: Message }) => (
        <View style={[styles.msgRow, item.sender === 'user' && styles.msgRowUser]}>
            {item.sender === 'bot' && (
                <Image source={DOLPHIN_LOGO} style={styles.botIconImg} />
            )}
            <View style={[styles.msgBubble, item.sender === 'user' ? styles.userBubble : styles.botBubble]}>
                {item.imageUri && (
                    <Image source={{ uri: item.imageUri }} style={styles.msgImage} />
                )}
                <Text style={[styles.msgText, item.sender === 'user' && styles.userMsgText]}>
                    {item.text}
                </Text>
            </View>
        </View>
    );

    return (
        <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            {kbLoading && (
                <View style={styles.kbBanner}>
                    <ActivityIndicator size="small" color="#6366F1" />
                    <Text style={styles.kbBannerText}>Loading knowledge base...</Text>
                </View>
            )}

            <FlatList
                ref={flatListRef}
                data={messages}
                keyExtractor={item => item.id}
                renderItem={renderMessage}
                contentContainerStyle={styles.chatList}
                onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            />

            {loading && (
                <View style={styles.typingRow}>
                    <Image source={DOLPHIN_LOGO} style={styles.botIconImg} />
                    <View style={styles.typingBubble}>
                        <ActivityIndicator size="small" color="#6366F1" />
                        <Text style={styles.typingText}>Thinking...</Text>
                    </View>
                </View>
            )}

            {/* Pending image preview */}
            {pendingImage && (
                <View style={styles.previewRow}>
                    <Image source={{ uri: pendingImage }} style={styles.previewImg} />
                    <TouchableOpacity style={styles.previewRemove} onPress={() => setPendingImage(null)}>
                        <Ionicons name="close-circle" size={22} color="#EF4444" />
                    </TouchableOpacity>
                </View>
            )}

            {/* Input */}
            <View style={styles.inputRow}>
                <TouchableOpacity style={styles.imageBtn} onPress={pickImage} disabled={loading}>
                    <Ionicons name="camera" size={22} color={loading ? '#ccc' : '#6366F1'} />
                </TouchableOpacity>
                <TextInput
                    style={styles.textInput}
                    placeholder="Ask about WiFi, printing, apps..."
                    placeholderTextColor={theme.colors.textMuted}
                    value={input}
                    onChangeText={setInput}
                    onSubmitEditing={sendMessage}
                    returnKeyType="send"
                    multiline
                    maxLength={500}
                />
                <TouchableOpacity
                    style={[styles.sendBtn, (!input.trim() && !pendingImage || loading) && { opacity: 0.4 }]}
                    onPress={sendMessage}
                    disabled={(!input.trim() && !pendingImage) || loading}
                >
                    <Ionicons name="send" size={20} color="#fff" />
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F0F0F8' },
    kbBanner: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        paddingVertical: 6, backgroundColor: '#EEF2FF',
    },
    kbBannerText: { fontSize: 12, color: '#6366F1', fontWeight: '600' },
    chatList: { padding: 16, paddingBottom: 8 },
    msgRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 12, gap: 8 },
    msgRowUser: { flexDirection: 'row-reverse' },
    botIconImg: {
        width: 32, height: 32, borderRadius: r(16),
        resizeMode: 'contain', backgroundColor: '#EEF2FF',
    },
    msgBubble: { maxWidth: '75%', padding: 12, borderRadius: r(18) },
    botBubble: { backgroundColor: '#fff', borderBottomLeftRadius: 4, ...theme.shadows.sm },
    userBubble: { backgroundColor: '#6366F1', borderBottomRightRadius: 4 },
    msgImage: { width: 200, height: 150, borderRadius: r(12), marginBottom: 8, resizeMode: 'cover' },
    msgText: { fontSize: 15, lineHeight: 21, color: '#1a1a2e' },
    userMsgText: { color: '#fff' },
    typingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
    typingBubble: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', padding: 10, borderRadius: r(16), ...theme.shadows.sm },
    typingText: { fontSize: 13, color: theme.colors.textMuted },
    previewRow: {
        flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8,
        backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: theme.colors.border,
    },
    previewImg: { width: 60, height: 60, borderRadius: r(8), resizeMode: 'cover' },
    previewRemove: { marginLeft: 8 },
    inputRow: {
        flexDirection: 'row', alignItems: 'flex-end', gap: 8,
        padding: 12, paddingBottom: 34, backgroundColor: '#fff',
        borderTopWidth: 1, borderTopColor: theme.colors.border,
    },
    imageBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
    textInput: {
        flex: 1, backgroundColor: '#F0F0F8', borderRadius: r(20),
        paddingHorizontal: 16, paddingVertical: 10, fontSize: 15,
        maxHeight: 100, color: theme.colors.textPrimary,
    },
    sendBtn: {
        width: 40, height: 40, borderRadius: r(20), backgroundColor: '#6366F1',
        justifyContent: 'center', alignItems: 'center',
    },
});
