import { initializeApp, getApp, getApps } from 'firebase/app';
// @ts-ignore
import { initializeAuth, getReactNativePersistence, getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 'AIzaSyDVg9Bxu9WWM4xe-yNVHCNxL-RaxGOJWog',
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || 'lost-and-found-20c10.firebaseapp.com',
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'lost-and-found-20c10',
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || 'lost-and-found-20c10.firebasestorage.app',
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '596104147964',
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || '1:596104147964:web:a5354700b1f5117ee9f879',
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Initialize auth - try with persistence first, fallback to basic
let firebaseAuth;
try {
    // Try to get AsyncStorage dynamically to avoid crash if native module isn't ready
    const AsyncStorageModule = require('@react-native-async-storage/async-storage');
    const storage = AsyncStorageModule.default || AsyncStorageModule;
    firebaseAuth = initializeAuth(app, {
        persistence: getReactNativePersistence(storage)
    });
} catch (e) {
    try {
        firebaseAuth = getAuth(app);
    } catch {
        firebaseAuth = initializeAuth(app);
    }
}
export const auth = firebaseAuth;
export const db = getFirestore(app);
export const storage = getStorage(app);
