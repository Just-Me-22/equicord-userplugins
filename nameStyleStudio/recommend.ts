/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { contrast, extractPalette, intToLab, labToLch, lchToInt, pickPair, readability, reorder } from "./color";
import { loadSources, nameStyleColors, readPixels } from "./sources";

export interface Suggestion { pair: [number, number]; label: string; }

const MOOD_SHAPES: { label: string; base: [number, number]; pop: [number, number]; shift: number; second?: boolean; }[] = [
    { label: "Midnight", base: [0.2, 0.05], pop: [0.66, 0.12], shift: 0 },
    { label: "Vivid", base: [0.4, 0.18], pop: [0.78, 0.17], shift: 0, second: true },
    { label: "Pastel", base: [0.8, 0.06], pop: [0.92, 0.07], shift: 25 },
    { label: "Glow", base: [0.24, 0.09], pop: [0.82, 0.16], shift: 0, second: true },
    { label: "Warm shift", base: [0.32, 0.12], pop: [0.8, 0.14], shift: 40 },
    { label: "Cool shift", base: [0.3, 0.1], pop: [0.74, 0.13], shift: -40 },
    { label: "Opposite", base: [0.3, 0.12], pop: [0.8, 0.14], shift: 180 },
    { label: "Mono", base: [0.22, 0.02], pop: [0.82, 0.05], shift: 0 }
];

function moodsFrom(colors: number[]): Suggestion[] {
    const hues = colors.map(c => labToLch(intToLab(c))).filter(([, C]) => C > 0.04).map(([, , h]) => h);
    if (!hues.length) return [];
    const [h1] = hues;
    const h2 = hues.find(h => Math.abs(((h - h1 + 540) % 360) - 180) > 30) ?? h1;
    return MOOD_SHAPES.map(m => ({
        label: m.label,
        pair: [lchToInt([m.base[0], m.base[1], h1 + m.shift]), lchToInt([m.pop[0], m.pop[1], (m.second ? h2 : h1) + m.shift])]
    }));
}

const palettes = new Map<string, Promise<number[]>>();

function paletteOf(src: string) {
    let p = palettes.get(src);
    if (!p) {
        p = readPixels(src).then(px => extractPalette(px, 5, "weight"), () => []);
        palettes.set(src, p);
        if (palettes.size > 40) palettes.delete(palettes.keys().next().value!);
    }
    return p;
}

const near = (a: number, b: number) => {
    const x = intToLab(a), y = intToLab(b);
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 0.06;
};

function score([p, a]: [number, number]) {
    const ratio = Math.min(readability(p, a).ratio, 7);
    return ratio + labToLch(intToLab(a))[1] * 8;
}

export async function suggest(guildId?: string | null): Promise<{ suggestions: Suggestion[]; moods: Suggestion[]; basis: string[]; }> {
    const sources = await loadSources(guildId);
    const parts: { label: string; colors: number[]; }[] = [];
    for (const s of sources) {
        if (s.id === "theme" || !s.image) continue;
        const colors = await paletteOf(s.image);
        if (colors.length) parts.push({ label: s.label, colors });
    }
    const names = nameStyleColors(guildId);
    if (names) parts.push({ label: "Name style", colors: names });

    const candidates: Suggestion[] = parts.map(p => ({ pair: pickPair(p.colors), label: p.label }));
    if (parts.length > 1) {
        candidates.push({ pair: pickPair(parts.flatMap(p => p.colors)), label: "Everything together" });
        for (const base of parts)
            for (const pop of parts)
                if (base !== pop)
                    candidates.push({ pair: [pickPair(base.colors)[0], pickPair(pop.colors)[1]], label: `${base.label} with ${pop.label.toLowerCase()} accent` });
    }

    const picked: Suggestion[] = [];
    for (const c of candidates.sort((x, y) => score(y.pair) - score(x.pair)))
        if (picked.length < 8 && !picked.some(p => near(p.pair[0], c.pair[0]) && near(p.pair[1], c.pair[1]))) picked.push(c);

    return { suggestions: picked, moods: moodsFrom(parts.flatMap(p => p.colors)), basis: parts.map(p => p.label) };
}

export interface NameSuggestion { colors: number[]; label: string; }

const DARK_CHAT = 0x1a1a1e;

function readable(c: number) {
    let [L, C, h] = labToLch(intToLab(c));
    let out = c;
    for (let i = 0; i < 40 && contrast(out, DARK_CHAT) < 4.5; i++) {
        L = Math.min(1, L + 0.02);
        out = lchToInt([L, C, h]);
    }
    return out;
}

function shape(colors: number[], count: number, loop: boolean) {
    const vivid = [...colors].sort((a, b) => labToLch(intToLab(b))[1] - labToLch(intToLab(a))[1]);
    const picked: number[] = [];
    for (const c of vivid) if (!picked.some(p => near(p, c))) picked.push(c);
    const base = picked.length ? picked : colors;
    const out = Array.from({ length: count }, (_, i) => readable(base[i % base.length]));
    return count > 2 ? reorder(out, loop, "smooth") : out;
}

export async function suggestName(guildId: string | null | undefined, count: number, loop: boolean): Promise<{ suggestions: NameSuggestion[]; basis: string[]; }> {
    const sources = await loadSources(guildId);
    const parts: { label: string; colors: number[]; }[] = [];
    for (const s of sources) {
        const colors = s.image ? await paletteOf(s.image) : s.colors ?? [];
        if (colors.length) parts.push({ label: s.label, colors });
    }

    const candidates: NameSuggestion[] = parts.map(p => ({ colors: shape(p.colors, count, loop), label: `From your ${p.label.toLowerCase()}` }));
    if (parts.length > 1) {
        candidates.push({ colors: shape(parts.flatMap(p => p.colors), count, loop), label: "Everything together" });
        if (count > 1)
            for (const base of parts)
                for (const pop of parts)
                    if (base !== pop)
                        candidates.push({ colors: shape([...base.colors.slice(0, 2), ...pop.colors.slice(0, 2)], count, loop), label: `${base.label} with ${pop.label.toLowerCase()}` });
    }

    const picked: NameSuggestion[] = [];
    for (const c of candidates)
        if (picked.length < 8 && !picked.some(p => p.colors.every((x, i) => near(x, c.colors[i])))) picked.push(c);

    return { suggestions: picked, basis: parts.map(p => p.label) };
}
