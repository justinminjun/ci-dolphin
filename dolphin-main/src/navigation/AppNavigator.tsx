import React, { useState, useRef, useEffect } from 'react';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MainTabs } from './MainTabs';
import { LoginScreen } from '../screens/LoginScreen';
import { ListingDetailScreen } from '../screens/ListingDetailScreen';
import { ChatRoomScreen } from '../screens/ChatRoomScreen';
import { CreatePostScreen } from '../screens/CreatePostScreen';
import { PostDetailScreen } from '../screens/PostDetailScreen';
import { CreateListingScreen } from '../screens/CreateListingScreen';
import { SellerDetailScreen } from '../screens/SellerDetailScreen';
import { BatchDetailScreen } from '../screens/BatchDetailScreen';

import { AdminScreen } from '../screens/AdminScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { MyPostsScreen, MyListingsScreen, SavedScreen, SettingsScreen, MarketSavedScreen } from '../screens/ProfileSubScreens';
import { useAuth } from '../config/AuthContext';
import { View } from 'react-native';
import { theme } from '../theme/theme';
import { AnimatedSplash } from '../screens/AnimatedSplash';
import { DetailScreen as LFDetailScreen } from '../lostandfound/screens/DetailScreen';
import { AddPostScreen as LFAddPostScreen } from '../lostandfound/screens/AddPostScreen';
import * as Notifications from 'expo-notifications';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

const Stack = createNativeStackNavigator();

export function AppNavigator() {
    const { user, loading } = useAuth();
    const [splashDone, setSplashDone] = useState(false);
    const navRef = useRef<NavigationContainerRef<any>>(null);
    const [isNavReady, setIsNavReady] = useState(false);

    // ── Push Notification Deep Link Handler ──
    useEffect(() => {
        const sub = Notifications.addNotificationResponseReceivedListener(async (response) => {
            const data = response.notification.request.content.data as any;
            if (!data || !navRef.current || !isNavReady) return;

            try {
                // Chat notification → go to ChatRoom
                if (data.chatId) {
                    navRef.current.navigate('ChatRoom', {
                        chatId: data.chatId,
                        otherUserId: data.senderId || '',
                        otherUserName: data.senderName || 'Chat',
                        listingId: data.listingId || '',
                        listingName: data.listingName || '',
                        chatSource: data.chatSource || 'market',
                    });
                    return;
                }

                // Market listing notification → go to ListingDetail
                if (data.listingId && !data.postId) {
                    const snap = await getDoc(doc(db, 'market_listings', data.listingId));
                    if (snap.exists()) {
                        navRef.current.navigate('ListingDetail', {
                            listing: { id: snap.id, ...snap.data() },
                            openQueue: data.type === 'queue' || data.type === 'request',
                        });
                    }
                    return;
                }

                // Post notification (like/comment) → go to PostDetail
                if (data.postId) {
                    const snap = await getDoc(doc(db, 'lounge_posts', data.postId));
                    if (snap.exists()) {
                        navRef.current.navigate('PostDetail', {
                            post: { id: snap.id, ...snap.data() },
                        });
                    }
                    return;
                }
            } catch (e) {
                console.warn('Deep link nav error:', e);
            }
        });

        return () => sub.remove();
    }, [isNavReady]);

    // Show animated splash while loading OR splash hasn't finished
    if (loading || !splashDone) {
        return (
            <View style={{ flex: 1, backgroundColor: '#061C34' }}>
                <AnimatedSplash onFinish={() => setSplashDone(true)} />
            </View>
        );
    }

    return (
        <NavigationContainer
            ref={navRef}
            onReady={() => setIsNavReady(true)}
            theme={{ dark: false, colors: { primary: '#0EA5E9', background: '#F7F8FA', card: '#FFFFFF', text: '#0F172A', border: '#E2E8F0', notification: '#EF4444' }, fonts: { regular: { fontFamily: 'System', fontWeight: '400' }, medium: { fontFamily: 'System', fontWeight: '500' }, bold: { fontFamily: 'System', fontWeight: '700' }, heavy: { fontFamily: 'System', fontWeight: '900' } } }}
        >
            <Stack.Navigator screenOptions={{ headerShown: false, gestureEnabled: true, fullScreenGestureEnabled: true }}>
                {user ? (
                    <>
                        <Stack.Screen name="Main" component={MainTabs} />
                        <Stack.Screen name="CreatePost" component={CreatePostScreen} options={{ presentation: 'modal' }} />
                        <Stack.Screen name="PostDetail" component={PostDetailScreen} />
                        <Stack.Screen name="CreateListing" component={CreateListingScreen} options={{ presentation: 'modal' }} />
                        <Stack.Screen name="SellerDetail" component={SellerDetailScreen} />
                        <Stack.Screen name="BatchDetail" component={BatchDetailScreen} />
                        <Stack.Screen name="ListingDetail" component={ListingDetailScreen} options={{ presentation: 'card' }} />
                        <Stack.Screen name="ChatRoom" component={ChatRoomScreen} />

                        <Stack.Screen name="MyPosts" component={MyPostsScreen} />
                        <Stack.Screen name="MyListings" component={MyListingsScreen} />
                        <Stack.Screen name="Saved" component={SavedScreen} />
                        <Stack.Screen name="MarketSaved" component={MarketSavedScreen} />
                        <Stack.Screen name="Settings" component={SettingsScreen} />
                        <Stack.Screen name="Admin" component={AdminScreen} />
                        <Stack.Screen name="Notifications" component={NotificationsScreen} />
                        <Stack.Screen name="LFDetail" component={LFDetailScreen} />
                        <Stack.Screen name="LFAddPost" component={LFAddPostScreen} options={{ presentation: 'modal' }} />
                    </>
                ) : (
                    <Stack.Screen name="Login" component={LoginScreen} />
                )}
            </Stack.Navigator>
        </NavigationContainer>
    );
}
