import React, { createContext, useContext, useState } from 'react';

type GlowCtx = {
    glowColor: string;
    setGlowColor: (color: string) => void;
};

const GlowContext = createContext<GlowCtx>({
    glowColor: '#63BCFF',
    setGlowColor: () => {},
});

export function GlowProvider({ children }: { children: React.ReactNode }) {
    const [glowColor, setGlowColor] = useState('#63BCFF');
    return (
        <GlowContext.Provider value={{ glowColor, setGlowColor }}>
            {children}
        </GlowContext.Provider>
    );
}

export const useGlow = () => useContext(GlowContext);
