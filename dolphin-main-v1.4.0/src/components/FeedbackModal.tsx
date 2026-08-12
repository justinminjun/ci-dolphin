import React, { useState } from 'react';
import {
    View, Text, TextInput, TouchableOpacity, Modal, Image,
    StyleSheet, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { auth, db } from '../config/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { theme, r } from '../theme/theme';

interface FeedbackModalProps {
    visible: boolean;
    onClose: () => void;
}

export function FeedbackModal({ visible, onClose }: FeedbackModalProps) {
    const [text, setText] = useState('');
    const [photos, setPhotos] = useState<string[]>([]);
    const [sending, setSending] = useState(false);
    const [showThankYou, setShowThankYou] = useState(false);
    const [category, setCategory] = useState<'bug' | 'suggestion' | 'other'>('other');

    const user = auth.currentUser;

    const CATEGORIES = [
        { key: 'bug' as const, label: 'Bug / Error', color: '#EF4444' },
        { key: 'suggestion' as const, label: 'Suggestion', color: '#0EA5E9' },
        { key: 'other' as const, label: 'Other', color: '#6366F1' },
    ];

    const pickImage = async () => {
        if (photos.length >= 3) return;
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.6,
            allowsMultipleSelection: true,
            selectionLimit: 3 - photos.length,
        });
        if (!result.canceled) {
            setPhotos(prev => [...prev, ...result.assets.map(a => a.uri)].slice(0, 3));
        }
    };

    const handleSubmit = async () => {
        if (!text.trim() && photos.length === 0) return;
        setSending(true);
        try {
            // Upload photos as base64 (or just URIs for now — can be enhanced with storage later)
            await addDoc(collection(db, 'dolphin_feedback'), {
                userId: user?.uid || 'anonymous',
                userName: user?.displayName || 'Anonymous',
                userEmail: user?.email || '',
                category,
                text: text.trim(),
                photoCount: photos.length,
                // Store photo URIs — for a production app, upload to Firebase Storage
                photos: photos,
                createdAt: serverTimestamp(),
                status: 'new',
                appVersion: '1.0.0',
                platform: Platform.OS,
            });
            setSending(false);
            setText('');
            setPhotos([]);
            setCategory('other');
            setShowThankYou(true);
        } catch (e) {
            console.error('Feedback error:', e);
            setSending(false);
        }
    };

    const handleClose = () => {
        setText('');
        setPhotos([]);
        setCategory('other');
        setShowThankYou(false);
        onClose();
    };

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
            <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                {showThankYou ? (
                    /* ── Thank You Screen ── */
                    <View style={s.card}>
                        <TouchableOpacity onPress={handleClose} style={s.closeBtn}>
                            <Ionicons name="close" size={22} color="#94A3B8" />
                        </TouchableOpacity>

                        <View style={s.thankIcon}>
                            <Text style={{ fontSize: 40 }}>✅</Text>
                        </View>
                        <Text style={s.thankTitle}>Thank you!</Text>
                        <Text style={s.thankBody}>
                            Your feedback means a lot to us!{'\n'}
                            We'll review it carefully and do our best to improve.{'\n\n'}
                            — Junyoung Yang (From Tech Office)
                        </Text>
                        <TouchableOpacity style={s.thankBtn} onPress={handleClose}>
                            <Text style={s.thankBtnText}>Got it!</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    /* ── Feedback Form ── */
                    <View style={s.card}>
                        <TouchableOpacity onPress={handleClose} style={s.closeBtn}>
                            <Ionicons name="close" size={22} color="#94A3B8" />
                        </TouchableOpacity>

                        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                        <Text style={s.title}>Send Feedback</Text>
                        <Text style={s.subtitle}>Help us make Dolphin better!</Text>

                        {/* Category picker */}
                        <View style={s.catRow}>
                            {CATEGORIES.map(c => (
                                <TouchableOpacity
                                    key={c.key}
                                    style={[s.catChip, category === c.key && { backgroundColor: c.color, borderColor: c.color }]}
                                    onPress={() => setCategory(c.key)}
                                >
                                    <Text style={[s.catText, category === c.key && { color: '#fff' }]}>{c.label}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        {/* Text input */}
                        <TextInput
                            style={s.input}
                            multiline
                            placeholder="Tell us what's on your mind..."
                            placeholderTextColor="#94A3B8"
                            value={text}
                            onChangeText={setText}
                            textAlignVertical="top"
                            maxLength={1000}
                        />
                        <Text style={s.charCount}>{text.length}/1000</Text>

                        {/* Photo upload */}
                        <View style={s.photoRow}>
                            {photos.map((uri, idx) => (
                                <View key={idx} style={s.photoWrap}>
                                    <Image source={{ uri }} style={s.photoThumb} />
                                    <TouchableOpacity style={s.photoRemove} onPress={() => setPhotos(prev => prev.filter((_, i) => i !== idx))}>
                                        <Ionicons name="close-circle" size={20} color="#EF4444" />
                                    </TouchableOpacity>
                                </View>
                            ))}
                            {photos.length < 3 && (
                                <TouchableOpacity style={s.addPhotoBtn} onPress={pickImage}>
                                    <Ionicons name="camera-outline" size={22} color="#0EA5E9" />
                                    <Text style={s.addPhotoText}>Photo</Text>
                                </TouchableOpacity>
                            )}
                        </View>

                        {/* Submit */}
                        <TouchableOpacity
                            style={[s.submitBtn, (!text.trim() && photos.length === 0) && { opacity: 0.5 }]}
                            onPress={handleSubmit}
                            disabled={sending || (!text.trim() && photos.length === 0)}
                        >
                            {sending ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <>
                                    <Ionicons name="send" size={16} color="#fff" />
                                    <Text style={s.submitText}>Send Feedback</Text>
                                </>
                            )}
                        </TouchableOpacity>
                        </ScrollView>
                    </View>
                )}
            </KeyboardAvoidingView>
        </Modal>
    );
}

const s = StyleSheet.create({
    overlay: {
        flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center', alignItems: 'center', padding: 20,
    },
    card: {
        backgroundColor: '#fff', borderRadius: r(24), padding: 24,
        width: '100%', maxHeight: '85%',
    },
    closeBtn: {
        position: 'absolute', top: 14, right: 14, zIndex: 10,
        width: 32, height: 32, borderRadius: r(16),
        backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center',
    },
    title: {
        fontSize: 20, fontWeight: '800', color: '#0F172A', marginBottom: 4,
    },
    subtitle: {
        fontSize: 13, color: '#64748B', marginBottom: 16,
    },

    // Categories
    catRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
    catChip: {
        paddingHorizontal: 12, paddingVertical: 7, borderRadius: r(20),
        borderWidth: 1.5, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC',
    },
    catText: { fontSize: 12, fontWeight: '700', color: '#64748B' },

    // Input
    input: {
        borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: r(14),
        padding: 14, fontSize: 15, color: '#0F172A',
        minHeight: 120, maxHeight: 200, backgroundColor: '#FAFBFC',
    },
    charCount: {
        fontSize: 11, color: '#94A3B8', textAlign: 'right', marginTop: 4, marginBottom: 12,
    },

    // Photos
    photoRow: { flexDirection: 'row', gap: 10, marginBottom: 16, flexWrap: 'wrap' },
    photoWrap: { position: 'relative' },
    photoThumb: { width: 64, height: 64, borderRadius: r(10) },
    photoRemove: { position: 'absolute', top: -6, right: -6 },
    addPhotoBtn: {
        width: 64, height: 64, borderRadius: r(10),
        borderWidth: 1.5, borderColor: '#7DD3FC', borderStyle: 'dashed',
        justifyContent: 'center', alignItems: 'center', backgroundColor: '#F0F9FF',
    },
    addPhotoText: { fontSize: 10, fontWeight: '700', color: '#0EA5E9', marginTop: 2 },

    // Submit
    submitBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 8, backgroundColor: '#0EA5E9', paddingVertical: 14,
        borderRadius: r(14),
    },
    submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },

    // Thank you
    thankIcon: {
        width: 72, height: 72, borderRadius: r(36), backgroundColor: '#F0F9FF',
        justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 16, marginTop: 8,
    },
    thankTitle: {
        fontSize: 22, fontWeight: '900', color: '#0F172A', textAlign: 'center', marginBottom: 8,
    },
    thankBody: {
        fontSize: 14, color: '#64748B', textAlign: 'center', lineHeight: 22, marginBottom: 20,
    },
    thankBtn: {
        backgroundColor: '#0EA5E9', paddingVertical: 14, borderRadius: r(14), alignItems: 'center',
    },
    thankBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
