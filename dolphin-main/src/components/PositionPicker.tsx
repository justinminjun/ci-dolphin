import React, { useState } from 'react';
import { View, Text, StyleSheet, Dimensions, PanResponder, Clipboard, Alert, TouchableOpacity, Platform } from 'react-native';

const { width: SW, height: SH } = Dimensions.get('window');

/**
 * DEBUG TOOL: Overlay this on any screen to find exact spotlight target coordinates.
 * 
 * Usage: Wrap your screen's root View content:
 *   import { PositionPicker } from '../components/PositionPicker';
 *   // In render:
 *   <PositionPicker enabled={true}>
 *     {/* ...your screen content... *\/}
 *   </PositionPicker>
 * 
 * Tap anywhere → shows (x, y) coordinate
 * Drag to draw a rectangle → shows { x, y, width, height }
 * Tap "Copy" to copy the target object to clipboard
 */
export function PositionPicker({ children, enabled = false }: { children: React.ReactNode; enabled?: boolean }) {
    const [start, setStart] = useState<{ x: number; y: number } | null>(null);
    const [end, setEnd] = useState<{ x: number; y: number } | null>(null);
    const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
    const [tapPoint, setTapPoint] = useState<{ x: number; y: number } | null>(null);

    const panResponder = PanResponder.create({
        onStartShouldSetPanResponder: () => enabled,
        onMoveShouldSetPanResponder: () => enabled,
        onPanResponderGrant: (e) => {
            const { pageX, pageY } = e.nativeEvent;
            setStart({ x: Math.round(pageX), y: Math.round(pageY) });
            setEnd(null);
            setRect(null);
            setTapPoint({ x: Math.round(pageX), y: Math.round(pageY) });
        },
        onPanResponderMove: (e) => {
            const { pageX, pageY } = e.nativeEvent;
            setEnd({ x: Math.round(pageX), y: Math.round(pageY) });
            setTapPoint(null);
            if (start) {
                const x = Math.min(start.x, Math.round(pageX));
                const y = Math.min(start.y, Math.round(pageY));
                const w = Math.abs(Math.round(pageX) - start.x);
                const h = Math.abs(Math.round(pageY) - start.y);
                if (w > 5 || h > 5) setRect({ x, y, w, h });
            }
        },
        onPanResponderRelease: () => {},
    });

    const copyTarget = () => {
        const str = rect
            ? `{ x: ${rect.x}, y: ${rect.y}, width: ${rect.w}, height: ${rect.h} }`
            : tapPoint
            ? `{ x: ${tapPoint.x}, y: ${tapPoint.y}, width: 100, height: 48 }`
            : '';
        if (str) {
            Clipboard.setString(str);
            Alert.alert('Copied!', str);
        }
    };

    if (!enabled) return <>{children}</>;

    return (
        <View style={{ flex: 1 }}>
            {children}
            <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers} pointerEvents="box-only">
                {/* Rectangle highlight */}
                {rect && (
                    <View style={[styles.rectHighlight, {
                        left: rect.x, top: rect.y, width: rect.w, height: rect.h,
                    }]} />
                )}
                {/* Tap point */}
                {tapPoint && (
                    <View style={[styles.tapDot, { left: tapPoint.x - 8, top: tapPoint.y - 8 }]} />
                )}
            </View>

            {/* Info bar */}
            <View style={styles.infoBar}>
                <Text style={styles.infoText}>
                    {rect
                        ? `x:${rect.x} y:${rect.y} w:${rect.w} h:${rect.h}`
                        : tapPoint
                        ? `x:${tapPoint.x} y:${tapPoint.y}`
                        : `Tap or drag to pick position`}
                </Text>
                <TouchableOpacity style={styles.copyBtn} onPress={copyTarget}>
                    <Text style={styles.copyText}>Copy</Text>
                </TouchableOpacity>
            </View>

            {/* Crosshair lines */}
            {(tapPoint || end) && (
                <>
                    <View style={[styles.hLine, { top: (tapPoint || end)!.y }]} />
                    <View style={[styles.vLine, { left: (tapPoint || end)!.x }]} />
                </>
            )}

            {/* Screen size label */}
            <View style={styles.sizeLabel}>
                <Text style={styles.sizeText}>Screen: {SW}×{SH}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    rectHighlight: {
        position: 'absolute',
        borderWidth: 2, borderColor: '#FF3B30', borderStyle: 'dashed',
        backgroundColor: 'rgba(255,59,48,0.15)',
    },
    tapDot: {
        position: 'absolute', width: 16, height: 16, borderRadius: 8,
        backgroundColor: '#FF3B30', borderWidth: 2, borderColor: '#fff',
    },
    infoBar: {
        position: 'absolute', bottom: 100, left: 20, right: 20,
        backgroundColor: 'rgba(0,0,0,0.85)', borderRadius: 12,
        paddingHorizontal: 16, paddingVertical: 10,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        zIndex: 10000,
    },
    infoText: { color: '#0F0', fontSize: 14, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontWeight: '600' },
    copyBtn: { backgroundColor: '#0EA5E9', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
    copyText: { color: '#fff', fontSize: 13, fontWeight: '700' },
    hLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,59,48,0.5)' },
    vLine: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,59,48,0.5)' },
    sizeLabel: {
        position: 'absolute', top: Platform.OS === 'ios' ? 54 : 24, left: 16,
        backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
        zIndex: 10000,
    },
    sizeText: { color: '#aaa', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
