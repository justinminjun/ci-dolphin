import React from 'react';
import { Text, Linking, StyleSheet, TextStyle, StyleProp } from 'react-native';
import { theme } from '../theme/theme';

interface Props {
    text: string;
    style?: StyleProp<TextStyle>;
    linkStyle?: StyleProp<TextStyle>;
}

export function HyperlinkText({ text, style, linkStyle }: Props) {
    if (!text) return null;

    // Simple regex to match http/https URLs
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    return (
        <Text style={style}>
            {parts.map((part, i) => {
                if (part.match(urlRegex)) {
                    return (
                        <Text
                            key={i}
                            style={[styles.link, linkStyle]}
                            onPress={() => Linking.openURL(part).catch(() => {})}
                        >
                            {part}
                        </Text>
                    );
                }
                return <Text key={i}>{part}</Text>;
            })}
        </Text>
    );
}

const styles = StyleSheet.create({
    link: {
        color: '#2563EB',
        textDecorationLine: 'underline',
    },
});
