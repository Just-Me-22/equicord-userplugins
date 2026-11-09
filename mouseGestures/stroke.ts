/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const ARROWS: Record<string, string> = { L: "←", R: "→", U: "↑", D: "↓" };

export const arrows = (gesture: string) => [...gesture].map(c => ARROWS[c]).join(" ");

const MAX_POINTS = 600;

export class Stroke {
    gesture = "";
    points: [number, number][] = [];
    private ax: number;
    private ay: number;

    constructor(x: number, y: number, private step: number) {
        this.ax = x;
        this.ay = y;
        this.points.push([x, y]);
    }

    add(x: number, y: number) {
        if (this.points.length < MAX_POINTS) this.points.push([x, y]);
        const dx = x - this.ax, dy = y - this.ay;
        const ax = Math.abs(dx), ay = Math.abs(dy);
        if (Math.max(ax, ay) < this.step || Math.max(ax, ay) < 1.4 * Math.min(ax, ay)) return false;
        this.ax = x;
        this.ay = y;
        const dir = ax > ay ? (dx > 0 ? "R" : "L") : (dy > 0 ? "D" : "U");
        if (this.gesture.endsWith(dir)) return false;
        this.gesture += dir;
        return true;
    }
}
