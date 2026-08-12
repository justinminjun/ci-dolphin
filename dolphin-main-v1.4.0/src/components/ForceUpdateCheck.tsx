import React, { useEffect, useState, useRef } from 'react';
import {
    View, Text, Modal, StyleSheet, TouchableOpacity,
    Linking, Platform, ActivityIndicator, Animated, Dimensions, Image,
} from 'react-native';
import { db } from '../config/firebase';
import { doc, getDoc } from 'firebase/firestore';
import Constants from 'expo-constants';
import { r } from '../theme/theme';

const { width: SW } = Dimensions.get('window');
const APP_STORE_URL = 'https://apps.apple.com/app/id6763223607';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.chadwick.dolphin';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const APP_ICON = require('../../assets/icon.png');

function compareVersions(current: string, minimum: string): number {
    const a = current.split('.').map(Number);
    const b = minimum.split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const av = a[i] || 0;
        const bv = b[i] || 0;
        if (av < bv) return -1;
        if (av > bv) return 1;
    }
    return 0;
}

export function ForceUpdateCheck({ children }: { children: React.ReactNode }) {
    const [needsUpdate, setNeedsUpdate] = useState(false);
    const [loading, setLoading] = useState(true);
    const [updateMessage, setUpdateMessage] = useState('');
    const [newVersion, setNewVersion] = useState('');

    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(40)).current;

    useEffect(() => {
        checkForUpdate();
    }, []);

    useEffect(() => {
        if (needsUpdate) {
            Animated.parallel([
                Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
                Animated.spring(slideAnim, { toValue: 0, tension: 65, friction: 12, useNativeDriver: true }),
            ]).start();
        }
    }, [needsUpdate]);

    const checkForUpdate = async () => {
        try {
            if (__DEV__) {
                setLoading(false);
                return;
            }

            const configDoc = await getDoc(doc(db, 'app_config', 'version'));
            if (!configDoc.exists()) {
                setLoading(false);
                return;
            }

            const data = configDoc.data();
            const minVersion = data.minimumVersion || '1.0.0';
            const message = data.updateMessage || '';
            const currentVersion = Constants.expoConfig?.version || '1.0.0';

            if (compareVersions(currentVersion, minVersion) < 0) {
                setNeedsUpdate(true);
                setUpdateMessage(message);
                setNewVersion(data.latestVersion || minVersion);
            }
        } catch (e) {
            console.log('Version check failed:', e);
        }
        setLoading(false);
    };

    const openStore = () => {
        const url = Platform.OS === 'ios' ? APP_STORE_URL : PLAY_STORE_URL;
        Linking.openURL(url).catch(() => {});
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <Image source={APP_ICON} style={styles.loadingIcon} />
                <ActivityIndicator size="small" color="#94A3B8" style={{ marginTop: 20 }} />
            </View>
        );
    }

    const currentVersion = Constants.expoConfig?.version || '1.0.0';

    return (
        <>
            {children}
            <Modal visible={needsUpdate} transparent={false} animationType="none">
                <View style={styles.container}>
                    <Animated.View style={[
                        styles.content,
                        {
                            opacity: fadeAnim,
                            transform: [{ translateY: slideAnim }],
                        }
                    ]}>
                        {/* App Icon */}
                        <Image source={APP_ICON} style={styles.appIcon} />

                        {/* App Name */}
                        <Text style={styles.appName}>Dolphin</Text>

                        {/* Version info */}
                        <Text style={styles.versionText}>
                            Version {newVersion || '?.?.?'} is available
                        </Text>

                        {/* Message */}
                        {updateMessage ? (
                            <Text style={styles.message}>{updateMessage}</Text>
                        ) : null}

                        {/* Update Button */}
                        <TouchableOpacity style={styles.updateBtn} onPress={openStore} activeOpacity={0.8}>
                            <Text style={styles.updateBtnText}>Update</Text>
                        </TouchableOpacity>

                        {/* Current version */}
                        <Text style={styles.currentVersion}>
                            Your version: {currentVersion}
                        </Text>
                    </Animated.View>

                    {/* Bottom */}
                    <Animated.View style={[styles.footer, { opacity: fadeAnim }]}>
                        <Text style={styles.footerText}>
                            Please update to continue using Dolphin.
                        </Text>
                    </Animated.View>
                </View>
            </Modal>
        </>
    );
}

const styles = StyleSheet.create({
    loadingContainer: {
        flex: 1,
        backgroundColor: '#FFFFFF',
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingIcon: {
        width: 64,
        height: 64,
        borderRadius: r(14),
    },
    container: {
        flex: 1,
        backgroundColor: '#FFFFFF',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
    },
    content: {
        alignItems: 'center',
        width: '100%',
    },

    // App Icon
    appIcon: {
        width: 100,
        height: 100,
        borderRadius: r(22),
        marginBottom: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
    },

    // App Name
    appName: {
        fontSize: 24,
        fontWeight: '800',
        color: '#0F172A',
        marginBottom: 6,
    },

    // Version
    versionText: {
        fontSize: 15,
        fontWeight: '500',
        color: '#64748B',
        marginBottom: 8,
    },

    // Message
    message: {
        fontSize: 14,
        color: '#94A3B8',
        textAlign: 'center',
        lineHeight: 20,
        marginBottom: 8,
        maxWidth: 260,
    },

    // Update button - App Store style
    updateBtn: {
        backgroundColor: '#007AFF',
        paddingHorizontal: 52,
        paddingVertical: 14,
        borderRadius: r(24),
        marginTop: 24,
        marginBottom: 16,
    },
    updateBtnText: {
        fontSize: 17,
        fontWeight: '700',
        color: '#FFFFFF',
    },

    // Current version
    currentVersion: {
        fontSize: 12,
        color: '#CBD5E1',
        fontWeight: '500',
    },

    // Footer
    footer: {
        position: 'absolute',
        bottom: 50,
    },
    footerText: {
        fontSize: 13,
        color: '#94A3B8',
        textAlign: 'center',
    },
});
