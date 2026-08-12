import { Alert, AlertButton, Platform } from 'react-native';

// react-native-web ships Alert.alert as a total no-op, so every confirm/error
// dialog in the app would silently vanish on web. Patch it once at startup
// with window.alert/confirm/prompt equivalents — every call site elsewhere
// keeps calling the same `Alert.alert(...)` API unchanged.
if (Platform.OS === 'web') {
    Alert.alert = (title?: string, message?: string, buttons?: AlertButton[]) => {
        const text = [title, message].filter(Boolean).join('\n\n');
        const actionable = (buttons ?? []).filter(b => b.style !== 'cancel');
        const cancelButton = (buttons ?? []).find(b => b.style === 'cancel');

        if (!buttons || buttons.length === 0) {
            window.alert(text);
            return;
        }

        if (buttons.length === 1) {
            window.alert(text);
            buttons[0].onPress?.();
            return;
        }

        // Simple confirm/cancel pattern — the overwhelming majority of calls in this app.
        if (buttons.length === 2 && cancelButton && actionable.length === 1) {
            if (window.confirm(text)) {
                actionable[0].onPress?.();
            } else {
                cancelButton.onPress?.();
            }
            return;
        }

        // 3+ options (e.g. action-sheet style pickers) — numbered prompt fallback.
        const optionsText = buttons.map((b, i) => `${i + 1}. ${b.text}`).join('\n');
        const answer = window.prompt(`${text}\n\n${optionsText}\n\nEnter a number:`, '1');
        const idx = answer ? parseInt(answer, 10) - 1 : -1;
        const chosen = buttons[idx];
        if (chosen) {
            chosen.onPress?.();
        } else {
            cancelButton?.onPress?.();
        }
    };
}
