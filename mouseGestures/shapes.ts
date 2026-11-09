/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Action, allActions } from "./actions";
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
export const THRESHOLD = 0.72;
export const MIN_LENGTH = 60;
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
    return best && best.score >= THRESHOLD ? best : null;
};

export const shapeIcon = (sample: Point[], size = 24) =>
    sample.map(([x, y]) => `${(size / 2 + x * size * 0.75).toFixed(1)},${(size / 2 + y * size * 0.75).toFixed(1)}`).join(" ");
