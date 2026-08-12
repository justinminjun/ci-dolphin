import React, { useEffect, useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Dimensions,
    ScrollView, Image, ImageBackground,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { theme, r } from '../theme/theme';
import { db } from '../config/firebase';
import { collection, query, onSnapshot, where } from 'firebase/firestore';

const SCREEN_WIDTH = Dimensions.get('window').width;

// Local guide category definitions
const LOCAL_CATEGORIES = [
    {
        key: 'restaurant',
        label: 'Restaurants',
        labelKo: '맛집 추천',
        icon: 'restaurant' as const,
        gradient: ['#F43F5E', '#FB7185'] as [string, string],
    },
    {
        key: 'tips',
        label: 'Local Tips',
        labelKo: '지역 꿀팁',
        icon: 'bulb' as const,
        gradient: ['#F59E0B', '#FBBF24'] as [string, string],
    },
    {
        key: 'shops',
        label: 'Local Shops',
        labelKo: '상가 추천',
        icon: 'storefront' as const,
        gradient: ['#8B5CF6', '#A78BFA'] as [string, string],
    },
    {
        key: 'hospital',
        label: 'Medical',
        labelKo: '병원 · 약국',
        icon: 'medkit' as const,
        gradient: ['#10B981', '#34D399'] as [string, string],
    },
    {
        key: 'vet',
        label: 'Pet & Vet',
        labelKo: '동물병원',
        icon: 'paw' as const,
        gradient: ['#06B6D4', '#22D3EE'] as [string, string],
    },
    {
        key: 'cafe',
        label: 'Cafés',
        labelKo: '카페 추천',
        icon: 'cafe' as const,
        gradient: ['#D97706', '#F59E0B'] as [string, string],
    },
    {
        key: 'kids',
        label: 'Kids & Family',
        labelKo: '키즈 · 가족',
        icon: 'people' as const,
        gradient: ['#EC4899', '#F472B6'] as [string, string],
    },
    {
        key: 'shopping',
        label: 'Shopping & Essentials',
        labelKo: '쇼핑 · 생필품',
        icon: 'bag-handle' as const,
        gradient: ['#6366F1', '#818CF8'] as [string, string],
    },
    {
        key: 'hiking',
        label: 'Hiking',
        labelKo: '등산 · 트레킹',
        icon: 'walk' as const,
        gradient: ['#65A30D', '#A3E635'] as [string, string],
    },
    {
        key: 'fitness',
        label: 'Fitness',
        labelKo: '운동 · 헬스',
        icon: 'barbell' as const,
        gradient: ['#0EA5E9', '#38BDF8'] as [string, string],
    },
    {
        key: 'learning',
        label: 'Learning & Hobbies',
        labelKo: '배움 · 취미',
        icon: 'book' as const,
        gradient: ['#0D9488', '#2DD4BF'] as [string, string],
    },
    {
        key: 'selfcare',
        label: 'Pamper & Self-care',
        labelKo: '뷰티 · 셀프케어',
        icon: 'water' as const,
        gradient: ['#C026D3', '#E879F9'] as [string, string],
    },
];

// Cuisine sub-types for the Restaurants category.
// Auto-classified by AI when a restaurant is posted — no manual picker.
export const CUISINES = [
    { key: 'korean',     label: 'Korean',         emoji: '🇰🇷' },
    { key: 'bunsik',     label: 'Bunsik',         emoji: '🍢' },
    { key: 'japanese',   label: 'Japanese',       emoji: '🍣' },
    { key: 'chinese',    label: 'Chinese',        emoji: '🥟' },
    { key: 'western',    label: 'Western',        emoji: '🍝' },
    { key: 'burger',     label: 'Burgers',        emoji: '🍔' },
    { key: 'pizza',      label: 'Pizza',          emoji: '🍕' },
    { key: 'chicken',    label: 'Chicken',        emoji: '🍗' },
    { key: 'bbq',        label: 'BBQ & Grill',    emoji: '🥩' },
    { key: 'vietnamese', label: 'Vietnamese',     emoji: '🍜' },
    { key: 'thai',       label: 'Thai',           emoji: '🥡' },
    { key: 'indian',     label: 'Indian',         emoji: '🍛' },
    { key: 'mexican',    label: 'Mexican',        emoji: '🌮' },
    { key: 'cafe',       label: 'Café & Dessert', emoji: '🍰' },
    { key: 'vegetarian', label: 'Vegetarian',     emoji: '🥗' },
    { key: 'fusion',     label: 'Fusion',         emoji: '🥘' },
    { key: 'other',      label: 'Other',          emoji: '🍽️' },
];

export const cuisineLabel = (key?: string | null) => {
    if (!key) return null;
    const c = CUISINES.find(c => c.key === key);
    return c ? `${c.emoji} ${c.label}` : null;
};

// Group into columns of 2 for the 2-row horizontal layout
function chunkPairs<T>(arr: T[]): [T, T | null][] {
    const result: [T, T | null][] = [];
    for (let i = 0; i < arr.length; i += 2) {
        result.push([arr[i], arr[i + 1] ?? null]);
    }
    return result;
}

interface LocalGuideCardsProps {
    onCategoryPress: (category: typeof LOCAL_CATEGORIES[0]) => void;
    onSeeAllPress?: () => void;
}

export function LocalGuideCards({ onCategoryPress, onSeeAllPress }: LocalGuideCardsProps) {
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [thumbs, setThumbs] = useState<Record<string, string>>({});

    useEffect(() => {
        const unsubs: (() => void)[] = [];
        LOCAL_CATEGORIES.forEach(cat => {
            // Count listener
            const qCount = query(
                collection(db, 'local_recommendations'),
                where('category', '==', cat.key),
            );
            unsubs.push(onSnapshot(qCount, snap => {
                setCounts(prev => ({ ...prev, [cat.key]: snap.size }));
            }, () => {}));

            // Photo: reuse the same query (no orderBy needed)
            const qPhoto = query(
                collection(db, 'local_recommendations'),
                where('category', '==', cat.key),
            );
            unsubs.push(onSnapshot(qPhoto, snap => {
                // Find the most recent doc with a photo
                const docsWithPhoto = snap.docs
                    .filter(d => d.data().photo)
                    .sort((a, b) => (b.data().createdAt?.seconds || 0) - (a.data().createdAt?.seconds || 0));
                if (docsWithPhoto.length > 0) {
                    setThumbs(prev => ({ ...prev, [cat.key]: docsWithPhoto[0].data().photo }));
                }
            }, () => {}));
        });
        return () => unsubs.forEach(u => u());
    }, []);

    const CARD_WIDTH = (SCREEN_WIDTH - 48) / 2.15;
    const CARD_HEIGHT = CARD_WIDTH * 0.58;
    const columns = chunkPairs(LOCAL_CATEGORIES);

    const renderCard = (cat: typeof LOCAL_CATEGORIES[0]) => {
        const thumb = thumbs[cat.key];

        const cardInner = (
            <LinearGradient
                colors={thumb
                    ? [`${cat.gradient[0]}CC`, `${cat.gradient[1]}99`]
                    : cat.gradient
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.cardGradient}
            >
                <View style={styles.cardIconWrap}>
                    <Ionicons name={cat.icon} size={16} color="rgba(255,255,255,0.95)" />
                </View>
                <View style={styles.cardTextArea}>
                    <Text style={styles.cardLabel} numberOfLines={1}>{cat.label}</Text>
                    <Text style={styles.cardLabelKo}>{cat.labelKo}</Text>
                </View>
                {(counts[cat.key] ?? 0) > 0 && (
                    <View style={styles.countBadge}>
                        <Text style={styles.countText}>{counts[cat.key]}</Text>
                    </View>
                )}
            </LinearGradient>
        );

        return (
            <TouchableOpacity
                key={cat.key}
                activeOpacity={0.85}
                onPress={() => onCategoryPress(cat)}
                style={[styles.card, { width: CARD_WIDTH, height: CARD_HEIGHT }]}
            >
                {thumb ? (
                    <ImageBackground
                        source={{ uri: thumb }}
                        style={styles.cardBg}
                        imageStyle={styles.cardBgImage}
                    >
                        {cardInner}
                    </ImageBackground>
                ) : cardInner}
            </TouchableOpacity>
        );
    };

    return (
        <View style={styles.container}>
            <View style={styles.headerRow}>
                <View>
                    <Text style={styles.sectionTitle}>Local Guide</Text>
                    <Text style={styles.sectionSubtitle}>송도 지역 추천</Text>
                </View>
            </View>

            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
                decelerationRate="fast"
                snapToInterval={CARD_WIDTH + 10}
            >
                {columns.map((pair, idx) => (
                    <View key={idx} style={[styles.column, { gap: 8 }]}>
                        {renderCard(pair[0])}
                        {pair[1] && renderCard(pair[1])}
                    </View>
                ))}
            </ScrollView>
        </View>
    );
}

export { LOCAL_CATEGORIES };

const styles = StyleSheet.create({
    container: {
        paddingTop: 16,
        paddingBottom: 8,
        backgroundColor: theme.colors.surface,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        marginBottom: 12,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: '800',
        color: theme.colors.textPrimary,
        letterSpacing: -0.3,
    },
    sectionSubtitle: {
        fontSize: 12,
        color: theme.colors.textMuted,
        marginTop: 2,
    },
    scrollContent: {
        paddingLeft: 16,
        paddingRight: 40,
        gap: 10,
    },
    column: {
        flexDirection: 'column',
    },
    card: {
        borderRadius: r(14),
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 6,
        elevation: 4,
    },
    cardGradient: {
        flex: 1,
        padding: 11,
        justifyContent: 'space-between',
    },
    cardBg: {
        flex: 1,
    },
    cardBgImage: {
        borderRadius: r(14),
    },
    cardIconWrap: {
        width: 28,
        height: 28,
        borderRadius: 8,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    cardTextArea: {
        marginTop: 'auto',
    },
    cardLabel: {
        fontSize: 13,
        fontWeight: '700',
        color: '#fff',
    },
    cardLabelKo: {
        fontSize: 10,
        fontWeight: '500',
        color: 'rgba(255,255,255,0.8)',
        marginTop: 1,
    },
    countBadge: {
        position: 'absolute',
        top: 8,
        right: 8,
        backgroundColor: 'rgba(255,255,255,0.25)',
        borderRadius: 10,
        paddingHorizontal: 7,
        paddingVertical: 2,
    },
    countText: {
        fontSize: 10,
        fontWeight: '700',
        color: '#fff',
    },
});
