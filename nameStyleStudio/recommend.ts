/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { contrast, extractPalette, intToLab, labToLch, lchToInt, pickPair, readability, reorder } from "./color";
import { loadSources, nameStyleColors, readPixels } from "./sources";

export interface Suggestion { pair: [number, number]; label: string; }

const MOOD_SHAPES: { label: string; base: [number, number]; pop: [number, number]; baseHue: 1 | 2; popHue: 1 | 2; shift?: number; }[] = [
    { label: "Pastel", base: [0.84, 0.07], pop: [0.94, 0.06], baseHue: 1, popHue: 2 },
    { label: "Soft", base: [0.7, 0.09], pop: [0.9, 0.08], baseHue: 2, popHue: 1 },
    { label: "Sunlit", base: [0.88, 0.05], pop: [0.72, 0.13], baseHue: 2, popHue: 1 },
    { label: "Vivid", base: [0.5, 0.16], pop: [0.82, 0.15], baseHue: 1, popHue: 2 },
    { label: "Midnight", base: [0.2, 0.05], pop: [0.8, 0.12], baseHue: 1, popHue: 2 },
    { label: "Glow", base: [0.26, 0.08], pop: [0.86, 0.14], baseHue: 2, popHue: 1 },
    { label: "Opposite", base: [0.78, 0.08], pop: [0.6, 0.13], baseHue: 1, popHue: 1, shift: 180 },
    { label: "Mono", base: [0.86, 0.03], pop: [0.4, 0.06], baseHue: 1, popHue: 1 }
];

const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

function moodsFrom(colors: number[]): Suggestion[] {
    const lch = colors.map(c => labToLch(intToLab(c))).filter(([, C]) => C > 0.025);
    if (!lch.length) return [];
    const h1 = lch[0][2];
    const h2 = lch.find(([, , h]) => hueGap(h, h1) > 25)?.[2] ?? h1 + 40;
    const own: Suggestion = { label: "Straight from you", pair: [colors[0], colors.find(c => hueGap(labToLch(intToLab(c))[2], h1) > 25) ?? colors[1] ?? colors[0]] };
    const hueOf = (n: 1 | 2) => n === 1 ? h1 : h2;
    return [own, ...MOOD_SHAPES.map(m => ({
        label: m.label,
        pair: [lchToInt([m.base[0], m.base[1], hueOf(m.baseHue) + (m.shift ?? 0)]), lchToInt([m.pop[0], m.pop[1], hueOf(m.popHue) + (m.shift ?? 0)])] as [number, number]
    }))];
}

const areas = new Map<string, Promise<number[]>>();

function areaPalette(src: string) {
    let p = areas.get(src);
    if (!p) {
        p = readPixels(src).then(px => extractPalette(px.filter(([L]) => L > 0.16 && L < 0.97), 6, "weight", 0.6), () => []);
        areas.set(src, p);
        if (areas.size > 20) areas.delete(areas.keys().next().value!);
    }
    return p;
}

const palettes = new Map<string, Promise<number[]>>();

function paletteOf(src: string) {
    let p = palettes.get(src);
    if (!p) {
        p = readPixels(src).then(px => extractPalette(px.filter(([L]) => L > 0.1 && L < 0.98), 5, "weight", 2), () => []);
        palettes.set(src, p);
        if (palettes.size > 40) palettes.delete(palettes.keys().next().value!);
    }
    return p;
}

const near = (a: number, b: number) => {
    const x = intToLab(a), y = intToLab(b);
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 0.06;
};

function score([p, a]: [number, number], light: boolean) {
    const ratio = Math.min(readability(p, a).ratio, 7);
    const lightness = intToLab(p)[0];
    return ratio + labToLch(intToLab(a))[1] * 8 + (light ? lightness * 10 : (1 - lightness) * 2);
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

    const all = parts.flatMap(p => p.colors);
    const light = all.length > 0 && all.reduce((sum, c) => sum + intToLab(c)[0], 0) / all.length > 0.62;
    const build = (mode: "light" | "dark") => {
        const tag = mode === "light" ? "light" : "dark";
        const list: Suggestion[] = parts.map(p => ({ pair: pickPair(p.colors, mode), label: `${p.label}, ${tag}` }));
        if (parts.length > 1) {
            list.push({ pair: pickPair(all, mode), label: `Everything together, ${tag}` });
            for (const base of parts)
                for (const pop of parts)
                    if (base !== pop)
                        list.push({ pair: [pickPair(base.colors, mode)[0], pickPair(pop.colors, mode)[1]], label: `${base.label} with ${pop.label.toLowerCase()} accent, ${tag}` });
        }
        return list.sort((x, y) => score(y.pair, mode === "light") - score(x.pair, mode === "light"));
    };

    const picked: Suggestion[] = [];
    const take = (list: Suggestion[], count: number) => {
        let added = 0;
        for (const c of list) {
            if (added >= count) break;
            if (picked.some(p => near(p.pair[0], c.pair[0]) && near(p.pair[1], c.pair[1]))) continue;
            picked.push(c);
            added++;
        }
    };
    take(build(light ? "light" : "dark"), 5);
    take(build(light ? "dark" : "light"), 3);

    const avatar = sources.find(x => x.id === "avatar")?.image;
    const own = avatar ? await areaPalette(avatar) : [];
    return { suggestions: picked, moods: moodsFrom(own.length ? own : parts.flatMap(p => p.colors)), basis: parts.map(p => p.label) };
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
