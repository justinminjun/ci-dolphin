import React, { useEffect, useState } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { FeedScreen } from '../screens/FeedScreen';
import { AddPostScreen } from '../screens/AddPostScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { AdminScreen } from '../screens/AdminScreen';
import { theme } from '../../theme/theme'; // Use main Dolphin theme
import { isAdmin } from '../utils/admin';

const Tab = createBottomTabNavigator();

export function MainTabs() {
    const admin = isAdmin();
    const navigation = useNavigation<any>();

    return (
        <Tab.Navigator
            screenOptions={{
                headerShown: true,
                headerStyle: { backgroundColor: theme.colors.surface },
                headerTitleStyle: { ...theme.typography.h3, color: theme.colors.textPrimary } as any,
                headerLeft: () => (
                    <TouchableOpacity onPress={() => navigation.navigate('Main')} style={{ marginLeft: 16, flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="chevron-back" size={24} color={theme.colors.primary} />
                        <Text style={{ color: theme.colors.primary, fontWeight: '600', fontSize: 16 }}>Dolphin</Text>
                    </TouchableOpacity>
                ),
                tabBarActiveTintColor: theme.colors.primary,
                tabBarInactiveTintColor: theme.colors.textMuted,
                tabBarStyle: {
                    backgroundColor: theme.colors.surface,
                    borderTopColor: theme.colors.border,
                    paddingTop: 4,
                    height: 88,
                    paddingBottom: 28,
                },
                tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
            }}
        >
            <Tab.Screen
                name="Feed"
                component={FeedScreen}
                options={{
                    title: 'Home',
                    tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
                }}
            />
            <Tab.Screen
                name="AddPost"
                component={AddPostScreen}
                options={{
                    title: 'Report',
                    tabBarIcon: ({ color, size }) => <Ionicons name="add-circle" size={size} color={color} />,
                }}
            />
            {admin && (
                <Tab.Screen
                    name="Admin"
                    component={AdminScreen}
                    options={{
                        title: 'Admin',
                        tabBarIcon: ({ color, size }) => <Ionicons name="shield-checkmark" size={size} color={color} />,
                    }}
                />
            )}
            <Tab.Screen
                name="Profile"
                component={ProfileScreen}
                options={{
                    title: 'Profile',
                    tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
                }}
            />
        </Tab.Navigator>
    );
}
