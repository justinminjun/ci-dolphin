import React, { useEffect, useState, useMemo } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Dimensions, ScrollView,
    ActivityIndicator, Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { theme, r } from '../theme/theme';
import { db } from '../config/firebase';
import { collection, query, where, orderBy, onSnapshot, doc, getDoc } from 'firebase/firestore';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_PADDING = 16;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Menu category config
const MSUS_CATEGORIES = [
    { key: 'korean', label: 'Korean', flag: '🇰🇷', ionicon: null as any, gradient: ['#4338CA', '#6366F1'] },
    { key: 'international', label: 'International', ionicon: 'globe-outline' as const, gradient: ['#4338CA', '#6366F1'] },
    { key: 'pasta', label: 'Pasta & Noodle', ionicon: 'restaurant-outline' as const, gradient: ['#4338CA', '#6366F1'] },
    { key: 'vegetarian', label: 'Vegetarian & Salad', ionicon: 'leaf-outline' as const, gradient: ['#4338CA', '#6366F1'] },
    { key: 'protein', label: 'Protein & In the Box', ionicon: 'cube-outline' as const, gradient: ['#4338CA', '#6366F1'] },
];

const VS_CATEGORIES = [
    { key: 'korean', label: 'Korean', flag: '🇰🇷', ionicon: null as any, gradient: ['#4338CA', '#6366F1'] },
    { key: 'international', label: 'International', ionicon: 'globe-outline' as const, gradient: ['#4338CA', '#6366F1'] },
    { key: 'inTheBox', label: 'In the Box', ionicon: 'cube-outline' as const, gradient: ['#4338CA', '#6366F1'] },
];

const PKK_CATEGORIES = [
    { key: 'lunch', label: 'PK/K Lunch', ionicon: 'happy-outline' as const, gradient: ['#4338CA', '#6366F1'] },
];

type SchoolLevel = 'MS/US' | 'VS' | 'PK/K';

function getToday(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getWeekDates(): string[] {
    const now = new Date();
    const day = now.getDay(); // 0=Sun, 1=Mon, ...
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1)); // Go to Monday

    const dates: string[] = [];
    for (let i = 0; i < 5; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    return dates;
}

interface MenuData {
    date: string;
    dayOfWeek: string;
    holiday?: boolean;
    msus?: Record<string, { items: string[]; itemsKo?: string[] }> | null;
    vs?: Record<string, { items: string[]; itemsKo?: string[] }> | null;
    pkk?: Record<string, { items: string[]; itemsKo?: string[] }> | null;
}

export function LunchMenuWidget({ compact = false }: { compact?: boolean }) {
    const [menus, setMenus] = useState<Record<string, MenuData>>({});
    const [loading, setLoading] = useState(true);
    const [selectedLevel, setSelectedLevel] = useState<SchoolLevel>('MS/US');
    const [selectedDate, setSelectedDate] = useState(getToday());
    const [showFullMenu, setShowFullMenu] = useState(false);

    const weekDates = useMemo(() => getWeekDates(), []);
    const todayStr = getToday();

    useEffect(() => {
        // Fetch this week's menus
        const dates = getWeekDates();
        const unsubscribers: (() => void)[] = [];

        let loaded = 0;
        dates.forEach(dateStr => {
            const unsub = onSnapshot(doc(db, 'lunch_menus', dateStr), (snap) => {
                if (snap.exists()) {
                    setMenus(prev => ({ ...prev, [dateStr]: snap.data() as MenuData }));
                }
                loaded++;
                if (loaded >= dates.length) setLoading(false);
            }, () => {
                loaded++;
                if (loaded >= dates.length) setLoading(false);
            });
            unsubscribers.push(unsub);
        });

        return () => unsubscribers.forEach(u => u());
    }, []);

    const todayMenu = menus[todayStr];
    const selectedMenu = menus[selectedDate];

    const categories = selectedLevel === 'MS/US' ? MSUS_CATEGORIES
        : selectedLevel === 'VS' ? VS_CATEGORIES
            : PKK_CATEGORIES;

    const menuData = selectedLevel === 'MS/US' ? selectedMenu?.msus
        : selectedLevel === 'VS' ? selectedMenu?.vs
            : selectedMenu?.pkk;

    // Compact widget data
    const todayCategories = selectedLevel === 'MS/US' ? MSUS_CATEGORIES
        : selectedLevel === 'VS' ? VS_CATEGORIES : PKK_CATEGORIES;
    const todayMenuData = selectedLevel === 'MS/US' ? todayMenu?.msus
        : selectedLevel === 'VS' ? todayMenu?.vs : todayMenu?.pkk;

    const todayDayName = SHORT_DAYS[new Date().getDay()];
    const todayDate = new Date().getDate();
    const todayMonthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][new Date().getMonth()];

    // Shared modal
    const fullMenuModal = (
        <Modal visible={showFullMenu} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowFullMenu(false)}>
            <View style={styles.modalContainer}>
                <LinearGradient
                    colors={['#F97316', '#FB923C']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.modalHeader}
                >
                    <View>
                        <Text style={styles.modalTitle}>Lunch Menu</Text>
                        <Text style={styles.modalSubtitle}>Chadwick International Cafeteria</Text>
                    </View>
                    <TouchableOpacity onPress={() => setShowFullMenu(false)} style={styles.closeBtn}>
                        <Ionicons name="close" size={20} color="#F97316" />
                    </TouchableOpacity>
                </LinearGradient>

                <View style={styles.daySelector}>
                    {weekDates.map((dateStr, i) => {
                        const d = new Date(dateStr + 'T00:00:00');
                        const isSelected = dateStr === selectedDate;
                        const isToday = dateStr === todayStr;
                        const hasMenu = !!menus[dateStr];
                        return (
                            <TouchableOpacity
                                key={dateStr}
                                style={[styles.dayBtn, isSelected && styles.dayBtnSelected]}
                                onPress={() => setSelectedDate(dateStr)}
                            >
                                <Text style={[styles.dayBtnDay, isSelected && styles.dayBtnDaySelected]}>
                                    {SHORT_DAYS[d.getDay()]}
                                </Text>
                                <Text style={[styles.dayBtnNum, isSelected && styles.dayBtnNumSelected]}>
                                    {d.getDate()}
                                </Text>
                                {isToday && !isSelected && <View style={styles.todayDotSmall} />}
                                {!hasMenu && <View style={styles.noMenuDot} />}
                            </TouchableOpacity>
                        );
                    })}
                </View>

                <View style={styles.levelTabs}>
                    {(['MS/US', 'VS', 'PK/K'] as SchoolLevel[]).map(level => (
                        <TouchableOpacity
                            key={level}
                            style={[styles.levelTab, selectedLevel === level && styles.levelTabActive]}
                            onPress={() => setSelectedLevel(level)}
                        >
                            <Text style={[styles.levelTabText, selectedLevel === level && styles.levelTabTextActive]}>
                                {level}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>

                <ScrollView showsVerticalScrollIndicator={false} style={styles.menuScroll}>
                    {selectedMenu?.holiday ? (
                        <View style={styles.noMenuModal}>
                            <Ionicons name="sunny-outline" size={48} color="#CBD5E0" />
                            <Text style={styles.noMenuModalTitle}>Cafeteria Closed</Text>
                            <Text style={styles.noMenuModalSub}>
                                No school cafeteria service on this day.
                            </Text>
                        </View>
                    ) : selectedMenu && menuData ? (
                        <View style={styles.menuGrid}>
                        {categories.map(cat => {
                            const items = menuData?.[cat.key]?.items || [];
                            const itemsKo = (menuData?.[cat.key] as any)?.itemsKo || [];
                            return (
                                <View key={cat.key} style={styles.menuCard}>
                                    <LinearGradient
                                        colors={cat.gradient as any}
                                        start={{ x: 0, y: 0 }}
                                        end={{ x: 1, y: 0 }}
                                        style={styles.menuCardHeader}
                                    >
                                        {(cat as any).flag ? (
                                            <Text style={{ fontSize: 15 }}>{(cat as any).flag}</Text>
                                        ) : (
                                            <Ionicons name={cat.ionicon!} size={15} color="#fff" />
                                        )}
                                        <Text style={styles.menuCardTitle}>{cat.label}</Text>
                                    </LinearGradient>
                                    <View style={styles.menuCardBody}>
                                        {items.length > 0 ? items.map((item, idx) => (
                                            <View key={idx} style={[styles.menuItem, idx < items.length - 1 && styles.menuItemBorder]}>
                                                <View style={styles.menuItemDot} />
                                                <View style={styles.menuItemTexts}>
                                                    <Text style={styles.menuItemText}>{item}</Text>
                                                    {itemsKo[idx] ? (
                                                        <Text style={styles.menuItemTextKo}>{itemsKo[idx]}</Text>
                                                    ) : null}
                                                </View>
                                            </View>
                                        )) : (
                                            <Text style={styles.noItemText}>Menu not available</Text>
                                        )}
                                    </View>
                                </View>
                            );
                        })}
                        </View>
                    ) : selectedMenu && !menuData ? (
                        <View style={styles.noMenuModal}>
                            <Ionicons name="alert-circle-outline" size={48} color="#CBD5E0" />
                            <Text style={styles.noMenuModalTitle}>{selectedLevel} Not Available</Text>
                            <Text style={styles.noMenuModalSub}>
                                {selectedLevel} cafeteria is not operating on this day.
                            </Text>
                        </View>
                    ) : (
                        <View style={styles.noMenuModal}>
                            <Ionicons name="restaurant-outline" size={48} color="#CBD5E0" />
                            <Text style={styles.noMenuModalTitle}>No Menu Available</Text>
                            <Text style={styles.noMenuModalSub}>
                                Menu for this day hasn't been uploaded yet.
                            </Text>
                        </View>
                    )}
                    <View style={{ height: 40 }} />
                </ScrollView>
            </View>
        </Modal>
    );

    // ─── Compact Card Mode ───
    if (compact) {
        const firstCat = todayCategories[0];
        const firstItems = todayMenuData?.[firstCat?.key]?.items || [];
        return (
            <>
                <TouchableOpacity
                    style={cStyles.card}
                    activeOpacity={0.85}
                    onPress={() => { setSelectedDate(todayStr); setShowFullMenu(true); }}
                >
                    <View style={cStyles.topRow}>
                        <View style={cStyles.iconCircle}>
                            <Ionicons name="restaurant" size={14} color="#6366F1" />
                        </View>
                        <Text style={cStyles.cardLabel}>LUNCH</Text>
                    </View>
                    <View style={cStyles.contentArea}>
                        {loading ? (
                            <Text style={cStyles.hintText}>Loading...</Text>
                        ) : todayMenu ? (
                            <>
                                <Text style={cStyles.menuDate}>
                                    {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                                </Text>
                                <Text style={cStyles.menuLabel}>Lunch Menu</Text>
                            </>
                        ) : (
                            <Text style={cStyles.hintText}>No menu today</Text>
                        )}
                    </View>
                    <View style={cStyles.bottomRow}>
                        {todayMenu ? (
                            <View style={cStyles.levelPills}>
                                {(['MS/US', 'VS'] as const).map(l => (
                                    <View key={l} style={cStyles.levelPill}>
                                        <Text style={cStyles.levelPillText}>{l}</Text>
                                    </View>
                                ))}
                            </View>
                        ) : (
                            <Ionicons name="restaurant-outline" size={16} color="#CBD5E0" />
                        )}
                    </View>
                </TouchableOpacity>
                {fullMenuModal}
            </>
        );
    }

    // ─── Full-width Widget Mode ───
    return (
        <>
            <TouchableOpacity
                style={styles.widget}
                activeOpacity={0.9}
                onPress={() => {
                    setSelectedDate(todayStr);
                    setShowFullMenu(true);
                }}
            >
                <LinearGradient
                    colors={['#F97316', '#FB923C']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.widgetHeader}
                >
                    <View style={styles.headerLeft}>
                        <Ionicons name="restaurant" size={18} color="#fff" />
                        <Text style={styles.headerTitle}>Today's Lunch</Text>
                    </View>
                    <View style={styles.headerRight}>
                        <Text style={styles.headerDate}>{todayDayName}, {todayMonthName} {todayDate}</Text>
                        <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.6)" />
                    </View>
                </LinearGradient>

                <View style={styles.widgetBody}>
                    {loading ? (
                        <View style={styles.loadingRow}>
                            <ActivityIndicator size="small" color="#F97316" />
                            <Text style={styles.loadingText}>Loading menu...</Text>
                        </View>
                    ) : todayMenu ? (
                        <>
                            <View style={styles.miniTabs}>
                                {(['MS/US', 'VS', 'PK/K'] as SchoolLevel[]).map(level => (
                                    <TouchableOpacity
                                        key={level}
                                        style={[styles.miniTab, selectedLevel === level && styles.miniTabActive]}
                                        onPress={(e) => { e.stopPropagation?.(); setSelectedLevel(level); }}
                                    >
                                        <Text style={[styles.miniTabText, selectedLevel === level && styles.miniTabTextActive]}>
                                            {level}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.menuPreview}>
                                {todayCategories.map(cat => {
                                    const items = todayMenuData?.[cat.key]?.items || [];
                                    if (items.length === 0) return null;
                                    return (
                                        <View key={cat.key} style={styles.menuChip}>
                                            {(cat as any).flag ? (
                                                <Text style={{ fontSize: 14 }}>{(cat as any).flag}</Text>
                                            ) : (
                                                <Ionicons name={cat.ionicon!} size={14} color="#6366F1" />
                                            )}
                                            <Text style={styles.chipLabel} numberOfLines={1}>{cat.label}</Text>
                                            <Text style={styles.chipItem} numberOfLines={1}>{items[0]}</Text>
                                        </View>
                                    );
                                })}
                            </ScrollView>
                        </>
                    ) : (
                        <View style={styles.noMenu}>
                            <Ionicons name="restaurant-outline" size={36} color="#CBD5E0" />
                            <Text style={styles.noMenuText}>No menu available for today</Text>
                        </View>
                    )}
                </View>
            </TouchableOpacity>
            {fullMenuModal}
        </>
    );
}

const styles = StyleSheet.create({
    // Widget
    widget: {
        marginHorizontal: CARD_PADDING,
        marginTop: 16,
        borderRadius: r(20),
        backgroundColor: '#fff',
        ...theme.shadows.md,
    },
    widgetHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderTopLeftRadius: r(20),
        borderTopRightRadius: r(20),
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    headerTitle: {
        fontSize: 15,
        fontWeight: '800',
        color: '#fff',
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    headerDate: {
        fontSize: 12,
        fontWeight: '600',
        color: 'rgba(255,255,255,0.8)',
    },

    // Widget body
    widgetBody: {
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    miniTabs: {
        flexDirection: 'row',
        gap: 6,
        marginBottom: 10,
    },
    miniTab: {
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderRadius: r(10),
        backgroundColor: '#F8FAFC',
    },
    miniTabActive: {
        backgroundColor: '#FFF7ED',
    },
    miniTabText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#94A3B8',
    },
    miniTabTextActive: {
        color: '#F97316',
    },

    // Menu preview chips
    menuPreview: {
        flexDirection: 'row',
    },
    menuChip: {
        backgroundColor: '#F8FAFC',
        borderRadius: r(12),
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginRight: 8,
        minWidth: 110,
    },
    chipIcon: {
        fontSize: 16,
        marginBottom: 2,
    },
    chipLabel: {
        fontSize: 10,
        fontWeight: '800',
        color: '#64748B',
        marginBottom: 2,
    },
    chipItem: {
        fontSize: 11,
        fontWeight: '600',
        color: '#0F172A',
    },

    // No menu
    noMenu: {
        alignItems: 'center',
        paddingVertical: 8,
        gap: 4,
    },
    noMenuEmoji: {
        fontSize: 20,
    },
    noMenuText: {
        fontSize: 12,
        color: '#94A3B8',
        fontWeight: '500',
    },

    // Loading
    loadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 12,
    },
    loadingText: {
        fontSize: 12,
        color: '#94A3B8',
    },

    // Modal
    modalContainer: {
        flex: 1,
        backgroundColor: '#F8FAFC',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 16,
    },
    modalTitle: {
        fontSize: 22,
        fontWeight: '900',
        color: '#fff',
    },
    modalSubtitle: {
        fontSize: 12,
        fontWeight: '500',
        color: 'rgba(255,255,255,0.7)',
        marginTop: 2,
    },
    closeBtn: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#fff',
        justifyContent: 'center',
        alignItems: 'center',
    },

    // Day selector
    daySelector: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 8,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },
    dayBtn: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 8,
        borderRadius: r(12),
    },
    dayBtnSelected: {
        backgroundColor: '#FFF7ED',
    },
    dayBtnDay: {
        fontSize: 11,
        fontWeight: '600',
        color: '#94A3B8',
    },
    dayBtnDaySelected: {
        color: '#F97316',
    },
    dayBtnNum: {
        fontSize: 18,
        fontWeight: '800',
        color: '#334155',
        marginTop: 2,
    },
    dayBtnNumSelected: {
        color: '#F97316',
    },
    todayDotSmall: {
        width: 4,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#F97316',
        marginTop: 4,
    },
    noMenuDot: {
        width: 4,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#E2E8F0',
        marginTop: 4,
    },

    // Level tabs
    levelTabs: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingVertical: 10,
        gap: 8,
        backgroundColor: '#fff',
    },
    levelTab: {
        flex: 1,
        paddingVertical: 8,
        alignItems: 'center',
        borderRadius: r(10),
        backgroundColor: '#F1F5F9',
    },
    levelTabActive: {
        backgroundColor: '#F97316',
    },
    levelTabText: {
        fontSize: 13,
        fontWeight: '700',
        color: '#64748B',
    },
    levelTabTextActive: {
        color: '#fff',
    },

    // Menu cards
    menuScroll: {
        flex: 1,
        paddingHorizontal: 16,
        paddingTop: 16,
    },
    menuGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    menuCard: {
        borderRadius: r(14),
        backgroundColor: '#fff',
        width: '48%' as any,
        ...theme.shadows.sm,
    },
    menuCardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderTopLeftRadius: r(14),
        borderTopRightRadius: r(14),
    },
    menuCardTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: '#fff',
    },
    menuCardBody: {
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        paddingVertical: 6,
    },
    menuItemBorder: {
        borderBottomWidth: 0.5,
        borderBottomColor: '#F1F5F9',
    },
    menuItemDot: {
        width: 5,
        height: 5,
        borderRadius: 3,
        backgroundColor: '#6366F1',
        marginTop: 4,
    },
    menuItemTexts: {
        flex: 1,
    },
    menuItemText: {
        fontSize: 12,
        fontWeight: '500',
        color: '#334155',
    },
    menuItemTextKo: {
        fontSize: 10,
        fontWeight: '400',
        color: '#94A3B8',
        marginTop: 1,
        letterSpacing: -0.2,
    },
    noItemText: {
        fontSize: 13,
        color: '#94A3B8',
        fontStyle: 'italic',
    },

    // No menu modal
    noMenuModal: {
        alignItems: 'center',
        paddingVertical: 60,
        gap: 8,
    },
    noMenuModalTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#334155',
    },
    noMenuModalSub: {
        fontSize: 14,
        color: '#94A3B8',
        textAlign: 'center',
    },
});
// Compact card styles
const cStyles = StyleSheet.create({
    card: {
        flex: 1,
        borderRadius: 20,
        minHeight: 170,
        backgroundColor: '#FFFFFF',
        padding: 16,
        justifyContent: 'space-between',
        borderWidth: 1,
        borderColor: '#F1F5F9',
        ...theme.shadows.sm,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
    },
    iconCircle: {
        width: 28,
        height: 28,
        borderRadius: 9,
        backgroundColor: '#E0E7FF',
        justifyContent: 'center',
        alignItems: 'center',
    },
    cardLabel: {
        fontSize: 10,
        fontWeight: '700',
        color: '#A0AEC0',
        letterSpacing: 1.5,
    },
    contentArea: {
        marginTop: 6,
    },
    menuDate: {
        fontSize: 22,
        fontWeight: '700',
        color: '#1A202C',
        letterSpacing: -0.5,
    },
    menuLabel: {
        fontSize: 13,
        fontWeight: '500',
        color: '#64748B',
        marginTop: 2,
    },
    menuTitle: {
        fontSize: 15,
        fontWeight: '600',
        color: '#1A202C',
        letterSpacing: -0.2,
    },
    menuSub: {
        fontSize: 11,
        fontWeight: '500',
        color: '#A0AEC0',
        marginTop: 2,
    },
    hintText: {
        fontSize: 11,
        fontWeight: '500',
        color: '#CBD5E0',
    },
    bottomRow: {
        marginTop: 6,
    },
    levelPills: {
        flexDirection: 'row',
        gap: 5,
    },
    levelPill: {
        backgroundColor: '#F7FAFC',
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: 5,
    },
    levelPillText: {
        fontSize: 9,
        fontWeight: '700',
        color: '#718096',
        letterSpacing: 0.3,
    },
});
