/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Rect } from "../image";

export interface Finding { rect: Rect; label: string; }

const SENSITIVE = /@\w|\w+@\w+\.\w+|#\d{4}\b|\b\d{17,20}\b|https?:\/\//i;

async function withTextDetector(source: ImageBitmap, scale: number): Promise<Finding[] | null> {
    const Detector = (window as any).TextDetector;
    if (!Detector) return null;
    try {
        const found: { boundingBox: DOMRectReadOnly; rawValue: string; }[] = await new Detector().detect(source);
        return found.map(f => ({
            rect: { x: f.boundingBox.x / scale, y: f.boundingBox.y / scale, w: f.boundingBox.width / scale, h: f.boundingBox.height / scale },
            label: SENSITIVE.test(f.rawValue) ? `Looks private: ${f.rawValue.slice(0, 24)}` : f.rawValue.slice(0, 24)
        }));
    } catch {
        return null;
    }
}

function textRegions(source: ImageBitmap, scale: number): Finding[] {
    const W = Math.min(640, source.width);
    const k = W / source.width;
    const H = Math.max(1, Math.round(source.height * k));
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(source, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);

    const gray = new Float32Array(W * H);
    for (let i = 0; i < gray.length; i++) gray[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;

    const edge = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++)
        for (let x = 1; x < W - 1; x++) {
            const i = y * W + x;
            if (Math.abs(gray[i + 1] - gray[i - 1]) > 60) edge[i] = 1;
        }

    const grown = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
        let last = -100;
        for (let x = 0; x < W; x++) {
            if (edge[y * W + x]) {
                if (x - last <= 8) for (let j = last; j <= x; j++) if (j >= 0) grown[y * W + j] = 1;
                last = x;
            }
        }
    }

    const seen = new Uint8Array(W * H);
    const out: Finding[] = [];
    const stack: number[] = [];
    for (let start = 0; start < grown.length; start++) {
        if (!grown[start] || seen[start]) continue;
        let minX = W, minY = H, maxX = 0, maxY = 0, count = 0;
        stack.push(start);
        seen[start] = 1;
        while (stack.length) {
            const i = stack.pop()!;
            const x = i % W, y = (i / W) | 0;
            count++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            for (const n of [i - 1, i + 1, i - W, i + W, i - W - 1, i - W + 1, i + W - 1, i + W + 1])
                if (n >= 0 && n < grown.length && grown[n] && !seen[n]) {
                    seen[n] = 1;
                    stack.push(n);
                }
        }
        const w = maxX - minX + 1, h = maxY - minY + 1;
        if (h < 5 || h > 40 || w < h * 2 || count / (w * h) < 0.25) continue;
        const pad = 2;
        out.push({
            rect: { x: (minX - pad) / k / scale, y: (minY - pad) / k / scale, w: (w + pad * 2) / k / scale, h: (h + pad * 2) / k / scale },
            label: "Text"
        });
    }

    const merged: Finding[] = [];
    for (const f of out.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)) {
        const prev = merged[merged.length - 1];
        if (prev && Math.abs(prev.rect.y - f.rect.y) < f.rect.h * 0.6 && f.rect.x - (prev.rect.x + prev.rect.w) < f.rect.h * 1.5) {
            const x = Math.min(prev.rect.x, f.rect.x), y = Math.min(prev.rect.y, f.rect.y);
            prev.rect = { x, y, w: Math.max(prev.rect.x + prev.rect.w, f.rect.x + f.rect.w) - x, h: Math.max(prev.rect.y + prev.rect.h, f.rect.y + f.rect.h) - y };
        } else merged.push(f);
    }
    return merged.slice(0, 60);
}

export async function findText(source: ImageBitmap, previewScale: number): Promise<{ findings: Finding[]; smart: boolean; }> {
    const smart = await withTextDetector(source, previewScale);
    if (smart) return { findings: smart, smart: true };
    return { findings: textRegions(source, previewScale), smart: false };
}
