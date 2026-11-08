/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@webpack/common";

import { extractPalette, intToLab, Lab, labToLch } from "./color";
import { readPixels } from "./sources";

const palettes = new Map<string, number[] | null>();
const queued = new Map<string, string>();
const listeners = new Set<() => void>();
let running = 0;
let notifyFrame = 0;

const LIMIT = 4;

function notify() {
    if (notifyFrame) return;
    notifyFrame = requestAnimationFrame(() => {
        notifyFrame = 0;
        for (const l of listeners) l();
    });
}

function pump() {
    while (running < LIMIT && queued.size) {
        const [key, url] = queued.entries().next().value!;
        queued.delete(key);
        running++;
        readPixels(url)
            .then(px => palettes.set(key, px.length ? extractPalette(px, 3, "weight") : null), () => palettes.set(key, null))
            .finally(() => {
                running--;
                notify();
                pump();
            });
    }
}

export function knowColors(key: string, colors: number[]) {
    if (palettes.get(key)) return;
    palettes.set(key, colors);
    notify();
}

export function wantColors(key: string, url: string | undefined) {
    if (!url || palettes.has(key) || queued.has(key)) return;
    queued.set(key, url);
    pump();
}

export const colorsOf = (key: string) => palettes.get(key) ?? undefined;

export const pendingCount = () => queued.size + running;

export function useColorIndex() {
    const [, bump] = useState(0);
    useEffect(() => {
        const l = () => bump(n => n + 1);
        listeners.add(l);
        return () => void listeners.delete(l);
    }, []);
}

const dist = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function hueKey(colors: number[]): number {
    const [L, C, h] = labToLch(intToLab(colors[0]));
    return C < 0.04 ? 1000 + (1 - L) : h;
}

export function matchScore(colors: number[], targets: number[]): number {
    const ts = targets.map(intToLab);
    const cs = colors.map(intToLab);
    let total = 0;
    for (let i = 0; i < cs.length; i++) {
        const best = Math.min(...ts.map(t => dist(cs[i], t)));
        total += best * (i === 0 ? 2 : 1);
    }
    return total / (cs.length + 1);
}
