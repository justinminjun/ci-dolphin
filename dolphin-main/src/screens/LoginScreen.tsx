import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, StatusBar, Image, Platform, Modal, ScrollView } from 'react-native';
import { theme, r } from '../theme/theme';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { auth, db } from '../config/firebase';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

try {
    GoogleSignin.configure({
        webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '596104147964-pv03qh1l47fhrjlrf99alv6628n4gi6n.apps.googleusercontent.com',
        iosClientId: '596104147964-cn5ns9dq8v7hglfsvghof39rh0buq60j.apps.googleusercontent.com',
    });
} catch (e) {
    console.warn('GoogleSignin configure error', e);
}

// Google multicolor "G" logo as a small component
function GoogleLogo() {
    return (
        <View style={{ width: 20, height: 20, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#4285F4' }}>G</Text>
            {/* Overlay colored dots to simulate the multicolor effect */}
            <View style={{ position: 'absolute', top: 0, left: 0, width: 5, height: 5, backgroundColor: '#EA4335', borderRadius: r(3) }} />
            <View style={{ position: 'absolute', bottom: 0, left: 0, width: 5, height: 5, backgroundColor: '#34A853', borderRadius: r(3) }} />
            <View style={{ position: 'absolute', bottom: 0, right: 0, width: 5, height: 5, backgroundColor: '#FBBC05', borderRadius: r(3) }} />
        </View>
    );
}

const EULA_TEXT = `CI Dolphin Terms of Service & End User License Agreement

Last Updated: May 2026

By using CI Dolphin ("the App"), you agree to the following terms:

1. Acceptable Use
You agree to use the App in a lawful and respectful manner. You must not post, share, or transmit any content that is:
• Obscene, offensive, or inappropriate
• Harassing, bullying, or threatening
• Discriminatory or hateful
• Spam or misleading
• Infringing on others' intellectual property

2. Zero Tolerance Policy
CI Dolphin has a zero tolerance policy for objectionable content or abusive users. Any user found to be in violation of these terms may have their account suspended or permanently deleted without prior notice.

3. Content Moderation
Users can report objectionable content and block abusive users. Reports will be reviewed within 24 hours. Content found to violate these terms will be removed and the offending user will be ejected from the platform.

4. User-Generated Content
You retain ownership of content you post but grant CI Dolphin a license to display it within the App. You are solely responsible for content you create.

5. Account Deletion
You may delete your account at any time from the Settings screen. Upon deletion, your personal data will be permanently removed.

6. Privacy
Your data is collected solely for app functionality. We do not sell or share your data with third parties for advertising purposes.

7. Disclaimer
The App is provided "as is" without warranties. CI Dolphin is not responsible for transactions between users.`;

export function LoginScreen() {
    const [eulaAccepted, setEulaAccepted] = useState(false);
    const [showEula, setShowEula] = useState(false);
    const handleGoogleLogin = async () => {
        try {
            await GoogleSignin.hasPlayServices();
            const response = await GoogleSignin.signIn();
            const userInfo = response.data;
            if (!userInfo) throw new Error('No user info returned');
            const email = userInfo.user.email;

            const idToken = userInfo.idToken;
            if (!idToken) throw new Error('No ID token found');

            const credential = GoogleAuthProvider.credential(idToken);
            const userCredential = await signInWithCredential(auth, credential);

            // Domain restriction: Only @chadwickschool.org allowed
            if (!email.toLowerCase().endsWith('@chadwickschool.org')) {
                await auth.signOut();
                throw new Error('Access restricted. Please use your @chadwickschool.org account.');
            }

            // Save user to Firestore
            const firebaseUser = userCredential.user;
            await setDoc(doc(db, 'users', firebaseUser.uid), {
                email,
                displayName: firebaseUser.displayName,
                photoURL: firebaseUser.photoURL || null,
                lastLogin: serverTimestamp(),
            }, { merge: true });
        } catch (error: any) {
            console.error(error);
            Alert.alert('Login Blocked', error.message || 'An error occurred during login.');
        }
    };

    return (
        <View style={styles.container}>
            <StatusBar barStyle="dark-content" />
            <View style={styles.content}>
                {/* Logo */}
                <View style={styles.logoContainer}>
                    <Image source={require('../../assets/dolphin-logo.png')} style={styles.logo} />
                    <Text style={styles.appName}>Dolphin</Text>
                    <Text style={styles.tagline}>Chadwick Community Hub</Text>
                </View>

                {/* Login Card */}
                <View style={styles.card}>
                    <Image source={require('../../assets/school-logo.jpg')} style={styles.schoolLogo} />
                    <Text style={styles.welcomeTitle}>Welcome!</Text>
                    <Text style={styles.welcomeSubtitle}>Sign in with your Google account to access the community hub.</Text>

                    {/* EULA Agreement */}
                    <TouchableOpacity style={styles.eulaRow} onPress={() => setEulaAccepted(!eulaAccepted)} activeOpacity={0.7}>
                        <View style={[styles.eulaCheckbox, eulaAccepted && styles.eulaCheckboxChecked]}>
                            {eulaAccepted && <Text style={styles.eulaCheckmark}>✓</Text>}
                        </View>
                        <Text style={styles.eulaText}>
                            I agree to the{' '}
                            <Text style={styles.eulaLink} onPress={() => setShowEula(true)}>Terms of Service & EULA</Text>
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={[styles.loginButton, !eulaAccepted && { opacity: 0.4 }]} onPress={handleGoogleLogin} activeOpacity={0.8} disabled={!eulaAccepted}>
                        <View style={styles.googleIconWrap}>
                            <Image
                                source={{ uri: 'https://developers.google.com/identity/images/g-logo.png' }}
                                style={styles.googleLogoImg}
                            />
                        </View>
                        <Text style={styles.loginButtonText}>Sign in with Google</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* EULA Modal */}
            <Modal visible={showEula} animationType="slide" presentationStyle="pageSheet">
                <View style={styles.eulaModal}>
                    <View style={styles.eulaHeader}>
                        <Text style={styles.eulaTitle}>Terms of Service</Text>
                        <TouchableOpacity onPress={() => setShowEula(false)}>
                            <Text style={styles.eulaCloseBtn}>✕</Text>
                        </TouchableOpacity>
                    </View>
                    <ScrollView style={styles.eulaScroll} contentContainerStyle={{ paddingBottom: 40 }}>
                        <Text style={styles.eulaBody}>{EULA_TEXT}</Text>
                    </ScrollView>
                    <TouchableOpacity style={styles.eulaAgreeBtn} onPress={() => { setEulaAccepted(true); setShowEula(false); }}>
                        <Text style={styles.eulaAgreeBtnText}>I Agree</Text>
                    </TouchableOpacity>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    content: { flex: 1, justifyContent: 'center', padding: theme.spacing.lg },
    logoContainer: { alignItems: 'center', marginBottom: 40 },
    logo: { width: 100, height: 100, borderRadius: r(24), marginBottom: 16 },
    appName: { fontSize: 34, fontWeight: '800', color: theme.colors.primary, letterSpacing: -0.5 },
    tagline: { fontSize: 15, color: theme.colors.textSecondary, marginTop: 4, fontWeight: '500' },
    card: {
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.xl,
        padding: theme.spacing.xl,
        ...theme.shadows.lg,
    },
    schoolLogo: { width: 56, height: 56, borderRadius: r(12), resizeMode: 'contain', marginBottom: 12, alignSelf: 'center' },
    welcomeTitle: { ...theme.typography.h2, color: theme.colors.textPrimary, textAlign: 'center', marginBottom: theme.spacing.xs },
    welcomeSubtitle: { ...theme.typography.bodySecondary, color: theme.colors.textSecondary, textAlign: 'center', marginBottom: theme.spacing.lg, lineHeight: 20 },
    loginButton: {
        backgroundColor: '#FFFFFF',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: r(100),
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 12,
        borderWidth: 1,
        borderColor: '#747775',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    googleIconWrap: {
        width: 24,
        height: 24,
        justifyContent: 'center',
        alignItems: 'center',
    },
    googleLogoImg: {
        width: 20,
        height: 20,
        resizeMode: 'contain',
    },
    loginButtonText: {
        color: '#1F1F1F',
        fontSize: 16,
        fontWeight: '500',
        letterSpacing: 0.25,
    },
    eulaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: 16,
        paddingHorizontal: 4,
    },
    eulaCheckbox: {
        width: 22,
        height: 22,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: '#CBD5E1',
        justifyContent: 'center',
        alignItems: 'center',
    },
    eulaCheckboxChecked: {
        backgroundColor: theme.colors.primary,
        borderColor: theme.colors.primary,
    },
    eulaCheckmark: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '700',
    },
    eulaText: {
        flex: 1,
        fontSize: 13,
        color: theme.colors.textSecondary,
        lineHeight: 18,
    },
    eulaLink: {
        color: theme.colors.primary,
        fontWeight: '600',
        textDecorationLine: 'underline',
    },
    eulaModal: {
        flex: 1,
        backgroundColor: '#fff',
    },
    eulaHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: Platform.OS === 'ios' ? 60 : 20,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#E2E8F0',
    },
    eulaTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#0F172A',
    },
    eulaCloseBtn: {
        fontSize: 20,
        color: '#94A3B8',
        padding: 4,
    },
    eulaScroll: {
        flex: 1,
        paddingHorizontal: 20,
        paddingTop: 16,
    },
    eulaBody: {
        fontSize: 14,
        color: '#334155',
        lineHeight: 22,
    },
    eulaAgreeBtn: {
        backgroundColor: theme.colors.primary,
        marginHorizontal: 20,
        marginBottom: Platform.OS === 'ios' ? 40 : 20,
        paddingVertical: 14,
        borderRadius: 14,
        alignItems: 'center',
    },
    eulaAgreeBtnText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '700',
    },
});
