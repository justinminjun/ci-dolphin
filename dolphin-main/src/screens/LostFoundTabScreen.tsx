import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';

/**
 * Wrapper screen that immediately navigates to the LostFoundApp stack
 * when the tab is focused, then returns to Home tab.
 */
export function LostFoundTabScreen() {
    const navigation = useNavigation<any>();

    useFocusEffect(
        React.useCallback(() => {
            // Navigate to the LostFoundApp stack screen
            navigation.navigate('LostFoundApp');

            // Return cleanup — when coming back, switch to Home tab
            return () => {};
        }, [navigation])
    );

    // This screen is never actually visible — it immediately navigates away
    return null;
}
