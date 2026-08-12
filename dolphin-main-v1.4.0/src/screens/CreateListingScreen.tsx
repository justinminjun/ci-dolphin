import React, { useState, useRef } from 'react';
import {
    View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
    Image, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
    ActionSheetIOS,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { theme, r } from '../theme/theme';
import { db, auth, storage } from '../config/firebase';
import { collection, addDoc, serverTimestamp, doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { analyzeMarketItemImages, MARKET_CATEGORIES } from '../utils/gemini';

interface ItemData {
    name: string;
    price: string;
    currency: string;
    description: string;
    category: string;
    photos: string[]; // URIs
}

const emptyItem = (): ItemData => ({ name: '', price: '', currency: 'USD', description: '', category: '', photos: [] });

export function CreateListingScreen({ route, navigation }: any) {
    const mode = route.params?.mode || 'single';
    const listingType: 'selling' | 'buying' = route.params?.listingType || route.params?.editListing?.listingType || 'selling';
    const isBuying = listingType === 'buying';
    const editListing = route.params?.editListing || null;
    const isEditing = !!editListing;

    const [items, setItems] = useState<ItemData[]>(() => {
        if (editListing) {
            return [{
                name: editListing.name || '',
                price: editListing.price || '',
                currency: editListing.currency || (isBuying ? 'Flexible' : 'USD'),
                description: editListing.description || '',
                category: editListing.category || '',
                photos: editListing.photos || [],
            }];
        }
        return [{ name: '', price: '', currency: isBuying ? 'Flexible' : 'USD', description: '', category: '', photos: [] }];
    });
    const [loading, setLoading] = useState(false);
    const [aiLoading, setAiLoading] = useState<number | null>(null);
    const scrollViewRef = useRef<ScrollView>(null);

    const updateItem = (index: number, field: keyof ItemData, value: any) => {
        setItems(prev => {
            const copy = [...prev];
            copy[index] = { ...copy[index], [field]: value };
            return copy;
        });
    };

    const addItem = () => {
        if (items.length >= 10) { Alert.alert('Limit', 'Maximum 10 items per listing.'); return; }
        setItems(prev => [...prev, emptyItem()]);
    };

    const removeItem = (index: number) => {
        if (items.length <= 1) return;
        Alert.alert('Remove Item', 'Remove this item from the listing?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove', style: 'destructive', onPress: () => setItems(prev => prev.filter((_, i) => i !== index)) },
        ]);
    };

    const showPhotoPicker = (itemIndex: number) => {
        const current = items[itemIndex].photos;
        if (current.length >= 3) { Alert.alert('Limit', 'Maximum 3 photos per item.'); return; }

        const options = ['Take Photo', 'Choose from Library', 'Cancel'];
        if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
                { options, cancelButtonIndex: 2 },
                (idx) => { if (idx === 0) takePhoto(itemIndex); else if (idx === 1) pickFromGallery(itemIndex); }
            );
        } else {
            Alert.alert('Add Photo', '', [
                { text: 'Take Photo', onPress: () => takePhoto(itemIndex) },
                { text: 'Choose from Library', onPress: () => pickFromGallery(itemIndex) },
                { text: 'Cancel', style: 'cancel' },
            ]);
        }
    };

    const takePhoto = async (itemIndex: number) => {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { Alert.alert('Camera permission needed'); return; }
        const result = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: true, aspect: [1, 1] });
        if (!result.canceled && result.assets[0]) {
            const newPhotos = [...items[itemIndex].photos, result.assets[0].uri].slice(0, 3);
            updateItem(itemIndex, 'photos', newPhotos);
            if (!isBuying) runAiAnalysis(itemIndex, newPhotos);
        }
    };

    const pickFromGallery = async (itemIndex: number) => {
        const current = items[itemIndex].photos;
        const remaining = 3 - current.length;
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { Alert.alert('Permission needed'); return; }
        const result = await ImagePicker.launchImageLibraryAsync({
            quality: 0.6,
            allowsMultipleSelection: true,
            selectionLimit: remaining,
            aspect: [1, 1],
        });
        if (!result.canceled && result.assets.length > 0) {
            const newPhotos = [...current, ...result.assets.map(a => a.uri)].slice(0, 3);
            updateItem(itemIndex, 'photos', newPhotos);
            if (!isBuying) runAiAnalysis(itemIndex, newPhotos);
        }
    };

    const runAiAnalysis = async (itemIndex: number, photos: string[]) => {
        if (photos.length === 0) return;
        setAiLoading(itemIndex);
        try {
            const base64Images: string[] = [];
            for (const uri of photos) {
                if (uri.startsWith('https://')) continue;
                const b64 = await FileSystem.readAsStringAsync(uri, {
                    encoding: FileSystem.EncodingType.Base64,
                });
                base64Images.push(b64);
            }
            if (base64Images.length === 0) { setAiLoading(null); return; }
            const result = await analyzeMarketItemImages(base64Images);
            updateItem(itemIndex, 'name', result.title || '');
            updateItem(itemIndex, 'description', result.description || '');
            updateItem(itemIndex, 'category', result.category || '');
        } catch (e: any) {
            console.warn('AI analysis failed:', e.message);
            Alert.alert('AI Note', 'AI analysis could not complete. Fill in details manually.');
        }
        setAiLoading(null);
    };

    const removePhoto = (itemIndex: number, photoIndex: number) => {
        const copy = [...items[itemIndex].photos];
        copy.splice(photoIndex, 1);
        updateItem(itemIndex, 'photos', copy);
    };

    const handlePost = async () => {
        const user = auth.currentUser;
        if (!user) { Alert.alert('Error', 'You must be logged in.'); return; }

        // Validate
        for (let i = 0; i < items.length; i++) {
            if (!items[i].name.trim()) {
                Alert.alert('Missing Info', `Please enter a name for item ${i + 1}.`);
                return;
            }
        }

        setLoading(true);
        try {
            // Each item becomes a separate document, linked by a batch ID for multi-item
            const batchId = Date.now().toString();
            const isMulti = items.length > 1;

            for (const item of items) {
                // Upload photos to Firebase Storage
                const uploadedPhotoUrls: string[] = [];
                for (const photoUri of item.photos) {
                    // Skip already-uploaded remote URLs
                    if (photoUri.startsWith('https://')) {
                        uploadedPhotoUrls.push(photoUri);
                        continue;
                    }
                    try {
                        // Compress & resize before upload (max 800px, 60% quality)
                        const compressed = await manipulateAsync(
                            photoUri,
                            [{ resize: { width: 800 } }],
                            { compress: 0.6, format: SaveFormat.JPEG }
                        );
                        const response = await fetch(compressed.uri);
                        const blob = await response.blob();
                        const filename = `market/${user.uid}/${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
                        const storageRef = ref(storage, filename);
                        await uploadBytes(storageRef, blob);
                        const downloadUrl = await getDownloadURL(storageRef);
                        uploadedPhotoUrls.push(downloadUrl);
                    } catch (uploadErr) {
                        console.error('Photo upload failed:', uploadErr);
                    }
                }

                if (isEditing) {
                    // Update existing listing
                    const allPhotos = [...uploadedPhotoUrls];
                    // Keep existing remote photos (https://...)
                    for (const p of item.photos) {
                        if (p.startsWith('https://') && !uploadedPhotoUrls.includes(p)) allPhotos.push(p);
                    }
                    await updateDoc(doc(db, 'market_listings', editListing.id), {
                        name: item.name.trim(),
                        price: item.currency === 'Free' ? '' : item.price.replace(/[^0-9]/g, ''),
                        currency: item.currency,
                        description: item.description.trim(),
                        category: item.category || '',
                        photos: allPhotos.length > 0 ? allPhotos : (editListing.photos || []),
                        listingType,
                    });
                } else {
                    await addDoc(collection(db, 'market_listings'), {
                        name: item.name.trim(),
                        price: item.currency === 'Free' ? '' : item.price.replace(/[^0-9]/g, ''),
                        currency: item.currency,
                        description: item.description.trim(),
                        category: item.category || '',
                        photos: uploadedPhotoUrls,
                        sellerId: user.uid,
                        sellerName: user.displayName || 'Anonymous',
                        sellerEmail: user.email || '',
                        sellerPhoto: user.photoURL || null,
                        batchId: isMulti ? batchId : null,
                        createdAt: serverTimestamp(),
                        status: 'available',
                        listingType,
                    });
                }
            }
            navigation.goBack();
        } catch (error: any) {
            Alert.alert('Error', error.message || 'Failed to create listing.');
        } finally {
            setLoading(false);
        }
    };

    const isValid = items.every(it => it.name.trim().length > 0);

    return (
        <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeBtn}>
                    <Ionicons name="close" size={26} color={theme.colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>
                    {isEditing ? 'Edit Listing' : isBuying ? 'Looking to Buy' : mode === 'multi' ? 'List Multiple Items' : 'List an Item'}
                </Text>
                <TouchableOpacity
                    style={[styles.postBtn, !isValid && styles.postBtnDisabled]}
                    onPress={handlePost}
                    disabled={loading || !isValid}
                >
                    {loading ? (
                        <ActivityIndicator size="small" color="#fff" />
                    ) : (
                        <Text style={styles.postBtnText}>{isEditing ? 'Save' : 'Post'}</Text>
                    )}
                </TouchableOpacity>
            </View>

            <ScrollView ref={scrollViewRef} style={styles.form} contentContainerStyle={{ paddingBottom: 120 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
                {items.map((item, index) => (
                    <View key={index} style={styles.itemCard}>
                        {/* Item Header */}
                        <View style={styles.itemHeader}>
                            <Text style={styles.itemNumber}>
                                {items.length > 1 ? `Item ${index + 1}` : 'Item Details'}
                            </Text>
                            {items.length > 1 && (
                                <TouchableOpacity onPress={() => removeItem(index)}>
                                    <Ionicons name="close-circle" size={22} color="#EF4444" />
                                </TouchableOpacity>
                            )}
                        </View>

                        {/* Name */}
                        <TextInput
                            style={styles.nameInput}
                            placeholder="Item name"
                            placeholderTextColor={theme.colors.textMuted}
                            value={item.name}
                            onChangeText={v => updateItem(index, 'name', v)}
                        />

                        {/* Photos */}
                        <Text style={styles.fieldLabel}>Photos (max 3)</Text>
                        <View style={styles.photoRow}>
                            {item.photos.map((uri, pIdx) => (
                                <View key={pIdx} style={styles.photoWrap}>
                                    <Image source={{ uri }} style={styles.photo} />
                                    <TouchableOpacity style={styles.photoRemove} onPress={() => removePhoto(index, pIdx)}>
                                        <Ionicons name="close-circle" size={18} color="#EF4444" />
                                    </TouchableOpacity>
                                </View>
                            ))}
                            {item.photos.length < 3 && (
                                <TouchableOpacity style={styles.photoAdd} onPress={() => showPhotoPicker(index)}>
                                    <Ionicons name="add" size={28} color={theme.colors.textMuted} />
                                    <Text style={styles.photoAddText}>{item.photos.length === 0 ? 'Photo' : 'Add'}</Text>
                                </TouchableOpacity>
                            )}
                        </View>

                        {/* AI analyzing indicator */}
                        {aiLoading === index && (
                            <View style={styles.aiBar}>
                                <ActivityIndicator size="small" color="#F97316" />
                                <Text style={styles.aiBarText}>AI is analyzing your photos...</Text>
                            </View>
                        )}

                        {/* Category */}
                        <Text style={styles.fieldLabel}>Category</Text>
                        <View style={styles.catWrap}>
                            {MARKET_CATEGORIES.map(cat => (
                                <TouchableOpacity
                                    key={cat}
                                    style={[styles.catChip, item.category === cat && styles.catChipActive]}
                                    onPress={() => updateItem(index, 'category', item.category === cat ? '' : cat)}
                                >
                                    <Text style={[styles.catChipText, item.category === cat && styles.catChipTextActive]}>{cat}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        {/* Price / Budget */}
                        {isBuying ? (
                            <>
                                <Text style={styles.fieldLabel}>Budget</Text>
                                <View style={styles.currencyRow}>
                                    <TouchableOpacity
                                        style={[styles.currencyBtn, item.currency === 'Flexible' && styles.currencyBtnActive]}
                                        onPress={() => { updateItem(index, 'currency', 'Flexible'); updateItem(index, 'price', ''); }}
                                    >
                                        <Text style={[styles.currencyText, item.currency === 'Flexible' && styles.currencyTextActive]}>Flexible</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.currencyBtn, (item.currency === 'USD' || item.currency === 'KRW') && styles.currencyBtnActive]}
                                        onPress={() => { if (item.currency !== 'USD' && item.currency !== 'KRW') updateItem(index, 'currency', 'KRW'); }}
                                    >
                                        <Text style={[styles.currencyText, (item.currency === 'USD' || item.currency === 'KRW') && styles.currencyTextActive]}>Specific</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.currencyBtn, item.currency === 'NoBudget' && styles.currencyBtnActive]}
                                        onPress={() => { updateItem(index, 'currency', 'NoBudget'); updateItem(index, 'price', ''); }}
                                    >
                                        <Text style={[styles.currencyText, item.currency === 'NoBudget' && styles.currencyTextActive]}>None</Text>
                                    </TouchableOpacity>
                                </View>
                                {(item.currency === 'USD' || item.currency === 'KRW') && (
                                    <>
                                        <View style={[styles.currencyRow, { marginTop: 8 }]}>
                                            <TouchableOpacity
                                                style={[styles.currencyBtn, item.currency === 'USD' && styles.currencyBtnActive]}
                                                onPress={() => updateItem(index, 'currency', 'USD')}
                                            >
                                                <Text style={[styles.currencyText, item.currency === 'USD' && styles.currencyTextActive]}>USD ($)</Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                style={[styles.currencyBtn, item.currency === 'KRW' && styles.currencyBtnActive]}
                                                onPress={() => updateItem(index, 'currency', 'KRW')}
                                            >
                                                <Text style={[styles.currencyText, item.currency === 'KRW' && styles.currencyTextActive]}>KRW (₩)</Text>
                                            </TouchableOpacity>
                                        </View>
                                        <TextInput
                                            style={styles.input}
                                            placeholder="Max budget amount"
                                            placeholderTextColor={theme.colors.textMuted}
                                            value={item.price}
                                            onChangeText={v => updateItem(index, 'price', v.replace(/[^0-9]/g, ''))}
                                            keyboardType="number-pad"
                                            maxLength={10}
                                        />
                                    </>
                                )}
                            </>
                        ) : (
                            <>
                                <Text style={styles.fieldLabel}>Price</Text>
                                <View style={styles.currencyRow}>
                                    <TouchableOpacity 
                                        style={[styles.currencyBtn, item.currency === 'USD' && styles.currencyBtnActive]}
                                        onPress={() => updateItem(index, 'currency', 'USD')}
                                    >
                                        <Text style={[styles.currencyText, item.currency === 'USD' && styles.currencyTextActive]}>USD ($)</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity 
                                        style={[styles.currencyBtn, item.currency === 'KRW' && styles.currencyBtnActive]}
                                        onPress={() => updateItem(index, 'currency', 'KRW')}
                                    >
                                        <Text style={[styles.currencyText, item.currency === 'KRW' && styles.currencyTextActive]}>KRW (₩)</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity 
                                        style={[styles.currencyBtn, item.currency === 'Free' && styles.currencyBtnActive]}
                                        onPress={() => {
                                            updateItem(index, 'currency', 'Free');
                                            updateItem(index, 'price', '');
                                        }}
                                    >
                                        <Text style={[styles.currencyText, item.currency === 'Free' && styles.currencyTextActive]}>Free</Text>
                                    </TouchableOpacity>
                                </View>
                                
                                {item.currency !== 'Free' && (
                                    <TextInput
                                        style={styles.input}
                                        placeholder="Numbers only"
                                        placeholderTextColor={theme.colors.textMuted}
                                        value={item.price}
                                        onChangeText={v => updateItem(index, 'price', v.replace(/[^0-9]/g, ''))}
                                        keyboardType="number-pad"
                                        maxLength={10}
                                    />
                                )}
                            </>
                        )}

                        {/* Description */}
                        <TextInput
                            style={[styles.input, styles.descInput]}
                            placeholder="Description (condition, details...)"
                            placeholderTextColor={theme.colors.textMuted}
                            value={item.description}
                            onChangeText={v => updateItem(index, 'description', v)}
                            multiline
                            textAlignVertical="top"
                            onFocus={() => {
                                setTimeout(() => {
                                    scrollViewRef.current?.scrollToEnd({ animated: true });
                                }, 300);
                            }}
                        />
                    </View>
                ))}

                {/* Add Item Button (multi mode) */}
                {mode === 'multi' && (
                    <TouchableOpacity style={styles.addItemBtn} onPress={addItem}>
                        <Ionicons name="add-circle-outline" size={22} color={theme.colors.primary} />
                        <Text style={styles.addItemText}>Add Another Item</Text>
                    </TouchableOpacity>
                )}

                <View style={{ height: 40 }} />
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
    headerTitle: { ...theme.typography.h3, color: theme.colors.textPrimary, fontSize: 16 },
    postBtn: {
        backgroundColor: '#F97316', paddingHorizontal: 20, paddingVertical: 8,
        borderRadius: theme.radius.full, minWidth: 70, alignItems: 'center',
    },
    postBtnDisabled: { opacity: 0.4 },
    postBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    form: { flex: 1, padding: theme.spacing.md },
    itemCard: {
        backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg,
        padding: theme.spacing.md, marginBottom: 16, ...theme.shadows.sm,
        borderWidth: 1, borderColor: theme.colors.border,
    },
    itemHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    itemNumber: { ...theme.typography.bodyBold, color: '#F97316', fontSize: 14 },
    nameInput: {
        ...theme.typography.h3, color: theme.colors.textPrimary, fontSize: 17,
        borderBottomWidth: 1, borderBottomColor: theme.colors.border,
        paddingBottom: 10, marginBottom: 14,
    },
    fieldLabel: { ...theme.typography.caption, fontWeight: '600', color: '#F97316', marginBottom: 8 },
    photoRow: { flexDirection: 'row', gap: 10, marginBottom: 14, flexWrap: 'wrap' },
    photoWrap: { position: 'relative' },
    photo: { width: 80, height: 80, borderRadius: r(12), resizeMode: 'cover' },
    photoRemove: { position: 'absolute', top: -6, right: -6 },
    photoAdd: {
        width: 80, height: 80, borderRadius: r(12), borderWidth: 1.5, borderStyle: 'dashed',
        borderColor: '#FDBA74', justifyContent: 'center', alignItems: 'center',
    },
    photoAddText: { fontSize: 10, color: '#F97316', marginTop: 2 },
    aiBar: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        paddingVertical: 10, marginBottom: 14, borderRadius: r(10),
        backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FDBA74',
    },
    aiBarText: { fontSize: 13, fontWeight: '600', color: '#F97316' },
    catWrap: {
        flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12,
    },
    catChip: {
        paddingHorizontal: 12, paddingVertical: 6, borderRadius: r(16),
        backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border,
    },
    catChipActive: { backgroundColor: '#F97316', borderColor: '#F97316' },
    catChipText: { fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary },
    catChipTextActive: { color: '#fff' },
    input: {
        ...theme.typography.body, color: theme.colors.textPrimary,
        backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md,
        paddingHorizontal: 14, paddingVertical: 11, marginBottom: 10,
    },
    descInput: { minHeight: 80, textAlignVertical: 'top' },
    addItemBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        paddingVertical: 14, borderRadius: theme.radius.lg,
        borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#F97316',
        backgroundColor: '#FFF7ED',
    },
    addItemText: { ...theme.typography.bodyBold, color: '#F97316', fontSize: 14 },
    currencyRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
    currencyBtn: {
        flex: 1, paddingVertical: 8, alignItems: 'center',
        backgroundColor: theme.colors.surfaceAlt, borderRadius: r(8),
    },
    currencyBtnActive: { backgroundColor: '#F97316' },
    currencyText: { fontSize: 13, fontWeight: '600', color: theme.colors.textSecondary },
    currencyTextActive: { color: '#fff' },
});
