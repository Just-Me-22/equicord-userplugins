/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const ARROWS: Record<string, string> = { L: "←", R: "→", U: "↑", D: "↓", 7: "↖", 9: "↗", 1: "↙", 3: "↘" };
const EIGHT = ["R", "3", "D", "1", "L", "7", "U", "9"];
const MAX_POINTS = 600;
const SECTOR_SLACK = 15;

export const arrows = (gesture: string) => [...gesture].map(c => ARROWS[c]).join(" ");

export class Stroke {
    gesture = "";
    points: [number, number][] = [];
    private ax: number;
    private ay: number;

    constructor(x: number, y: number, private step: number, private diagonals: boolean) {
        this.ax = x;
        this.ay = y;
        this.points.push([x, y]);
    }

    private direction(dx: number, dy: number) {
        const ax = Math.abs(dx), ay = Math.abs(dy);
        if (!this.diagonals) {
            if (Math.max(ax, ay) < 1.4 * Math.min(ax, ay)) return null;
            return ax > ay ? (dx > 0 ? "R" : "L") : (dy > 0 ? "D" : "U");
        }
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        const sector = Math.round(angle / 45);
        if (Math.abs(angle - sector * 45) > SECTOR_SLACK) return null;
        return EIGHT[(sector + 8) % 8];
    }

    add(x: number, y: number) {
        if (this.points.length < MAX_POINTS) this.points.push([x, y]);
        const dx = x - this.ax, dy = y - this.ay;
        if (Math.hypot(dx, dy) < this.step) return false;
        const dir = this.direction(dx, dy);
        if (!dir) return false;
        this.ax = x;
        this.ay = y;
        if (this.gesture.endsWith(dir)) return false;
        this.gesture += dir;
        return true;
    }
}
