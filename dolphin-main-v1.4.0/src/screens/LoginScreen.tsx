import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, StatusBar, Image, Platform, Modal, ScrollView, TextInput, KeyboardAvoidingView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, r } from '../theme/theme';
import { auth, db } from '../config/firebase';
import { GoogleAuthProvider, signInWithCredential, signInWithEmailAndPassword, signInWithPopup } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../config/AuthContext';

// Native Google Sign-In module is not available on web — load it lazily so the
// web bundle never touches the native-only package.
let GoogleSignin: typeof import('@react-native-google-signin/google-signin').GoogleSignin | null = null;
if (Platform.OS !== 'web') {
    GoogleSignin = require('@react-native-google-signin/google-signin').GoogleSignin;
    try {
        GoogleSignin!.configure({
            webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '596104147964-pv03qh1l47fhrjlrf99alv6628n4gi6n.apps.googleusercontent.com',
            iosClientId: '596104147964-cn5ns9dq8v7hglfsvghof39rh0buq60j.apps.googleusercontent.com',
        });
    } catch (e) {
        console.warn('GoogleSignin configure error', e);
    }
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
    const [showReviewer, setShowReviewer] = useState(false);
    const [reviewerEmail, setReviewerEmail] = useState('');
    const [reviewerPassword, setReviewerPassword] = useState('');
    const [reviewerLoading, setReviewerLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const insets = useSafeAreaInsets();
    const passwordRef = useRef<TextInput>(null);
    const { enterTestMode } = useAuth();

    const handleGoogleLogin = async () => {
        // This button used to be `disabled` while the box was unchecked, so the very
        // first tap did nothing at all — indistinguishable from a broken sign-in.
        if (!eulaAccepted) {
            Alert.alert('Terms of Service', 'Please tick the checkbox to accept the Terms of Service & EULA, then sign in.');
            return;
        }
        try {
            let userCredential;

            if (Platform.OS === 'web') {
                const provider = new GoogleAuthProvider();
                provider.setCustomParameters({ hd: 'chadwickschool.org' });
                userCredential = await signInWithPopup(auth, provider);
            } else {
                await GoogleSignin!.hasPlayServices();
                const response = await GoogleSignin!.signIn();
                const userInfo = response.data;
                if (!userInfo) throw new Error('No user info returned');

                const idToken = userInfo.idToken;
                if (!idToken) throw new Error('No ID token found');

                const credential = GoogleAuthProvider.credential(idToken);
                userCredential = await signInWithCredential(auth, credential);
            }

            const email = userCredential.user.email || '';

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

    // TEMP: testing-only bypass for the web deploy while its domain isn't yet
    // authorized for Google Sign-In on the Firebase backend project. No real
    // Firebase Auth session is created, so Firestore-backed reads/writes won't
    // work — this only unlocks the navigation shell/layout for visual testing.
    // Remove once Google Sign-In works on this host again.
    const handleTestBypass = () => {
        enterTestMode();
    };

    // Readable messages for the Firebase Auth error codes a reviewer is most likely to hit.
    const authErrorMessage = (error: any): string => {
        switch (error?.code) {
            case 'auth/invalid-credential':
            case 'auth/wrong-password':
            case 'auth/user-not-found':
                return 'Incorrect email or password. Please check the credentials and try again.';
            case 'auth/invalid-email':
                return 'That email address is not valid. Please check it and try again.';
            case 'auth/too-many-requests':
                return 'Too many sign-in attempts. Please wait a moment and try again.';
            case 'auth/network-request-failed':
                return 'Network error. Please check your internet connection and try again.';
            default:
                return error?.message || 'An error occurred during sign-in.';
        }
    };

    // Always dismissible: a stalled network request must never leave the reviewer
    // stuck in a spinner with no way out of the sheet.
    const closeReviewerModal = () => {
        setShowReviewer(false);
        setReviewerEmail('');
        setReviewerPassword('');
        setShowPassword(false);
        setReviewerLoading(false);
    };

    // Two native Modals cannot be presented at once on iOS, so hand off instead:
    // close the sheet (keeping what was typed) and open the ToS once it is gone.
    const openTermsFromReviewer = () => {
        setShowReviewer(false);
        setTimeout(() => setShowEula(true), Platform.OS === 'ios' ? 400 : 0);
    };

    const handleReviewerLogin = async () => {
        if (reviewerLoading) return;
        const email = reviewerEmail.trim();
        // Reviewers paste these out of the store listing's review notes, where a
        // trailing space or newline rides along and fails as auth/invalid-credential.
        const password = reviewerPassword.trim();
        if (!email || !password) {
            Alert.alert('Sign-in Failed', 'Please enter both an email address and a password.');
            return;
        }
        // Domain check runs BEFORE authenticating. Signing in first would flash the
        // authenticated stack in and leave a users/{uid} doc behind for an account we
        // are about to reject.
        if (!email.toLowerCase().endsWith('@chadwickschool.org')) {
            Alert.alert('Access Restricted', 'Please use your @chadwickschool.org account.');
            return;
        }
        setReviewerLoading(true);
        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const firebaseUser = userCredential.user;

            // Re-check the canonical address on the account, not the string that was typed.
            const verifiedEmail = (firebaseUser.email || '').toLowerCase();
            if (!verifiedEmail.endsWith('@chadwickschool.org')) {
                await auth.signOut();
                throw new Error('Access restricted. Please use your @chadwickschool.org account.');
            }

            // Auth has succeeded — close the sheet before anything that can fail, so a
            // Firestore hiccup can never raise a false "Sign-in Failed" alert over an
            // app the reviewer is already signed in to.
            setShowReviewer(false);
            setReviewerEmail('');
            setReviewerPassword('');
            setShowPassword(false);

            // Best-effort profile touch. AuthContext writes the full profile, so a
            // failure here must not be reported to the user as a sign-in failure.
            try {
                await setDoc(doc(db, 'users', firebaseUser.uid), {
                    email: verifiedEmail,
                    displayName: firebaseUser.displayName,
                    lastLogin: serverTimestamp(),
                }, { merge: true });
            } catch (profileError) {
                console.error('Reviewer profile update failed (sign-in already succeeded)', profileError);
            }
        } catch (error: any) {
            console.error(error);
            Alert.alert('Sign-in Failed', authErrorMessage(error));
        } finally {
            setReviewerLoading(false);
        }
    };

    return (
        <View style={styles.container}>
            <StatusBar barStyle="dark-content" />
            {/* Scrollable so the card cannot be clipped — and the email sign-in button
                with it — at large Android font/display scales. */}
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {/* Press & hold the logo ~1s to open the email sign-in sheet. This
                    is the ONLY entry point, kept off-screen on purpose so regular
                    students/faculty only see the Google path; app-store reviewers are
                    given the exact gesture in the store listing's sign-in notes. */}
                <TouchableOpacity
                    style={styles.logoContainer}
                    activeOpacity={1}
                    delayLongPress={1000}
                    onLongPress={() => setShowReviewer(true)}
                >
                    <Image source={require('../../assets/dolphin-logo.png')} style={styles.logo} />
                    <Text style={styles.appName}>Dolphin</Text>
                    <Text style={styles.tagline}>Chadwick Community Hub</Text>
                </TouchableOpacity>

                {/* Login Card */}
                <View style={styles.card}>
                    <Image source={require('../../assets/school-logo.jpg')} style={styles.schoolLogo} />
                    <Text style={styles.welcomeTitle}>Welcome!</Text>
                    <Text style={styles.welcomeSubtitle}>Sign in with your @chadwickschool.org Google account to access the community hub.</Text>

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

                    <TouchableOpacity style={[styles.loginButton, !eulaAccepted && { opacity: 0.4 }]} onPress={handleGoogleLogin} activeOpacity={0.8}>
                        <View style={styles.googleIconWrap}>
                            <Image
                                source={{ uri: 'https://developers.google.com/identity/images/g-logo.png' }}
                                style={styles.googleLogoImg}
                            />
                        </View>
                        <Text style={styles.loginButtonText}>Sign in with Google</Text>
                    </TouchableOpacity>

                    {/* TEMP: testing-only bypass — remove once Google Sign-In's domain is authorized */}
                    {Platform.OS === 'web' && (
                        <TouchableOpacity
                            style={[styles.testBypassBtn, !eulaAccepted && { opacity: 0.4 }]}
                            onPress={handleTestBypass}
                            activeOpacity={0.7}
                            disabled={!eulaAccepted}
                        >
                            <Text style={styles.testBypassText}>Continue without signing in (testing only — no live data)</Text>
                        </TouchableOpacity>
                    )}

                    {/* No visible email/password control: students and faculty must
                        only ever see the Google path. App-store reviewers reach the
                        email sign-in by pressing and holding the Dolphin logo above
                        for ~1.5s — the exact wording is given in the Play Console
                        "Sign in details" instructions. */}
                </View>
            </ScrollView>

            {/* EULA Modal */}
            {/* onRequestClose is the Android hardware-back handler; onDismiss keeps
                showEula in sync when the iOS pageSheet is swiped away, which would
                otherwise leave the flag true and make the ToS unopenable for the
                rest of the session. */}
            <Modal
                visible={showEula}
                animationType="slide"
                presentationStyle="pageSheet"
                onRequestClose={() => setShowEula(false)}
                onDismiss={() => setShowEula(false)}
            >
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

            {/* Reviewer sign-in Modal */}
            <Modal visible={showReviewer} animationType="slide" transparent onRequestClose={closeReviewerModal}>
                {/* behavior must be set on Android too — with `undefined` the sheet is
                    bottom-anchored and the IME covers both inputs and the Sign in
                    button, with no way to scroll them back into view. */}
                <KeyboardAvoidingView
                    style={styles.reviewerOverlay}
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                >
                    <View style={[styles.reviewerSheet, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 36 : theme.spacing.lg) }]}>
                        <View style={styles.reviewerHeader}>
                            <Text style={styles.reviewerTitle}>App review sign-in</Text>
                            <TouchableOpacity onPress={closeReviewerModal} hitSlop={12}>
                                <Text style={styles.reviewerCloseBtn}>✕</Text>
                            </TouchableOpacity>
                        </View>
                        <ScrollView
                            style={styles.reviewerScroll}
                            contentContainerStyle={styles.reviewerScrollContent}
                            keyboardShouldPersistTaps="handled"
                            showsVerticalScrollIndicator={false}
                        >
                            <Text style={styles.reviewerSubtitle}>
                                Email and password access for app review. Use the demo credentials provided with this app submission.
                            </Text>

                            <Text style={styles.reviewerLabel}>Email</Text>
                            <TextInput
                                style={styles.reviewerInput}
                                value={reviewerEmail}
                                onChangeText={setReviewerEmail}
                                placeholder="name@chadwickschool.org"
                                placeholderTextColor={theme.colors.textMuted}
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType="email-address"
                                textContentType="emailAddress"
                                editable={!reviewerLoading}
                                returnKeyType="next"
                                onSubmitEditing={() => passwordRef.current?.focus()}
                            />

                            <Text style={styles.reviewerLabel}>Password</Text>
                            <View style={styles.reviewerPasswordRow}>
                                <TextInput
                                    ref={passwordRef}
                                    style={styles.reviewerPasswordInput}
                                    value={reviewerPassword}
                                    onChangeText={setReviewerPassword}
                                    placeholder="Password"
                                    placeholderTextColor={theme.colors.textMuted}
                                    secureTextEntry={!showPassword}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    textContentType="password"
                                    editable={!reviewerLoading}
                                    returnKeyType="go"
                                    onSubmitEditing={handleReviewerLogin}
                                />
                                {/* The demo password is long and mixed-case; typing it
                                    blind is the most likely way a reviewer fails. */}
                                <TouchableOpacity
                                    onPress={() => setShowPassword(!showPassword)}
                                    style={styles.reviewerShowBtn}
                                    hitSlop={8}
                                    accessibilityRole="button"
                                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                                >
                                    <Text style={styles.reviewerShowBtnText}>{showPassword ? 'Hide' : 'Show'}</Text>
                                </TouchableOpacity>
                            </View>

                            <Text style={styles.reviewerNote}>
                                By signing in you agree to the{' '}
                                <Text style={styles.reviewerNoteLink} onPress={openTermsFromReviewer}>Terms of Service</Text>.
                            </Text>

                            <TouchableOpacity
                                style={[styles.reviewerSubmitBtn, reviewerLoading && { opacity: 0.6 }]}
                                onPress={handleReviewerLogin}
                                activeOpacity={0.8}
                                disabled={reviewerLoading}
                            >
                                {reviewerLoading
                                    ? <ActivityIndicator color="#fff" />
                                    : <Text style={styles.reviewerSubmitBtnText}>Sign in</Text>}
                            </TouchableOpacity>

                            <TouchableOpacity style={styles.reviewerCancelBtn} onPress={closeReviewerModal} activeOpacity={0.7}>
                                <Text style={styles.reviewerCancelBtnText}>Cancel</Text>
                            </TouchableOpacity>
                        </ScrollView>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    scroll: { flex: 1 },
    content: { flexGrow: 1, justifyContent: 'center', padding: theme.spacing.lg },
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
    testBypassBtn: {
        alignItems: 'center',
        paddingVertical: 12,
        marginTop: 8,
    },
    testBypassText: {
        color: theme.colors.textMuted,
        fontSize: 13,
        fontWeight: '600',
        textDecorationLine: 'underline',
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
    reviewerOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
    },
    reviewerSheet: {
        maxHeight: '92%',
        backgroundColor: theme.colors.surface,
        borderTopLeftRadius: r(20),
        borderTopRightRadius: r(20),
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.lg,
    },
    reviewerScroll: {
        flexShrink: 1,
    },
    reviewerScrollContent: {
        paddingBottom: 4,
    },
    reviewerHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: theme.spacing.xs,
    },
    reviewerTitle: {
        ...theme.typography.h3,
        color: theme.colors.textPrimary,
    },
    reviewerCloseBtn: {
        fontSize: 20,
        color: theme.colors.textMuted,
        padding: 4,
    },
    reviewerSubtitle: {
        ...theme.typography.bodySecondary,
        color: theme.colors.textSecondary,
        marginBottom: theme.spacing.md,
    },
    reviewerLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        marginBottom: 6,
    },
    reviewerInput: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: r(12),
        backgroundColor: theme.colors.surfaceAlt,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 15,
        color: theme.colors.textPrimary,
        marginBottom: theme.spacing.md,
    },
    reviewerPasswordRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: r(12),
        backgroundColor: theme.colors.surfaceAlt,
        paddingRight: 6,
        marginBottom: theme.spacing.md,
    },
    reviewerPasswordInput: {
        flex: 1,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 15,
        color: theme.colors.textPrimary,
    },
    reviewerShowBtn: {
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    reviewerShowBtnText: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.primary,
    },
    reviewerNote: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginBottom: theme.spacing.md,
    },
    reviewerNoteLink: {
        color: theme.colors.primary,
        fontWeight: '600',
        textDecorationLine: 'underline',
    },
    reviewerSubmitBtn: {
        backgroundColor: theme.colors.primary,
        paddingVertical: 14,
        borderRadius: r(14),
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 50,
    },
    reviewerSubmitBtnText: {
        ...theme.typography.button,
        color: theme.colors.textInverse,
    },
    reviewerCancelBtn: {
        marginTop: 10,
        paddingVertical: 10,
        alignItems: 'center',
    },
    reviewerCancelBtnText: {
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.textSecondary,
    },
});
