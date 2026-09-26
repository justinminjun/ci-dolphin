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
if (Notifications) {
    Notifications.setNotificationHandler({
        handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: true,
            shouldShowBanner: true,
            shouldShowList: true,
        }),
    });
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

        // Configure Android channel
        if (Platform.OS === 'android') {
            await Notifications.setNotificationChannelAsync('chat', {
                name: 'Chat Messages',
                importance: Notifications.AndroidImportance.HIGH,
                vibrationPattern: [0, 250, 250, 250],
                lightColor: '#0C2340',
                sound: 'default',
            });
        }

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
