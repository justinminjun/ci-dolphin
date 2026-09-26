import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Image, Switch, Keyboard, findNodeHandle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, r } from '../theme/theme';
import { auth, db, storage } from '../config/firebase';
import { collection, addDoc, serverTimestamp, doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as MailComposer from 'expo-mail-composer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsWebDesktop } from '../utils/useResponsive';

const EMAIL_KEY = '@post_email_recipients';

const CATEGORIES = [
    { key: 'general', label: 'General', icon: 'chatbubble-outline', color: theme.colors.primary },
    { key: 'question', label: 'Questions', icon: 'help-circle-outline', color: '#8B5CF6' },
    { key: 'event', label: 'Events', icon: 'calendar-outline', color: '#F59E0B' },
    { key: 'tip', label: 'Tips', icon: 'bulb-outline', color: '#10B981' },
    { key: 'life', label: 'Life Info', icon: 'information-circle-outline', color: '#06B6D4' },
    { key: 'food', label: 'Food/Dining', icon: 'restaurant-outline', color: '#F43F5E' },
    { key: 'housing', label: 'Housing', icon: 'home-outline', color: '#8B5CF6' },
];

export function CreatePostScreen({ route, navigation }: any) {
    const isWebDesktop = useIsWebDesktop();
    const editPost = route?.params?.editPost || null;
    const isEditing = !!editPost;

    const [title, setTitle] = useState(editPost?.title || '');
    const [body, setBody] = useState(editPost?.body || '');
    const [category, setCategory] = useState(editPost?.category || 'general');
    const [loading, setLoading] = useState(false);
    const [photos, setPhotos] = useState<string[]>(editPost?.photos || []);
    const [chatEnabled, setChatEnabled] = useState(editPost?.chatEnabled || false);

    // Email feature
    const [emailEnabled, setEmailEnabled] = useState(false);
    const [emailTo, setEmailTo] = useState('');

    useEffect(() => {
        AsyncStorage.getItem(EMAIL_KEY).then(val => { if (val) setEmailTo(val); });
    }, []);

    // Formatting state
    const [isBold, setIsBold] = useState(editPost?.bodyStyle?.bold || false);
    const [isItalic, setIsItalic] = useState(editPost?.bodyStyle?.italic || false);
    const [fontSize, setFontSize] = useState(editPost?.bodyStyle?.fontSize || 15);
    const [fontColor, setFontColor] = useState(editPost?.bodyStyle?.color || theme.colors.textPrimary);
    const [showColorPicker, setShowColorPicker] = useState(false);
    const [eventLocation, setEventLocation] = useState(editPost?.eventLocation || '');
    const [eventTime, setEventTime] = useState(editPost?.eventTime || '');

    const FONT_SIZES = [13, 15, 18, 22, 28];
    const COLORS = ['#1E293B', '#2563EB', '#059669', '#F97316', '#EF4444', '#8B5CF6', '#EC4899', '#0EA5E9'];
    const scrollViewRef = useRef<ScrollView>(null);
    const bodyInputRef = useRef<TextInput>(null);

    const pickPhoto = async () => {
        if (photos.length >= 1) { Alert.alert('Limit', 'Maximum 1 photo per post.'); return; }
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { Alert.alert('Permission needed'); return; }

        const result = await ImagePicker.launchImageLibraryAsync({
            quality: 0.6,
            allowsEditing: true,
            aspect: [1, 1],
        });
        if (!result.canceled && result.assets[0]) {
            setPhotos(prev => [...prev, result.assets[0].uri]);
        }
    };

    const removePhoto = (index: number) => {
        setPhotos(prev => prev.filter((_, i) => i !== index));
    };

    const handlePost = async () => {
        if (!title.trim()) {
            Alert.alert('Missing Title', 'Please enter a title for your post.');
            return;
        }
        if (!body.trim()) {
            Alert.alert('Missing Content', 'Please write something for your post.');
            return;
        }

        const user = auth.currentUser;
        if (!user) {
            Alert.alert('Error', 'You must be logged in to post.');
            return;
        }

        setLoading(true);
        try {
            // Upload photos to Firebase Storage
            const uploadedPhotoUrls: string[] = [];
            for (const photoUri of photos) {
                // Skip already-uploaded remote URLs
                if (photoUri.startsWith('https://')) {
                    uploadedPhotoUrls.push(photoUri);
                    continue;
                }
                try {
                    const compressed = await manipulateAsync(
                        photoUri,
                        [{ resize: { width: 800 } }],
                        { compress: 0.6, format: SaveFormat.JPEG }
                    );
                    const response = await fetch(compressed.uri);
                    const blob = await response.blob();
                    const filename = `lounge/${user.uid}/${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
                    const storageRef = ref(storage, filename);
                    await uploadBytes(storageRef, blob);
                    const downloadUrl = await getDownloadURL(storageRef);
                    uploadedPhotoUrls.push(downloadUrl);
                } catch (uploadErr) {
                    console.error('Photo upload failed:', uploadErr);
                }
            }

            if (isEditing) {
                // Update existing post
                const allPhotos = [...uploadedPhotoUrls];
                for (const p of photos) {
                    if (p.startsWith('https://') && !uploadedPhotoUrls.includes(p)) allPhotos.push(p);
                }
                await updateDoc(doc(db, 'lounge_posts', editPost.id), {
                    title: title.trim(),
                    body: body.trim(),
                    category,
                    photos: allPhotos.length > 0 ? allPhotos : (editPost.photos || []),
                    chatEnabled,
                    bodyStyle: { bold: isBold, italic: isItalic, fontSize, color: fontColor },
                    ...(category === 'event' ? { eventLocation: eventLocation.trim(), eventTime: eventTime.trim() } : {}),
                });
            } else {
                await addDoc(collection(db, 'lounge_posts'), {
                    title: title.trim(),
                    body: body.trim(),
                    category,
                    authorId: user.uid,
                    authorName: user.displayName || 'Anonymous',
                    authorEmail: user.email || '',
                    authorPhoto: user.photoURL || null,
                    photos: uploadedPhotoUrls,
                    createdAt: serverTimestamp(),
                    likes: 0, commentCount: 0, views: 0,
                    chatEnabled,
                    bodyStyle: { bold: isBold, italic: isItalic, fontSize, color: fontColor },
                    ...(category === 'event' ? { eventLocation: eventLocation.trim(), eventTime: eventTime.trim() } : {}),
                });
            }

            // Send email if enabled
            if (emailEnabled && emailTo.trim()) {
                await AsyncStorage.setItem(EMAIL_KEY, emailTo.trim());
                const catLabel = CATEGORIES.find(c => c.key === category)?.label || 'General';
                const user = auth.currentUser;
                const senderName = user?.displayName || 'Dolphin User';
                const photoHtml = uploadedPhotoUrls.length > 0
                    ? uploadedPhotoUrls.map(url => `<div style="margin:16px 0;"><img src="${url}" style="max-width:100%;border-radius:12px;" /></div>`).join('')
                    : '';
                const eventHtml = category === 'event' && (eventLocation.trim() || eventTime.trim())
                    ? `<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:12px;padding:14px;margin:12px 0;"><p style="font-weight:800;color:#B45309;margin:0 0 8px;">📅 Event Details</p>${eventLocation.trim() ? `<p style="margin:4px 0;color:#1E293B;">📍 ${eventLocation.trim()}</p>` : ''}${eventTime.trim() ? `<p style="margin:4px 0;color:#1E293B;">🕐 ${eventTime.trim()}</p>` : ''}</div>`
                    : '';
                const catColor = CATEGORIES.find(c => c.key === category)?.color || '#0EA5E9';
                const htmlBody = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;"><div style="background:linear-gradient(135deg,#0EA5E9,#0284C7);padding:24px 20px;border-radius:0 0 20px 20px;"><h2 style="color:#fff;margin:0;font-size:22px;">🐬 Dolphin Community</h2><p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:13px;">Chadwick International School</p></div><div style="padding:20px;"><span style="display:inline-block;background:${catColor}22;color:${catColor};font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;letter-spacing:0.5px;">${catLabel.toUpperCase()}</span><h1 style="color:#0F172A;font-size:20px;margin:12px 0 8px;">${title.trim()}</h1><p style="color:#475569;font-size:15px;line-height:1.6;white-space:pre-wrap;">${body.trim()}</p>${photoHtml}${eventHtml}<div style="margin-top:20px;padding-top:16px;border-top:1px solid #E2E8F0;"><p style="color:#94A3B8;font-size:12px;margin:0;">Posted by <strong style="color:#0F172A;">${senderName}</strong></p></div></div></div>`;
                try {
                    const available = await MailComposer.isAvailableAsync();
                    if (available) {
                        await MailComposer.composeAsync({
                            recipients: emailTo.split(',').map(e => e.trim()).filter(Boolean),
                            subject: `[Dolphin] ${title.trim()}`,
                            body: htmlBody,
                            isHtml: true,
                        });
                    }
                } catch {}
            }

            navigation.goBack();
        } catch (error: any) {
            Alert.alert('Error', error.message || 'Failed to create post.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            {/* Header */}
            <View style={[styles.header, isWebDesktop && { paddingTop: 20 }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeBtn}>
                    <Ionicons name="close" size={26} color={theme.colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{isEditing ? 'Edit Post' : 'New Post'}</Text>
                <TouchableOpacity
                    style={[styles.postBtn, (!title.trim() || !body.trim()) && styles.postBtnDisabled]}
                    onPress={handlePost}
                    disabled={loading || !title.trim() || !body.trim()}
                >
                    {loading ? (
                        <ActivityIndicator size="small" color="#fff" />
                    ) : (
                        <Text style={styles.postBtnText}>{isEditing ? 'Save' : 'Post'}</Text>
                    )}
                </TouchableOpacity>
            </View>

            <ScrollView ref={scrollViewRef} style={styles.form} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
                {/* Options — Chat & Email */}
                <View style={styles.chatToggleRow}>
                    <View style={styles.chatToggleLeft}>
                        <Ionicons name="chatbubbles-outline" size={20} color={theme.colors.primary} />
                        <View>
                            <Text style={styles.chatToggleLabel}>Allow Direct Chat</Text>
                            <Text style={styles.chatToggleHint}>Let others message you about this post</Text>
                        </View>
                    </View>
                    <Switch
                        value={chatEnabled}
                        onValueChange={setChatEnabled}
                        trackColor={{ false: theme.colors.borderLight, true: '#93C5FD' }}
                        thumbColor={chatEnabled ? theme.colors.primary : '#f4f4f5'}
                    />
                </View>
                <View style={[styles.chatToggleRow, { marginTop: -8 }, emailEnabled && styles.emailToggleActive]}>
                    <View style={styles.chatToggleLeft}>
                        <Ionicons name="mail-outline" size={20} color="#F97316" />
                        <View>
                            <Text style={styles.chatToggleLabel}>Also Send via Email</Text>
                            <Text style={styles.chatToggleHint}>Send a formatted copy to email recipients</Text>
                        </View>
                    </View>
                    <Switch
                        value={emailEnabled}
                        onValueChange={setEmailEnabled}
                        trackColor={{ false: theme.colors.borderLight, true: '#FDBA74' }}
                        thumbColor={emailEnabled ? '#F97316' : '#f4f4f5'}
                    />
                </View>
                {emailEnabled && (
                    <View style={styles.emailInputBox}>
                        <Ionicons name="people-outline" size={18} color="#F97316" />
                        <TextInput
                            style={styles.emailInput}
                            placeholder="Recipient email(s), comma separated"
                            placeholderTextColor={theme.colors.textMuted}
                            value={emailTo}
                            onChangeText={setEmailTo}
                            keyboardType="email-address"
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                    </View>
                )}

                {/* Category Picker */}
                <Text style={styles.label}>Category</Text>
                <View style={styles.categoryRow}>
                    {CATEGORIES.map(cat => (
                        <TouchableOpacity
                            key={cat.key}
                            style={[styles.categoryChip, category === cat.key && { backgroundColor: cat.color }]}
                            onPress={() => setCategory(cat.key)}
                        >
                            <Ionicons
                                name={cat.icon as any}
                                size={16}
                                color={category === cat.key ? '#fff' : theme.colors.textSecondary}
                            />
                            <Text style={[styles.categoryText, category === cat.key && styles.categoryTextActive]}>
                                {cat.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>

                {/* Photo — Single Hero */}
                {photos.length === 0 ? (
                    <TouchableOpacity style={styles.photoHero} onPress={pickPhoto} activeOpacity={0.7}>
                        <View style={styles.photoHeroContent}>
                            <Ionicons name="camera" size={40} color={theme.colors.textMuted} />
                            <Text style={styles.photoHeroTitle}>Add Cover Photo</Text>
                            <Text style={styles.photoHeroHint}>Tap to add a photo (optional)</Text>
                        </View>
                    </TouchableOpacity>
                ) : (
                    <View style={styles.photoPreviewSection}>
                        <View style={styles.photoLargeWrap}>
                            <Image source={{ uri: photos[0] }} style={styles.photoSinglePreview} resizeMode="contain" />
                            <TouchableOpacity style={styles.photoLargeRemove} onPress={() => removePhoto(0)}>
                                <Ionicons name="close-circle" size={26} color="#fff" />
                            </TouchableOpacity>
                        </View>
                    </View>
                )}

                {/* Title */}
                <TextInput
                    style={styles.titleInput}
                    placeholder="Title"
                    placeholderTextColor={theme.colors.textMuted}
                    value={title}
                    onChangeText={setTitle}
                    maxLength={100}
                />

                {/* Body with formatting toolbar */}
                <View style={styles.formatToolbar}>
                    <TouchableOpacity
                        style={[styles.formatBtn, isBold && styles.formatBtnActive]}
                        onPress={() => setIsBold(!isBold)}
                    >
                        <Text style={[styles.formatBtnText, { fontWeight: '900' }, isBold && styles.formatBtnTextActive]}>B</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.formatBtn, isItalic && styles.formatBtnActive]}
                        onPress={() => setIsItalic(!isItalic)}
                    >
                        <Text style={[styles.formatBtnText, { fontStyle: 'italic' }, isItalic && styles.formatBtnTextActive]}>I</Text>
                    </TouchableOpacity>
                    <View style={styles.formatDivider} />
                    {FONT_SIZES.map(s => (
                        <TouchableOpacity
                            key={s}
                            style={[styles.formatBtn, fontSize === s && styles.formatBtnActive]}
                            onPress={() => setFontSize(s)}
                        >
                            <Text style={[styles.formatSizeText, { fontSize: Math.min(s, 16) }, fontSize === s && styles.formatBtnTextActive]}>
                                {s === 13 ? 'S' : s === 15 ? 'M' : s === 18 ? 'L' : s === 22 ? 'XL' : 'H'}
                            </Text>
                        </TouchableOpacity>
                    ))}
                    <View style={styles.formatDivider} />
                    <TouchableOpacity style={styles.formatBtn} onPress={() => setShowColorPicker(!showColorPicker)}>
                        <View style={[styles.colorDot, { backgroundColor: fontColor }]} />
                    </TouchableOpacity>
                </View>
                {showColorPicker && (
                    <View style={styles.colorRow}>
                        {COLORS.map(c => (
                            <TouchableOpacity
                                key={c}
                                style={[styles.colorOption, { backgroundColor: c }, fontColor === c && styles.colorOptionActive]}
                                onPress={() => { setFontColor(c); setShowColorPicker(false); }}
                            />
                        ))}
                    </View>
                )}
                <TextInput
                    ref={bodyInputRef}
                    style={[
                        styles.bodyInput,
                        isBold && { fontWeight: '700' },
                        isItalic && { fontStyle: 'italic' },
                        { fontSize, color: fontColor },
                    ]}
                    placeholder="What's on your mind?"
                    placeholderTextColor={theme.colors.textMuted}
                    value={body}
                    onChangeText={setBody}
                    multiline
                    textAlignVertical="top"
                    maxLength={2000}
                    onFocus={() => {
                        setTimeout(() => {
                            bodyInputRef.current?.measureLayout(
                                findNodeHandle(scrollViewRef.current) as number,
                                (_x, y) => {
                                    scrollViewRef.current?.scrollTo({ y: y - 60, animated: true });
                                },
                                () => {}
                            );
                        }, 300);
                    }}
                />

                <Text style={styles.charCount}>{body.length} / 2000</Text>

                {/* Event-specific fields */}
                {category === 'event' && (
                    <View style={styles.eventFieldsBox}>
                        <Text style={styles.eventFieldsTitle}>📅 Event Details</Text>
                        <View style={styles.eventFieldRow}>
                            <Ionicons name="location-outline" size={18} color="#F59E0B" />
                            <TextInput
                                style={styles.eventFieldInput}
                                placeholder="Location / Venue"
                                placeholderTextColor={theme.colors.textMuted}
                                value={eventLocation}
                                onChangeText={setEventLocation}
                            />
                        </View>
                        <View style={styles.eventFieldRow}>
                            <Ionicons name="time-outline" size={18} color="#F59E0B" />
                            <TextInput
                                style={styles.eventFieldInput}
                                placeholder="Date & Time (e.g. May 3, 3:00 PM)"
                                placeholderTextColor={theme.colors.textMuted}
                                value={eventTime}
                                onChangeText={setEventTime}
                            />
                        </View>
                    </View>
                )}
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: theme.spacing.md, paddingTop: 60, paddingBottom: 12,
        backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.border,
    },
    closeBtn: { padding: 4 },
    headerTitle: { ...theme.typography.h3, color: theme.colors.textPrimary },
    postBtn: {
        backgroundColor: theme.colors.primary, paddingHorizontal: 20, paddingVertical: 8,
        borderRadius: theme.radius.full, minWidth: 70, alignItems: 'center',
    },
    postBtnDisabled: { opacity: 0.4 },
    postBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    form: { flex: 1, padding: theme.spacing.md },
    label: { ...theme.typography.caption, fontWeight: '600', color: theme.colors.textSecondary, marginBottom: 8 },
    categoryRow: { flexDirection: 'row', gap: 8, marginBottom: 20, flexWrap: 'wrap' },
    categoryChip: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 14, paddingVertical: 8, borderRadius: theme.radius.full,
        backgroundColor: theme.colors.surfaceAlt,
    },
    categoryText: { ...theme.typography.caption, fontWeight: '600', color: theme.colors.textSecondary },
    categoryTextActive: { color: '#fff' },
    titleInput: {
        ...theme.typography.h3, color: theme.colors.textPrimary,
        backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg,
        padding: theme.spacing.md, marginBottom: 12, borderWidth: 1, borderColor: theme.colors.border,
    },
    bodyInput: {
        ...theme.typography.body, color: theme.colors.textPrimary,
        backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg,
        padding: theme.spacing.md, minHeight: 180, borderWidth: 1, borderColor: theme.colors.border,
    },
    charCount: { ...theme.typography.tiny, color: theme.colors.textMuted, textAlign: 'right', marginTop: 8 },

    // Photo hero (empty state)
    photoHero: {
        height: 180, borderRadius: theme.radius.lg, borderWidth: 2,
        borderColor: theme.colors.border, borderStyle: 'dashed',
        backgroundColor: theme.colors.surfaceAlt, justifyContent: 'center',
        alignItems: 'center', marginBottom: 20,
    },
    photoHeroContent: { alignItems: 'center', gap: 6 },
    photoHeroTitle: { fontSize: 17, fontWeight: '700', color: theme.colors.textSecondary },
    photoHeroHint: { fontSize: 13, color: theme.colors.textMuted },

    // Photo preview
    photoPreviewSection: { marginBottom: 20 },
    photoLargeWrap: { position: 'relative' },
    photoSinglePreview: { width: '100%', height: 220, borderRadius: r(14), backgroundColor: '#000' },
    photoLargeRemove: { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: r(13) },

    // Formatting toolbar
    formatToolbar: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        backgroundColor: theme.colors.surface, borderRadius: r(12),
        padding: 6, marginBottom: 6, borderWidth: 1, borderColor: theme.colors.border,
    },
    formatBtn: {
        width: 32, height: 32, borderRadius: r(8), justifyContent: 'center', alignItems: 'center',
    },
    formatBtnActive: { backgroundColor: theme.colors.primary },
    formatBtnText: { fontSize: 15, fontWeight: '600', color: theme.colors.textSecondary },
    formatBtnTextActive: { color: '#fff' },
    formatSizeText: { fontWeight: '700', color: theme.colors.textSecondary },
    formatDivider: { width: 1, height: 20, backgroundColor: theme.colors.borderLight, marginHorizontal: 2 },
    colorDot: { width: 18, height: 18, borderRadius: r(9), borderWidth: 2, borderColor: theme.colors.borderLight },
    colorRow: {
        flexDirection: 'row', gap: 10, padding: 10,
        backgroundColor: theme.colors.surface, borderRadius: r(10),
        marginBottom: 6, borderWidth: 1, borderColor: theme.colors.border,
    },
    colorOption: { width: 28, height: 28, borderRadius: r(14) },
    colorOptionActive: { borderWidth: 3, borderColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 3 },

    chatToggleRow: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg,
        padding: 14, marginTop: 16, marginBottom: 20, borderWidth: 1, borderColor: theme.colors.border,
    },
    chatToggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
    chatToggleLabel: { fontSize: 15, fontWeight: '600', color: theme.colors.textPrimary },
    chatToggleHint: { fontSize: 12, color: theme.colors.textMuted, marginTop: 1 },
    eventFieldsBox: {
        backgroundColor: '#FFFBEB', borderRadius: r(14), padding: 14, marginTop: 12,
        borderWidth: 1, borderColor: '#FDE68A', marginBottom: 4,
    },
    eventFieldsTitle: { fontSize: 14, fontWeight: '800', color: '#B45309', marginBottom: 10 },
    eventFieldRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
    eventFieldInput: { flex: 1, fontSize: 14, color: theme.colors.textPrimary, borderBottomWidth: 1, borderBottomColor: '#FDE68A', paddingVertical: 6 },

    // Email
    emailToggleActive: { borderColor: '#FDBA74', borderWidth: 1.5 },
    emailInputBox: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: '#FFF7ED', borderRadius: r(14), padding: 14,
        marginTop: -4, marginBottom: 20, borderWidth: 1, borderColor: '#FDBA74',
    },
    emailInput: { flex: 1, fontSize: 14, color: theme.colors.textPrimary },
});
