/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Action, allActions, resolve } from "./actions";
import { settings } from "./settings";
import { Context } from "./zones";

export type Point = [number, number];

export interface Shape {
    id: string;
    name: string;
    samples: Point[][];
    action: string;
}

export const SAMPLES = 3;
export const threshold = () => 0.72 - (settings.store.steady ? settings.store.steadyAmount / 1000 : 0);
export const MIN_LENGTH = 30;
const POINTS = 32;

export function pathLength(points: Point[]) {
    let total = 0;
    for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    return total;
}

function resample(input: Point[]) {
    const points = input.map(p => [p[0], p[1]] as Point);
    const step = pathLength(points) / (POINTS - 1);
    const out: Point[] = [points[0]];
    let walked = 0;
    for (let i = 1; i < points.length; i++) {
        const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
        if (d > 0 && walked + d >= step) {
            const t = (step - walked) / d;
            const q: Point = [points[i - 1][0] + t * (points[i][0] - points[i - 1][0]), points[i - 1][1] + t * (points[i][1] - points[i - 1][1])];
            out.push(q);
            points.splice(i, 0, q);
            walked = 0;
        } else walked += d;
    }
    while (out.length < POINTS) out.push(points[points.length - 1]);
    return out.slice(0, POINTS);
}

export function normalize(input: Point[]): Point[] {
    const points = resample(input);
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const size = Math.max(maxX - minX, maxY - minY) || 1;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return points.map(([x, y]) => [Math.round((x - cx) / size * 1000) / 1000, Math.round((y - cy) / size * 1000) / 1000]);
}

function distance(a: Point[], b: Point[]) {
    let total = 0;
    for (let i = 0; i < POINTS; i++) total += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]);
    return total / POINTS;
}

export const shapeAction = (shape: Shape) => allActions().find(a => a.id === shape.action);

export const isReady = (shape: Shape) => shape.samples.length >= SAMPLES && !!shapeAction(shape);

const allowedIn = (action: Action, ctx: Context | null) => !ctx || action.zone === "anywhere" || ctx.zones.includes(action.zone);

export interface ShapeMatch { shape: Shape; action: Action; score: number; }

export function bestShape(points: Point[], ctx: Context | null, shapes: Shape[] = settings.store.shapes): ShapeMatch | null {
    if (points.length < 6 || pathLength(points) < MIN_LENGTH) return null;
    const drawn = normalize(points);
    let best: ShapeMatch | null = null;
    for (const shape of shapes) {
        const action = shapeAction(shape);
        if (!action || shape.samples.length < SAMPLES || !allowedIn(action, ctx)) continue;
        for (const sample of shape.samples) {
            if (sample.length !== POINTS) continue;
            const score = 1 - Math.min(distance(drawn, sample), distance(drawn, [...sample].reverse())) / 0.35;
            if (!best || score > best.score) best = { shape, action, score };
        }
    }
    return best;
}

export const matchShape = (points: Point[], ctx: Context | null) => {
    const best = bestShape(points, ctx);
    return best && best.score >= threshold() ? best : null;
};

export const shapeIcon = (sample: Point[], size = 24) =>
    sample.map(([x, y]) => `${(size / 2 + x * size * 0.75).toFixed(1)},${(size / 2 + y * size * 0.75).toFixed(1)}`).join(" ");

const ARROW_STEP: Record<string, Point> = { L: [-1, 0], R: [1, 0], U: [0, -1], D: [0, 1], 7: [-0.71, -0.71], 9: [0.71, -0.71], 1: [-0.71, 0.71], 3: [0.71, 0.71] };
const fromArrowsCache = new Map<string, Point[]>();

function fromArrows(gesture: string) {
    let template = fromArrowsCache.get(gesture);
    if (!template) {
        const line: Point[] = [[0, 0]];
        for (const c of gesture) {
            const [x, y] = line[line.length - 1];
            line.push([x + ARROW_STEP[c][0], y + ARROW_STEP[c][1]]);
        }
        template = normalize(line);
        fromArrowsCache.set(gesture, template);
    }
    return template;
}

export function templatesOf(id: string): Point[][] {
    const drawn = settings.store.drawn?.[id];
    if (drawn?.length) return drawn;
    const arrows = settings.store.bindings[id];
    return arrows ? [fromArrows(arrows)] : [];
}

export const hasGesture = (id: string) => templatesOf(id).length > 0;

const likeness = (a: Point[], b: Point[]) => 1 - distance(a, b) / 0.35;

export const similar = (a: Point[], b: Point[]) => likeness(a, b) >= threshold();

export interface CommandMatch { action: Action; score: number; }

export function bestCommand(points: Point[], ctx: Context, drawn = normalize(points)): CommandMatch | null {
    const zones = [...ctx.zones, "anywhere"];
    const found: (CommandMatch & { rank: number; })[] = [];
    for (const action of allActions()) {
        const rank = zones.indexOf(action.zone);
        if (rank < 0) continue;
        let score = -Infinity;
        for (const template of templatesOf(action.id))
            if (template.length === POINTS) score = Math.max(score, likeness(drawn, template));
        if (score > -Infinity) found.push({ action, score, rank });
    }
    if (!found.length) return null;
    const top = Math.max(...found.map(f => f.score));
    return found.filter(f => f.score >= top - 0.04).sort((a, b) => a.rank - b.rank || b.score - a.score)[0];
}

export function readCommand(points: Point[], gesture: string, loose: string, ctx: Context): Action | undefined {
    const long = points.length >= 3 && pathLength(points) >= settings.store.stepSize;
    const match = long ? bestCommand(points, ctx) : null;
    const shape = match && match.score >= threshold() ? match.action : undefined;
    if (shape && settings.store.drawn?.[shape.id]?.length) return shape;
    return (gesture ? resolve(gesture, ctx) : undefined) ?? shape ?? (gesture ? resolve(gesture, ctx, loose) : undefined);
}
