/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type Pt = [number, number];

export interface StrokeOptions {
    step: number;
    diagonals: boolean;
    steady: number;
}

export interface Reading {
    gesture: string;
    loose: string;
    smooth: Pt[];
    size: number;
}

const ARROWS: Record<string, string> = { L: "←", R: "→", U: "↑", D: "↓", 7: "↖", 9: "↗", 1: "↙", 3: "↘" };
const FOUR = ["R", "D", "L", "U"];
const DIAGONALS = ["3", "1", "7", "9"];
const MAX_POINTS = 400;
const MAX_TURNS = 8;
const MIN_SPACING = 2;

export const arrows = (gesture: string) => [...gesture].map(c => ARROWS[c]).join(" ");

function smoothed(points: Pt[], reach: number): Pt[] {
    if (reach < 1 || points.length < 3) return points;
    return points.map((p, i) => {
        if (i === 0 || i === points.length - 1) return p;
        const from = Math.max(0, i - reach), to = Math.min(points.length - 1, i + reach);
        let x = 0, y = 0;
        for (let k = from; k <= to; k++) {
            x += points[k][0];
            y += points[k][1];
        }
        return [x / (to - from + 1), y / (to - from + 1)] as Pt;
    });
}

function distanceToSegment([px, py]: Pt, [ax, ay]: Pt, [bx, by]: Pt) {
    const dx = bx - ax, dy = by - ay;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function corners(points: Pt[], tolerance: number): Pt[] {
    if (points.length < 3) return points;
    const first = points[0], last = points[points.length - 1];
    let worst = 0, at = 0;
    for (let i = 1; i < points.length - 1; i++) {
        const d = distanceToSegment(points[i], first, last);
        if (d > worst) {
            worst = d;
            at = i;
        }
    }
    if (worst <= tolerance) return [first, last];
    return [...corners(points.slice(0, at + 1), tolerance).slice(0, -1), ...corners(points.slice(at), tolerance)];
}

function direction(dx: number, dy: number, diagonals: boolean, bias: number) {
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const quarter = Math.round(angle / 90);
    const cardinal = FOUR[(quarter % 4 + 4) % 4];
    if (!diagonals || Math.abs(angle - quarter * 90) <= 22.5 + bias) return cardinal;
    return DIAGONALS[(Math.floor(angle / 90) % 4 + 4) % 4];
}

export function recognise(raw: Pt[], o: StrokeOptions): Reading {
    const smooth = smoothed(raw, Math.round(o.steady * 5));
    const xs = smooth.map(p => p[0]), ys = smooth.map(p => p[1]);
    const size = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const none: Reading = { gesture: "", loose: "", smooth, size };
    if (smooth.length < 2 || size < o.step) return none;

    const turns = corners(smooth, Math.max(2, size * (0.05 + 0.15 * o.steady)));
    const lines = turns.slice(1).map((p, i) => ({ dx: p[0] - turns[i][0], dy: p[1] - turns[i][1], length: Math.hypot(p[0] - turns[i][0], p[1] - turns[i][1]) }));
    const longest = Math.max(...lines.map(l => l.length));
    const shortest = Math.max(o.step * 0.6, longest * (0.2 + 0.2 * o.steady));
    const kept = lines.filter(l => l.length >= shortest);
    const read = (diagonals: boolean) => kept.map(l => direction(l.dx, l.dy, diagonals, 10 * o.steady)).join("").replace(/(.)\1+/g, "$1");

    const loose = read(false);
    const gesture = o.diagonals ? read(true) : loose;
    if (gesture.length > MAX_TURNS) return none;
    return { gesture, loose: loose.length > MAX_TURNS ? "" : loose, smooth, size };
}

export class Stroke implements Reading {
    gesture = "";
    loose = "";
    size = 0;
    points: Pt[] = [];
    smooth: Pt[];

    constructor(x: number, y: number, private options: StrokeOptions) {
        this.points.push([x, y]);
        this.smooth = this.points;
    }

    add(x: number, y: number) {
        const [lx, ly] = this.points[this.points.length - 1];
        if (Math.hypot(x - lx, y - ly) < MIN_SPACING) return false;
        this.points.push([x, y]);
        if (this.points.length > MAX_POINTS) this.points = this.points.filter((_, i, all) => i % 2 === 0 || i === all.length - 1);
        const before = this.gesture;
        const reading = recognise(this.points, this.options);
        this.gesture = reading.gesture;
        this.loose = reading.loose;
        this.smooth = reading.smooth;
        this.size = reading.size;
        return this.gesture !== before;
    }
}
