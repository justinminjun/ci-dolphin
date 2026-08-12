import React, { useRef, useState } from 'react';
import {
    View, Text, StyleSheet, Modal, TouchableOpacity, Image,
    ScrollView, Dimensions, NativeSyntheticEvent, NativeScrollEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_W } = Dimensions.get('window');
// Bounded so the dialog reads as a proper centered modal on wide desktop
// viewports instead of stretching edge-to-edge.
const MODAL_W = Math.min(SCREEN_W - 44, 400);
const CARD_W = MODAL_W;

const TABS = [
    { icon: 'home', color: '#0EA5E9', bg: '#E0F2FE', name: 'Home', desc: "Calendar, lunch menu, weather & today's highlights" },
    { icon: 'chatbubble', color: '#6366F1', bg: '#E0E7FF', name: 'Lounge', desc: 'F&S community board — with the Market inside' },
    { icon: 'map', color: '#10B981', bg: '#D1FAE5', name: 'Local', desc: 'Local Guide — community-recommended places on a map' },
    { icon: 'search', color: '#14B8A6', bg: '#CCFBF1', name: 'Lost & Found', desc: 'Report lost items, AI tags photos automatically' },
    { icon: 'mail', color: '#F59E0B', bg: '#FEF3C7', name: 'Messages', desc: 'All your chats from every corner of the app' },
    { icon: 'person', color: '#EC4899', bg: '#FCE7F3', name: 'My', desc: 'Your posts, saved items & settings' },
] as const;

const SLIDES = [
    {
        image: require('../../assets/onboarding/intro_home.png'),
        accent: '#0EA5E9',
        accentBg: '#E0F2FE',
        title: 'Welcome to the\nnew Dolphin',
        desc: "School life in one app — today's calendar, lunch menu and air quality live right on your Home screen.",
    },
    {
        image: require('../../assets/onboarding/intro_lounge.png'),
        accent: '#F97316',
        accentBg: '#FFF4ED',
        title: 'Market moved into\nF&S Lounge',
        desc: 'The Marketplace now lives inside the Lounge tab — flip between Community and Market at the top. Post, buy and sell in one place.',
    },
    {
        image: require('../../assets/onboarding/intro_local.png'),
        accent: '#10B981',
        accentBg: '#D1FAE5',
        title: 'New: Local Guide',
        desc: 'Places around Songdo recommended by our own community — explore the map, tap Community Picks, and share your favorite spots.',
    },
    {
        image: null,
        accent: '#6366F1',
        accentBg: '#E0E7FF',
        title: 'Find your way around',
        desc: '',
    },
];

interface Props {
    visible: boolean;
    onClose: () => void;
}

export function AppIntro({ visible, onClose }: Props) {
    const [idx, setIdx] = useState(0);
    const idxRef = useRef(0);
    const scrollRef = useRef<ScrollView>(null);

    const setIndex = (n: number) => {
        idxRef.current = n;
        setIdx(n);
    };

    // The paged ScrollView can drift to the last page when the modal's content
    // lays out asynchronously — pin it back to the first slide on open.
    React.useEffect(() => {
        if (visible) {
            setIndex(0);
            const t = setTimeout(() => scrollRef.current?.scrollTo({ x: 0, animated: false }), 50);
            return () => clearTimeout(t);
        }
    }, [visible]);

    const goTo = (next: number) => {
        // animated: true is unreliable on react-native-web here — the scroll
        // position barely moves even though it reports success, leaving the
        // dots/CTA (state-driven) out of sync with the still-unscrolled page.
        scrollRef.current?.scrollTo({ x: next * CARD_W, animated: false });
        setIndex(next);
    };

    const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        setIndex(Math.round(e.nativeEvent.contentOffset.x / CARD_W));
    };

    const isLast = idx === SLIDES.length - 1;
    const slide = SLIDES[idx];

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.scrim}>
                <View style={styles.card}>
                    {/* Header row */}
                    <View style={styles.headerRow}>
                        <View style={[styles.newChip, { backgroundColor: slide.accentBg }]}>
                            <Text style={[styles.newChipText, { color: slide.accent }]}>WHAT'S NEW</Text>
                        </View>
                        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                            <Text style={styles.skipText}>Skip</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Slides */}
                    <ScrollView
                        ref={scrollRef}
                        horizontal
                        pagingEnabled
                        showsHorizontalScrollIndicator={false}
                        onMomentumScrollEnd={onMomentumEnd}
                        contentOffset={{ x: 0, y: 0 }}
                        onContentSizeChange={() => {
                            // Re-layout (image decode etc.) must not move the carousel
                            scrollRef.current?.scrollTo({ x: idxRef.current * CARD_W, animated: false });
                        }}
                        style={{ flexGrow: 0 }}
                    >
                        {SLIDES.map((s, i) => (
                            <View key={i} style={{ width: CARD_W }}>
                                {s.image ? (
                                    <>
                                        <View style={[styles.shotFrame, { backgroundColor: s.accentBg }]}>
                                            <Image source={s.image} style={styles.shot} resizeMode="contain" />
                                        </View>
                                        <Text style={styles.title}>{s.title}</Text>
                                        <Text style={styles.desc}>{s.desc}</Text>
                                    </>
                                ) : (
                                    <>
                                        <Text style={[styles.title, { marginTop: 0 }]}>{s.title}</Text>
                                        <View style={styles.tabList}>
                                            {TABS.map(t => (
                                                <View key={t.name} style={styles.tabRow}>
                                                    <View style={[styles.tabIcon, { backgroundColor: t.bg }]}>
                                                        <Ionicons name={t.icon as any} size={15} color={t.color} />
                                                    </View>
                                                    <View style={{ flex: 1 }}>
                                                        <Text style={styles.tabName}>{t.name}</Text>
                                                        <Text style={styles.tabDesc}>{t.desc}</Text>
                                                    </View>
                                                </View>
                                            ))}
                                        </View>
                                    </>
                                )}
                            </View>
                        ))}
                    </ScrollView>

                    {/* Dots */}
                    <View style={styles.dots}>
                        {SLIDES.map((_, i) => (
                            <View
                                key={i}
                                style={[
                                    styles.dot,
                                    i === idx && [styles.dotActive, { backgroundColor: slide.accent }],
                                ]}
                            />
                        ))}
                    </View>

                    {/* CTA */}
                    <TouchableOpacity
                        style={[styles.cta, { backgroundColor: slide.accent }]}
                        activeOpacity={0.85}
                        onPress={() => (isLast ? onClose() : goTo(idx + 1))}
                    >
                        <Text style={styles.ctaText}>{isLast ? "Let's go" : 'Next'}</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    scrim: {
        flex: 1,
        backgroundColor: 'rgba(15,23,42,0.55)',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 22,
    },
    card: {
        width: MODAL_W,
        backgroundColor: '#fff',
        borderRadius: 26,
        paddingTop: 18,
        paddingBottom: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.25,
        shadowRadius: 30,
        elevation: 12,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        marginBottom: 14,
    },
    newChip: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 9999,
    },
    newChipText: {
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.8,
    },
    skipText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#94A3B8',
    },
    shotFrame: {
        marginHorizontal: 20,
        borderRadius: 20,
        paddingVertical: 14,
        paddingHorizontal: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    shot: {
        width: '100%',
        height: 210,
        borderRadius: 12,
    },
    title: {
        fontSize: 22,
        fontWeight: '900',
        color: '#0F172A',
        letterSpacing: -0.5,
        lineHeight: 28,
        marginTop: 16,
        paddingHorizontal: 20,
    },
    desc: {
        fontSize: 14,
        color: '#64748B',
        lineHeight: 21,
        marginTop: 8,
        paddingHorizontal: 20,
    },
    tabList: {
        paddingHorizontal: 20,
        marginTop: 12,
        gap: 11,
    },
    tabRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
    },
    tabIcon: {
        width: 32,
        height: 32,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
    tabName: {
        fontSize: 13.5,
        fontWeight: '800',
        color: '#0F172A',
    },
    tabDesc: {
        fontSize: 11.5,
        color: '#64748B',
        marginTop: 1,
    },
    dots: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 6,
        marginTop: 16,
    },
    dot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#E2E8F0',
    },
    dotActive: {
        width: 18,
    },
    cta: {
        marginHorizontal: 20,
        marginTop: 14,
        paddingVertical: 14,
        borderRadius: 14,
        alignItems: 'center',
    },
    ctaText: {
        fontSize: 15,
        fontWeight: '800',
        color: '#fff',
    },
});
