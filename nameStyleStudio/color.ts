/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type Lab = [L: number, a: number, b: number];
export type Lch = [L: number, C: number, h: number];

export const toHex = (c: number) => "#" + (c & 0xffffff).toString(16).padStart(6, "0");

export function fromHex(hex: string): number | null {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
    return parseInt(h, 16);
}

const toLinear = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const toGamma = (v: number) => v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;

export function rgbToLab(r: number, g: number, b: number): Lab {
    const lr = toLinear(r / 255), lg = toLinear(g / 255), lb = toLinear(b / 255);
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    return [
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    ];
}

function labToLinear([L, a, b]: Lab): [number, number, number] {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ];
}

const inGamut = (rgb: number[]) => rgb.every(v => v >= -1e-4 && v <= 1 + 1e-4);

export const intToLab = (c: number) => rgbToLab(c >> 16 & 255, c >> 8 & 255, c & 255);

export function labToInt(lab: Lab): number {
    const [r, g, b] = labToLinear(lab).map(v => Math.round(Math.min(1, Math.max(0, toGamma(v))) * 255));
    return r << 16 | g << 8 | b;
}

export const labToLch = ([L, a, b]: Lab): Lch => [L, Math.hypot(a, b), (Math.atan2(b, a) * 180 / Math.PI + 360) % 360];

export function lchToLab([L, C, h]: Lch): Lab {
    const r = h * Math.PI / 180;
    return [L, C * Math.cos(r), C * Math.sin(r)];
}

export function lchToInt([L, C, h]: Lch): number {
    L = Math.min(1, Math.max(0, L));
    if (inGamut(labToLinear(lchToLab([L, C, h])))) return labToInt(lchToLab([L, C, h]));
    let lo = 0, hi = C;
    for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        if (inGamut(labToLinear(lchToLab([L, mid, h])))) lo = mid;
        else hi = mid;
    }
    return labToInt(lchToLab([L, lo, h]));
}

export const mixLab = (a: Lab, b: Lab, t: number): Lab => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export interface Stop { pos: number; color: number; }

export function sampleStops(stops: Stop[], t: number): number {
    const sorted = [...stops].sort((a, b) => a.pos - b.pos);
    if (t <= sorted[0].pos) return sorted[0].color;
    for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1], b = sorted[i];
        if (t <= b.pos) {
            const span = b.pos - a.pos || 1;
            return labToInt(mixLab(intToLab(a.color), intToLab(b.color), (t - a.pos) / span));
        }
    }
    return sorted[sorted.length - 1].color;
}

export const evenly = (count: number) => Array.from({ length: count }, (_, i) => count === 1 ? 0.5 : i / (count - 1));

export const resample = (stops: Stop[], count: number) => evenly(count).map(t => sampleStops(stops, t));

export const HARMONIES = {
    analogous: { label: "Neighbours", hint: "Hues next to yours. Calm and smooth.", offsets: null },
    monochrome: { label: "One hue", hint: "Your colour from light to dark.", offsets: [0] },
    complementary: { label: "Opposites", hint: "Your colour and its opposite. Loud.", offsets: [0, 180] },
    split: { label: "Soft opposites", hint: "Two hues either side of the opposite.", offsets: [0, 150, 210] },
    triadic: { label: "Triangle", hint: "Three hues spaced evenly. Playful.", offsets: [0, 120, 240] },
    tetradic: { label: "Square", hint: "Four hues spaced evenly. Busiest.", offsets: [0, 90, 180, 270] }
} as const;

export type Harmony = keyof typeof HARMONIES;

export function harmony(seed: number, rule: Harmony, count: number, spread: number): number[] {
    const [L, C, h] = labToLch(intToLab(seed));
    const chroma = Math.max(C, 0.04);

    if (rule === "analogous")
        return Array.from({ length: count }, (_, i) => lchToInt([L, chroma, h + spread * (i - (count - 1) / 2)]));

    if (rule === "monochrome") {
        const range = Math.min(0.5, spread / 120);
        return evenly(count).map(t => lchToInt([L + (t - 0.5) * range * 2, chroma * (1 - Math.abs(t - 0.5) * 0.6), h]));
    }

    const offsets = HARMONIES[rule].offsets!;
    return Array.from({ length: count }, (_, i) => {
        const lap = Math.floor(i / offsets.length);
        const shift = lap === 0 ? 0 : (lap % 2 ? 1 : -1) * Math.ceil(lap / 2) * 0.12;
        return lchToInt([L + shift, chroma, h + offsets[i % offsets.length]]);
    });
}

export const ORDERS = {
    weight: "Most used first",
    light: "Light to dark",
    hue: "By hue"
} as const;

export type Order = keyof typeof ORDERS;

interface Cluster { lab: Lab; weight: number; }

function sortColors(clusters: Cluster[], order: Order): Cluster[] {
    const out = [...clusters];
    if (order === "weight") out.sort((a, b) => b.weight - a.weight);
    else if (order === "light") out.sort((a, b) => b.lab[0] - a.lab[0]);
    else out.sort((a, b) => labToLch(a.lab)[2] - labToLch(b.lab)[2]);
    return out;
}

const dist = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function extractPalette(pixels: Lab[], count: number, order: Order, boost = 5): number[] {
    if (!pixels.length) return [];
    const k = Math.min(10, Math.max(count + 3, 6));

    let seed = 0x9e3779b9;
    const rand = () => (seed = seed * 1664525 + 1013904223 >>> 0) / 2 ** 32;

    const centers: Lab[] = [pixels[Math.floor(rand() * pixels.length)]];
    while (centers.length < k) {
        const d = pixels.map(p => Math.min(...centers.map(c => dist(p, c))) ** 2);
        const total = d.reduce((s, v) => s + v, 0);
        if (!total) break;
        let r = rand() * total, i = 0;
        while ((r -= d[i]) > 0 && i < d.length - 1) i++;
        centers.push(pixels[i]);
    }

    let assign = new Array<number>(pixels.length).fill(0);
    for (let iter = 0; iter < 14; iter++) {
        assign = pixels.map(p => {
            let best = 0, bd = Infinity;
            centers.forEach((c, i) => {
                const v = dist(p, c);
                if (v < bd) { bd = v; best = i; }
            });
            return best;
        });
        const sums = centers.map(() => [0, 0, 0, 0]);
        pixels.forEach((p, i) => {
            const s = sums[assign[i]];
            s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
        });
        sums.forEach((s, i) => { if (s[3]) centers[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
    }

    const sizes = centers.map(() => 0);
    assign.forEach(a => sizes[a]++);
    const clusters = centers
        .map((lab, i) => ({ lab, weight: sizes[i] / pixels.length, score: sizes[i] * (0.4 + Math.hypot(lab[1], lab[2]) * boost) }))
        .filter(c => c.weight > 0)
        .sort((a, b) => b.score - a.score);

    const picked: Cluster[] = [];
    for (const c of clusters)
        if (picked.length < count && picked.every(p => dist(p.lab, c.lab) > 0.07)) picked.push(c);

    const colors = sortColors(picked, order).map(c => labToInt(c.lab));
    return colors.length < count ? ramp(colors, count) : colors;
}

export function ramp(colors: number[], count: number): number[] {
    if (colors.length === 1) {
        const [L, C, h] = labToLch(intToLab(colors[0]));
        return evenly(count).map(t => lchToInt([L + (0.5 - t) * 0.36, C, h]));
    }
    return resample(colors.map((color, i) => ({ pos: i / (colors.length - 1), color })), count);
}

function permutations(items: number[]): number[][] {
    if (items.length <= 1) return [items];
    return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(p => [x, ...p]));
}

export function reorder(colors: number[], loop: boolean, mode: "smooth" | "alternate"): number[] {
    if (colors.length < 3) return colors;
    const labs = colors.map(intToLab);
    const rest = colors.map((_, i) => i).slice(1);
    let best = colors.map((_, i) => i), bestCost = mode === "smooth" ? Infinity : -Infinity;
    for (const perm of permutations(rest)) {
        const order = [0, ...perm];
        let cost = 0;
        for (let i = 1; i < order.length; i++) cost += dist(labs[order[i - 1]], labs[order[i]]);
        if (loop) cost += dist(labs[order[order.length - 1]], labs[order[0]]);
        if (mode === "smooth" ? cost < bestCost : cost > bestCost) {
            bestCost = cost;
            best = order;
        }
    }
    return best.map(i => colors[i]);
}

export interface Adjustment { hue: number; chroma: number; light: number; }

export const adjust = (colors: number[], { hue, chroma, light }: Adjustment) => colors.map(c => {
    const [L, C, h] = labToLch(intToLab(c));
    return lchToInt([L + light, C * chroma, h + hue]);
});

export function luminance(c: number) {
    return [c >> 16 & 255, c >> 8 & 255, c & 255]
        .map(v => toLinear(v / 255))
        .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
}

export function contrast(a: number, b: number) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export const LIGHT_TEXT = 0xffffff;
export const DARK_TEXT = 0x060607;

export function readability(primary: number, accent: number) {
    const text = contrast(primary, LIGHT_TEXT) >= contrast(primary, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;
    return { text, ratio: Math.min(contrast(text, primary), contrast(text, accent)) };
}

export function makeReadable(primary: number, accent: number, target = 4.5): [number, number] {
    const { text } = readability(primary, accent);
    const step = text === LIGHT_TEXT ? -0.02 : 0.02;
    const shift = (c: number) => {
        let [L, C, h] = labToLch(intToLab(c));
        let out = c;
        for (let i = 0; i < 50 && contrast(text, out) < target; i++) {
            L = Math.min(1, Math.max(0, L + step));
            out = lchToInt([L, C, h]);
        }
        return out;
    };
    return [shift(primary), shift(accent)];
}

export function pickPair(colors: number[], mode?: "light" | "dark"): [number, number] {
    const lch = colors.map(c => labToLch(intToLab(c)));
    const light = mode ? mode === "light" : lch.reduce((sum, v) => sum + v[0], 0) / lch.length > 0.62;
    let base = 0;
    lch.forEach((v, i) => { if (light ? v[0] > lch[base][0] : v[0] < lch[base][0]) base = i; });
    let pop = -1;
    lch.forEach((v, i) => { if (i !== base && (pop < 0 || v[1] > lch[pop][1])) pop = i; });
    if (pop < 0) pop = base;
    const [L, C, h] = lch[base];
    const primary = lchToInt([light ? Math.max(L, 0.8) : Math.min(L, 0.42), C, h]);
    const [pl] = labToLch(intToLab(primary));
    const [aL, aC, aH] = pop === base ? [L, C, h] : lch[pop];
    const gap = Math.abs(aL - pl);
    const accent = pop !== base && gap >= 0.25 ? colors[pop] : lchToInt([light ? Math.min(aL, pl - 0.3) : Math.max(aL, pl + 0.3), Math.max(aC, 0.08), aH]);
    return [primary, accent];
}

export const ACCENT_IDEAS = {
    opposite: { label: "Opposite", offsets: [180] },
    near: { label: "Neighbour", offsets: [35, -35] },
    soft: { label: "Soft opposite", offsets: [150, 210] },
    triangle: { label: "Triangle", offsets: [120, 240] },
    same: { label: "Same, brighter", offsets: [0] }
} as const;

export function accentIdeas(primary: number): { key: string; label: string; color: number; }[] {
    const [L, C, h] = labToLch(intToLab(primary));
    const l = Math.max(0.66, Math.min(0.85, L + 0.3));
    const c = Math.max(0.13, C);
    return Object.entries(ACCENT_IDEAS).flatMap(([key, v]) =>
        v.offsets.map((o, i) => ({ key: `${key}${i}`, label: v.label, color: lchToInt([l, c, h + o]) })));
}

export const MOODS: Record<string, [number, number]> = {
    Midnight: [0x0d1b2a, 0x5a7bb8],
    Candy: [0xff8fc7, 0x8fd3ff],
    Ember: [0x3a0d0d, 0xff6b2b],
    Ocean: [0x0b2e3f, 0x2ec4b6],
    Forest: [0x10251b, 0x7bc950],
    Dusk: [0x2b1a3d, 0xff9e7a],
    Gold: [0x2a2112, 0xf2c14e],
    Mono: [0x1e1f22, 0xb5bac1]
};

export function parseThemeCode(text: string): [number, number] | null {
    const hexes = text.match(/#?[0-9a-f]{6}\b/gi);
    if (!hexes || hexes.length < 2) return null;
    return [fromHex(hexes[0])!, fromHex(hexes[1])!];
}

export const themeCode = ([p, a]: [number, number]) => `theme:${toHex(p)},${toHex(a)}`;

export function toHsl(c: number): [number, number, number] {
    const r = (c >> 16 & 255) / 255, g = (c >> 8 & 255) / 255, b = (c & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
}

export function fromHsl(h: number, s: number, l: number): number {
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) * 255);
    return f(0) << 16 | f(8) << 8 | f(4);
}

export function discordShades(c: number) {
    const [h, s, l] = toHsl(c);
    return {
        main: c,
        light1: fromHsl(h, s, Math.min(1, 1.2 * l)),
        light2: fromHsl(h, s, Math.min(1, 1.6 * l)),
        dark1: fromHsl(h, s, Math.max(0, 0.6 * l)),
        dark2: fromHsl(h, s, Math.max(0, 0.2 * l)),
        toonStroke: fromHsl(h, s, Math.max(0.12, 0.4 * l)),
        neonStroke: fromHsl(h, Math.min(1, 1.2 * s), Math.min(0.6, l + 0.1))
    };
}

export function variations(c: number): { label: string; color: number; }[] {
    const [L, C, h] = labToLch(intToLab(c));
    return [
        { label: "Lighter", color: lchToInt([L + 0.12, C, h]) },
        { label: "Darker", color: lchToInt([L - 0.12, C, h]) },
        { label: "Bolder", color: lchToInt([L, C * 1.5 + 0.02, h]) },
        { label: "Softer", color: lchToInt([L, C * 0.55, h]) },
        { label: "Warmer", color: lchToInt([L, C, h + 18]) },
        { label: "Cooler", color: lchToInt([L, C, h - 18]) },
        { label: "Pastel", color: lchToInt([Math.max(L, 0.85), Math.min(C, 0.09), h]) },
        { label: "Neon", color: lchToInt([0.75, 0.3, h]) },
        { label: "Deep", color: lchToInt([Math.min(L, 0.42), C * 1.1, h]) }
    ];
}

export const NAME_PRESETS: Record<string, number[]> = {
    Sakura: [0xff8fc7, 0xffb7d5, 0xf472b6, 0xffd1e8, 0xff6fae],
    Ocean: [0x5ad1ff, 0x2ec4b6, 0x8fd3ff, 0x3a86ff, 0xa0e7ff],
    Sunset: [0xff9e7a, 0xff6b6b, 0xffd166, 0xf78c6b, 0xffb4a2],
    Mint: [0x7bf1a8, 0x2ee59d, 0xb8f2e6, 0x5ce1e6, 0xa8e6cf],
    Lavender: [0xc3b1e1, 0xa78bfa, 0xe0aaff, 0xb388ff, 0xd6c6ff],
    Gold: [0xf2c14e, 0xffd700, 0xffe8a3, 0xe9b949, 0xfff1b8],
    Ice: [0xa5d8ff, 0xdff6ff, 0x74c0fc, 0xc5f6fa, 0x91e0ff],
    Ember: [0xff6b2b, 0xff3d00, 0xffb36b, 0xff8a3d, 0xffd0a8],
    Neon: [0x39ff14, 0xff00e6, 0x00f0ff, 0xfffb00, 0xff3131],
    Mono: [0xffffff, 0xd9d9d9, 0xb5bac1, 0xeeeeee, 0xc8c8c8]
};
