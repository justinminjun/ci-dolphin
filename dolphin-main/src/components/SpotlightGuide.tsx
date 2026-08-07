import React, { useState, useEffect, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Dimensions,
    Platform, Pressable,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

const { width: SW, height: SH } = Dimensions.get('window');

export interface SpotlightStep {
    target: { x: number; y: number; width: number; height: number } | null;
    title: string;
    description: string;
    tooltipPosition?: 'top' | 'bottom' | 'center';
    borderRadius?: number;
}

interface Props {
    storageKey: string;
    steps: SpotlightStep[];
    onDismiss?: () => void;
    visible?: boolean;
}

export function SpotlightGuide({ storageKey, steps, onDismiss, visible }: Props) {
    const [currentStep, setCurrentStep] = useState(0);
    const [show, setShow] = useState(false);

    useEffect(() => {
        if (visible !== undefined) {
            if (visible) { setCurrentStep(0); setShow(true); }
            else { setShow(false); }
            return;
        }
        AsyncStorage.getItem(storageKey).then(val => {
            if (val === null) setTimeout(() => setShow(true), 500);
        });
    }, [storageKey, visible]);

    const dismiss = useCallback(async (dontShowAgain: boolean) => {
        if (dontShowAgain) await AsyncStorage.setItem(storageKey, 'true');
        setShow(false);
        onDismiss?.();
    }, [storageKey]);

    const nextStep = () => {
        if (currentStep < steps.length - 1) setCurrentStep(prev => prev + 1);
        else dismiss(true);
    };

    const prevStep = () => {
        if (currentStep > 0) setCurrentStep(prev => prev - 1);
    };

    if (!show || steps.length === 0) return null;

    const step = steps[currentStep];
    const isFullscreen = step.target === null;
    const pad = 6;
    const br = step.borderRadius ?? 16;
    const t = step.target || { x: 0, y: 0, width: 0, height: 0 };
    const cutX = t.x - pad;
    const cutY = t.y - pad;
    const cutW = t.width + pad * 2;
    const cutH = t.height + pad * 2;

    const tooltipPos = step.tooltipPosition || (isFullscreen ? 'center' : (cutY > SH * 0.5 ? 'top' : 'bottom'));
    const tooltipStyle: any = { left: 24, right: 24 };
    if (tooltipPos === 'center') tooltipStyle.top = SH * 0.3;
    else if (tooltipPos === 'bottom') tooltipStyle.top = cutY + cutH + 16;
    else tooltipStyle.bottom = SH - cutY + 16;

    return (
        <View style={styles.container}>
            {/* Dark overlay pieces — each one blocks touch on its own area */}
            {isFullscreen ? (
                <Pressable style={[styles.dark, { top: 0, left: 0, right: 0, bottom: 0 }]} />
            ) : (
                <>
                    <Pressable style={[styles.dark, { top: 0, left: 0, right: 0, height: Math.max(0, cutY) }]} />
                    <Pressable style={[styles.dark, { top: cutY + cutH, left: 0, right: 0, bottom: 0 }]} />
                    <Pressable style={[styles.dark, { top: cutY, left: 0, width: Math.max(0, cutX), height: cutH }]} />
                    <Pressable style={[styles.dark, { top: cutY, left: cutX + cutW, right: 0, height: cutH }]} />
                    <View style={[styles.border, {
                        top: cutY - 2, left: cutX - 2,
                        width: cutW + 4, height: cutH + 4,
                        borderRadius: br + pad,
                    }]} />
                </>
            )}

            {/* Tooltip card — buttons work because it's a sibling, not a child of touch blocker */}
            <View style={[styles.card, tooltipStyle]}>
                <Text style={styles.title}>{step.title}</Text>
                <Text style={styles.desc}>{step.description}</Text>
                <View style={styles.dots}>
                    {steps.map((_, i) => (
                        <View key={i} style={[styles.dot, i === currentStep && styles.dotActive]} />
                    ))}
                </View>
                <View style={styles.btnRow}>
                    {currentStep > 0 && (
                        <TouchableOpacity style={styles.backBtn} onPress={prevStep} activeOpacity={0.7}>
                            <Ionicons name="chevron-back" size={16} color="#64748B" />
                            <Text style={styles.backText}>Back</Text>
                        </TouchableOpacity>
                    )}
                    <View style={{ flex: 1 }} />
                    <TouchableOpacity style={styles.nextBtn} onPress={nextStep} activeOpacity={0.7}>
                        <Text style={styles.nextText}>
                            {currentStep === steps.length - 1 ? 'Got it!' : 'Next'}
                        </Text>
                        <Ionicons
                            name={currentStep === steps.length - 1 ? 'checkmark' : 'chevron-forward'}
                            size={16} color="#fff"
                        />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Skip */}
            <TouchableOpacity style={styles.skip} onPress={() => dismiss(true)} activeOpacity={0.7}>
                <Ionicons name="eye-off-outline" size={14} color="rgba(255,255,255,0.6)" />
                <Text style={styles.skipText}>Don't show again</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { ...StyleSheet.absoluteFillObject, zIndex: 9999, elevation: 9999 },
    dark: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.72)' },
    border: { position: 'absolute', borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.6)' },
    card: {
        position: 'absolute', backgroundColor: '#fff', borderRadius: 20,
        paddingHorizontal: 22, paddingVertical: 20,
        shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25, shadowRadius: 20, elevation: 15,
        zIndex: 10000,
    },
    title: { fontSize: 20, fontWeight: '800', color: '#0F172A', marginBottom: 8 },
    desc: { fontSize: 15, color: '#475569', lineHeight: 22, marginBottom: 16 },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 16 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#E2E8F0' },
    dotActive: { width: 20, backgroundColor: '#0EA5E9' },
    btnRow: { flexDirection: 'row', alignItems: 'center' },
    backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 12 },
    backText: { fontSize: 14, color: '#64748B', fontWeight: '600' },
    nextBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: '#0EA5E9', paddingVertical: 11, paddingHorizontal: 22, borderRadius: 14,
    },
    nextText: { fontSize: 15, color: '#fff', fontWeight: '700' },
    skip: {
        position: 'absolute', top: Platform.OS === 'ios' ? 58 : 30, right: 20,
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: 'rgba(0,0,0,0.5)', paddingVertical: 8, paddingHorizontal: 14,
        borderRadius: 20, zIndex: 10000,
    },
    skipText: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '500' },
});
