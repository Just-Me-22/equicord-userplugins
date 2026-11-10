/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { allActions } from "./actions";
import { accent, paintFrame } from "./overlay";
import { settings, strokeOptions } from "./settings";
import { isReady, matchShape, Point, readCommand, shapeAction, templatesOf } from "./shapes";
import { Stroke } from "./stroke";
import { Context, Zone, ZONES } from "./zones";

export type Spot = "still" | "fade" | "ready" | "reach";
type Phase = "ready" | "go" | "draw" | "hold" | "fade" | "rest" | "reach" | "user";

interface Demo {
    template: Point[];
    ctx: Context;
    label: string;
    keys: string;
    zone: Zone;
}

const CALM = matchMedia("(prefers-reduced-motion: reduce)");
const MATCH_EVERY = 70;
const GO = 160;
const HOLD = 520;
const CALM_HOLD = 1600;
const REST = 420;
const STILL = 1500;
const PAD = 22;
const GAP = 3;
const LIMIT = 14;
const WAVE: Point[] = Array.from({ length: 24 }, (_, i) => [i / 23 - 0.5, Math.sin(i / 23 * Math.PI * 2) * 0.22]);

const prefix = (zone: Zone) => zone === "anywhere" ? "" : `${ZONES.find(z => z.id === zone)!.label}: `;
const ease = (t: number) => -(Math.cos(Math.PI * Math.min(1, t)) - 1) / 2;
const contextFor = (zone: Zone): Context => ({ zones: zone === "anywhere" ? [] : [zone], targets: {} });

function demos(): Demo[] {
    const list: Demo[] = [];
    for (const shape of settings.store.shapes) {
        const action = isReady(shape) ? shapeAction(shape) : undefined;
        if (action) list.push({ template: shape.samples[0], ctx: contextFor(action.zone), label: action.label, keys: `◎ ${shape.name}`, zone: action.zone });
    }
    for (const action of allActions()) {
        const template = templatesOf(action.id)[0];
        if (template) list.push({ template, ctx: contextFor(action.zone), label: action.label, keys: "✓", zone: action.zone });
    }
    return list.slice(0, LIMIT);
}

function fitTo(points: Point[], w: number, h: number): Point[] {
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = Math.min((w - PAD * 2) / Math.max(maxX - minX, 0.001), (h - PAD * 2) / Math.max(maxY - minY, 0.001), 150);
    const ox = w / 2 - (minX + maxX) / 2 * scale, oy = h / 2 - (minY + maxY) / 2 * scale;
    return points.map(([x, y]) => [ox + x * scale, oy + y * scale]);
}

function soften(points: Point[]): Point[] {
    if (points.length < 3) return points;
    const out: Point[] = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
        const [ax, ay] = points[i], [bx, by] = points[i + 1];
        out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    out.push(points[points.length - 1]);
    return out;
}

function spread(points: Point[]): Point[] {
    const out: Point[] = [points[0]];
    let carry = 0;
    for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1], [bx, by] = points[i];
        const length = Math.hypot(bx - ax, by - ay);
        let at = GAP - carry;
        while (at <= length) {
            out.push([ax + (bx - ax) * at / length, ay + (by - ay) * at / length]);
            at += GAP;
        }
        carry = length - (at - GAP);
    }
    out.push(points[points.length - 1]);
    return out;
}

export class LiveTrail {
    private pen: CanvasRenderingContext2D | null;
    private frame = 0;
    private list: Demo[] = [];
    private index = -1;
    private demo: Demo | null = null;
    private path: Point[] = [];
    private stroke: Stroke | null = null;
    private fed = 0;
    private phase: Phase = "rest";
    private at = 0;
    private matchedAt = 0;
    private keys = "";
    private label: string | null = null;
    private tip: Point = [0, 0];
    private dirty = false;
    private w = 0;
    private h = 0;
    private readonly brand = accent();
    private readonly observer: ResizeObserver;

    constructor(private readonly canvas: HTMLCanvasElement, private readonly onDemo: (name: string) => void) {
        this.pen = canvas.getContext("2d");
        this.observer = new ResizeObserver(() => this.resize());
        this.observer.observe(canvas);
        this.resize();
        this.play(0, performance.now());
        this.frame = requestAnimationFrame(this.tick);
    }

    stop() {
        cancelAnimationFrame(this.frame);
        this.observer.disconnect();
    }

    spot(kind: Spot) {
        const now = performance.now();
        if (this.phase === "user") return;
        if (kind === "ready") return this.play(this.index, now);
        if (kind === "reach") {
            this.show(1);
            this.enter("reach", now);
            return;
        }
        this.whole();
        this.enter("hold", kind === "fade" ? now - HOLD + 250 : now - HOLD + STILL);
    }

    down(x: number, y: number) {
        this.stroke = new Stroke(x, y, strokeOptions());
        this.demo = null;
        this.keys = "";
        this.label = null;
        this.tip = [x, y];
        this.show(1);
        this.onDemo("Your stroke");
        this.enter("user", performance.now());
    }

    move(x: number, y: number) {
        if (this.phase !== "user" || !this.stroke) return;
        this.dirty = this.stroke.push(x, y) || this.dirty;
        this.tip = [x, y];
    }

    up() {
        if (this.phase !== "user" || !this.stroke) return;
        this.stroke.read();
        this.judge(contextFor("anywhere"));
        this.paint();
        this.fade(performance.now());
    }

    private readonly tick = (now: number) => {
        this.frame = requestAnimationFrame(this.tick);
        const spent = now - this.at;
        switch (this.phase) {
            case "ready": {
                const hold = settings.store.holdStart;
                this.ring(Math.min(1, spent / hold), false);
                if (spent >= hold) this.enter("go", now);
                break;
            }
            case "go":
                this.ring(1, true);
                if (spent >= GO) this.enter("draw", now);
                break;
            case "draw": {
                const length = this.path.length * GAP;
                const t = spent / Math.min(1300, Math.max(520, length * 2.6));
                this.feed(Math.ceil(ease(t) * this.path.length));
                if (now - this.matchedAt >= MATCH_EVERY) {
                    this.matchedAt = now;
                    this.judge(this.demo!.ctx);
                }
                if (t >= 1) {
                    this.settle();
                    this.enter("hold", now);
                }
                this.paint();
                break;
            }
            case "user":
                if (this.dirty) {
                    this.dirty = false;
                    this.stroke!.read();
                }
                if (now - this.matchedAt >= MATCH_EVERY) {
                    this.matchedAt = now;
                    this.judge(contextFor("anywhere"));
                }
                this.paint();
                break;
            case "hold":
                if (spent >= (CALM.matches ? CALM_HOLD : HOLD)) this.fade(now);
                break;
            case "reach":
                this.reach();
                if (spent >= STILL) this.fade(now);
                break;
            case "fade":
                if (spent >= settings.store.fadeOut + 40) {
                    this.clear();
                    this.show(1);
                    this.enter("rest", now);
                }
                break;
            case "rest":
                if (spent >= REST) this.play(this.index + 1, now);
                break;
        }
    };

    private enter(phase: Phase, at: number) {
        this.phase = phase;
        this.at = at;
    }

    private resize() {
        const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
        if (!w || !h || (w === this.w && h === this.h)) return;
        const scale = devicePixelRatio || 1;
        this.w = w;
        this.h = h;
        this.canvas.width = Math.round(w * scale);
        this.canvas.height = Math.round(h * scale);
        this.pen?.setTransform(scale, 0, 0, scale, 0, 0);
        if (this.demo) this.play(this.index, performance.now());
    }

    private play(index: number, now: number) {
        if (!this.w) return;
        this.list = demos();
        this.index = this.list.length ? index % this.list.length : 0;
        this.demo = this.list[this.index] ?? { template: WAVE, ctx: contextFor("anywhere"), label: "", keys: "", zone: "anywhere" };
        this.path = spread(soften(soften(fitTo(this.demo.template, this.w, this.h))));
        this.stroke = null;
        this.fed = 0;
        this.keys = "";
        this.label = null;
        this.matchedAt = 0;
        this.clear();
        this.show(1);
        this.onDemo(this.demo.label ? `${prefix(this.demo.zone)}${this.demo.label}` : "Add a gesture to see it here");
        if (CALM.matches) {
            this.whole();
            this.enter("hold", now);
            return;
        }
        const { readyRing, holdStart } = settings.store;
        this.enter(readyRing && holdStart > 0 ? "ready" : "draw", now);
    }

    private feed(count: number) {
        const end = Math.min(count, this.path.length);
        if (!this.stroke && end > 0) {
            this.stroke = new Stroke(this.path[0][0], this.path[0][1], strokeOptions());
            this.fed = 1;
        }
        if (!this.stroke || this.fed >= end) return;
        for (; this.fed < end; this.fed++) this.stroke.push(this.path[this.fed][0], this.path[this.fed][1]);
        this.stroke.read();
        this.tip = this.path[end - 1];
    }

    private whole() {
        if (!this.demo) return;
        this.stroke = null;
        this.fed = 0;
        this.feed(this.path.length);
        this.settle();
        this.show(1);
        this.paint();
    }

    private judge(ctx: Context) {
        const { stroke } = this;
        if (!stroke) return;
        const shape = matchShape(stroke.smooth, ctx);
        if (shape) {
            this.keys = `◎ ${shape.shape.name}`;
            this.label = prefix(shape.action.zone) + shape.action.label;
            return;
        }
        const action = readCommand(stroke.smooth, stroke.gesture, stroke.loose, ctx);
        this.keys = action ? "✓" : stroke.gesture ? "?" : "";
        this.label = action ? prefix(action.zone) + action.label : null;
    }

    private settle() {
        const { demo } = this;
        if (!demo) return;
        this.judge(demo.ctx);
        if (!this.label && demo.label) {
            this.keys = demo.keys;
            this.label = prefix(demo.zone) + demo.label;
        }
    }

    private fade(now: number) {
        this.canvas.style.transition = `opacity ${settings.store.fadeOut}ms ease-out`;
        this.canvas.style.opacity = "0";
        this.enter("fade", now);
    }

    private show(opacity: number) {
        this.canvas.style.transition = "none";
        this.canvas.style.opacity = String(opacity);
    }

    private clear() {
        this.pen?.clearRect(0, 0, this.w, this.h);
    }

    private paint() {
        const { pen, stroke } = this;
        if (!pen) return;
        if (!settings.store.trail || !stroke) return this.clear();
        paintFrame(pen, stroke.smooth, this.tip[0], this.tip[1], this.keys, this.label, settings.store.trailColor || this.brand, this.w, this.h);
    }

    private ring(fill: number, go: boolean) {
        const { pen } = this;
        if (!pen || !this.path.length) return;
        const [x, y] = this.path[0];
        this.clear();
        pen.save();
        pen.lineCap = "round";
        pen.lineWidth = go ? 4 : 3;
        pen.strokeStyle = settings.store.trailColor || this.brand;
        pen.shadowColor = "rgba(0, 0, 0, 0.6)";
        pen.shadowBlur = 1;
        pen.beginPath();
        pen.arc(x, y, go ? 7 * 1.35 : 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fill);
        pen.stroke();
        pen.restore();
    }

    private reach() {
        const { pen } = this;
        if (!pen || !this.path.length) return;
        const [x, y] = this.path[0];
        const radius = settings.store.startDistance;
        this.clear();
        pen.save();
        pen.strokeStyle = "rgba(255, 255, 255, 0.55)";
        pen.fillStyle = settings.store.trailColor || this.brand;
        pen.lineWidth = 1.5;
        pen.setLineDash([3, 4]);
        pen.beginPath();
        pen.arc(x, y, radius, 0, Math.PI * 2);
        pen.stroke();
        pen.beginPath();
        pen.arc(x, y, 3.5, 0, Math.PI * 2);
        pen.fill();
        pen.restore();
    }
}
