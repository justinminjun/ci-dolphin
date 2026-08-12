import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ActionSheetIOS, Dimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { theme } from '../../theme/theme';
import { analyzeLostItemImage } from '../utils/gemini';
import { auth, db } from '../config/firebase';
import { collection, addDoc, serverTimestamp, doc, updateDoc } from 'firebase/firestore';

const STORAGE_BUCKET = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || 'lost-and-found-20c10.firebasestorage.app';
const MAX_IMAGES = 3;
const screenWidth = Dimensions.get('window').width;

interface ImageItem {
    uri: string;
    base64: string | null;
}

export function AddPostScreen({ route, navigation }: any) {
    const editPost = route?.params?.editPost || null;
    const isEditing = !!editPost;
    const defaultType = route?.params?.defaultType || null; // 'lost' | 'found' | null
    const isTypeLocked = !!defaultType && !isEditing; // lock toggle when coming from quick-action cards

    const [images, setImages] = useState<ImageItem[]>(() => {
        if (editPost?.imageUrls?.length) {
            return editPost.imageUrls.map((uri: string) => ({ uri, base64: null }));
        }
        if (editPost?.imageUrl) {
            return [{ uri: editPost.imageUrl, base64: null }];
        }
        return [];
    });
    const [loading, setLoading] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [postType, setPostType] = useState<'lost' | 'found'>(editPost?.postType || defaultType || 'found');

    const [title, setTitle] = useState(editPost?.title || '');
    const [description, setDescription] = useState(editPost?.description || '');
    const scrollViewRef = useRef<ScrollView>(null);
    const [color, setColor] = useState(editPost?.color || '');
    const [location, setLocation] = useState(editPost?.location || '');
    const [tags, setTags] = useState<string[]>(editPost?.tags || []);
    const [eventDate, setEventDate] = useState<Date>(editPost?.eventDate ? new Date(editPost.eventDate) : new Date());
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [timeUnknown, setTimeUnknown] = useState(editPost?.eventTime === 'unknown' || false);
    const [dropOffLocation, setDropOffLocation] = useState(editPost?.dropOffLocation || '');
    const [customDropOff, setCustomDropOff] = useState('');

    const requestCameraPermission = async (): Promise<boolean> => {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert('Camera Permission', 'Camera access is needed to take photos. Please enable it in Settings.');
            return false;
        }
        return true;
    };

    const takePhoto = async () => {
        const hasPermission = await requestCameraPermission();
        if (!hasPermission) return;

        const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.3,
            base64: true,
        });

        if (!result.canceled && result.assets && result.assets.length > 0) {
            const newImage: ImageItem = {
                uri: result.assets[0].uri,
                base64: result.assets[0].base64 || null,
            };
            setImages(prev => [...prev, newImage]);

            // AI analyze first image only
            if (images.length === 0 && newImage.base64) {
                handleAIAnalysis(newImage.base64);
            }
        }
    };

    const pickFromGallery = async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.3,
            base64: true,
        });

        if (!result.canceled && result.assets && result.assets.length > 0) {
            const newImage: ImageItem = {
                uri: result.assets[0].uri,
                base64: result.assets[0].base64 || null,
            };
            setImages(prev => [...prev, newImage]);

            // AI analyze first image only
            if (images.length === 0 && newImage.base64) {
                handleAIAnalysis(newImage.base64);
            }
        }
    };

    const showImagePickerOptions = () => {
        if (images.length >= MAX_IMAGES) {
            Alert.alert('Maximum Photos', `You can add up to ${MAX_IMAGES} photos.`);
            return;
        }

        if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    options: ['Cancel', 'Take Photo', 'Choose from Gallery'],
                    cancelButtonIndex: 0,
                    title: 'Add Photo',
                    message: `${images.length}/${MAX_IMAGES} photos added`,
                },
                (buttonIndex) => {
                    if (buttonIndex === 1) takePhoto();
                    else if (buttonIndex === 2) pickFromGallery();
                }
            );
        } else {
            Alert.alert(
                'Add Photo',
                `${images.length}/${MAX_IMAGES} photos added`,
                [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Take Photo', onPress: takePhoto },
                    { text: 'Choose from Gallery', onPress: pickFromGallery },
                ]
            );
        }
    };

    const removeImage = (index: number) => {
        setImages(prev => prev.filter((_, i) => i !== index));
    };

    const handleAIAnalysis = async (base64Str: string) => {
        setAnalyzing(true);
        try {
            const details = await analyzeLostItemImage(base64Str);
            if (details) {
                setTitle(details.title || '');
                setDescription(details.description || '');
                setColor(details.color || '');
                if (details.tags && Array.isArray(details.tags)) {
                    setTags(details.tags.slice(0, 5));
                }
            }
        } catch (e: any) {
            Alert.alert('AI Analysis Note', 'AI could not analyze. You can enter details manually.');
        } finally {
            setAnalyzing(false);
        }
    };

    const removeTag = (index: number) => {
        setTags(prev => prev.filter((_, i) => i !== index));
    };

    // Upload image using expo-file-system/legacy native uploader
    const uploadImage = async (localUri: string, userId: string, index: number): Promise<string> => {
        const user = auth.currentUser;
        if (!user) throw new Error('Not authenticated');
        const idToken = await user.getIdToken();

        const fileName = `posts/${Date.now()}-${userId}-${index}.jpg`;
        const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(fileName)}?uploadType=media`;

        const response = await FileSystem.uploadAsync(uploadUrl, localUri, {
            httpMethod: 'POST',
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
            headers: {
                'Content-Type': 'image/jpeg',
                'Authorization': `Bearer ${idToken}`,
            },
        });

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Upload failed (${response.status}): ${response.body}`);
        }

        const result = JSON.parse(response.body);
        const downloadToken = result.downloadTokens;
        return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(fileName)}?alt=media&token=${downloadToken}`;
    };

    const submitPost = async () => {
        if (images.length === 0 || !title) {
            Alert.alert('Missing Info', 'Please provide at least one photo and a title.');
            return;
        }

        setLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) throw new Error('Not logged in');

            // Upload all images to Firebase Storage
            const imageUrls: string[] = [];
            for (let i = 0; i < images.length; i++) {
                const url = await uploadImage(images[i].uri, user.uid, i);
                imageUrls.push(url);
            }

            // Save post to Firestore (imageUrls array + backward-compatible imageUrl)
            if (isEditing) {
                // Keep existing remote photos + new uploads
                const allUrls = [...imageUrls];
                for (const img of images) {
                    if (img.uri.startsWith('https://') && !allUrls.includes(img.uri)) allUrls.push(img.uri);
                }
                await updateDoc(doc(db, 'posts', editPost.id), {
                    title,
                    description,
                    color,
                    location,
                    dropOffLocation: dropOffLocation || '',
                    tags,
                    imageUrl: allUrls[0] || editPost.imageUrl,
                    imageUrls: allUrls.length > 0 ? allUrls : (editPost.imageUrls || []),
                    postType,
                    eventDate: eventDate.toISOString(),
                    eventTime: timeUnknown ? 'unknown' : 'specified',
                });
                Alert.alert('Updated!', 'Your report has been updated.');
                navigation.goBack();
            } else {
                await addDoc(collection(db, 'posts'), {
                    title,
                    description,
                    color,
                    location,
                    dropOffLocation: dropOffLocation || '',
                    tags,
                    imageUrl: imageUrls[0],
                    imageUrls,
                    postType,
                    eventDate: eventDate.toISOString(),
                    eventTime: timeUnknown ? 'unknown' : 'specified',
                    authorId: user.uid,
                    authorName: user.displayName || user.email,
                    authorEmail: user.email,
                    authorPhoto: user.photoURL || null,
                    createdAt: serverTimestamp(),
                    status: 'active'
                });

                // Reset form
                setImages([]);
                setTitle('');
                setDescription('');
                setColor('');
                setLocation('');
                setTags([]);
                setEventDate(new Date());
                setShowDatePicker(false);
                setTimeUnknown(false);
                setPostType('found');
                setLoading(false);

                Alert.alert('Success!', 'Your item has been posted successfully.');
                navigation.navigate('Feed');
            }
        } catch (e: any) {
            console.error('Submit error:', e);
            setLoading(false);
            Alert.alert('Error', e.message || 'Failed to post item.');
        }
    };

    return (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container} keyboardVerticalOffset={90}>
            <ScrollView ref={scrollViewRef} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
                {/* Lost / Found Toggle */}
                {isTypeLocked ? (
                    // Single large locked badge — no switching allowed
                    <View style={styles.toggleRow}>
                        <View style={[
                            styles.toggleBtnLocked,
                            postType === 'found' ? styles.toggleBtnActiveFound : styles.toggleBtnActiveLost
                        ]}>
                            <Text style={[styles.toggleTextLocked, postType === 'found' ? styles.toggleTextFound : styles.toggleTextLost]}>
                                {postType === 'found' ? '✅  Found an Item' : '🚨  Report Lost Item'}
                            </Text>
                        </View>
                    </View>
                ) : (
                    <View style={styles.toggleRow}>
                        <TouchableOpacity
                            style={[styles.toggleBtn, postType === 'found' && styles.toggleBtnActiveFound]}
                            onPress={() => setPostType('found')}
                        >
                            <Text style={[styles.toggleText, postType === 'found' && styles.toggleTextFound]}>I Found This</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.toggleBtn, postType === 'lost' && styles.toggleBtnActiveLost]}
                            onPress={() => setPostType('lost')}
                        >
                            <Text style={[styles.toggleText, postType === 'lost' && styles.toggleTextLost]}>I Lost This</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* Photo Section */}
                <View style={styles.photoSection}>
                    <View style={styles.photoHeader}>
                        <Text style={styles.photoTitle}>Photos</Text>
                        <Text style={styles.photoCount}>{images.length}/{MAX_IMAGES}</Text>
                    </View>

                    <View style={styles.photoGrid}>
                        {/* Existing image thumbnails */}
                        {images.map((img, index) => (
                            <View key={index} style={styles.thumbnailContainer}>
                                <Image source={{ uri: img.uri }} style={styles.thumbnail} />
                                <TouchableOpacity
                                    style={styles.removeBtn}
                                    onPress={() => removeImage(index)}
                                    activeOpacity={0.7}
                                >
                                    <Text style={styles.removeBtnText}>✕</Text>
                                </TouchableOpacity>
                                {index === 0 && (
                                    <View style={styles.mainBadge}>
                                        <Text style={styles.mainBadgeText}>Main</Text>
                                    </View>
                                )}
                            </View>
                        ))}

                        {/* Add photo button */}
                        {images.length < MAX_IMAGES && (
                            <TouchableOpacity
                                style={styles.addPhotoBtn}
                                onPress={showImagePickerOptions}
                                activeOpacity={0.7}
                            >
                                <Text style={styles.addPhotoBtnIcon}>+</Text>
                                <Text style={styles.addPhotoBtnText}>
                                    {images.length === 0 ? 'Add Photo' : 'Add More'}
                                </Text>
                                <Text style={styles.addPhotoBtnHint}>Camera or Gallery</Text>
                            </TouchableOpacity>
                        )}
                    </View>

                    {images.length === 0 && (
                        <Text style={styles.photoHint}>Tap to take a photo or choose from gallery. AI will auto-analyze the first image.</Text>
                    )}
                </View>

                {analyzing && (
                    <View style={styles.analyzing}>
                        <ActivityIndicator size="small" color={theme.colors.primary} />
                        <Text style={styles.analyzingText}>AI is analyzing the image...</Text>
                    </View>
                )}

                {/* Tags */}
                {tags.length > 0 && (
                    <View style={styles.tagsContainer}>
                        <Text style={styles.tagsLabel}>AI Tags</Text>
                        <View style={styles.tagsRow}>
                            {tags.map((tag, i) => (
                                <TouchableOpacity key={i} style={styles.tag} onPress={() => removeTag(i)}>
                                    <Text style={styles.tagText}>#{tag}</Text>
                                    <Text style={styles.tagRemove}>×</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>
                )}

                {/* Form */}
                <View style={styles.form}>
                    <Text style={styles.label}>Item Title</Text>
                    <TextInput style={styles.input} placeholder="e.g. AirPods Pro" value={title} onChangeText={setTitle} placeholderTextColor={theme.colors.textMuted} />

                    <Text style={styles.label}>Description</Text>
                    <TextInput style={[styles.input, styles.textArea]} multiline placeholder="Describe the item..." value={description} onChangeText={setDescription} placeholderTextColor={theme.colors.textMuted}
                        onFocus={() => { setTimeout(() => { scrollViewRef.current?.scrollTo({ y: 300, animated: true }); }, 300); }}
                    />

                    <Text style={styles.label}>Location / {postType === 'found' ? 'Found' : 'Lost'} at</Text>
                    <TextInput style={styles.input} placeholder="e.g. 2nd Floor Library" value={location} onChangeText={setLocation} placeholderTextColor={theme.colors.textMuted} />

                    {/* Drop-off Location */}
                    {postType === 'found' && (
                        <>
                            <Text style={styles.label}>Where did you leave it?</Text>
                            <View style={styles.dropOffRow}>
                                <TouchableOpacity
                                    style={[styles.dropOffBtn, dropOffLocation === 'MS Office' && styles.dropOffBtnActive]}
                                    onPress={() => { setDropOffLocation('MS Office'); setCustomDropOff(''); }}
                                >
                                    <Text style={[styles.dropOffBtnText, dropOffLocation === 'MS Office' && styles.dropOffBtnTextActive]}>MS Office</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.dropOffBtn, dropOffLocation === 'US Office' && styles.dropOffBtnActive]}
                                    onPress={() => { setDropOffLocation('US Office'); setCustomDropOff(''); }}
                                >
                                    <Text style={[styles.dropOffBtnText, dropOffLocation === 'US Office' && styles.dropOffBtnTextActive]}>US Office</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.dropOffBtn, dropOffLocation !== 'MS Office' && dropOffLocation !== 'US Office' && dropOffLocation !== '' && styles.dropOffBtnActive]}
                                    onPress={() => setDropOffLocation(customDropOff || 'Other')}
                                >
                                    <Text style={[styles.dropOffBtnText, dropOffLocation !== 'MS Office' && dropOffLocation !== 'US Office' && dropOffLocation !== '' && styles.dropOffBtnTextActive]}>Other</Text>
                                </TouchableOpacity>
                            </View>
                            {dropOffLocation !== '' && dropOffLocation !== 'MS Office' && dropOffLocation !== 'US Office' && (
                                <TextInput
                                    style={styles.input}
                                    placeholder="Where exactly? e.g. Cafeteria counter"
                                    value={customDropOff}
                                    onChangeText={(v) => { setCustomDropOff(v); setDropOffLocation(v); }}
                                    placeholderTextColor={theme.colors.textMuted}
                                />
                            )}
                        </>
                    )}

                    <Text style={styles.label}>{postType === 'found' ? 'When did you find it?' : 'When did you lose it?'}</Text>
                    <TouchableOpacity style={styles.datePickerBtn} onPress={() => setShowDatePicker(!showDatePicker)} activeOpacity={0.7}>
                        <Text style={styles.datePickerBtnText}>
                            {eventDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                            {'  '}
                            {timeUnknown ? '(Time unknown)' : eventDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                        </Text>
                        <Text style={styles.datePickerArrow}>{showDatePicker ? '▲' : '▼'}</Text>
                    </TouchableOpacity>
                    {showDatePicker && (
                        <View style={styles.datePickerContainer}>
                            {/* Date chips */}
                            <Text style={styles.pickerSectionLabel}>Date</Text>
                            <View style={styles.datePickerRow}>
                                {[...Array(14)].map((_, i) => {
                                    const d = new Date();
                                    d.setDate(d.getDate() - i);
                                    const isSelected = eventDate.toDateString() === d.toDateString();
                                    const isToday = i === 0;
                                    return (
                                        <TouchableOpacity
                                            key={i}
                                            style={[styles.dateChip, isSelected && styles.dateChipSelected]}
                                            onPress={() => {
                                                const updated = new Date(eventDate);
                                                updated.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                                                setEventDate(updated);
                                            }}
                                        >
                                            <Text style={[styles.dateChipDay, isSelected && styles.dateChipTextSelected]}>
                                                {isToday ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short' })}
                                            </Text>
                                            <Text style={[styles.dateChipDate, isSelected && styles.dateChipTextSelected]}>
                                                {d.getMonth() + 1}/{d.getDate()}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>

                            {/* Time selector */}
                            <Text style={[styles.pickerSectionLabel, { marginTop: 12 }]}>Time</Text>
                            <TouchableOpacity
                                style={[styles.unknownBtn, timeUnknown && styles.unknownBtnActive]}
                                onPress={() => setTimeUnknown(!timeUnknown)}
                                activeOpacity={0.7}
                            >
                                <Text style={[styles.unknownBtnText, timeUnknown && styles.unknownBtnTextActive]}>
                                    {timeUnknown ? 'Time is unknown' : 'I don\'t know the time'}
                                </Text>
                            </TouchableOpacity>
                            {!timeUnknown && (
                            <View style={styles.timeRow}>
                                {/* Hour */}
                                <View style={styles.timeColumn}>
                                    <TouchableOpacity style={styles.timeArrow} onPress={() => {
                                        const d = new Date(eventDate);
                                        d.setHours(d.getHours() + 1);
                                        setEventDate(d);
                                    }}>
                                        <Text style={styles.timeArrowText}>▲</Text>
                                    </TouchableOpacity>
                                    <View style={styles.timeValueBox}>
                                        <Text style={styles.timeValueText}>
                                            {eventDate.getHours() % 12 === 0 ? 12 : eventDate.getHours() % 12}
                                        </Text>
                                    </View>
                                    <TouchableOpacity style={styles.timeArrow} onPress={() => {
                                        const d = new Date(eventDate);
                                        d.setHours(d.getHours() - 1);
                                        setEventDate(d);
                                    }}>
                                        <Text style={styles.timeArrowText}>▼</Text>
                                    </TouchableOpacity>
                                </View>

                                <Text style={styles.timeColon}>:</Text>

                                {/* Minute */}
                                <View style={styles.timeColumn}>
                                    <TouchableOpacity style={styles.timeArrow} onPress={() => {
                                        const d = new Date(eventDate);
                                        d.setMinutes(d.getMinutes() + 5);
                                        setEventDate(d);
                                    }}>
                                        <Text style={styles.timeArrowText}>▲</Text>
                                    </TouchableOpacity>
                                    <View style={styles.timeValueBox}>
                                        <Text style={styles.timeValueText}>
                                            {String(eventDate.getMinutes()).padStart(2, '0')}
                                        </Text>
                                    </View>
                                    <TouchableOpacity style={styles.timeArrow} onPress={() => {
                                        const d = new Date(eventDate);
                                        d.setMinutes(d.getMinutes() - 5);
                                        setEventDate(d);
                                    }}>
                                        <Text style={styles.timeArrowText}>▼</Text>
                                    </TouchableOpacity>
                                </View>

                                {/* AM/PM */}
                                <TouchableOpacity style={styles.ampmBtn} onPress={() => {
                                    const d = new Date(eventDate);
                                    d.setHours(d.getHours() >= 12 ? d.getHours() - 12 : d.getHours() + 12);
                                    setEventDate(d);
                                }}>
                                    <Text style={styles.ampmText}>{eventDate.getHours() >= 12 ? 'PM' : 'AM'}</Text>
                                </TouchableOpacity>
                            </View>
                            )}

                            <TouchableOpacity style={styles.doneBtn} onPress={() => setShowDatePicker(false)}>
                                <Text style={styles.doneBtnText}>Done</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    <TouchableOpacity style={[styles.submitBtn, (loading || analyzing) && styles.submitBtnDisabled]} onPress={submitPost} disabled={loading || analyzing} activeOpacity={0.8}>
                        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>{isEditing ? 'Save Changes' : 'Post Item'}</Text>}
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const thumbSize = (screenWidth - 32 - 16) / 3; // 3 columns with gaps

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    scroll: { padding: theme.spacing.md, paddingBottom: 120 },
    toggleRow: { flexDirection: 'row', gap: theme.spacing.sm, marginBottom: 20 },
    toggleBtn: { flex: 1, paddingVertical: 12, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceAlt, alignItems: 'center', borderWidth: 1.5, borderColor: 'transparent' },
    toggleBtnActiveFound: { backgroundColor: '#ECFDF5', borderColor: '#10B981' },
    toggleBtnActiveLost: { backgroundColor: '#FEF2F2', borderColor: '#EF4444' },
    toggleText: { ...theme.typography.bodySecondary, color: theme.colors.textSecondary, fontWeight: '500' },
    toggleTextFound: { fontWeight: '700', color: '#10B981' },
    toggleTextLost: { fontWeight: '700', color: '#EF4444' },
    toggleBtnLocked: { flex: 1, paddingVertical: 14, borderRadius: theme.radius.lg, alignItems: 'center', borderWidth: 2 },
    toggleTextLocked: { fontSize: 16, fontWeight: '800' },

    // Photo section
    photoSection: { marginBottom: 20 },
    photoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    photoTitle: { ...theme.typography.h3, color: '#10B981' },
    photoCount: { ...theme.typography.caption, color: '#10B981', fontWeight: '700', backgroundColor: '#ECFDF5', paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.full },
    photoGrid: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
    thumbnailContainer: { width: thumbSize, height: thumbSize, borderRadius: theme.radius.lg, overflow: 'hidden', position: 'relative' },
    thumbnail: { width: '100%', height: '100%', resizeMode: 'cover' },
    removeBtn: { position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
    removeBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    mainBadge: { position: 'absolute', bottom: 6, left: 6, backgroundColor: '#10B981', paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.full },
    mainBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
    addPhotoBtn: { width: thumbSize, height: thumbSize, borderRadius: theme.radius.lg, backgroundColor: '#ECFDF5', borderWidth: 2, borderColor: '#A7F3D0', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', gap: 2 },
    addPhotoBtnIcon: { fontSize: 32, color: '#10B981', fontWeight: '300' },
    addPhotoBtnText: { ...theme.typography.caption, color: '#10B981', fontWeight: '600' },
    addPhotoBtnHint: { fontSize: 10, color: '#6EE7B7' },
    photoHint: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: 8, textAlign: 'center' },

    analyzing: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, padding: theme.spacing.md, backgroundColor: '#ECFDF5', borderRadius: theme.radius.lg, borderWidth: 1, borderColor: '#A7F3D0' },
    analyzingText: { marginLeft: theme.spacing.sm, color: '#10B981', fontWeight: '600' },
    tagsContainer: { marginBottom: 16 },
    tagsLabel: { ...theme.typography.caption, color: '#10B981', fontWeight: '700', marginBottom: 6 },
    tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    tag: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ECFDF5', paddingHorizontal: 10, paddingVertical: 5, borderRadius: theme.radius.full, gap: 4, borderWidth: 1, borderColor: '#A7F3D0' },
    tagText: { fontSize: 12, color: '#059669', fontWeight: '600' },
    tagRemove: { fontSize: 14, color: '#6EE7B7', fontWeight: '600' },
    form: { gap: 8 },
    label: { ...theme.typography.caption, fontWeight: '700', color: '#10B981', marginTop: 12 },
    input: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg, padding: 14, fontSize: 15, color: theme.colors.textPrimary },
    textArea: { height: 90, textAlignVertical: 'top' },
    submitBtn: { backgroundColor: '#10B981', padding: 16, borderRadius: theme.radius.lg, alignItems: 'center', marginTop: 24, ...theme.shadows.md },
    submitBtnDisabled: { opacity: 0.5 },
    submitBtnText: { color: '#fff', ...theme.typography.button },

    // Date picker
    datePickerBtn: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg, padding: 14 },
    datePickerBtnText: { fontSize: 15, color: theme.colors.textPrimary, fontWeight: '500' },
    datePickerArrow: { fontSize: 12, color: theme.colors.textMuted },
    datePickerContainer: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.border, marginTop: 4 },
    datePickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
    dateChip: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt, minWidth: 44 },
    dateChipSelected: { backgroundColor: '#10B981' },
    dateChipDay: { ...theme.typography.caption, color: theme.colors.textSecondary, fontWeight: '600', marginBottom: 2 },
    dateChipDate: { ...theme.typography.caption, color: theme.colors.textMuted, fontWeight: '500' },
    dateChipTextSelected: { color: '#fff' },
    pickerSectionLabel: { ...theme.typography.caption, color: '#10B981', fontWeight: '700', marginBottom: 6 },
    timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    timeColumn: { alignItems: 'center' },
    timeArrow: { padding: 6 },
    timeArrowText: { fontSize: 14, color: theme.colors.textMuted },
    timeValueBox: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, paddingHorizontal: 16, paddingVertical: 10, minWidth: 52, alignItems: 'center' },
    timeValueText: { fontSize: 20, fontWeight: '700', color: theme.colors.textPrimary },
    timeColon: { fontSize: 22, fontWeight: '700', color: theme.colors.textPrimary },
    ampmBtn: { backgroundColor: '#10B981', paddingHorizontal: 14, paddingVertical: 10, borderRadius: theme.radius.md, marginLeft: 4 },
    ampmText: { color: '#fff', fontSize: 14, fontWeight: '700' },
    doneBtn: { backgroundColor: '#10B981', paddingVertical: 10, borderRadius: theme.radius.md, alignItems: 'center', marginTop: 12 },
    doneBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
    unknownBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt, alignItems: 'center', marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border },
    unknownBtnActive: { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' },
    unknownBtnText: { ...theme.typography.caption, fontWeight: '600', color: theme.colors.textSecondary },
    unknownBtnTextActive: { color: '#D97706' },
    // Drop-off
    dropOffRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
    dropOffBtn: {
        flex: 1, paddingVertical: 10, alignItems: 'center',
        borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt,
        borderWidth: 1, borderColor: theme.colors.border,
    },
    dropOffBtnActive: { backgroundColor: '#ECFDF5', borderColor: '#10B981' },
    dropOffBtnText: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
    dropOffBtnTextActive: { color: '#10B981', fontWeight: '700' },
});
