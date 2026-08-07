import React, { useEffect, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MainTabs } from './MainTabs';
import { DetailScreen } from '../screens/DetailScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';

const Stack = createNativeStackNavigator();

export function AppNavigator() {
    const [hasOnboarded, setHasOnboarded] = useState<boolean | null>(null);

    useEffect(() => {
        AsyncStorage.getItem('@has_onboarded_lf').then((value) => {
            setHasOnboarded(value === 'true');
        });
    }, []);

    if (hasOnboarded === null) return null; // Loading

    return (
        <Stack.Navigator screenOptions={{ headerShown: false, gestureEnabled: true, fullScreenGestureEnabled: true }}>
            {!hasOnboarded && (
                <Stack.Screen 
                    name="LF_Onboarding" 
                    component={OnboardingScreen}
                    initialParams={{ onComplete: () => setHasOnboarded(true) }}
                />
            )}
            <Stack.Screen name="LF_Main" component={MainTabs} options={{ headerBackTitle: 'Back' }} />
            <Stack.Screen name="Detail" component={DetailScreen} options={{ headerShown: true, title: 'Item Details', headerBackTitle: 'Back' }} />
        </Stack.Navigator>
    );
}
