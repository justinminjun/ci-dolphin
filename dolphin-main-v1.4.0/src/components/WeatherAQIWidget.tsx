import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Modal,
    ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/theme';
import { db } from '../config/firebase';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';

// ── AQI source: Firestore `app_config/aqi` ──
// A Cloud Function (aqiSync) polls the AirKorea 아암(Aam) station every 15 min
// server-side and caches the values there. Clients must NOT call data.go.kr
// directly — the shared key's daily quota gets exhausted as users grow
// (that's what broke this widget in July 2026).

// ── Open-Meteo Weather (no key needed) ──
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=37.3823&longitude=126.6617&current=temperature_2m,wind_speed_10m,relative_humidity_2m,weather_code&timezone=Asia/Seoul';

// ── PM grading thresholds ──
function gradePM25(v: number) {
    if (v <= 15) return { label: 'Good', color: '#10B981', rank: 0 };
    if (v <= 35) return { label: 'Moderate', color: '#F59E0B', rank: 1 };
    if (v <= 75) return { label: 'Unhealthy', color: '#EF4444', rank: 2 };
    if (v <= 180) return { label: 'Very Unhealthy', color: '#7C3AED', rank: 3 };
    return { label: 'Warning', color: '#991B1B', rank: 4 };
}
function gradePM10(v: number) {
    if (v <= 30) return { label: 'Good', color: '#10B981', rank: 0 };
    if (v <= 80) return { label: 'Moderate', color: '#F59E0B', rank: 1 };
    if (v <= 150) return { label: 'Unhealthy', color: '#EF4444', rank: 2 };
    if (v <= 300) return { label: 'Very Unhealthy', color: '#7C3AED', rank: 3 };
    return { label: 'Warning', color: '#991B1B', rank: 4 };
}

// ── Athletic condition based on time of day ──
function getActivity(gradeLabel: string) {
    const hour = new Date().getHours();
    if (hour < 12) {
        if (gradeLabel === 'Good' || gradeLabel === 'Moderate') return 'OUTDOORS for ALL';
        return 'INDOORS for ALL';
    } else if (hour < 15) {
        switch (gradeLabel) {
            case 'Good': return 'No limitations for CICP';
            case 'Moderate': return 'Sensitive groups limit intense activities';
            case 'Unhealthy': return 'Restrict outdoor CICP';
            case 'Very Unhealthy': return 'Outdoor CICP Cancelled';
            default: return 'All outdoor activities restricted';
        }
    } else {
        switch (gradeLabel) {
            case 'Good': return 'No limitations for Athletics';
            case 'Moderate': return 'Sensitive groups limit intense activities';
            case 'Unhealthy': return 'Restrict outdoor Athletics';
            case 'Very Unhealthy': return 'Cancel/reschedule Practice & Games';
            default: return 'All outdoor activities restricted';
        }
    }
}

// ── Weather code → icon ──
function weatherIcon(code: number): { name: string; label: string } {
    if (code === 0) return { name: 'sunny', label: 'Clear' };
    if (code <= 3) return { name: 'partly-sunny', label: 'Partly Cloudy' };
    if (code <= 48) return { name: 'cloud', label: 'Cloudy' };
    if (code <= 67) return { name: 'rainy', label: 'Rain' };
    if (code <= 77) return { name: 'snow', label: 'Snow' };
    if (code <= 82) return { name: 'rainy', label: 'Showers' };
    return { name: 'thunderstorm', label: 'Storm' };
}

interface AQIData {
    pm25: number;
    pm10: number;
    o3: number;
    no2: number;
    so2: number;
    co: number;
    overallGrade: { label: string; color: string; rank: number };
    activity: string;
    temp: number | null;
    weatherCode: number | null;
    dataTime: string;
    success: boolean;
}

// Cache
let cachedData: AQIData | null = null;
let lastFetch = 0;
const CACHE_MS = 10 * 60 * 1000; // 10 min

async function fetchAQIData(): Promise<AQIData> {
    if (cachedData && (Date.now() - lastFetch) < CACHE_MS) return cachedData;

    let pm25 = 0, pm10 = 0, o3 = 0, no2 = 0, so2 = 0, co = 0;
    let dataTime = '';
    let success = false;

    try {
        const snap = await getDoc(doc(db, 'app_config', 'aqi'));
        const item = snap.exists() ? snap.data() : null;
        if (item && typeof item.pm25 === 'number') {
            pm25 = item.pm25 || 0;
            pm10 = item.pm10 || 0;
            o3 = item.o3 || 0;
            no2 = item.no2 || 0;
            so2 = item.so2 || 0;
            co = item.co || 0;
            dataTime = item.dataTime || '';
            success = true;
        }
    } catch (e: any) {
        console.warn('AQI Firestore fetch failed:', e?.message || e);
    }

    const g25 = gradePM25(pm25);
    const g10 = gradePM10(pm10);
    const overallGrade = g25.rank >= g10.rank ? g25 : g10;
    const activity = getActivity(overallGrade.label);

    let temp: number | null = null;
    let weatherCode: number | null = null;
    try {
        const wRes = await fetch(WEATHER_URL);
        const wJson = await wRes.json();
        const cur = wJson?.current;
        if (cur) {
            temp = Math.round(cur.temperature_2m);
            weatherCode = cur.weather_code;
        }
    } catch (e) {
        console.warn('Weather fetch failed:', e);
    }

    const result: AQIData = { pm25, pm10, o3, no2, so2, co, overallGrade, activity, temp, weatherCode, dataTime, success };
    cachedData = result;
    lastFetch = Date.now();
    return result;
}

interface Props {
    compact?: boolean;
    banner?: boolean;
}

export function WeatherAQIWidget({ compact, banner }: Props) {
    const [data, setData] = useState<AQIData | null>(cachedData);
    const [loading, setLoading] = useState(!cachedData);
    const [showDetail, setShowDetail] = useState(false);
    const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    const load = useCallback(async () => {
        try {
            const result = await fetchAQIData();
            setData(result);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        refreshTimer.current = setInterval(load, CACHE_MS);
        return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
    }, [load]);

    // Live push on top of the poll above — aqiSync (Cloud Function) writes here
    // every 15 min; without this, a change only reaches the screen on the next
    // scheded poll (up to CACHE_MS late). This applies it the instant it lands.
    useEffect(() => {
        return onSnapshot(doc(db, 'app_config', 'aqi'), snap => {
            if (!snap.exists()) return;
            const item = snap.data();
            if (typeof item.pm25 !== 'number') return;
            const pm25 = item.pm25 || 0;
            const pm10 = item.pm10 || 0;
            const g25 = gradePM25(pm25);
            const g10 = gradePM10(pm10);
            const overallGrade = g25.rank >= g10.rank ? g25 : g10;
            const updated: AQIData = {
                pm25, pm10,
                o3: item.o3 || 0, no2: item.no2 || 0, so2: item.so2 || 0, co: item.co || 0,
                overallGrade, activity: getActivity(overallGrade.label),
                dataTime: item.dataTime || '', success: true,
                temp: cachedData?.temp ?? null, weatherCode: cachedData?.weatherCode ?? null,
            };
            cachedData = updated;
            lastFetch = Date.now();
            setData(updated);
            setLoading(false);
        }, () => { /* permission-denied etc. — the poll-based load() above already surfaces this */ });
    }, []);

    // ── Detail Modal ──
    const detailModal = (
        <Modal visible={showDetail} animationType="slide" presentationStyle="pageSheet">
            <View style={dStyles.container}>
                <View style={dStyles.header}>
                    <Text style={dStyles.headerTitle}>Songdo Air Quality</Text>
                    <TouchableOpacity onPress={() => setShowDetail(false)} style={dStyles.closeBtn}>
                        <Ionicons name="close" size={20} color="#64748B" />
                    </TouchableOpacity>
                </View>
                {data ? (
                    <ScrollView contentContainerStyle={dStyles.scroll}>
                        {/* Overall Status — only meaningful once the AQI fetch actually
                            succeeded; showing "Good"/0s from a failed fetch's zero-value
                            defaults would be actively misleading. */}
                        {data.success ? (
                            <View style={[dStyles.statusCard, { borderColor: data.overallGrade.color + '40' }]}>
                                <Text style={[dStyles.gradeLabel, { color: data.overallGrade.color }]}>{data.overallGrade.label}</Text>
                                <Text style={dStyles.activityText}>{data.activity}</Text>
                            </View>
                        ) : (
                            <View style={dStyles.statusCard}>
                                <Text style={dStyles.activityText}>Air quality data unavailable right now</Text>
                            </View>
                        )}

                        {/* Weather */}
                        {data.temp !== null && (
                            <View style={dStyles.weatherCard}>
                                <Ionicons
                                    name={weatherIcon(data.weatherCode ?? 0).name as any}
                                    size={32}
                                    color="#F59E0B"
                                />
                                <Text style={dStyles.tempBig}>{data.temp}°</Text>
                                <Text style={dStyles.weatherLabel}>{weatherIcon(data.weatherCode ?? 0).label}</Text>
                            </View>
                        )}

                        {data.success && (
                            <>
                                {/* PM Cards */}
                                <View style={dStyles.pmRow}>
                                    <View style={[dStyles.pmCard, { borderColor: gradePM25(data.pm25).color + '40' }]}>
                                        <Text style={dStyles.pmLabel}>PM2.5</Text>
                                        <Text style={[dStyles.pmValue, { color: gradePM25(data.pm25).color }]}>{data.pm25}</Text>
                                        <Text style={dStyles.pmUnit}>µg/m³</Text>
                                        <Text style={[dStyles.pmGrade, { color: gradePM25(data.pm25).color }]}>{gradePM25(data.pm25).label}</Text>
                                    </View>
                                    <View style={[dStyles.pmCard, { borderColor: gradePM10(data.pm10).color + '40' }]}>
                                        <Text style={dStyles.pmLabel}>PM10</Text>
                                        <Text style={[dStyles.pmValue, { color: gradePM10(data.pm10).color }]}>{data.pm10}</Text>
                                        <Text style={dStyles.pmUnit}>µg/m³</Text>
                                        <Text style={[dStyles.pmGrade, { color: gradePM10(data.pm10).color }]}>{gradePM10(data.pm10).label}</Text>
                                    </View>
                                </View>

                                {/* Secondary pollutants */}
                                <View style={dStyles.secRow}>
                                    {[
                                        { label: 'O₃', value: data.o3, unit: 'ppm' },
                                        { label: 'NO₂', value: data.no2, unit: 'ppm' },
                                        { label: 'SO₂', value: data.so2, unit: 'ppm' },
                                        { label: 'CO', value: data.co, unit: 'ppm' },
                                    ].map(p => (
                                        <View key={p.label} style={dStyles.secCard}>
                                            <Text style={dStyles.secLabel}>{p.label}</Text>
                                            <Text style={dStyles.secValue}>{p.value}</Text>
                                            <Text style={dStyles.secUnit}>{p.unit}</Text>
                                        </View>
                                    ))}
                                </View>

                                {/* Source */}
                                <Text style={dStyles.source}>AirKorea · Aam Station{data.dataTime ? ` · ${data.dataTime.split(' ')[1] || data.dataTime}` : ''}</Text>
                            </>
                        )}
                    </ScrollView>
                ) : (
                    <ActivityIndicator style={{ marginTop: 40 }} color="#64748B" />
                )}
            </View>
        </Modal>
    );

    // ── Banner Card (horizontal rectangle) ──
    if (banner) {
        return (
            <>
                <TouchableOpacity
                    style={bStyles.card}
                    activeOpacity={0.85}
                    onPress={() => setShowDetail(true)}
                >
                    {loading ? (
                        <ActivityIndicator size="small" color="#A0AEC0" />
                    ) : data && (data.success || data.temp !== null) ? (
                        <View>
                            <View style={bStyles.topRow}>
                                <View style={bStyles.leftGroup}>
                                    <View style={bStyles.weatherGroup}>
                                        {data.weatherCode !== null && (
                                            <Ionicons
                                                name={weatherIcon(data.weatherCode ?? 0).name as any}
                                                size={18}
                                                color="#F59E0B"
                                            />
                                        )}
                                        {data.temp !== null && (
                                            <Text style={bStyles.tempText}>{data.temp}°</Text>
                                        )}
                                    </View>
                                    {data.success && (
                                        <View style={[bStyles.gradeBadge, { backgroundColor: data.overallGrade.color + '18' }]}>
                                            <Text style={[bStyles.gradeText, { color: data.overallGrade.color }]}>{data.overallGrade.label}</Text>
                                        </View>
                                    )}
                                </View>
                                {data.success && (
                                    <View style={bStyles.pmGroup}>
                                        <Text style={bStyles.pmLabel}>PM2.5 <Text style={bStyles.pmValue}>{data.pm25}</Text></Text>
                                        <View style={bStyles.pmDivider} />
                                        <Text style={bStyles.pmLabel}>PM10 <Text style={bStyles.pmValue}>{data.pm10}</Text></Text>
                                    </View>
                                )}
                            </View>
                            <Text style={bStyles.activityText}>
                                {data.success ? data.activity : 'Air quality data unavailable right now'}
                            </Text>
                        </View>
                    ) : (
                        <Text style={bStyles.hintText}>No data available</Text>
                    )}
                </TouchableOpacity>
                {detailModal}
            </>
        );
    }

    // ── Compact Card ──
    if (compact) {
        return (
            <>
                <TouchableOpacity
                    style={cStyles.card}
                    activeOpacity={0.85}
                    onPress={() => setShowDetail(true)}
                >
                    <View style={cStyles.topRow}>
                        <View style={cStyles.iconCircle}>
                            <Ionicons name="leaf" size={14} color="#3B82F6" />
                        </View>
                        <Text style={cStyles.cardLabel}>AIR QUALITY</Text>
                    </View>
                    <View style={cStyles.contentArea}>
                        {loading ? (
                            <ActivityIndicator size="small" color="#A0AEC0" />
                        ) : data && (data.success || data.temp !== null) ? (
                            <>
                                <View style={cStyles.mainRow}>
                                    {data.temp !== null && (
                                        <Text style={cStyles.tempText}>{data.temp}°</Text>
                                    )}
                                    {data.success && (
                                        <View style={[cStyles.gradeBadge, { backgroundColor: data.overallGrade.color + '18' }]}>
                                            <Text style={[cStyles.gradeText, { color: data.overallGrade.color }]}>{data.overallGrade.label}</Text>
                                        </View>
                                    )}
                                </View>
                                <Text style={cStyles.activityText} numberOfLines={2}>
                                    {data.success ? data.activity : 'Air quality unavailable'}
                                </Text>
                            </>
                        ) : (
                            <Text style={cStyles.hintText}>No data</Text>
                        )}
                    </View>
                    <View style={cStyles.bottomRow}>
                        {data?.success ? (
                            <Text style={cStyles.pmText}>PM2.5: {data.pm25}  PM10: {data.pm10}</Text>
                        ) : (
                            <Ionicons name="leaf-outline" size={16} color="#CBD5E0" />
                        )}
                    </View>
                </TouchableOpacity>
                {detailModal}
            </>
        );
    }

    // ── Full-width (not used currently) ──
    return (
        <>
            <TouchableOpacity style={fStyles.card} activeOpacity={0.85} onPress={() => setShowDetail(true)}>
                <Text style={fStyles.title}>Songdo Air Quality</Text>
                {data?.success ? (
                    <View style={fStyles.row}>
                        <Text style={[fStyles.grade, { color: data.overallGrade.color }]}>{data.overallGrade.label}</Text>
                        <Text style={fStyles.activity}>{data.activity}</Text>
                    </View>
                ) : (
                    <ActivityIndicator size="small" color="#A0AEC0" />
                )}
            </TouchableOpacity>
            {detailModal}
        </>
    );
}

// ── Compact styles ──
const cStyles = StyleSheet.create({
    card: {
        flex: 1,
        borderRadius: 20,
        minHeight: 170,
        backgroundColor: '#EEF2FF',
        padding: 16,
        justifyContent: 'space-between',
        ...theme.shadows.md,
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
    mainRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    tempText: {
        fontSize: 28,
        fontWeight: '300',
        color: '#1A202C',
        letterSpacing: -1,
    },
    gradeBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
    },
    gradeText: {
        fontSize: 11,
        fontWeight: '700',
    },
    activityText: {
        fontSize: 11,
        fontWeight: '500',
        color: '#64748B',
        marginTop: 3,
        lineHeight: 15,
    },
    hintText: {
        fontSize: 11,
        fontWeight: '500',
        color: '#CBD5E0',
    },
    bottomRow: {
        marginTop: 6,
    },
    pmText: {
        fontSize: 9,
        fontWeight: '600',
        color: '#94A3B8',
        letterSpacing: 0.3,
    },
});

// ── Banner styles ──
const bStyles = StyleSheet.create({
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 14,
        ...theme.shadows.sm,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    leftGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    weatherGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    tempText: {
        fontSize: 17,
        fontWeight: '600',
        color: '#1A202C',
        letterSpacing: -0.5,
    },
    gradeBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
    },
    gradeText: {
        fontSize: 11,
        fontWeight: '700',
    },
    pmGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    pmLabel: {
        fontSize: 10,
        fontWeight: '500',
        color: '#A0AEC0',
    },
    pmValue: {
        fontWeight: '700',
        color: '#64748B',
    },
    pmDivider: {
        width: 1,
        height: 10,
        backgroundColor: '#E2E8F0',
    },
    activityText: {
        fontSize: 12,
        fontWeight: '500',
        color: '#94A3B8',
        marginTop: 6,
        lineHeight: 17,
    },
    hintText: {
        fontSize: 12,
        fontWeight: '500',
        color: '#CBD5E0',
        textAlign: 'center',
    },
});

// ── Full-width styles ──
const fStyles = StyleSheet.create({
    card: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: '#EDF2F7',
        ...theme.shadows.sm,
    },
    title: {
        fontSize: 13,
        fontWeight: '700',
        color: '#2D3748',
        marginBottom: 8,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    grade: {
        fontSize: 15,
        fontWeight: '700',
    },
    activity: {
        fontSize: 12,
        fontWeight: '500',
        color: '#64748B',
        flex: 1,
    },
});

// ── Detail modal styles ──
const dStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F8FAFC',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: Platform.OS === 'ios' ? 60 : 20,
        paddingBottom: 16,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#1A202C',
    },
    closeBtn: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#F1F5F9',
        justifyContent: 'center',
        alignItems: 'center',
    },
    scroll: {
        padding: 20,
        paddingBottom: 60,
    },
    statusCard: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 20,
        alignItems: 'center',
        borderWidth: 1.5,
        marginBottom: 16,
        ...theme.shadows.sm,
    },
    gradeLabel: {
        fontSize: 24,
        fontWeight: '800',
    },
    activityText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#475569',
        marginTop: 6,
        textAlign: 'center',
    },
    weatherCard: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 20,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#F1F5F9',
        ...theme.shadows.sm,
    },
    tempBig: {
        fontSize: 28,
        fontWeight: '300',
        color: '#1A202C',
    },
    weatherLabel: {
        fontSize: 14,
        fontWeight: '500',
        color: '#64748B',
    },
    pmRow: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 16,
    },
    pmCard: {
        flex: 1,
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 16,
        alignItems: 'center',
        borderWidth: 1.5,
        ...theme.shadows.sm,
    },
    pmLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: '#64748B',
        marginBottom: 4,
    },
    pmValue: {
        fontSize: 32,
        fontWeight: '700',
    },
    pmUnit: {
        fontSize: 10,
        fontWeight: '500',
        color: '#94A3B8',
        marginTop: 2,
    },
    pmGrade: {
        fontSize: 12,
        fontWeight: '700',
        marginTop: 4,
    },
    secRow: {
        flexDirection: 'row',
        gap: 8,
        flexWrap: 'wrap',
        marginBottom: 20,
    },
    secCard: {
        flex: 1,
        minWidth: '45%' as any,
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 14,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#F1F5F9',
        ...theme.shadows.sm,
    },
    secLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: '#94A3B8',
    },
    secValue: {
        fontSize: 22,
        fontWeight: '700',
        color: '#1A202C',
        marginTop: 4,
    },
    secUnit: {
        fontSize: 9,
        fontWeight: '500',
        color: '#CBD5E0',
        marginTop: 2,
    },
    source: {
        fontSize: 10,
        fontWeight: '500',
        color: '#CBD5E0',
        textAlign: 'center',
    },
});
