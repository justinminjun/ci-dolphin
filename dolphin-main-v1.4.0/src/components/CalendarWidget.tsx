import React, { useEffect, useState, useMemo } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Dimensions, ScrollView,
    ActivityIndicator, Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { theme, r } from '../theme/theme';
import { db } from '../config/firebase';
import { collection, query, where, orderBy, onSnapshot, Timestamp } from 'firebase/firestore';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_PADDING = 16;
const WIDGET_WIDTH = SCREEN_WIDTH - CARD_PADDING * 2;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

// Color palette for event types
const EVENT_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
    'All School': { bg: '#EEF2FF', text: '#4F46E5', dot: '#6366F1' },
    'Upper School': { bg: '#FEF3C7', text: '#B45309', dot: '#F59E0B' },
    'Middle School': { bg: '#DBEAFE', text: '#1D4ED8', dot: '#3B82F6' },
    'Village School': { bg: '#D1FAE5', text: '#047857', dot: '#10B981' },
    'default': { bg: '#F1F5F9', text: '#475569', dot: '#94A3B8' },
};

function getEventColor(schoolLevel: string) {
    return EVENT_COLORS[schoolLevel] || EVENT_COLORS['default'];
}

// Priority: All School > Upper School > Middle School > Village School > other
const LEVEL_PRIORITY: Record<string, number> = {
    'All School': 0,
    'Upper School': 1,
    'Middle School': 2,
    'Village School': 3,
};

function formatTime(time: string | null) {
    if (!time) return 'All day';
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function getToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getTomorrow() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface CalendarEvent {
    id: string;
    title: string;
    location: string | null;
    startDate: string;
    endDate: string;
    startTime: string | null;
    endTime: string | null;
    allDay: boolean;
    schoolLevel: string;
    eventType: string;
}

export function CalendarWidget({ compact = false }: { compact?: boolean }) {
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [showFullCalendar, setShowFullCalendar] = useState(false);
    const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [selectedDate, setSelectedDate] = useState<string>(getToday());

    // Listen to school_calendar collection
    useEffect(() => {
        const today = getToday();
        const endDate = (() => {
            const d = new Date();
            d.setMonth(d.getMonth() + 2);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        })();

        const q = query(
            collection(db, 'school_calendar'),
            where('startDate', '>=', today.substring(0, 7) + '-01'),
            orderBy('startDate', 'asc'),
        );

        const unsub = onSnapshot(q, snap => {
            const items = snap.docs.map(d => ({ id: d.id, ...d.data() })) as CalendarEvent[];
            setEvents(items);
            setLoading(false);
        }, () => setLoading(false));

        return unsub;
    }, []);

    // Today's events
    const todayStr = getToday();
    const tomorrowStr = getTomorrow();

    const todayEvents = useMemo(() =>
        events.filter(e => e.startDate <= todayStr && e.endDate >= todayStr)
            .sort((a, b) => {
                const pa = LEVEL_PRIORITY[a.schoolLevel] ?? 99;
                const pb = LEVEL_PRIORITY[b.schoolLevel] ?? 99;
                if (pa !== pb) return pa - pb;
                return (a.startTime || '99:99').localeCompare(b.startTime || '99:99');
            }),
        [events, todayStr]
    );

    const tomorrowEvents = useMemo(() =>
        events.filter(e => e.startDate <= tomorrowStr && e.endDate >= tomorrowStr),
        [events, tomorrowStr]
    );

    // Selected date events (for full calendar modal)
    const selectedEvents = useMemo(() =>
        events.filter(e => e.startDate <= selectedDate && e.endDate >= selectedDate)
            .sort((a, b) => (a.startTime || '99:99').localeCompare(b.startTime || '99:99')),
        [events, selectedDate]
    );

    // Calendar grid for full calendar modal
    const calendarDays = useMemo(() => {
        const firstDay = new Date(selectedYear, selectedMonth, 1).getDay();
        const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
        const days: (number | null)[] = [];
        for (let i = 0; i < firstDay; i++) days.push(null);
        for (let i = 1; i <= daysInMonth; i++) days.push(i);
        return days;
    }, [selectedMonth, selectedYear]);

    // Events by date for dot indicators
    const eventsByDate = useMemo(() => {
        const map: Record<string, CalendarEvent[]> = {};
        events.forEach(e => {
            const start = new Date(e.startDate);
            const end = new Date(e.endDate);
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                if (!map[key]) map[key] = [];
                map[key].push(e);
            }
        });
        return map;
    }, [events]);

    const now = new Date();
    const todayDate = now.getDate();
    const todayMonthIdx = now.getMonth();
    const todayYear = now.getFullYear();
    const dayName = DAY_NAMES[now.getDay()];
    const monthName = MONTH_NAMES[now.getMonth()];

    const goMonth = (dir: number) => {
        let m = selectedMonth + dir;
        let y = selectedYear;
        if (m < 0) { m = 11; y--; }
        if (m > 11) { m = 0; y++; }
        setSelectedMonth(m);
        setSelectedYear(y);
    };

    const fullCalendarModal = (
        <Modal visible={showFullCalendar} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowFullCalendar(false)}>
            <View style={styles.modalContainer}>
                {/* Modal Header */}
                <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>School Calendar</Text>
                    <TouchableOpacity onPress={() => setShowFullCalendar(false)} style={styles.closeBtn}>
                        <Ionicons name="close" size={22} color="#64748B" />
                    </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>
                    {/* Month Navigation */}
                    <View style={styles.monthNav}>
                        <TouchableOpacity onPress={() => goMonth(-1)} style={styles.monthArrow}>
                            <Ionicons name="chevron-back" size={20} color="#475569" />
                        </TouchableOpacity>
                        <Text style={styles.monthTitle}>
                            {MONTH_NAMES[selectedMonth]} {selectedYear}
                        </Text>
                        <TouchableOpacity onPress={() => goMonth(1)} style={styles.monthArrow}>
                            <Ionicons name="chevron-forward" size={20} color="#475569" />
                        </TouchableOpacity>
                    </View>

                    {/* Day names header */}
                    <View style={styles.dayNamesRow}>
                        {DAY_NAMES.map(d => (
                            <Text key={d} style={[styles.dayNameText, d === 'Sun' && { color: '#EF4444' }]}>{d}</Text>
                        ))}
                    </View>

                    {/* Calendar grid */}
                    <View style={styles.calendarGrid}>
                        {calendarDays.map((day, i) => {
                            if (day === null) return <View key={`empty-${i}`} style={styles.calendarCell} />;
                            const dateStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                            const isToday = day === todayDate && selectedMonth === todayMonthIdx && selectedYear === todayYear;
                            const isSelected = dateStr === selectedDate;
                            const dayEvents = eventsByDate[dateStr] || [];
                            const isSunday = i % 7 === 0;

                            return (
                                <TouchableOpacity
                                    key={dateStr}
                                    style={[
                                        styles.calendarCell,
                                        isSelected && styles.calendarCellSelected,
                                        isToday && !isSelected && styles.calendarCellToday,
                                    ]}
                                    activeOpacity={0.7}
                                    onPress={() => setSelectedDate(dateStr)}
                                >
                                    <Text style={[
                                        styles.calendarDayText,
                                        isSelected && styles.calendarDayTextSelected,
                                        isToday && !isSelected && styles.calendarDayTextToday,
                                        isSunday && !isSelected && { color: '#EF4444' },
                                    ]}>{day}</Text>
                                    {dayEvents.length > 0 && (
                                        <View style={styles.dotRow}>
                                            {dayEvents.slice(0, 3).map((e, idx) => (
                                                <View key={idx} style={[styles.calDot, {
                                                    backgroundColor: isSelected ? '#fff' : getEventColor(e.schoolLevel).dot
                                                }]} />
                                            ))}
                                        </View>
                                    )}
                                </TouchableOpacity>
                            );
                        })}
                    </View>

                    {/* Selected date events */}
                    <View style={styles.selectedDateSection}>
                        <Text style={styles.selectedDateTitle}>
                            {(() => {
                                const d = new Date(selectedDate + 'T00:00:00');
                                return `${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
                            })()}
                        </Text>
                        {selectedEvents.length > 0 ? (
                            selectedEvents.map(evt => {
                                const color = getEventColor(evt.schoolLevel);
                                return (
                                    <View key={evt.id} style={styles.modalEventCard}>
                                        <View style={[styles.modalEventBar, { backgroundColor: color.dot }]} />
                                        <View style={styles.modalEventContent}>
                                            <Text style={styles.modalEventTitle}>{evt.title}</Text>
                                            <View style={styles.modalEventMeta}>
                                                <Ionicons name="time-outline" size={12} color="#94A3B8" />
                                                <Text style={styles.modalEventTime}>
                                                    {evt.allDay ? 'All day' : `${formatTime(evt.startTime)}${evt.endTime ? ` – ${formatTime(evt.endTime)}` : ''}`}
                                                </Text>
                                            </View>
                                            {evt.location && (
                                                <View style={styles.modalEventMeta}>
                                                    <Ionicons name="location-outline" size={12} color="#94A3B8" />
                                                    <Text style={styles.modalEventTime}>{evt.location}</Text>
                                                </View>
                                            )}
                                            <View style={[styles.levelTag, { backgroundColor: color.bg, marginTop: 6 }]}>
                                                <Text style={[styles.levelTagText, { color: color.text }]}>
                                                    {evt.schoolLevel || evt.eventType}
                                                </Text>
                                            </View>
                                        </View>
                                    </View>
                                );
                            })
                        ) : (
                            <View style={styles.noEventsModal}>
                                <Ionicons name="calendar-outline" size={24} color="#CBD5E1" />
                                <Text style={styles.noEventsModalText}>No events on this day</Text>
                            </View>
                        )}
                    </View>
                    <View style={{ height: 40 }} />
                </ScrollView>
            </View>
        </Modal>
    );

    if (compact) {
        const firstEvent = todayEvents[0];
        const moreCount = todayEvents.length - 1;
        const color = firstEvent ? getEventColor(firstEvent.schoolLevel) : null;

        return (
            <>
                <TouchableOpacity
                    style={sqStyles.card}
                    activeOpacity={0.85}
                    onPress={() => setShowFullCalendar(true)}
                >
                    <View style={sqStyles.topRow}>
                        <View style={sqStyles.iconCircle}>
                            <Ionicons name="calendar" size={14} color="#EA580C" />
                        </View>
                        <Text style={sqStyles.cardLabel}>CALENDAR</Text>
                    </View>

                    <View style={sqStyles.todaySection}>
                        <Text style={sqStyles.todayTitle}>Today</Text>
                        {loading ? (
                            <ActivityIndicator size="small" color="#6366F1" style={{ marginTop: 8 }} />
                        ) : firstEvent ? (
                            <View style={sqStyles.eventBlock}>
                                <View style={[sqStyles.eventDot, { backgroundColor: color!.dot }]} />
                                <Text style={sqStyles.eventTitle} numberOfLines={2}>{firstEvent.title}</Text>
                            </View>
                        ) : (
                            <Text style={sqStyles.noEventText}>No events</Text>
                        )}
                    </View>

                    <View style={sqStyles.bottomRow}>
                        {moreCount > 0 ? (
                            <Text style={sqStyles.moreText}>+{moreCount} more</Text>
                        ) : (
                            <View />
                        )}
                        <Ionicons name="chevron-forward" size={14} color="#94A3B8" />
                    </View>
                </TouchableOpacity>
                {fullCalendarModal}
            </>
        );
    }

    return (
        <>
            {/* ─── Compact Widget ─── */}
            <TouchableOpacity
                style={styles.widget}
                activeOpacity={0.9}
                onPress={() => setShowFullCalendar(true)}
            >
                {/* Gradient Header */}
                <LinearGradient
                    colors={['#1E293B', '#334155']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.widgetHeader}
                >
                    <View style={styles.dateBlock}>
                        <View style={styles.dateCircle}>
                            <Text style={styles.dateDay}>{todayDate}</Text>
                        </View>
                        <View>
                            <Text style={styles.dateDayName}>{dayName}</Text>
                            <Text style={styles.dateMonth}>{monthName} {todayYear}</Text>
                        </View>
                    </View>
                    <View style={styles.headerRight}>
                        <View style={styles.todayBadge}>
                            <Ionicons name="calendar" size={11} color="#fff" />
                            <Text style={styles.todayBadgeText}>Today</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.5)" />
                    </View>
                </LinearGradient>

                {/* Events list */}
                <View style={styles.eventsBody}>
                    {loading ? (
                        <View style={styles.loadingRow}>
                            <ActivityIndicator size="small" color="#6366F1" />
                            <Text style={styles.loadingText}>Loading calendar...</Text>
                        </View>
                    ) : todayEvents.length > 0 ? (
                        <View style={styles.eventsList}>
                            {todayEvents.slice(0, 4).map((evt, i) => {
                                const color = getEventColor(evt.schoolLevel);
                                return (
                                    <View key={evt.id} style={[styles.eventRow, i === todayEvents.slice(0, 4).length - 1 && { borderBottomWidth: 0 }]}>
                                        <View style={[styles.eventDot, { backgroundColor: color.dot }]} />
                                        <View style={styles.eventInfo}>
                                            <Text style={styles.eventTitle} numberOfLines={1}>{evt.title}</Text>
                                            <Text style={styles.eventTime}>
                                                {evt.allDay ? 'All day' : formatTime(evt.startTime)}
                                                {evt.location ? ` · ${evt.location}` : ''}
                                            </Text>
                                        </View>
                                        <View style={[styles.levelTag, { backgroundColor: color.bg }]}>
                                            <Text style={[styles.levelTagText, { color: color.text }]} numberOfLines={1}>
                                                {evt.schoolLevel || evt.eventType}
                                            </Text>
                                        </View>
                                    </View>
                                );
                            })}
                            {todayEvents.length > 4 && (
                                <Text style={styles.moreText}>+{todayEvents.length - 4} more events</Text>
                            )}
                        </View>
                    ) : (
                        <View style={styles.noEvents}>
                            <View style={styles.noEventsIcon}>
                                <Ionicons name="sunny-outline" size={22} color="#F59E0B" />
                            </View>
                            <Text style={styles.noEventsText}>No events today</Text>
                            {tomorrowEvents.length > 0 && (
                                <View style={styles.tomorrowRow}>
                                    <Ionicons name="arrow-forward-circle" size={14} color="#6366F1" />
                                    <Text style={styles.tomorrowHint}>
                                        Tomorrow: {tomorrowEvents.length} event{tomorrowEvents.length > 1 ? 's' : ''}
                                    </Text>
                                </View>
                            )}
                        </View>
                    )}
                </View>
            </TouchableOpacity>

            {fullCalendarModal}
        </>
    );
}

const styles = StyleSheet.create({
    // Widget (compact)
    widget: {
        marginHorizontal: CARD_PADDING,
        marginTop: 16,
        borderRadius: r(20),
        ...theme.shadows.md,
        backgroundColor: '#fff',
    },
    widgetHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 18,
        paddingVertical: 16,
        borderTopLeftRadius: r(20),
        borderTopRightRadius: r(20),
    },
    dateBlock: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    dateCircle: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: 'rgba(255,255,255,0.15)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    dateDay: {
        fontSize: 24,
        fontWeight: '900',
        color: '#fff',
        lineHeight: 28,
    },
    dateDayName: {
        fontSize: 15,
        fontWeight: '700',
        color: '#fff',
    },
    dateMonth: {
        fontSize: 12,
        color: 'rgba(255,255,255,0.6)',
        fontWeight: '500',
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    todayBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: 'rgba(255,255,255,0.15)',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: r(12),
    },
    todayBadgeText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#fff',
    },

    // Events body
    eventsBody: {
        paddingHorizontal: 18,
        paddingVertical: 14,
    },
    eventsList: { gap: 4 },
    eventRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },
    eventDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
    },
    eventInfo: {
        flex: 1,
    },
    eventTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: '#0F172A',
    },
    eventTime: {
        fontSize: 11,
        color: '#94A3B8',
        marginTop: 2,
    },
    levelTag: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: r(8),
    },
    levelTagText: {
        fontSize: 9,
        fontWeight: '800',
        maxWidth: 80,
    },
    moreText: {
        fontSize: 11,
        color: '#6366F1',
        fontWeight: '700',
        textAlign: 'center',
        paddingTop: 8,
    },

    // No events
    noEvents: {
        alignItems: 'center',
        gap: 6,
        paddingVertical: 10,
    },
    noEventsIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#FFFBEB',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 2,
    },
    noEventsText: {
        fontSize: 14,
        color: '#64748B',
        fontWeight: '600',
    },
    tomorrowRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginTop: 2,
    },
    tomorrowHint: {
        fontSize: 12,
        color: '#6366F1',
        fontWeight: '700',
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
        backgroundColor: '#fff',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: '800',
        color: '#0F172A',
    },
    closeBtn: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#F1F5F9',
        justifyContent: 'center',
        alignItems: 'center',
    },

    // Month nav
    monthNav: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 16,
    },
    monthArrow: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#F8FAFC',
        justifyContent: 'center',
        alignItems: 'center',
    },
    monthTitle: {
        fontSize: 17,
        fontWeight: '700',
        color: '#0F172A',
    },

    // Day names
    dayNamesRow: {
        flexDirection: 'row',
        paddingHorizontal: 12,
        marginBottom: 4,
    },
    dayNameText: {
        flex: 1,
        textAlign: 'center',
        fontSize: 11,
        fontWeight: '600',
        color: '#94A3B8',
    },

    // Calendar grid
    calendarGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        paddingHorizontal: 12,
    },
    calendarCell: {
        width: (SCREEN_WIDTH - 24) / 7,
        height: 48,
        justifyContent: 'center',
        alignItems: 'center',
    },
    calendarCellSelected: {
        backgroundColor: '#6366F1',
        borderRadius: 14,
    },
    calendarCellToday: {
        backgroundColor: '#F1F5F9',
        borderRadius: 14,
    },
    calendarDayText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#334155',
    },
    calendarDayTextSelected: {
        color: '#fff',
        fontWeight: '700',
    },
    calendarDayTextToday: {
        color: '#6366F1',
        fontWeight: '700',
    },
    dotRow: {
        flexDirection: 'row',
        gap: 2,
        marginTop: 2,
    },
    calDot: {
        width: 4,
        height: 4,
        borderRadius: 2,
    },

    // Selected date events
    selectedDateSection: {
        paddingHorizontal: 20,
        paddingTop: 20,
    },
    selectedDateTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#0F172A',
        marginBottom: 12,
    },
    modalEventCard: {
        flexDirection: 'row',
        backgroundColor: '#F8FAFC',
        borderRadius: 14,
        overflow: 'hidden',
        marginBottom: 10,
    },
    modalEventBar: {
        width: 4,
    },
    modalEventContent: {
        flex: 1,
        padding: 14,
    },
    modalEventTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#0F172A',
        marginBottom: 6,
    },
    modalEventMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginBottom: 2,
    },
    modalEventTime: {
        fontSize: 12,
        color: '#64748B',
    },
    noEventsModal: {
        alignItems: 'center',
        paddingVertical: 32,
        gap: 8,
    },
    noEventsModalText: {
        fontSize: 14,
        color: '#94A3B8',
    },
});

const compactStyles = StyleSheet.create({
    card: {
        flex: 1,
        borderRadius: 20,
        minHeight: 170,
        backgroundColor: '#EFF6FF',
        padding: 16,
        justifyContent: 'space-between',
        borderWidth: 1,
        borderColor: '#DBEAFE',
        ...theme.shadows.sm,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
    },
    iconCircle: {
        width: 26,
        height: 26,
        borderRadius: 8,
        backgroundColor: '#DBEAFE',
        justifyContent: 'center',
        alignItems: 'center',
    },
    cardLabel: {
        fontSize: 10,
        fontWeight: '700',
        color: '#A0AEC0',
        letterSpacing: 1.5,
    },
    dateArea: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 8,
        marginTop: 4,
    },
    dateNum: {
        fontSize: 36,
        fontWeight: '300',
        color: '#1A202C',
        lineHeight: 40,
        letterSpacing: -1,
    },
    dateMeta: {
        paddingBottom: 4,
    },
    dayText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#2D3748',
        letterSpacing: -0.2,
    },
    monthText: {
        fontSize: 10,
        fontWeight: '600',
        color: '#A0AEC0',
        letterSpacing: 1,
        marginTop: 1,
    },
    eventInfo: {
        marginTop: 4,
    },
    eventBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    eventDot: {
        width: 5,
        height: 5,
        borderRadius: 3,
        backgroundColor: '#48BB78',
    },
    eventBadgeText: {
        fontSize: 11,
        fontWeight: '500',
        color: '#718096',
    },
    noEventText: {
        fontSize: 11,
        fontWeight: '500',
        color: '#CBD5E0',
    },
});

// ── Banner (full-width horizontal) styles ──
const bannerStyles = StyleSheet.create({
    wrapper: {
        gap: 8,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    titleText: {
        fontSize: 15,
        fontWeight: '700',
        color: theme.colors.textPrimary,
        letterSpacing: -0.2,
    },
    card: {
        backgroundColor: '#fff',
        borderRadius: 16,
        ...theme.shadows.sm,
    },
    springsRow: {
        flexDirection: 'row',
        justifyContent: 'space-evenly',
        paddingHorizontal: 20,
        height: 12,
        backgroundColor: '#F8FAFC',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
    },
    spring: {
        width: 16,
        height: 12,
        alignItems: 'center',
        justifyContent: 'flex-end',
    },
    springInner: {
        width: 10,
        height: 10,
        borderRadius: 5,
        borderWidth: 2,
        borderColor: '#CBD5E1',
        backgroundColor: '#F1F5F9',
        marginBottom: -5,
    },
    cardBody: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 14,
        paddingTop: 12,
    },
    left: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        flex: 1,
    },
    dateBox: {
        width: 48,
        height: 48,
        borderRadius: 12,
        backgroundColor: '#6366F1',
        justifyContent: 'center',
        alignItems: 'center',
    },
    dateMonth: {
        fontSize: 8,
        fontWeight: '800',
        color: 'rgba(255,255,255,0.7)',
        letterSpacing: 1,
    },
    dateNum: {
        fontSize: 20,
        fontWeight: '700',
        color: '#fff',
        marginTop: -2,
    },
    info: {
        flex: 1,
    },
    dayText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#1A202C',
        letterSpacing: -0.2,
    },
    eventRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        marginTop: 3,
    },
    eventDot: {
        width: 5,
        height: 5,
        borderRadius: 3,
        backgroundColor: '#6366F1',
    },
    eventText: {
        fontSize: 12,
        fontWeight: '500',
        color: '#64748B',
        flex: 1,
    },
    noEventText: {
        fontSize: 12,
        fontWeight: '500',
        color: '#CBD5E0',
        marginTop: 3,
    },
    moreEvents: {
        fontSize: 11,
        fontWeight: '600',
        color: '#6366F1',
        marginTop: 2,
    },
});

// ── Square compact card styles (for heroRow) ──
const sqStyles = StyleSheet.create({
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
        backgroundColor: '#FFF4ED',
        justifyContent: 'center',
        alignItems: 'center',
    },
    cardLabel: {
        fontSize: 10,
        fontWeight: '700',
        color: '#A0AEC0',
        letterSpacing: 1.5,
    },
    todaySection: {
        flex: 1,
        justifyContent: 'center',
        paddingVertical: 4,
    },
    todayTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#1A202C',
        letterSpacing: -0.3,
    },
    eventBlock: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 7,
        marginTop: 6,
    },
    eventDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginTop: 3,
    },
    eventTitle: {
        fontSize: 13,
        fontWeight: '500',
        color: '#475569',
        flex: 1,
        lineHeight: 17,
    },
    noEventText: {
        fontSize: 12,
        fontWeight: '500',
        color: '#CBD5E0',
        marginTop: 6,
    },
    bottomRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    moreText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#6366F1',
    },
});

