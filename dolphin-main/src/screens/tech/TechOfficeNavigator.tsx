import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { TouchableOpacity, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { TechChatScreen } from './TechChatScreen';
import { TechAnnouncementsScreen } from './TechAnnouncementsScreen';

const Tab = createBottomTabNavigator();

export function TechOfficeNavigator() {
    const navigation = useNavigation<any>();

    return (
        <Tab.Navigator
            screenOptions={{
                headerStyle: { backgroundColor: '#6366F1' },
                headerTintColor: '#fff',
                headerTitleStyle: { fontWeight: '700', fontSize: 18 },
                headerLeft: () => (
                    <TouchableOpacity
                        onPress={() => navigation.goBack()}
                        style={{ marginLeft: 16, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                    >
                        <Ionicons name="chevron-back" size={22} color="#fff" />
                        <Text style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>Back</Text>
                    </TouchableOpacity>
                ),
                tabBarActiveTintColor: '#6366F1',
                tabBarInactiveTintColor: '#94A3B8',
                tabBarStyle: {
                    backgroundColor: '#fff',
                    borderTopColor: '#E2E8F0',
                    paddingTop: 4,
                    height: 88,
                },
                tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
            }}
        >
            <Tab.Screen
                name="TechChat"
                component={TechChatScreen}
                options={{
                    headerTitle: 'Tech Assistant',
                    tabBarLabel: 'AI Chat',
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons name="chatbubble-ellipses" size={size} color={color} />
                    ),
                }}
            />
            <Tab.Screen
                name="TechAnnouncements"
                component={TechAnnouncementsScreen}
                options={{
                    headerTitle: 'Tech Announcements',
                    tabBarLabel: 'Announcements',
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons name="megaphone" size={size} color={color} />
                    ),
                }}
            />
        </Tab.Navigator>
    );
}
