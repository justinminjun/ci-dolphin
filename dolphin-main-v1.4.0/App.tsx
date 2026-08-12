import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppNavigator } from './src/navigation/AppNavigator';
import { AuthProvider } from './src/config/AuthContext';
import { GlowProvider, useGlow } from './src/context/GlowContext';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ForceUpdateCheck } from './src/components/ForceUpdateCheck';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';

SplashScreen.preventAutoHideAsync().catch(() => {});

// ─────────────────────────────────────────────────────────────────────────────
// Tune these two values to your liking:
const BORDER_WIDTH   = 5.6;  // thickness of the border line
// On native this rounds the corners to match the physical phone bezel. On web
// there's no bezel to match — a big rounded box just reads as a fake phone
// silhouette, so the glow renders as a slim straight-edge accent line instead.
const BORDER_RADIUS  = Platform.OS === 'web' ? 0 : 61;  // corner curve — higher = curves earlier from straight edge
// ─────────────────────────────────────────────────────────────────────────────

function RootGlowBorder() {
    const { glowColor } = useGlow();

    const fade  = useRef(new Animated.Value(1)).current;
    const [from, setFrom] = useState(glowColor);
    const [to,   setTo  ] = useState(glowColor);
    const prev  = useRef(glowColor);

    useEffect(() => {
        if (glowColor === prev.current) return;
        setTo(glowColor);
        fade.setValue(0);
        Animated.timing(fade, { toValue: 1, duration: 300, useNativeDriver: true })
            .start(() => { setFrom(glowColor); prev.current = glowColor; });
    }, [glowColor]);

    const fromOp = fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
    const toOp   = fade.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

    // Push border outward by half its width so the LINE CENTER sits on screen edge.
    // The outer half bleeds off-screen (hidden by phone bezel), inner half is visible.
    // This guarantees content can never appear outside the border.
    const half = BORDER_WIDTH / 2;
    const borderStyle = (color: string) => ({
        position: 'absolute' as const,
        top: -half, left: -half, right: -half, bottom: -half,
        borderWidth: BORDER_WIDTH,
        borderColor: color,
        borderRadius: BORDER_RADIUS + half,   // compensate for the outward shift
    });

    return (
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
            <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: fromOp }]} pointerEvents="none">
                <View pointerEvents="none" style={borderStyle(from)} />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: toOp }]} pointerEvents="none">
                <View pointerEvents="none" style={borderStyle(to)} />
            </Animated.View>
        </View>
    );
}

export default function App() {
    useEffect(() => {
        SplashScreen.hideAsync().catch(() => {});
    }, []);

    return (
        <View style={styles.shell}>
            <StatusBar style="dark" translucent backgroundColor="transparent" />
            <SafeAreaProvider>
                <GlowProvider>
                    {/* Clip content to border's INNER edge = BORDER_RADIUS - half */}
                <View style={[styles.root, { borderRadius: Math.max(0, BORDER_RADIUS - BORDER_WIDTH / 2), overflow: 'hidden' }]}>
                        <ForceUpdateCheck>
                            <AuthProvider>
                                <GestureHandlerRootView style={styles.root}>
                                    <AppNavigator />
                                </GestureHandlerRootView>
                            </AuthProvider>
                        </ForceUpdateCheck>
                    </View>
                    <RootGlowBorder />
                </GlowProvider>
            </SafeAreaProvider>
        </View>
    );
}

const styles = StyleSheet.create({
    shell: { flex: 1, backgroundColor: '#000000' },   // ← black kills any white bleed (native only; full-bleed on web means this rarely shows)
    root: { flex: 1, backgroundColor: '#061C34' },
});
