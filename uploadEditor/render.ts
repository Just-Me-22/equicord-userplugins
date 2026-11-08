/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Filters, Item, NEUTRAL, Overlay, Rect, Stroke } from "./image";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const FONTS: Record<string, { label: string; css: string; weight: number; }> = {
    sans: { label: "Sans", css: "'gg sans', 'Noto Sans', 'Segoe UI', sans-serif", weight: 800 },
    serif: { label: "Serif", css: "Georgia, 'Times New Roman', serif", weight: 700 },
    impact: { label: "Meme", css: "Impact, 'Arial Black', sans-serif", weight: 400 },
    hand: { label: "Hand", css: "'Segoe Print', 'Comic Sans MS', cursive", weight: 700 },
    mono: { label: "Mono", css: "Consolas, 'Courier New', monospace", weight: 700 }
};

export const PRESETS: Record<string, Filters> = {
    Original: NEUTRAL,
    Vivid: { brightness: 1.05, contrast: 1.15, saturation: 1.35, warmth: 0 },
    Warm: { brightness: 1.03, contrast: 1.05, saturation: 1.1, warmth: 0.5 },
    Cool: { brightness: 1.02, contrast: 1.05, saturation: 1.05, warmth: -0.5 },
    Fade: { brightness: 1.08, contrast: 0.82, saturation: 0.8, warmth: 0.1 },
    Mono: { brightness: 1, contrast: 1.1, saturation: 0, warmth: 0 },
    Noir: { brightness: 0.95, contrast: 1.45, saturation: 0, warmth: 0 }
};

const filterCss = (f: Filters) => f.brightness === 1 && f.contrast === 1 && f.saturation === 1
    ? "none"
    : `brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturation})`;

function canvas(w: number, h: number) {
    return new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

export function paintStroke(ctx: Ctx, stroke: Stroke) {
    if (stroke.rect) {
        ctx.fillStyle = stroke.color;
        const { x, y, w, h } = stroke.rect;
        ctx.fillRect(x, y, w, h);
        return;
    }
    const [first, ...rest] = stroke.points;
    if (!first) return;

    ctx.strokeStyle = ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (!rest.length) {
        ctx.beginPath();
        ctx.arc(first[0], first[1], stroke.size / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
    }

    ctx.beginPath();
    ctx.moveTo(first[0], first[1]);
    for (const [x, y] of rest) ctx.lineTo(x, y);
    ctx.stroke();
}

function applyEffect(ctx: Ctx, item: Item, effect: "blur" | "pixelate", strokes: Stroke[]) {
    const target = ctx.canvas;
    const W = target.width, H = target.height;
    const m = ctx.getTransform();
    const unit = Math.min(item.width, item.height) * Math.abs(m.a);

    const fx = canvas(W, H);
    const f = fx.getContext("2d")!;
    if (effect === "blur") {
        f.filter = `blur(${Math.max(4, unit * 0.03)}px)`;
        f.drawImage(target, 0, 0);
    } else {
        const block = Math.max(4, unit * 0.035);
        const small = canvas(W / block, H / block);
        small.getContext("2d")!.drawImage(target, 0, 0, small.width, small.height);
        f.imageSmoothingEnabled = false;
        f.drawImage(small, 0, 0, W, H);
    }

    const mask = canvas(W, H);
    const mc = mask.getContext("2d")!;
    mc.setTransform(m);
    strokes.forEach(s => paintStroke(mc, { ...s, color: "#000" }));

    f.filter = "none";
    f.globalCompositeOperation = "destination-in";
    f.drawImage(mask, 0, 0);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(fx, 0, 0);
    ctx.restore();
}

const isLight = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return (n >> 16 & 255) * 0.299 + (n >> 8 & 255) * 0.587 + (n & 255) * 0.114 > 150;
};

const fontOf = (o: Overlay) => `${FONTS[o.font]?.weight ?? 700} ${o.size}px ${FONTS[o.font]?.css ?? FONTS.sans.css}`;

let measurer: OffscreenCanvasRenderingContext2D | null = null;

export function overlayBox(o: Overlay): Rect {
    measurer ??= canvas(1, 1).getContext("2d")!;
    measurer.font = fontOf(o);
    const lines = o.text.split("\n");
    const w = Math.max(o.size * 0.6, ...lines.map(l => measurer!.measureText(l).width));
    const h = lines.length * o.size * 1.15;
    return { x: o.x - w / 2, y: o.y - h / 2, w, h };
}

export function drawOverlay(ctx: Ctx, o: Overlay) {
    const lines = o.text.split("\n");
    const lh = o.size * 1.15;
    ctx.save();
    ctx.font = fontOf(o);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    lines.forEach((line, i) => {
        const y = o.y + (i - (lines.length - 1) / 2) * lh;
        if (o.outline) {
            ctx.lineWidth = o.size * 0.14;
            ctx.strokeStyle = isLight(o.color) ? "#000" : "#fff";
            ctx.strokeText(line, o.x, y);
        }
        ctx.fillStyle = o.color;
        ctx.fillText(line, o.x, y);
    });
    ctx.restore();
}

export function renderEdits(ctx: Ctx, item: Item, source: CanvasImageSource, compare = false) {
    const f = compare ? NEUTRAL : item.filters;
    ctx.save();
    ctx.filter = filterCss(f);
    ctx.drawImage(source, 0, 0, item.width, item.height);
    ctx.restore();
    if (compare) return;

    if (f.warmth) {
        ctx.save();
        ctx.globalCompositeOperation = "soft-light";
        ctx.fillStyle = f.warmth > 0 ? `rgb(255 140 40 / ${f.warmth * 0.6})` : `rgb(60 140 255 / ${-f.warmth * 0.6})`;
        ctx.fillRect(0, 0, item.width, item.height);
        ctx.restore();
    }

    for (const effect of ["blur", "pixelate"] as const) {
        const list = item.strokes.filter(s => s.effect === effect);
        if (list.length) applyEffect(ctx, item, effect, list);
    }
    item.strokes.filter(s => !s.effect).forEach(s => paintStroke(ctx, s));
    item.overlays.forEach(o => drawOverlay(ctx, o));
}

export function placeCrop(ctx: Ctx, item: Item, outW: number, outH: number) {
    const { crop } = item;
    const sx = outW / crop.w, sy = outH / crop.h;
    ctx.setTransform(sx, 0, 0, sy, -crop.x * sx, -crop.y * sy);
}
