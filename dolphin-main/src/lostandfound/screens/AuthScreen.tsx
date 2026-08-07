import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, StatusBar } from 'react-native';
import { theme } from '../../theme/theme';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { auth, db } from '../config/firebase';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { LinearGradient } from 'expo-linear-gradient';
import { getUserRole } from '../utils/userRole';
import { registerForPushNotifications } from '../utils/notifications';
import { isEmailAllowed } from '../utils/admin';

try {
    GoogleSignin.configure({
        webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '596104147964-pv03qh1l47fhrjlrf99alv6628n4gi6n.apps.googleusercontent.com',
        iosClientId: '596104147964-cn5ns9dq8v7hglfsvghof39rh0buq60j.apps.googleusercontent.com',
    });
} catch (e) {
    console.warn('GoogleSignin configure error', e);
}

export function AuthScreen() {
    const handleGoogleLogin = async () => {
        try {
            await GoogleSignin.hasPlayServices();
            const response = await GoogleSignin.signIn();
            const userInfo = response.data;
            if (!userInfo) throw new Error('No user info returned');
            const email = userInfo.user.email;

            if (!isEmailAllowed(email)) {
                await GoogleSignin.signOut();
                Alert.alert('Access Denied', 'This email is not authorized to use this app.');
                return;
            }

            const idToken = userInfo.idToken;
            if (!idToken) throw new Error('No ID token found');

            const credential = GoogleAuthProvider.credential(idToken);
            const userCredential = await signInWithCredential(auth, credential);

            // Save user role to Firestore
            const firebaseUser = userCredential.user;
            const role = getUserRole(email);
            await setDoc(doc(db, 'users', firebaseUser.uid), {
                email,
                displayName: firebaseUser.displayName,
                photoURL: firebaseUser.photoURL || null,
                role,
                lastLogin: serverTimestamp(),
            }, { merge: true });

            // Register push notifications
            registerForPushNotifications(firebaseUser.uid);
        } catch (error: any) {
            console.error(error);
            Alert.alert('Login Error', error.message || 'An error occurred during login.');
        }
    };

    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" />
            <LinearGradient colors={[theme.colors.gradientStart, theme.colors.gradientEnd]} style={styles.gradient}>
                <View style={styles.logoContainer}>
                    <Text style={styles.title}>Lost & Found</Text>
                    <Text style={styles.subtitle}>Chadwick International</Text>
                </View>

                <View style={styles.card}>
                    <Text style={styles.welcomeTitle}>Welcome</Text>
                    <Text style={styles.welcomeSubtitle}>Sign in with your school account to report or find lost items.</Text>

                    <TouchableOpacity style={styles.loginButton} onPress={handleGoogleLogin} activeOpacity={0.8}>
                        <Text style={styles.googleIcon}>G</Text>
                        <Text style={styles.loginButtonText}>Continue with Google</Text>
                    </TouchableOpacity>

                    <View style={styles.divider}>
                        <View style={styles.dividerLine} />
                        <Text style={styles.dividerText}>School email only</Text>
                        <View style={styles.dividerLine} />
                    </View>

                    <Text style={styles.info}>
                        Only @chadwickschool.org accounts can access this app. Your real name is displayed for accountability.
                    </Text>
                </View>
            </LinearGradient>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    gradient: { flex: 1, justifyContent: 'center', padding: theme.spacing.lg },
    logoContainer: { alignItems: 'center', marginBottom: theme.spacing.xl },
    title: { fontSize: 36, fontWeight: '800', color: '#fff', letterSpacing: -1 },
    subtitle: { fontSize: 16, color: 'rgba(255,255,255,0.8)', marginTop: 4, fontWeight: '500' },
    card: { backgroundColor: '#fff', borderRadius: theme.radius.xl, padding: theme.spacing.xl, ...theme.shadows.lg },
    welcomeTitle: { ...theme.typography.h2, color: theme.colors.textPrimary, textAlign: 'center', marginBottom: theme.spacing.xs },
    welcomeSubtitle: { ...theme.typography.bodySecondary, color: theme.colors.textSecondary, textAlign: 'center', marginBottom: theme.spacing.lg, lineHeight: 20 },
    loginButton: { backgroundColor: theme.colors.textPrimary, paddingVertical: 14, borderRadius: theme.radius.lg, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10, ...theme.shadows.md },
    googleIcon: { color: '#fff', fontSize: 20, fontWeight: '700', backgroundColor: 'rgba(255,255,255,0.15)', width: 28, height: 28, borderRadius: 6, textAlign: 'center', lineHeight: 28, overflow: 'hidden' },
    loginButtonText: { color: '#fff', ...theme.typography.button },
    divider: { flexDirection: 'row', alignItems: 'center', marginVertical: theme.spacing.lg },
    dividerLine: { flex: 1, height: 1, backgroundColor: theme.colors.border },
    dividerText: { paddingHorizontal: theme.spacing.md, ...theme.typography.caption, color: theme.colors.textMuted },
    info: { ...theme.typography.caption, color: theme.colors.textSecondary, textAlign: 'center', lineHeight: 18 },
});
