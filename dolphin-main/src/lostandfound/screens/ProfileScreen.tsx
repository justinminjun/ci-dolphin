import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, Alert, ActionSheetIOS, Platform } from 'react-native';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { auth, db } from '../config/firebase';
import { collection, query, where, onSnapshot, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { updateProfile } from 'firebase/auth';
import { theme } from '../../theme/theme';
import { timeAgo } from '../utils/timeAgo';
import { isAdmin } from '../utils/admin';

const STORAGE_BUCKET = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || 'lost-and-found-20c10.firebasestorage.app';

export function ProfileScreen({ navigation }: any) {
    const [myPosts, setMyPosts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const user = auth.currentUser;
    const [photoURL, setPhotoURL] = useState(user?.photoURL || null);

    useEffect(() => {
        if (!user) return;
        const q = query(
            collection(db, 'posts'),
            where('authorId', '==', user.uid)
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const posts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            posts.sort((a: any, b: any) => {
                const aTime = a.createdAt?.seconds || 0;
                const bTime = b.createdAt?.seconds || 0;
                return bTime - aTime;
            });
            setMyPosts(posts);
            setLoading(false);
        }, (error) => {
            console.error('Error fetching my posts:', error);
            setLoading(false);
        });
        return unsubscribe;
    }, [user]);

    const handleChangePhoto = () => {
        if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    options: ['Cancel', 'Take Photo', 'Choose from Gallery', ...(photoURL ? ['Remove Photo'] : [])],
                    cancelButtonIndex: 0,
                    destructiveButtonIndex: photoURL ? 3 : undefined,
                    title: 'Change Profile Photo',
                },
                (buttonIndex) => {
                    if (buttonIndex === 1) takePhoto();
                    else if (buttonIndex === 2) pickFromGallery();
                    else if (buttonIndex === 3) removePhoto();
                }
            );
        } else {
            Alert.alert(
                'Change Profile Photo',
                undefined,
                [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Take Photo', onPress: takePhoto },
                    { text: 'Choose from Gallery', onPress: pickFromGallery },
                    ...(photoURL ? [{ text: 'Remove Photo', onPress: removePhoto, style: 'destructive' as const }] : []),
                ]
            );
        }
    };

    const takePhoto = async () => {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert('Permission Needed', 'Camera access is required to take a photo.');
            return;
        }
        const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.3,
        });
        if (!result.canceled && result.assets?.[0]) {
            await uploadProfilePhoto(result.assets[0].uri);
        }
    };

    const pickFromGallery = async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.3,
        });
        if (!result.canceled && result.assets?.[0]) {
            await uploadProfilePhoto(result.assets[0].uri);
        }
    };

    const uploadProfilePhoto = async (localUri: string) => {
        if (!user) return;
        setUploadingPhoto(true);
        try {
            const idToken = await user.getIdToken();
            const fileName = `profiles/${user.uid}.jpg`;
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
                throw new Error('Upload failed');
            }

            const result = JSON.parse(response.body);
            const downloadToken = result.downloadTokens;
            const newPhotoURL = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(fileName)}?alt=media&token=${downloadToken}`;

            // Update Firebase Auth profile
            await updateProfile(user, { photoURL: newPhotoURL });
            // Also save to Firestore
            await setDoc(doc(db, 'users', user.uid), { photoURL: newPhotoURL }, { merge: true });

            setPhotoURL(newPhotoURL);
            Alert.alert('Success', 'Profile photo updated!');
        } catch (e: any) {
            console.error('Photo upload error:', e);
            Alert.alert('Error', 'Failed to update photo.');
        } finally {
            setUploadingPhoto(false);
        }
    };

    const removePhoto = async () => {
        if (!user) return;
        try {
            await updateProfile(user, { photoURL: '' });
            await setDoc(doc(db, 'users', user.uid), { photoURL: null }, { merge: true });
            setPhotoURL(null);
        } catch (e) {
            Alert.alert('Error', 'Failed to remove photo.');
        }
    };

    const handleLogout = async () => {
        Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Sign Out',
                style: 'destructive',
                onPress: async () => {
                    try {
                        await GoogleSignin.signOut();
                        await auth.signOut();
                    } catch (e) {
                        console.error('Logout error:', e);
                        Alert.alert('Error', 'Failed to sign out.');
                    }
                }
            }
        ]);
    };

    const handleDeletePost = (postId: string) => {
        Alert.alert('Delete Post', 'Are you sure you want to delete this post?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                    try {
                        await deleteDoc(doc(db, 'posts', postId));
                        setMyPosts(prev => prev.filter(p => p.id !== postId));
                    } catch (e) {
                        console.error(e);
                        Alert.alert('Error', 'Could not delete post.');
                    }
                }
            }
        ]);
    };

    const renderItem = ({ item }: { item: any }) => {
        const isLost = item.postType === 'lost';
        return (
            <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('Detail', { post: item })} activeOpacity={0.8}>
                <View style={[styles.cardImageContainer, item.status === 'resolved' && { opacity: 0.4 }]}>
                    {item.imageUrl ? (
                        <Image source={{ uri: item.imageUrl }} style={styles.cardImage} />
                    ) : (
                        <View style={[styles.cardImage, styles.noImage]}><Text style={styles.noImageText}>No Image</Text></View>
                    )}
                    <View style={[styles.badge, 
                        item.status === 'resolved' ? styles.badgeResolved : (isLost ? styles.badgeLost : styles.badgeFound)
                    ]}>
                        <Text style={[styles.badgeText, 
                            item.status === 'resolved' ? styles.badgeResolvedText : (isLost ? styles.badgeLostText : styles.badgeFoundText)
                        ]}>
                            {item.status === 'resolved' ? 'Resolved' : (isLost ? 'Lost' : 'Found')}
                        </Text>
                    </View>
                </View>
                <View style={styles.cardContent}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.cardTime}>{timeAgo(item.createdAt)}</Text>
                    <TouchableOpacity style={styles.deleteButton} onPress={() => handleDeletePost(item.id)}>
                        <Text style={styles.deleteText}>Delete</Text>
                    </TouchableOpacity>
                </View>
            </TouchableOpacity>
        );
    };

    return (
        <View style={styles.container}>
            {/* Header / User Info */}
            <View style={styles.header}>
                <TouchableOpacity onPress={handleChangePhoto} activeOpacity={0.7} disabled={uploadingPhoto}>
                    {photoURL ? (
                        <Image source={{ uri: photoURL }} style={styles.avatarImage} />
                    ) : (
                        <View style={styles.avatar}>
                            <Text style={styles.avatarText}>{(user?.displayName || 'U')[0].toUpperCase()}</Text>
                        </View>
                    )}
                    <View style={styles.editBadge}>
                        <Text style={styles.editBadgeText}>Edit</Text>
                    </View>
                </TouchableOpacity>
                <View style={styles.userInfo}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={styles.userName}>{user?.displayName || 'User'}</Text>
                        {isAdmin() && (
                            <View style={{ backgroundColor: '#1E1B4B', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                                <Text style={{ color: '#C4B5FD', fontSize: 10, fontWeight: '700' }}>ADMIN</Text>
                            </View>
                        )}
                    </View>
                    <Text style={styles.userEmail}>{user?.email}</Text>
                </View>
            </View>

            <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
                <Text style={styles.logoutText}>Sign Out</Text>
            </TouchableOpacity>

            <View style={styles.divider} />

            <Text style={styles.sectionTitle}>My Posts</Text>

            <FlatList
                data={myPosts}
                keyExtractor={item => item.id}
                renderItem={renderItem}
                numColumns={2}
                columnWrapperStyle={styles.row}
                contentContainerStyle={styles.list}
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Text style={styles.emptyText}>You haven't posted anything yet.</Text>
                    </View>
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    header: { flexDirection: 'row', alignItems: 'center', padding: theme.spacing.lg, backgroundColor: theme.colors.surface, ...theme.shadows.sm },
    avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center' },
    avatarImage: { width: 60, height: 60, borderRadius: 30 },
    avatarText: { color: '#fff', fontSize: 24, fontWeight: '700' },
    editBadge: { position: 'absolute', bottom: -2, right: -2, backgroundColor: theme.colors.primary, paddingHorizontal: 6, paddingVertical: 2, borderRadius: theme.radius.full, borderWidth: 2, borderColor: theme.colors.surface },
    editBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
    userInfo: { flex: 1, marginLeft: theme.spacing.md },
    userName: { ...theme.typography.h2, color: theme.colors.textPrimary },
    userEmail: { ...theme.typography.bodySecondary, color: theme.colors.textMuted },
    logoutButton: { marginHorizontal: theme.spacing.lg, marginTop: theme.spacing.md, backgroundColor: theme.colors.surfaceAlt, padding: 12, borderRadius: theme.radius.lg, alignItems: 'center' },
    logoutText: { ...theme.typography.button, color: theme.colors.danger },
    divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: theme.spacing.lg },
    sectionTitle: { ...theme.typography.h3, color: theme.colors.textPrimary, paddingHorizontal: theme.spacing.lg, marginBottom: theme.spacing.sm },
    list: { paddingHorizontal: theme.spacing.md, paddingBottom: 20 },
    row: { justifyContent: 'space-between', gap: theme.spacing.md },
    card: { flex: 1, backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, marginBottom: theme.spacing.md, overflow: 'hidden', ...theme.shadows.sm },
    cardImageContainer: { position: 'relative' },
    cardImage: { width: '100%', height: 120, resizeMode: 'cover' },
    noImage: { backgroundColor: theme.colors.surfaceAlt, justifyContent: 'center', alignItems: 'center' },
    noImageText: { ...theme.typography.caption, color: theme.colors.textMuted },
    badge: { position: 'absolute', top: 6, left: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: theme.radius.sm },
    badgeFound: { backgroundColor: theme.colors.foundBg },
    badgeLost: { backgroundColor: theme.colors.lostBg },
    badgeText: { fontSize: 10, fontWeight: '600' },
    badgeFoundText: { color: theme.colors.foundText },
    badgeLostText: { color: theme.colors.lostText },
    badgeResolved: { backgroundColor: '#F0FDF4' },
    badgeResolvedText: { color: '#059669' },
    cardContent: { padding: theme.spacing.sm },
    cardTitle: { ...theme.typography.tag, color: theme.colors.textPrimary, marginBottom: 2 },
    cardTime: { ...theme.typography.caption, color: theme.colors.textMuted, fontSize: 10, marginBottom: 6 },
    deleteButton: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#FEF2F2', borderRadius: 4 },
    deleteText: { color: theme.colors.danger, fontSize: 10, fontWeight: '600' },
    emptyContainer: { padding: theme.spacing.lg, alignItems: 'center' },
    emptyText: { ...theme.typography.body, color: theme.colors.textSecondary },
});
