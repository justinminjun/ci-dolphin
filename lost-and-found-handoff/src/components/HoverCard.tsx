import React from 'react';
import { TouchableOpacity, TouchableOpacityProps, StyleProp, ViewStyle } from 'react-native';
import { useHover } from '../utils/useResponsive';

interface Props extends TouchableOpacityProps {
    hoverStyle?: StyleProp<ViewStyle>;
}

// Thin TouchableOpacity wrapper that also reacts to mouse hover on web (a
// plain TouchableOpacity has no hover concept at all — native apps don't
// need one). Native platforms render identically to a normal TouchableOpacity.
export function HoverCard({ style, hoverStyle, ...rest }: Props) {
    const { ref, hovered } = useHover<any>();
    return <TouchableOpacity ref={ref} style={[style, hovered && hoverStyle]} {...rest} />;
}
