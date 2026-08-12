import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

// Lazy-load expo-notifications to avoid crash if native module not yet built
let Notifications: typeof import('expo-notifications') | null = null;
try {
    Notifications = require('expo-notifications');
} catch (e) {
    console.warn('expo-notifications native module not available — push notifications disabled until next native build');
}

// Configure how notifications appear when app is in foreground
// Suppress notifications for the currently open chat
if (Notifications) {
    Notifications.setNotificationHandler({
        handleNotification: async (notification) => {
            // Check if this notification is for the chat the user is currently viewing
            const data = notification.request.content.data;
            try {
                const { activeChatId } = require('../screens/ChatRoomScreen');
                if (data?.chatId && activeChatId && data.chatId === activeChatId) {
                    return { shouldShowAlert: false, shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: false, shouldShowList: false };
                }
            } catch {}
            return {
                shouldShowAlert: true,
                shouldPlaySound: true,
                shouldSetBadge: true,
                shouldShowBanner: true,
                shouldShowList: true,
            };
        },
    });
}

/**
 * Current OS-level notification permission, for surfacing "notifications are
 * off" UI. 'unavailable' = simulator or native module missing.
 */
export async function getNotificationPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined' | 'unavailable'> {
    if (!Notifications || !Device.isDevice) return 'unavailable';
    try {
        const { status } = await Notifications.getPermissionsAsync();
        return status as 'granted' | 'denied' | 'undetermined';
    } catch {
        return 'unavailable';
    }
}

/**
 * Register for push notifications and return the Expo push token.
 * Also saves the token to Firestore under the user's document.
 */
export async function registerForPushNotifications(userId: string): Promise<string | null> {
    if (!Notifications) {
        console.log('Push notifications not available (native module missing)');
        return null;
    }

    if (!Device.isDevice) {
        console.log('Push notifications require a physical device');
        return null;
    }

    // Check existing permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request permissions if not granted
    if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
    }

    if (finalStatus !== 'granted') {
        console.log('Push notification permission not granted');
        return null;
    }

    // Get Expo push token
    try {
        const projectId = Constants.expoConfig?.extra?.eas?.projectId;
        const tokenData = await Notifications.getExpoPushTokenAsync({
            projectId,
        });
        const token = tokenData.data;

        // Save token to Firestore
        await setDoc(doc(db, 'users', userId), {
            pushToken: token,
            pushTokenUpdatedAt: new Date().toISOString(),
        }, { merge: true });

        // Configure Android channels
        if (Platform.OS === 'android') {
            await Notifications.setNotificationChannelAsync('chat', {
                name: 'Chat Messages',
                importance: Notifications.AndroidImportance.HIGH,
                vibrationPattern: [0, 250, 250, 250],
                lightColor: '#0C2340',
                sound: 'default',
            });
            await Notifications.setNotificationChannelAsync('meetup', {
                name: 'Meetup Reminders',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 500, 200, 500],
                lightColor: '#F97316',
                sound: 'default',
            });
        }

        // iOS notification categories with action buttons
        await Notifications.setNotificationCategoryAsync('meetup_reminder', [
            { identifier: 'open_chat', buttonTitle: 'Open Chat', options: { opensAppToForeground: true } },
            { identifier: 'dismiss', buttonTitle: 'Dismiss', options: { isDestructive: true } },
        ]);

        console.log('Push token registered:', token);
        return token;
    } catch (error) {
        console.error('Error getting push token:', error);
        return null;
    }
}

/**
 * Send a push notification to a specific user via Expo Push API.
 */
export async function sendPushNotification(
    expoPushToken: string,
    title: string,
    body: string,
    data?: Record<string, any>
): Promise<void> {
    const message = {
        to: expoPushToken,
        sound: 'default',
        title,
        body,
        data: data || {},
    };

    try {
        await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Accept-encoding': 'gzip, deflate',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(message),
        });
    } catch (error) {
        console.error('Error sending push notification:', error);
    }
}

// Maps a push `data.type` to the recipient's notification preference key
// (users/{uid}.notifPrefs, mirrored from the Settings screen toggles)
const PREF_KEY_BY_TYPE: Record<string, string> = {
    like: 'likes',
    comment: 'comments',
    chat: 'messages',
    queue: 'market',
    market: 'market',
    lounge: 'lounge',
    lostfound: 'lostfound',
};

/**
 * Send a push notification to a user by their userId.
 * Looks up their push token from Firestore automatically and respects
 * the recipient's notification preferences (Settings → Notifications).
 */
export async function sendPushToUser(
    recipientId: string,
    title: string,
    body: string,
    data?: Record<string, any>
): Promise<void> {
    try {
        const { getDoc } = await import('firebase/firestore');
        const userDoc = await getDoc(doc(db, 'users', recipientId));
        if (!userDoc.exists()) return;
        const userData = userDoc.data();
        const pushToken = userData?.pushToken;
        if (!pushToken) return;
        // Respect recipient's notification settings
        const prefs = userData?.notifPrefs;
        if (prefs) {
            if (prefs.all === false) return;
            const prefKey = PREF_KEY_BY_TYPE[data?.type as string];
            if (prefKey && prefs[prefKey] === false) return;
        }
        await sendPushNotification(pushToken, title, body, data);
    } catch (error) {
        console.error('Error sending push to user:', error);
    }
}
