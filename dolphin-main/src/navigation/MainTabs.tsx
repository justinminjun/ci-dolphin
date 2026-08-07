import React, { useEffect, useState } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/theme';
import { auth, db } from '../config/firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { useGlow } from '../context/GlowContext';
import { useAuth } from '../config/AuthContext';

import { HomeScreen } from '../screens/HomeScreen';
import { CommunityScreen } from '../screens/CommunityScreen';
import { MarketScreen } from '../screens/MarketScreen';
import { LostFoundScreen } from '../screens/LostFoundScreen';
import { ChatListScreen } from '../screens/ChatListScreen';
import { ProfileScreen } from '../screens/ProfileScreen';

const Tab = createBottomTabNavigator();

// ── Tab accent colors ──────────────────────────────────────────────────────
const TAB_COLORS: Record<string, string> = {
    Home:      'transparent', // Home — no border
    Community: '#6366F1',   // Lounge   — purple
    Market:    '#F97316',   // Market   — orange
    LostFound: '#10B981',   // Lost&Found — green
    ChatList:  '#0EA5E9',   // Messages — sky blue
    Profile:   'transparent', // Profile  — no border
};

// ── MainTabs ───────────────────────────────────────────────────────────────
export function MainTabs() {
    const [unreadCount,  setUnreadCount ] = useState(0);
    const [activeRoute,  setActiveRoute ] = useState('Home');
    const { setGlowColor } = useGlow();
    const { isStudent } = useAuth();

    const glowColor = TAB_COLORS[activeRoute] ?? TAB_COLORS.Home;

    // Push color up to App.tsx root whenever active tab changes
    useEffect(() => {
        setGlowColor(glowColor);
    }, [glowColor]);

    useEffect(() => {
        const user = auth.currentUser;
        if (!user) return;
        const q = query(collection(db, 'dolphin_chats'),
            where('participants', 'array-contains', user.uid));
        return onSnapshot(q, snap => {
            let count = 0;
            snap.docs.forEach(d => {
                const data = d.data();
                const myLastRead = data.lastRead?.[user.uid];
                const isUnread   = myLastRead
                    ? data.updatedAt?.toMillis() > myLastRead.toMillis()
                    : !!data.lastMessage;
                if (!data.deletedBy?.includes(user.uid) && isUnread) count++;
            });
            setUnreadCount(count);
        });
    }, []);

    return (
        <View style={styles.wrapper}>
            <Tab.Navigator
                screenListeners={{
                    state: e => {
                        const st = (e.data as any)?.state;
                        if (st) {
                            const route = st.routes[st.index]?.name ?? 'Home';
                            setActiveRoute(route);
                            setGlowColor(TAB_COLORS[route] ?? TAB_COLORS.Home);
                        }
                    },
                    focus: e => {
                        // Re-apply tab color whenever tab regains focus (e.g., returning from stack)
                        const route = e.target?.split('-')[0] ?? activeRoute;
                        const color = TAB_COLORS[route] ?? TAB_COLORS.Home;
                        setGlowColor(color);
                    },
                }}
                screenOptions={{
                    headerShown: false,
                    tabBarActiveTintColor:   glowColor === 'transparent' ? theme.colors.primary : glowColor,
                    tabBarInactiveTintColor: theme.colors.textMuted,
                    tabBarStyle: {
                        backgroundColor: theme.colors.surface,
                        borderTopColor:  glowColor === 'transparent' ? theme.colors.border : glowColor,
                        borderTopWidth:  glowColor === 'transparent' ? 1 : 2.5,
                        paddingTop: 4,
                        height: 88,
                    },
                    tabBarLabelStyle: { ...theme.typography.tiny, marginTop: -2 },
                }}
            >
                <Tab.Screen name="Home"      component={HomeScreen}
                    options={{ tabBarLabel: 'Home',
                        tabBarIcon: ({ color, size }) => <Ionicons name="home"          size={size} color={color} /> }} />
                {!isStudent && (
                    <Tab.Screen name="Community" component={CommunityScreen}
                        options={{ tabBarLabel: 'Lounge',
                            tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles"   size={size} color={color} /> }} />
                )}
                <Tab.Screen name="Market"    component={MarketScreen}
                    options={{ tabBarLabel: 'Market',
                        tabBarIcon: ({ color, size }) => <Ionicons name="storefront"    size={size} color={color} /> }} />
                <Tab.Screen name="LostFound" component={LostFoundScreen}
                    options={{ tabBarLabel: 'Lost&Found',
                        tabBarIcon: ({ color, size }) => <Ionicons name="search-circle" size={size} color={color} /> }} />
                <Tab.Screen name="ChatList"  component={ChatListScreen}
                    options={{
                        tabBarLabel: 'Messages',
                        tabBarIcon: ({ color, size }) => (
                            <View>
                                <Ionicons name="mail" size={size} color={color} />
                                {unreadCount > 0 && (
                                    <View style={{
                                        position: 'absolute', top: -4, right: -6,
                                        backgroundColor: theme.colors.danger,
                                        borderRadius: 10, minWidth: 16, height: 16,
                                        justifyContent: 'center', alignItems: 'center',
                                        paddingHorizontal: 4,
                                        borderWidth: 1.5, borderColor: theme.colors.surface,
                                    }}>
                                        <Text style={{ color: '#fff', fontSize: 9, fontWeight: 'bold' }}>
                                            {unreadCount > 99 ? '99+' : unreadCount}
                                        </Text>
                                    </View>
                                )}
                            </View>
                        ),
                    }} />
                <Tab.Screen name="Profile"   component={ProfileScreen}
                    options={{ tabBarLabel: 'My',
                        tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" size={size} color={color} /> }} />
            </Tab.Navigator>
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: { flex: 1 },
});
