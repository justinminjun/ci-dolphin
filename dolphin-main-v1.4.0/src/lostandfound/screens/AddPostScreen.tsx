import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ActionSheetIOS, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { theme } from '../../theme/theme';
import { analyzeLostItemImage } from '../utils/gemini';
import { LOSTFOUND_ZONES, LOSTFOUND_CATEGORIES } from '../utils/constants';
import { fetchMatchesFor } from '../utils/matching';
import { useLFLang } from '../i18n';
import { useIsWebDesktop } from '../../utils/useResponsive';
import { auth, db } from '../config/firebase';
import { collection, addDoc, serverTimestamp, doc, updateDoc } from 'firebase/firestore';

const STORAGE_BUCKET = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || 'lost-and-found-20c10.firebasestorage.app';
const MAX_IMAGES = 3;
const FORM_MAX_WIDTH = 720;
const PHOTO_GAP = 10;

interface ImageItem {
    uri: string;
    base64: string | null;
    mimeType?: string;
}

export function AddPostScreen({ route, navigation }: any) {
    const { t, zoneLabel, categoryLabel, dropOffLabel, locale } = useLFLang();
    const isWebDesktop = useIsWebDesktop();
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
    // Measured, not read from Dimensions at load: the window can be 0-wide or
    // resized later on web, which would collapse the photo tiles.
    const [photoRowW, setPhotoRowW] = useState(() => Math.min(Dimensions.get('window').width, FORM_MAX_WIDTH) - 32);
    const thumbSize = Math.max(80, Math.floor((photoRowW - PHOTO_GAP * 2) / 3));
    const [loading, setLoading] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [postType, setPostType] = useState<'lost' | 'found'>(editPost?.postType || defaultType || 'found');

    const [title, setTitle] = useState(editPost?.title || '');
    const [description, setDescription] = useState(editPost?.description || '');
    const scrollViewRef = useRef<ScrollView>(null);
    const [color, setColor] = useState(editPost?.color || '');
    const [category, setCategory] = useState<string>(editPost?.category || '');

    // Location = Zone (fixed campus-area list, keeps posts filterable on a large
    // campus) + optional free-text Detail for specifics ("2nd floor, near room 204").
    // Legacy posts only had a single free-text `location` string — fall back to
    // zone "Other" pre-filled with that text so nothing is lost when editing them.
    // Custom areas are stored as zone "Other" + locationZoneCustom so the
    // "Other" filter still finds them.
    const knownZone = (LOSTFOUND_ZONES as readonly string[]).includes(editPost?.locationZone);
    const [locationZone, setLocationZone] = useState<string>(
        editPost?.locationZone ? (knownZone ? editPost.locationZone : 'Other') : (editPost?.location ? 'Other' : '')
    );
    const [customZone, setCustomZone] = useState<string>(
        editPost?.locationZoneCustom
        || (editPost?.locationZone ? (knownZone ? '' : editPost.locationZone) : (editPost?.location || ''))
    );
    const [locationDetail, setLocationDetail] = useState(editPost?.locationDetail || '');

    const [tags, setTags] = useState<string[]>(editPost?.tags || []);
    const [eventDate, setEventDate] = useState<Date>(editPost?.eventDate ? new Date(editPost.eventDate) : new Date());
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [timeUnknown, setTimeUnknown] = useState(editPost?.eventTime === 'unknown' || false);

    // Found items: the finder may have dropped it off somewhere, or may still be
    // personally holding onto it — these need different UI and different info.
    const [foundStatus, setFoundStatus] = useState<'dropped_off' | 'holding' | ''>(
        editPost?.foundStatus || (editPost?.dropOffLocation ? 'dropped_off' : '')
    );
    const [dropOffLocation, setDropOffLocation] = useState(editPost?.dropOffLocation || '');
    const [customDropOff, setCustomDropOff] = useState(
        editPost?.dropOffLocation && !['MS Office', 'US Office'].includes(editPost.dropOffLocation) ? editPost.dropOffLocation : ''
    );

    const requestCameraPermission = async (): Promise<boolean> => {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert(t('cameraPermTitle'), t('cameraPermBody'));
            return false;
        }
        return true;
    };

    const addPickedImage = (result: ImagePicker.ImagePickerResult) => {
        if (result.canceled || !result.assets || result.assets.length === 0) return;
        const asset = result.assets[0];
        const newImage: ImageItem = { uri: asset.uri, base64: asset.base64 || null, mimeType: asset.mimeType };
        const isFirst = images.length === 0;
        setImages(prev => [...prev, newImage]);
        // AI analyze first image only
        if (isFirst && newImage.base64) {
            handleAIAnalysis(newImage.base64, newImage.mimeType);
        }
    };

    const takePhoto = async () => {
        const hasPermission = await requestCameraPermission();
        if (!hasPermission) return;
        addPickedImage(await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.3,
            base64: true,
        }));
    };

    const pickFromGallery = async () => {
        addPickedImage(await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: Platform.OS !== 'web',
            aspect: [4, 3],
            quality: 0.3,
            base64: true,
        }));
    };

    const showImagePickerOptions = () => {
        if (images.length >= MAX_IMAGES) {
            Alert.alert(t('maxPhotosTitle'), t('maxPhotosBody', { n: MAX_IMAGES }));
            return;
        }

        // Browsers open their own file dialog (which already offers the camera on
        // phones), so skip the native-style chooser that has no good web equivalent.
        if (Platform.OS === 'web') {
            pickFromGallery();
            return;
        }

        if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    options: [t('cancel'), t('takePhoto'), t('chooseGallery')],
                    cancelButtonIndex: 0,
                    title: t('addPhotoTitle'),
                    message: t('photosAdded', { n: images.length, max: MAX_IMAGES }),
                },
                (buttonIndex) => {
                    if (buttonIndex === 1) takePhoto();
                    else if (buttonIndex === 2) pickFromGallery();
                }
            );
        } else {
            Alert.alert(
                t('addPhotoTitle'),
                t('photosAdded', { n: images.length, max: MAX_IMAGES }),
                [
                    { text: t('cancel'), style: 'cancel' },
                    { text: t('takePhoto'), onPress: takePhoto },
                    { text: t('chooseGallery'), onPress: pickFromGallery },
                ]
            );
        }
    };

    const removeImage = (index: number) => {
        setImages(prev => prev.filter((_, i) => i !== index));
    };

    const handleAIAnalysis = async (base64Str: string, mimeType?: string) => {
        setAnalyzing(true);
        try {
            const details = await analyzeLostItemImage(base64Str, mimeType || 'image/jpeg');
            if (details) {
                setTitle(details.title || '');
                setDescription(details.description || '');
                setColor(details.color || '');
                if ((LOSTFOUND_CATEGORIES as readonly string[]).includes(details.category)) {
                    setCategory(details.category);
                }
                if (details.tags && Array.isArray(details.tags)) {
                    setTags(details.tags.slice(0, 5));
                }
            }
        } catch (e: any) {
            Alert.alert(t('aiNoteTitle'), t('aiNoteBody'));
        } finally {
            setAnalyzing(false);
        }
    };

    const removeTag = (index: number) => {
        setTags(prev => prev.filter((_, i) => i !== index));
    };

    // Upload via the Storage REST endpoint. Native uses the expo-file-system
    // uploader; browsers have no file-system API, so post the blob with fetch.
    const uploadImage = async (localUri: string, userId: string, index: number): Promise<string> => {
        const user = auth.currentUser;
        if (!user) throw new Error('Not authenticated');
        const idToken = await user.getIdToken();

        const fileName = `posts/${Date.now()}-${userId}-${index}.jpg`;
        const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(fileName)}?uploadType=media`;

        let status: number;
        let body: string;
        if (Platform.OS === 'web') {
            const blob = await (await fetch(localUri)).blob();
            const res = await fetch(uploadUrl, {
                method: 'POST',
                headers: { 'Content-Type': blob.type || 'image/jpeg', 'Authorization': `Bearer ${idToken}` },
                body: blob,
            });
            status = res.status;
            body = await res.text();
        } else {
            const response = await FileSystem.uploadAsync(uploadUrl, localUri, {
                httpMethod: 'POST',
                uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
                headers: {
                    'Content-Type': 'image/jpeg',
                    'Authorization': `Bearer ${idToken}`,
                },
            });
            status = response.status;
            body = response.body;
        }

        if (status < 200 || status >= 300) {
            throw new Error(`Upload failed (${status}): ${body}`);
        }

        const result = JSON.parse(body);
        const downloadToken = result.downloadTokens;
        return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(fileName)}?alt=media&token=${downloadToken}`;
    };

    // Notify authors of similar opposite-type posts (in-app bell only). Never
    // blocks or fails the post itself.
    const notifyMatches = async (newPost: any): Promise<number> => {
        try {
            const matches = await fetchMatchesFor(newPost, 6);
            const notifyTitle = newPost.postType === 'found'
                ? '🔎 Someone may have found your item'
                : '🔎 Someone may be looking for an item you found';
            await Promise.all(matches.slice(0, 3).filter(m => m.post.authorId).map(m =>
                addDoc(collection(db, 'dolphin_notifications'), {
                    recipientId: m.post.authorId,
                    type: 'lf_match',
                    title: notifyTitle,
                    body: `"${newPost.title}" looks similar to your post "${m.post.title}". Tap to take a look.`,
                    postId: newPost.id,
                    read: false,
                    createdAt: serverTimestamp(),
                })
            ));
            return matches.length;
        } catch {
            return 0;
        }
    };

    const submitPost = async () => {
        if (images.length === 0 || !title.trim()) {
            Alert.alert(t('missingInfo'), t('needPhotoTitle'));
            return;
        }
        const finalZone = locationZone;
        const customName = locationZone === 'Other' ? customZone.trim() : '';
        if (!finalZone) {
            Alert.alert(t('missingInfo'), t('needZone'));
            return;
        }
        if (postType === 'found' && !foundStatus) {
            Alert.alert(t('missingInfo'), t('needFoundStatus'));
            return;
        }
        if (postType === 'found' && foundStatus === 'dropped_off' && !dropOffLocation.trim()) {
            Alert.alert(t('missingInfo'), t('needDropOff'));
            return;
        }
        const location = (customName || finalZone) + (locationDetail.trim() ? ` — ${locationDetail.trim()}` : '');

        setLoading(true);
        try {
            const user = auth.currentUser;
            if (!user) throw new Error('Not logged in');

            // Upload only newly added local photos; photos already in Storage
            // (when editing) are kept as-is, in their original order.
            const imageUrls: string[] = [];
            for (let i = 0; i < images.length; i++) {
                const uri = images[i].uri;
                imageUrls.push(uri.startsWith('https://') ? uri : await uploadImage(uri, user.uid, i));
            }

            const fields = {
                title: title.trim(),
                description: description.trim(),
                color: color.trim(),
                category: category || 'Other',
                location,
                locationZone: finalZone,
                locationZoneCustom: customName,
                locationDetail: locationDetail.trim(),
                foundStatus: postType === 'found' ? foundStatus : '',
                dropOffLocation: (postType === 'found' && foundStatus === 'dropped_off') ? dropOffLocation.trim() : '',
                tags,
                imageUrl: imageUrls[0],
                imageUrls,
                postType,
                eventDate: eventDate.toISOString(),
                eventTime: timeUnknown ? 'unknown' : 'specified',
            };

            if (isEditing) {
                await updateDoc(doc(db, 'posts', editPost.id), fields);
                setLoading(false);
                Alert.alert(t('updatedTitle'), t('updatedBody'));
                navigation.goBack();
            } else {
                const ref = await addDoc(collection(db, 'posts'), {
                    ...fields,
                    authorId: user.uid,
                    authorName: user.displayName || user.email,
                    authorEmail: user.email,
                    authorPhoto: user.photoURL || null,
                    createdAt: serverTimestamp(),
                    status: 'active'
                });
                const newPost = {
                    id: ref.id, ...fields,
                    authorId: user.uid, authorName: user.displayName || user.email,
                    authorEmail: user.email, authorPhoto: user.photoURL || null, status: 'active',
                };
                const matchCount = await notifyMatches(newPost);
                setLoading(false);

                Alert.alert(t('successTitle'), matchCount > 0 ? `${t('successBody')}\n\n${t('successMatches', { n: matchCount })}` : t('successBody'));
                // Land on the new post so the author immediately sees any possible matches.
                navigation.replace('LFDetail', { post: newPost });
            }
        } catch (e: any) {
            console.error('Submit error:', e);
            setLoading(false);
            Alert.alert(t('errorTitle'), e.message || t('postFailed'));
        }
    };

    const isCustomDropOff = dropOffLocation !== '' && dropOffLocation !== 'MS Office' && dropOffLocation !== 'US Office';

    return (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container} keyboardVerticalOffset={90}>
            {/* Header */}
            <View style={[styles.header, isWebDesktop && { paddingTop: 20 }]}>
                <View style={[styles.headerInner, styles.centered]}>
                    <TouchableOpacity
                        onPress={() => navigation.goBack()}
                        style={styles.closeBtn}
                        accessibilityRole="button"
                        accessibilityLabel={t('close')}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Ionicons name="close" size={24} color={theme.colors.textPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle} accessibilityRole="header">{isEditing ? t('editReport') : t('newReport')}</Text>
                    <View style={{ width: 32 }} />
                </View>
            </View>

            <ScrollView ref={scrollViewRef} contentContainerStyle={[styles.scroll, styles.centered]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
                {/* Lost / Found Toggle */}
                {isTypeLocked ? (
                    // Single large locked badge — no switching allowed
                    <View style={styles.toggleRow}>
                        <View style={[
                            styles.toggleBtnLocked,
                            postType === 'found' ? styles.toggleBtnActiveFound : styles.toggleBtnActiveLost
                        ]}>
                            <Text style={[styles.toggleTextLocked, postType === 'found' ? styles.toggleTextFound : styles.toggleTextLost]}>
                                {postType === 'found' ? t('lockedFound') : t('lockedLost')}
                            </Text>
                        </View>
                    </View>
                ) : (
                    <View style={styles.toggleRow} accessibilityRole="radiogroup">
                        <TouchableOpacity
                            style={[styles.toggleBtn, postType === 'found' && styles.toggleBtnActiveFound]}
                            onPress={() => setPostType('found')}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: postType === 'found' }}
                            accessibilityLabel={t('foundThis')}
                        >
                            <Text style={[styles.toggleText, postType === 'found' && styles.toggleTextFound]}>{t('foundThis')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.toggleBtn, postType === 'lost' && styles.toggleBtnActiveLost]}
                            onPress={() => setPostType('lost')}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: postType === 'lost' }}
                            accessibilityLabel={t('lostThis')}
                        >
                            <Text style={[styles.toggleText, postType === 'lost' && styles.toggleTextLost]}>{t('lostThis')}</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* Photo Section */}
                <View style={styles.photoSection}>
                    <View style={styles.photoHeader}>
                        <Text style={styles.photoTitle}>{t('photos')}</Text>
                        <Text style={styles.photoCount}>{images.length}/{MAX_IMAGES}</Text>
                    </View>

                    <View style={styles.photoGrid} onLayout={e => { const w = e.nativeEvent.layout.width; if (w > 0) setPhotoRowW(w); }}>
                        {images.map((img, index) => (
                            <View key={index} style={[styles.thumbnailContainer, { width: thumbSize, height: thumbSize }]}>
                                <Image source={{ uri: img.uri }} style={styles.thumbnail} accessibilityIgnoresInvertColors />
                                <TouchableOpacity
                                    style={styles.removeBtn}
                                    onPress={() => removeImage(index)}
                                    activeOpacity={0.7}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('removePhoto', { n: index + 1 })}
                                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                                >
                                    <Text style={styles.removeBtnText}>✕</Text>
                                </TouchableOpacity>
                                {index === 0 && (
                                    <View style={styles.mainBadge}>
                                        <Text style={styles.mainBadgeText}>{t('mainPhoto')}</Text>
                                    </View>
                                )}
                            </View>
                        ))}

                        {images.length < MAX_IMAGES && (
                            <TouchableOpacity
                                style={[styles.addPhotoBtn, { width: thumbSize, height: thumbSize }]}
                                onPress={showImagePickerOptions}
                                activeOpacity={0.7}
                                accessibilityRole="button"
                                accessibilityLabel={`${t('addPhoto')}, ${images.length}/${MAX_IMAGES}`}
                            >
                                <Text style={styles.addPhotoBtnIcon}>+</Text>
                                <Text style={styles.addPhotoBtnText}>
                                    {images.length === 0 ? t('addPhoto') : t('addMore')}
                                </Text>
                                <Text style={styles.addPhotoBtnHint}>{Platform.OS === 'web' ? t('uploadFromDevice') : t('cameraOrGallery')}</Text>
                            </TouchableOpacity>
                        )}
                    </View>

                    {images.length === 0 && (
                        <Text style={styles.photoHint}>{Platform.OS === 'web' ? t('photoHintWeb') : t('photoHint')}</Text>
                    )}
                </View>

                {analyzing && (
                    <View style={styles.analyzing} accessibilityLiveRegion="polite">
                        <ActivityIndicator size="small" color={theme.colors.primary} />
                        <Text style={styles.analyzingText}>{t('analyzing')}</Text>
                    </View>
                )}

                {/* Tags */}
                {tags.length > 0 && (
                    <View style={styles.tagsContainer}>
                        <Text style={styles.tagsLabel}>{t('aiTags')}</Text>
                        <View style={styles.tagsRow}>
                            {tags.map((tag, i) => (
                                <TouchableOpacity
                                    key={i}
                                    style={styles.tag}
                                    onPress={() => removeTag(i)}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('removeTag', { tag })}
                                >
                                    <Text style={styles.tagText}>#{tag}</Text>
                                    <Text style={styles.tagRemove}>×</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>
                )}

                {/* Form */}
                <View style={styles.form}>
                    <Text style={styles.label} nativeID="lf-title-label">{t('itemTitle')}</Text>
                    <TextInput
                        style={styles.input}
                        placeholder={t('titlePlaceholder')}
                        value={title}
                        onChangeText={setTitle}
                        placeholderTextColor={theme.colors.textMuted}
                        accessibilityLabel={t('itemTitle')}
                    />

                    <Text style={styles.label}>{t('category')}</Text>
                    <View style={styles.zoneGrid} accessibilityRole="radiogroup">
                        {LOSTFOUND_CATEGORIES.map(cat => (
                            <TouchableOpacity
                                key={cat}
                                style={[styles.zoneChip, category === cat && styles.zoneChipActive]}
                                onPress={() => setCategory(category === cat ? '' : cat)}
                                accessibilityRole="radio"
                                accessibilityState={{ selected: category === cat }}
                                accessibilityLabel={categoryLabel(cat)}
                            >
                                <Text style={[styles.zoneChipText, category === cat && styles.zoneChipTextActive]}>{categoryLabel(cat)}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    <Text style={styles.label}>{t('description')}</Text>
                    <TextInput
                        style={[styles.input, styles.textArea]}
                        multiline
                        placeholder={t('descPlaceholder')}
                        value={description}
                        onChangeText={setDescription}
                        placeholderTextColor={theme.colors.textMuted}
                        accessibilityLabel={t('description')}
                        onFocus={() => { if (Platform.OS !== 'web') setTimeout(() => { scrollViewRef.current?.scrollTo({ y: 300, animated: true }); }, 300); }}
                    />

                    <Text style={styles.label}>{t('color')}</Text>
                    <TextInput
                        style={styles.input}
                        placeholder={t('colorPlaceholder')}
                        value={color}
                        onChangeText={setColor}
                        placeholderTextColor={theme.colors.textMuted}
                        accessibilityLabel={t('color')}
                    />

                    <Text style={styles.label}>{postType === 'found' ? t('whereFound') : t('whereLost')}</Text>
                    <View style={styles.zoneGrid} accessibilityRole="radiogroup">
                        {LOSTFOUND_ZONES.map(zone => (
                            <TouchableOpacity
                                key={zone}
                                style={[styles.zoneChip, locationZone === zone && styles.zoneChipActive]}
                                onPress={() => setLocationZone(zone)}
                                accessibilityRole="radio"
                                accessibilityState={{ selected: locationZone === zone }}
                                accessibilityLabel={zoneLabel(zone)}
                            >
                                <Text style={[styles.zoneChipText, locationZone === zone && styles.zoneChipTextActive]}>{zoneLabel(zone)}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                    {locationZone === 'Other' && (
                        <TextInput
                            style={styles.input}
                            placeholder={t('customZonePlaceholder')}
                            value={customZone}
                            onChangeText={setCustomZone}
                            placeholderTextColor={theme.colors.textMuted}
                            accessibilityLabel={t('customZonePlaceholder')}
                        />
                    )}
                    <TextInput
                        style={styles.input}
                        placeholder={t('detailPlaceholder')}
                        value={locationDetail}
                        onChangeText={setLocationDetail}
                        placeholderTextColor={theme.colors.textMuted}
                        accessibilityLabel={t('detailPlaceholder')}
                    />

                    {/* Found item status: dropped off vs. still with the finder */}
                    {postType === 'found' && (
                        <>
                            <Text style={styles.label}>{t('whereNow')}</Text>
                            <View style={styles.dropOffRow} accessibilityRole="radiogroup">
                                <TouchableOpacity
                                    style={[styles.dropOffBtn, foundStatus === 'dropped_off' && styles.dropOffBtnActive]}
                                    onPress={() => setFoundStatus('dropped_off')}
                                    accessibilityRole="radio"
                                    accessibilityState={{ selected: foundStatus === 'dropped_off' }}
                                    accessibilityLabel={t('droppedOff')}
                                >
                                    <Text style={[styles.dropOffBtnText, foundStatus === 'dropped_off' && styles.dropOffBtnTextActive]}>{t('droppedOff')}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.dropOffBtn, foundStatus === 'holding' && styles.dropOffBtnActive]}
                                    onPress={() => { setFoundStatus('holding'); setDropOffLocation(''); setCustomDropOff(''); }}
                                    accessibilityRole="radio"
                                    accessibilityState={{ selected: foundStatus === 'holding' }}
                                    accessibilityLabel={t('holding')}
                                >
                                    <Text style={[styles.dropOffBtnText, foundStatus === 'holding' && styles.dropOffBtnTextActive]}>{t('holding')}</Text>
                                </TouchableOpacity>
                            </View>

                            {foundStatus === 'dropped_off' && (
                                <>
                                    <Text style={styles.label}>{t('whereDropped')}</Text>
                                    <View style={styles.dropOffRow} accessibilityRole="radiogroup">
                                        {(['MS Office', 'US Office'] as const).map(spot => (
                                            <TouchableOpacity
                                                key={spot}
                                                style={[styles.dropOffBtn, dropOffLocation === spot && styles.dropOffBtnActive]}
                                                onPress={() => { setDropOffLocation(spot); setCustomDropOff(''); }}
                                                accessibilityRole="radio"
                                                accessibilityState={{ selected: dropOffLocation === spot }}
                                                accessibilityLabel={dropOffLabel(spot)}
                                            >
                                                <Text style={[styles.dropOffBtnText, dropOffLocation === spot && styles.dropOffBtnTextActive]}>{dropOffLabel(spot)}</Text>
                                            </TouchableOpacity>
                                        ))}
                                        <TouchableOpacity
                                            style={[styles.dropOffBtn, isCustomDropOff && styles.dropOffBtnActive]}
                                            onPress={() => setDropOffLocation(customDropOff || 'Other')}
                                            accessibilityRole="radio"
                                            accessibilityState={{ selected: isCustomDropOff }}
                                            accessibilityLabel={t('other')}
                                        >
                                            <Text style={[styles.dropOffBtnText, isCustomDropOff && styles.dropOffBtnTextActive]}>{t('other')}</Text>
                                        </TouchableOpacity>
                                    </View>
                                    {isCustomDropOff && (
                                        <TextInput
                                            style={styles.input}
                                            placeholder={t('dropOffPlaceholder')}
                                            value={customDropOff}
                                            onChangeText={(v) => { setCustomDropOff(v); setDropOffLocation(v || 'Other'); }}
                                            placeholderTextColor={theme.colors.textMuted}
                                            accessibilityLabel={t('dropOffPlaceholder')}
                                        />
                                    )}
                                </>
                            )}
                            {foundStatus === 'holding' && (
                                <Text style={styles.holdingHint}>{t('holdingHint')}</Text>
                            )}
                        </>
                    )}

                    <Text style={styles.label}>{postType === 'found' ? t('whenFound') : t('whenLost')}</Text>
                    <TouchableOpacity
                        style={styles.datePickerBtn}
                        onPress={() => setShowDatePicker(!showDatePicker)}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: showDatePicker }}
                        accessibilityLabel={postType === 'found' ? t('whenFound') : t('whenLost')}
                    >
                        <Text style={styles.datePickerBtnText}>
                            {eventDate.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })}
                            {'  '}
                            {timeUnknown ? t('timeUnknownParen') : eventDate.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true })}
                        </Text>
                        <Text style={styles.datePickerArrow}>{showDatePicker ? '▲' : '▼'}</Text>
                    </TouchableOpacity>
                    {showDatePicker && (
                        <View style={styles.datePickerContainer}>
                            <Text style={styles.pickerSectionLabel}>{t('date')}</Text>
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
                                            accessibilityRole="radio"
                                            accessibilityState={{ selected: isSelected }}
                                            accessibilityLabel={d.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' })}
                                        >
                                            <Text style={[styles.dateChipDay, isSelected && styles.dateChipTextSelected]}>
                                                {isToday ? t('today') : d.toLocaleDateString(locale, { weekday: 'short' })}
                                            </Text>
                                            <Text style={[styles.dateChipDate, isSelected && styles.dateChipTextSelected]}>
                                                {d.getMonth() + 1}/{d.getDate()}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>

                            <Text style={[styles.pickerSectionLabel, { marginTop: 12 }]}>{t('time')}</Text>
                            <TouchableOpacity
                                style={[styles.unknownBtn, timeUnknown && styles.unknownBtnActive]}
                                onPress={() => setTimeUnknown(!timeUnknown)}
                                activeOpacity={0.7}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: timeUnknown }}
                                accessibilityLabel={t('dontKnowTime')}
                            >
                                <Text style={[styles.unknownBtnText, timeUnknown && styles.unknownBtnTextActive]}>
                                    {timeUnknown ? t('timeIsUnknown') : t('dontKnowTime')}
                                </Text>
                            </TouchableOpacity>
                            {!timeUnknown && (
                            <View style={styles.timeRow}>
                                <View style={styles.timeColumn}>
                                    <TouchableOpacity style={styles.timeArrow} accessibilityRole="button" accessibilityLabel={t('hourUp')} onPress={() => {
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
                                    <TouchableOpacity style={styles.timeArrow} accessibilityRole="button" accessibilityLabel={t('hourDown')} onPress={() => {
                                        const d = new Date(eventDate);
                                        d.setHours(d.getHours() - 1);
                                        setEventDate(d);
                                    }}>
                                        <Text style={styles.timeArrowText}>▼</Text>
                                    </TouchableOpacity>
                                </View>

                                <Text style={styles.timeColon}>:</Text>

                                <View style={styles.timeColumn}>
                                    <TouchableOpacity style={styles.timeArrow} accessibilityRole="button" accessibilityLabel={t('minuteUp')} onPress={() => {
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
                                    <TouchableOpacity style={styles.timeArrow} accessibilityRole="button" accessibilityLabel={t('minuteDown')} onPress={() => {
                                        const d = new Date(eventDate);
                                        d.setMinutes(d.getMinutes() - 5);
                                        setEventDate(d);
                                    }}>
                                        <Text style={styles.timeArrowText}>▼</Text>
                                    </TouchableOpacity>
                                </View>

                                <TouchableOpacity style={styles.ampmBtn} accessibilityRole="button" accessibilityLabel={t('toggleAmPm')} onPress={() => {
                                    const d = new Date(eventDate);
                                    d.setHours(d.getHours() >= 12 ? d.getHours() - 12 : d.getHours() + 12);
                                    setEventDate(d);
                                }}>
                                    <Text style={styles.ampmText}>{eventDate.getHours() >= 12 ? 'PM' : 'AM'}</Text>
                                </TouchableOpacity>
                            </View>
                            )}

                            <TouchableOpacity style={styles.doneBtn} onPress={() => setShowDatePicker(false)} accessibilityRole="button" accessibilityLabel={t('done')}>
                                <Text style={styles.doneBtnText}>{t('done')}</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    <TouchableOpacity
                        style={[styles.submitBtn, (loading || analyzing) && styles.submitBtnDisabled]}
                        onPress={submitPost}
                        disabled={loading || analyzing}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: loading || analyzing, busy: loading }}
                        accessibilityLabel={isEditing ? t('saveChanges') : t('postItem')}
                    >
                        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>{isEditing ? t('saveChanges') : t('postItem')}</Text>}
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    centered: { width: '100%', maxWidth: FORM_MAX_WIDTH, alignSelf: 'center' },
    header: {
        paddingHorizontal: theme.spacing.md, paddingTop: 12, paddingBottom: 10,
        backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.borderLight,
    },
    headerInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    closeBtn: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { fontSize: 17, fontWeight: '800', color: theme.colors.textPrimary },
    scroll: { padding: theme.spacing.md, paddingBottom: 120 },
    toggleRow: { flexDirection: 'row', gap: theme.spacing.sm, marginBottom: 20 },
    toggleBtn: { flex: 1, paddingVertical: 12, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceAlt, alignItems: 'center', borderWidth: 1.5, borderColor: 'transparent' },
    toggleBtnActiveFound: { backgroundColor: '#ECFDF5', borderColor: '#10B981' },
    toggleBtnActiveLost: { backgroundColor: '#FEF2F2', borderColor: '#EF4444' },
    toggleText: { ...theme.typography.bodySecondary, color: theme.colors.textSecondary, fontWeight: '500' },
    toggleTextFound: { fontWeight: '700', color: '#047857' },
    toggleTextLost: { fontWeight: '700', color: '#B91C1C' },
    toggleBtnLocked: { flex: 1, paddingVertical: 14, borderRadius: theme.radius.lg, alignItems: 'center', borderWidth: 2 },
    toggleTextLocked: { fontSize: 16, fontWeight: '800' },

    // Photo section
    photoSection: { marginBottom: 20 },
    photoHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    photoTitle: { ...theme.typography.h3, color: '#047857' },
    photoCount: { ...theme.typography.caption, color: '#047857', fontWeight: '700', backgroundColor: '#ECFDF5', paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.full },
    photoGrid: { flexDirection: 'row', gap: PHOTO_GAP, flexWrap: 'wrap' },
    thumbnailContainer: { borderRadius: theme.radius.lg, overflow: 'hidden', position: 'relative' },
    thumbnail: { width: '100%', height: '100%', resizeMode: 'cover' },
    removeBtn: { position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
    removeBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    mainBadge: { position: 'absolute', bottom: 6, left: 6, backgroundColor: '#047857', paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.full },
    mainBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
    addPhotoBtn: { borderRadius: theme.radius.lg, backgroundColor: '#ECFDF5', borderWidth: 2, borderColor: '#A7F3D0', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', gap: 2 },
    addPhotoBtnIcon: { fontSize: 32, color: '#047857', fontWeight: '300' },
    addPhotoBtnText: { ...theme.typography.caption, color: '#047857', fontWeight: '600' },
    addPhotoBtnHint: { fontSize: 10, color: '#059669', textAlign: 'center', paddingHorizontal: 4 },
    photoHint: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: 8, textAlign: 'center' },

    analyzing: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, padding: theme.spacing.md, backgroundColor: '#ECFDF5', borderRadius: theme.radius.lg, borderWidth: 1, borderColor: '#A7F3D0' },
    analyzingText: { marginLeft: theme.spacing.sm, color: '#047857', fontWeight: '600' },
    tagsContainer: { marginBottom: 16 },
    tagsLabel: { ...theme.typography.caption, color: '#047857', fontWeight: '700', marginBottom: 6 },
    tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    tag: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ECFDF5', paddingHorizontal: 10, paddingVertical: 5, borderRadius: theme.radius.full, gap: 4, borderWidth: 1, borderColor: '#A7F3D0' },
    tagText: { fontSize: 12, color: '#047857', fontWeight: '600' },
    tagRemove: { fontSize: 14, color: '#059669', fontWeight: '600' },
    form: { gap: 8 },
    // #047857 (emerald-700) instead of #10B981 for small text — the lighter green
    // fails WCAG AA contrast (~2.5:1) against the light background.
    label: { ...theme.typography.caption, fontWeight: '700', color: '#047857', marginTop: 12 },
    input: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg, padding: 14, fontSize: 15, color: theme.colors.textPrimary },
    textArea: { height: 90, textAlignVertical: 'top' },
    submitBtn: { backgroundColor: '#047857', padding: 16, borderRadius: theme.radius.lg, alignItems: 'center', marginTop: 24, ...theme.shadows.md },
    submitBtnDisabled: { opacity: 0.5 },
    submitBtnText: { color: '#fff', ...theme.typography.button },

    // Date picker
    datePickerBtn: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg, padding: 14 },
    datePickerBtnText: { fontSize: 15, color: theme.colors.textPrimary, fontWeight: '500' },
    datePickerArrow: { fontSize: 12, color: theme.colors.textMuted },
    datePickerContainer: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: theme.spacing.sm, borderWidth: 1, borderColor: theme.colors.border, marginTop: 4 },
    datePickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
    dateChip: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 10, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt, minWidth: 44 },
    dateChipSelected: { backgroundColor: '#047857' },
    dateChipDay: { ...theme.typography.caption, color: theme.colors.textSecondary, fontWeight: '600', marginBottom: 2 },
    dateChipDate: { ...theme.typography.caption, color: theme.colors.textMuted, fontWeight: '500' },
    dateChipTextSelected: { color: '#fff' },
    pickerSectionLabel: { ...theme.typography.caption, color: '#047857', fontWeight: '700', marginBottom: 6 },
    timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    timeColumn: { alignItems: 'center' },
    timeArrow: { padding: 6 },
    timeArrowText: { fontSize: 14, color: theme.colors.textMuted },
    timeValueBox: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, paddingHorizontal: 16, paddingVertical: 10, minWidth: 52, alignItems: 'center' },
    timeValueText: { fontSize: 20, fontWeight: '700', color: theme.colors.textPrimary },
    timeColon: { fontSize: 22, fontWeight: '700', color: theme.colors.textPrimary },
    ampmBtn: { backgroundColor: '#047857', paddingHorizontal: 14, paddingVertical: 10, borderRadius: theme.radius.md, marginLeft: 4 },
    ampmText: { color: '#fff', fontSize: 14, fontWeight: '700' },
    doneBtn: { backgroundColor: '#047857', paddingVertical: 10, borderRadius: theme.radius.md, alignItems: 'center', marginTop: 12 },
    doneBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
    unknownBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt, alignItems: 'center', marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border },
    unknownBtnActive: { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' },
    unknownBtnText: { ...theme.typography.caption, fontWeight: '600', color: theme.colors.textSecondary },
    unknownBtnTextActive: { color: '#B45309' },
    // Drop-off
    dropOffRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
    dropOffBtn: {
        flex: 1, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center',
        borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt,
        borderWidth: 1, borderColor: theme.colors.border,
    },
    dropOffBtnActive: { backgroundColor: '#ECFDF5', borderColor: '#10B981' },
    dropOffBtnText: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary, textAlign: 'center' },
    dropOffBtnTextActive: { color: '#047857', fontWeight: '700' },
    // Zone / category chips
    zoneGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6, marginBottom: 8 },
    zoneChip: {
        paddingVertical: 8, paddingHorizontal: 14,
        borderRadius: theme.radius.full, backgroundColor: theme.colors.surfaceAlt,
        borderWidth: 1, borderColor: theme.colors.border,
    },
    zoneChipActive: { backgroundColor: '#ECFDF5', borderColor: '#10B981' },
    zoneChipText: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
    zoneChipTextActive: { color: '#047857', fontWeight: '700' },
    holdingHint: { ...theme.typography.caption, color: theme.colors.textMuted, marginTop: 4, marginBottom: 4, lineHeight: 16 },
});
