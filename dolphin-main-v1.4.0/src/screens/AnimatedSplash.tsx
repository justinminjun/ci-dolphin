/**
 * AnimatedSplash — Kawaii dolphin IMAGE (generated asset)
 * Uses Image component — no SVG, no dependencies, works everywhere
 * Left→Right arc, tail-wag via subtle scale animation, water splash
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, Image, StyleSheet, Animated, Easing, Dimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { r } from '../theme/theme';

const { width: W, height: H } = Dimensions.get('window');
const BG      = '#061C34';
const OCEAN   = '#0A3B75';
const WATER_Y = H * 0.58;   // moved up slightly — dolphin jumps higher
const ARC_AMP = H * 0.30;   // bigger arc so dolphin clears the title
// Jump distance as a fraction of width, capped in absolute px — on a phone
// this is the same 0.72*W span as before; on a wide desktop window it stops
// growing past a comfortable arc instead of stretching edge to edge.
const JUMP_SPAN = Math.min(W * 0.72, 480);
const SX = W / 2 - JUMP_SPAN / 2;   // start: LEFT
const EX = W / 2 + JUMP_SPAN / 2;   // end:   RIGHT

// Keyframes: LEFT → RIGHT parabolic arc
const STEPS = 24;
const KF_IN: number[]  = [];
const KF_Y: number[]   = [];
const KF_ROT: string[] = [];
for (let i = 0; i <= STEPS; i++) {
    const t  = i / STEPS;
    KF_IN.push(t);
    KF_Y.push(WATER_Y - ARC_AMP * Math.sin(t * Math.PI));
    const dy  = -Math.cos(t * Math.PI) * ARC_AMP * Math.PI;
    const dx  = EX - SX;
    KF_ROT.push(`${(Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1)}deg`);
}

const JUMP_MS = 1700;  // module-level so JSX can reference it


// ── Water droplet ─────────────────────────────────────────────────────────
function Drop({ prog, cx, angle, dist, size, delay: delayMs }: {
    prog: Animated.Value; cx: number; angle: number; dist: number; size: number; delay: number;
}) {
    const local = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        const t = setTimeout(() => {
            Animated.timing(local, { toValue: 1, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
        }, delayMs);
        return () => clearTimeout(t);
    }, []);

    const rad = angle * Math.PI / 180;
    const xA  = local.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(rad) * dist] });
    const yA  = local.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(rad) * dist] });
    const opA = local.interpolate({ inputRange: [0, 0.1, 0.55, 1], outputRange: [0, 1, 0.7, 0] });
    const sA  = local.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.4, 1, 0.6] });

    return (
        <Animated.View style={{
            position: 'absolute',
            width: size, height: size, borderRadius: size / 2,
            backgroundColor: 'rgba(140,220,255,0.95)',
            left: cx - size / 2, top: WATER_Y - size / 2,
            opacity: opA,
            transform: [{ translateX: xA }, { translateY: yA }, { scale: sA }],
        }} />
    );
}

// ── Splash cluster ─────────────────────────────────────────────────────────
function Splash({ prog, cx, startDelay, flip }: {
    prog: Animated.Value; cx: number; startDelay: number; flip?: boolean;
}) {
    const f = flip ? -1 : 1;
    // Big arc drops
    const drops = [
        { angle: -88, dist: 72, size: 10, d: 0   },
        { angle: -72, dist: 82, size: 14, d: 30  },
        { angle: -55, dist: 78, size: 12, d: 20  },
        { angle: -38, dist: 70, size: 9,  d: 50  },
        { angle: -20, dist: 68, size: 11, d: 10  },
        { angle:  -5, dist: 60, size: 8,  d: 40  },
        { angle:  12, dist: 64, size: 10, d: 60  },
        { angle:  28, dist: 72, size: 7,  d: 25  },
        // small micro drops
        { angle: -62, dist: 45, size: 6,  d: 80  },
        { angle: -45, dist: 50, size: 5,  d: 90  },
        { angle: -30, dist: 42, size: 5,  d: 70  },
        { angle:  -8, dist: 40, size: 6,  d: 100 },
    ];

    return (
        <>
            {drops.map((d, i) => (
                <Drop
                    key={i}
                    prog={prog}
                    cx={cx}
                    angle={d.angle}
                    dist={d.dist}
                    size={d.size}
                    delay={startDelay + d.d}
                />
            ))}
            {/* Ripple rings */}
            {[1.0, 1.8, 2.8, 4.0].map((maxS, i) => {
                const s  = prog.interpolate({ inputRange: [0, 1], outputRange: [0.2, maxS] });
                const op = prog.interpolate({ inputRange: [0, 0.1, 0.65, 1], outputRange: [0, 0.7 - i * 0.12, 0.2, 0] });
                return (
                    <Animated.View key={i} style={{
                        position: 'absolute',
                        width: 90, height: 26, borderRadius: r(45),
                        borderWidth: 2, borderColor: 'rgba(100,200,255,0.8)',
                        left: cx - 45, top: WATER_Y - 13,
                        opacity: op, transform: [{ scale: s }],
                    }} />
                );
            })}
            {/* Water column base */}
            {[0, 1, 2].map((_, i) => {
                const h   = [30, 22, 16][i];
                const w   = [10, 7, 5][i];
                const xOff = f * [-4, 5, -8][i];
                const op = prog.interpolate({ inputRange: [0, 0.1, 0.4, 1], outputRange: [0, 0.8, 0.5, 0] });
                return (
                    <Animated.View key={i} style={{
                        position: 'absolute',
                        width: w, height: h, borderRadius: w / 2,
                        backgroundColor: 'rgba(140,220,255,0.85)',
                        left: cx - w / 2 + xOff,
                        top: WATER_Y - h,
                        opacity: op,
                    }} />
                );
            })}
        </>
    );
}


// ── Loading dot ───────────────────────────────────────────────────────────
function Dot({ delay }: { delay: number }) {
    const v = useRef(new Animated.Value(0.2)).current;
    useEffect(() => {
        const loop = Animated.loop(Animated.sequence([
            Animated.timing(v, { toValue: 1,   duration: 400, delay, useNativeDriver: true }),
            Animated.timing(v, { toValue: 0.2, duration: 400,        useNativeDriver: true }),
        ]));
        loop.start();
        return () => loop.stop();
    }, []);
    return <Animated.View style={[styles.dot, { opacity: v }]} />;
}

// ── Main ──────────────────────────────────────────────────────────────────
export function AnimatedSplash({ onFinish }: { onFinish: () => void }) {
    const progress      = useRef(new Animated.Value(0)).current;
    // Tail wag simulated via scaleY oscillation on the image
    const tailWag       = useRef(new Animated.Value(1)).current;
    const splash1       = useRef(new Animated.Value(0)).current;
    const splash2       = useRef(new Animated.Value(0)).current;
    const titleOpacity  = useRef(new Animated.Value(0)).current;
    const titleY        = useRef(new Animated.Value(14)).current;
    const screenOpacity = useRef(new Animated.Value(1)).current;
    // Driven directly (not via progress.interpolate()) — react-native-web
    // doesn't reliably apply an interpolated `opacity` when it's combined
    // with a `transform` array on the same node driven by the same source
    // value, which left the dolphin invisible for the whole jump on web.
    const dolphinOpacity = useRef(new Animated.Value(0)).current;
    const done          = useRef(false);

    const JUMP_MS_LOCAL = JUMP_MS;
    const finish  = () => { if (!done.current) { done.current = true; onFinish(); } };

    useEffect(() => {
        const safe = setTimeout(finish, 7000);

        // Subtle scaleY wag while airborne (simulates tail movement)
        const wagLoop = Animated.loop(Animated.sequence([
            Animated.timing(tailWag, { toValue: 1.06, duration: 240, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(tailWag, { toValue: 0.94, duration: 240, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]));
        wagLoop.start();

        const splash = (v: Animated.Value) =>
            Animated.timing(v, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true });

        Animated.sequence([
            Animated.delay(200),
            Animated.parallel([
                Animated.timing(progress, { toValue: 1, duration: JUMP_MS, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
                Animated.sequence([
                    Animated.timing(dolphinOpacity, { toValue: 1, duration: 60, useNativeDriver: true }),
                    Animated.delay(Math.max(0, JUMP_MS - 120)),
                    Animated.timing(dolphinOpacity, { toValue: 0, duration: 60, useNativeDriver: true }),
                ]),
                Animated.parallel([
                    Animated.timing(titleOpacity, { toValue: 1, duration: 700, useNativeDriver: true }),
                    Animated.spring(titleY, { toValue: 0, friction: 6, tension: 60, useNativeDriver: true }),
                ]),
                splash(splash1),
                Animated.sequence([Animated.delay(JUMP_MS - 480), splash(splash2)]),
            ]),
            Animated.delay(350),
            Animated.timing(screenOpacity, { toValue: 0, duration: 320, easing: Easing.in(Easing.ease), useNativeDriver: true }),
        ]).start(() => { wagLoop.stop(); clearTimeout(safe); finish(); });

        return () => { wagLoop.stop(); clearTimeout(safe); };
    }, []);

    const dolphinX   = progress.interpolate({ inputRange: KF_IN, outputRange: KF_IN.map(t => SX + (EX - SX) * t) });
    const dolphinY   = progress.interpolate({ inputRange: KF_IN, outputRange: KF_Y });
    const dolphinRot = progress.interpolate({ inputRange: KF_IN, outputRange: KF_ROT });

    return (
        <Animated.View style={[styles.container, { opacity: screenOpacity }]}>

            {/* ── Wave boundary — animated SVG wave replacing flat line ── */}
            <View style={styles.ocean} />
            <WaveEdge />


            {/* Splash exit (left) + entry (right) */}
            <Splash prog={splash1} cx={SX} startDelay={400} />
            <Splash prog={splash2} cx={EX} startDelay={400 + JUMP_MS - 480} flip />

            {/* Kawaii dolphin image along arc */}
            <Animated.View style={{
                position: 'absolute',
                opacity:   dolphinOpacity,
                transform: [
                    { translateX: Animated.subtract(dolphinX, new Animated.Value(85)) },
                    { translateY: Animated.subtract(dolphinY, new Animated.Value(72)) },
                    { rotate: dolphinRot },
                    { scaleY: tailWag },
                ],
            }}>
                <Image
                    source={require('../../assets/dolphin.png')}
                    style={styles.dolphinImg}
                    resizeMode="contain"
                />
            </Animated.View>

            {/* Title — appears WITH the dolphin */}
            <Animated.View style={[styles.titleWrap, {
                opacity:   titleOpacity,
                transform: [{ translateY: titleY }],
            }]}>
                <Text style={styles.title}>Dolphin</Text>
                <Text style={styles.sub}>Chadwick Community Hub</Text>
            </Animated.View>

            <View style={styles.dotsRow}>
                {[0, 1, 2].map(i => <Dot key={i} delay={i * 180} />)}
            </View>

        </Animated.View>
    );
}

// ── Animated wave edge ───────────────────────────────────────────────────
// Draws a 2× wide SVG and scrolls it with translateX — no string interpolation.
function WaveEdge() {
    const shift = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.loop(
            Animated.timing(shift, { toValue: -W, duration: 2800, easing: Easing.linear, useNativeDriver: true })
        ).start();
    }, []);

    // Build a 2W-wide repeating wave path
    const svgW   = W * 2;
    const AMP    = 18;   // wave amplitude in px
    const SEGS   = 4;    // wave repetitions across 2W
    const segW   = svgW / SEGS;

    const wavePath = (yOffset: number, fillBelow: boolean) => {
        let d = `M0 ${WATER_Y + yOffset}`;
        for (let i = 0; i < SEGS; i++) {
            const sign = i % 2 === 0 ? -1 : 1;
            const cpX  = i * segW + segW / 2;
            const cpY  = WATER_Y + yOffset + sign * AMP;
            const ex   = (i + 1) * segW;
            const ey   = WATER_Y + yOffset;
            d += ` Q${cpX} ${cpY} ${ex} ${ey}`;
        }
        if (fillBelow) d += ` L${svgW} ${H} L0 ${H} Z`;
        return d;
    };

    return (
        <Animated.View
            style={[StyleSheet.absoluteFillObject, { transform: [{ translateX: shift }] }]}
            pointerEvents="none"
        >
            <Svg width={svgW} height={H}>
                {/* Main ocean fill */}
                <Path d={wavePath(0, true)}  fill="rgba(10,59,117,0.9)" />
                {/* Secondary foam layer */}
                <Path d={wavePath(8, true)}  fill="rgba(100,190,255,0.18)" />
                {/* Bright crest line */}
                <Path d={wavePath(-1, false)} fill="none" stroke="rgba(140,230,255,0.7)" strokeWidth="2.5" />
            </Svg>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: BG,
        zIndex: 999,
        overflow: 'hidden',
    },
    ocean: {
        position: 'absolute',
        top: WATER_Y + 20, left: 0, right: 0, bottom: 0,  // starts below wave peak
        backgroundColor: OCEAN,
    },
    dolphinImg: {
        width:  170,
        height: 145,
    },
    titleWrap: {
        position: 'absolute',
        bottom: H * 0.30,    // moved UP toward the dolphin arc
        left: 0, right: 0,
        alignItems: 'center',
    },
    title: { fontSize: 46, fontWeight: '900', color: '#fff', letterSpacing: 3 },
    sub:   { fontSize: 14, fontWeight: '500', color: 'rgba(255,255,255,0.5)', marginTop: 6, letterSpacing: 0.5 },
    dotsRow: {
        position: 'absolute', bottom: 70, left: 0, right: 0,
        flexDirection: 'row', justifyContent: 'center', gap: 8,
    },
    dot: { width: 7, height: 7, borderRadius: r(4), backgroundColor: '#63BCFF' },
});
