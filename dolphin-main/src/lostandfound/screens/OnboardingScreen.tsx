import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Dimensions, Animated, TouchableOpacity, FlatList } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme/theme';

const { width, height } = Dimensions.get('window');

const SLIDES = [
    {
        id: '1',
        title: 'CI Lost & Found',
        description: 'The official Chadwick International lost and found system. Report lost items or help return found ones to their owners.',
        iconName: 'search-outline' as const,
        accentColor: '#10B981',
    },
    {
        id: '2',
        title: 'AI-Powered Tagging',
        description: 'Take a photo of a found item and our AI will automatically analyze it, generating smart tags and descriptions.',
        iconName: 'sparkles-outline' as const,
        accentColor: '#8B5CF6',
    },
    {
        id: '3',
        title: 'Unified Messaging',
        description: 'All Lost & Found conversations appear in your main Dolphin Messages tab, so you never miss a notification.',
        iconName: 'chatbubble-outline' as const,
        accentColor: '#0EA5E9',
    },
    {
        id: '4',
        title: 'Mark as Resolved',
        description: 'Once an item is returned, the post owner can mark it as resolved directly from the chat or detail page.',
        iconName: 'checkmark-circle-outline' as const,
        accentColor: '#059669',
    },
];

export function OnboardingScreen({ navigation, route }: any) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const scrollX = useRef(new Animated.Value(0)).current;
    const slidesRef = useRef<FlatList>(null);
    const buttonScale = useRef(new Animated.Value(1)).current;

    const viewableItemsChanged = useRef(({ viewableItems }: any) => {
        if (viewableItems && viewableItems.length > 0) {
            setCurrentIndex(viewableItems[0].index);
        }
    }).current;

    const viewConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

    const scrollToNext = () => {
        if (currentIndex < SLIDES.length - 1) {
            slidesRef.current?.scrollToIndex({ index: currentIndex + 1 });
        } else {
            completeOnboarding();
        }
    };

    const completeOnboarding = async () => {
        try {
            await AsyncStorage.setItem('@has_onboarded_lf', 'true');
            
            Animated.sequence([
                Animated.timing(buttonScale, { toValue: 0.9, duration: 100, useNativeDriver: true }),
                Animated.timing(buttonScale, { toValue: 1, duration: 100, useNativeDriver: true })
            ]).start(() => {
                if (route.params?.onComplete) {
                    route.params.onComplete();
                }
            });
        } catch (error) {
            console.error('Error saving onboarding state', error);
        }
    };

    const Paginator = ({ data, scrollX: sX }: { data: any[], scrollX: Animated.Value }) => {
        return (
            <View style={styles.paginatorContainer}>
                {data.map((_, i) => {
                    const inputRange = [(i - 1) * width, i * width, (i + 1) * width];

                    const dotWidth = sX.interpolate({
                        inputRange,
                        outputRange: [8, 28, 8],
                        extrapolate: 'clamp',
                    });

                    const opacity = sX.interpolate({
                        inputRange,
                        outputRange: [0.3, 1, 0.3],
                        extrapolate: 'clamp',
                    });

                    return (
                        <Animated.View
                            key={i.toString()}
                            style={[styles.dot, { width: dotWidth, opacity }]}
                        />
                    );
                })}
            </View>
        );
    };

    return (
        <View style={styles.container}>
            <LinearGradient
                colors={['#059669', '#10B981']}
                style={StyleSheet.absoluteFillObject}
            />
            
            {/* Skip button */}
            <TouchableOpacity
                style={styles.skipBtn}
                onPress={completeOnboarding}
                activeOpacity={0.7}
            >
                <Text style={styles.skipText}>Skip</Text>
            </TouchableOpacity>

            <View style={{ flex: 3 }}>
                <FlatList
                    data={SLIDES}
                    renderItem={({ item }) => (
                        <View style={styles.slide}>
                            <View style={styles.iconRing}>
                                <Ionicons name={item.iconName} size={56} color="#fff" />
                            </View>
                            <Text style={styles.title}>{item.title}</Text>
                            <Text style={styles.description}>{item.description}</Text>
                        </View>
                    )}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    pagingEnabled
                    bounces={false}
                    keyExtractor={(item) => item.id}
                    onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
                        useNativeDriver: false,
                    })}
                    onViewableItemsChanged={viewableItemsChanged}
                    viewabilityConfig={viewConfig}
                    ref={slidesRef}
                />
            </View>

            <View style={styles.footer}>
                <Paginator data={SLIDES} scrollX={scrollX} />
                
                <Animated.View style={{ transform: [{ scale: buttonScale }], width: '100%' }}>
                    <TouchableOpacity style={styles.button} onPress={scrollToNext} activeOpacity={0.8}>
                        <Text style={styles.buttonText}>
                            {currentIndex === SLIDES.length - 1 ? "Get Started" : "Next"}
                        </Text>
                        <Ionicons
                            name={currentIndex === SLIDES.length - 1 ? "arrow-forward" : "chevron-forward"}
                            size={20}
                            color="#059669"
                        />
                    </TouchableOpacity>
                </Animated.View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    skipBtn: {
        position: 'absolute',
        top: 60,
        right: 24,
        zIndex: 10,
        paddingVertical: 6,
        paddingHorizontal: 16,
    },
    skipText: {
        color: 'rgba(255,255,255,0.7)',
        fontSize: 15,
        fontWeight: '500',
    },
    slide: {
        width,
        alignItems: 'center',
        paddingHorizontal: 44,
        paddingTop: height * 0.18,
    },
    iconRing: {
        width: 120,
        height: 120,
        borderRadius: 60,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.25)',
        backgroundColor: 'rgba(255,255,255,0.1)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 36,
    },
    title: {
        fontSize: 30,
        fontWeight: '800',
        color: '#FFFFFF',
        marginBottom: 14,
        textAlign: 'center',
        letterSpacing: -0.5,
    },
    description: {
        fontSize: 16,
        color: 'rgba(255,255,255,0.85)',
        textAlign: 'center',
        lineHeight: 24,
        fontWeight: '400',
    },
    footer: {
        flex: 1,
        width: '100%',
        paddingHorizontal: 40,
        justifyContent: 'space-between',
        paddingBottom: 60,
    },
    paginatorContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        height: 40,
        alignItems: 'center',
    },
    dot: {
        height: 6,
        borderRadius: 3,
        backgroundColor: '#FFFFFF',
        marginHorizontal: 4,
    },
    button: {
        backgroundColor: '#FFFFFF',
        paddingVertical: 16,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 10,
        elevation: 5,
    },
    buttonText: {
        color: '#059669',
        fontSize: 17,
        fontWeight: '700',
    },
});
