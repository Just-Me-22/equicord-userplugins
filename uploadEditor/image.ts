/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface Stroke {
    color: string;
    size: number;
    points: [number, number][];
}

export interface Item {
    id: number;
    file: File;
    image: ImageBitmap;
    thumb: string;
    crop: Rect;
    strokes: Stroke[];
}

export type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const EDITABLE = new Set(["image/png", "image/jpeg", "image/webp"]);

let nextId = 0;

export async function loadItem(file: File): Promise<Item> {
    const image = await createImageBitmap(file);
    return {
        id: nextId++,
        file,
        image,
        thumb: URL.createObjectURL(file),
        crop: { x: 0, y: 0, w: image.width, h: image.height },
        strokes: []
    };
}

export function disposeItem(item: Item) {
    item.image.close();
    URL.revokeObjectURL(item.thumb);
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function isEdited(item: Item) {
    const { crop, image } = item;
    return item.strokes.length > 0 || crop.x !== 0 || crop.y !== 0 || crop.w !== image.width || crop.h !== image.height;
}

export function fitAspect(item: Item, aspect: number): Rect {
    const { width, height } = item.image;
    let w = width;
    let h = w / aspect;
    if (h > height) {
        h = height;
        w = h * aspect;
    }
    return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

export function moveCrop(start: Rect, dx: number, dy: number, width: number, height: number): Rect {
    return {
        ...start,
        x: clamp(start.x + dx, 0, width - start.w),
        y: clamp(start.y + dy, 0, height - start.h)
    };
}

export function resizeCrop(start: Rect, handle: Handle, dx: number, dy: number, aspect: number | null, width: number, height: number, min: number): Rect {
    let left = start.x;
    let top = start.y;
    let right = start.x + start.w;
    let bottom = start.y + start.h;

    if (handle.includes("w")) left = clamp(left + dx, 0, right - min);
    if (handle.includes("e")) right = clamp(right + dx, left + min, width);
    if (handle.includes("n")) top = clamp(top + dy, 0, bottom - min);
    if (handle.includes("s")) bottom = clamp(bottom + dy, top + min, height);

    if (!aspect) return { x: left, y: top, w: right - left, h: bottom - top };

    let w = right - left;
    let h = bottom - top;
    if (handle === "e" || handle === "w") h = w / aspect;
    else if (handle === "n" || handle === "s") w = h * aspect;
    else if (w / h > aspect) h = w / aspect;
    else w = h * aspect;

    const centerX = start.x + start.w / 2;
    const centerY = start.y + start.h / 2;
    const anchorX = handle.includes("w") ? "right" : handle.includes("e") ? "left" : "center";
    const anchorY = handle.includes("n") ? "bottom" : handle.includes("s") ? "top" : "center";

    const maxW = anchorX === "left" ? width - left : anchorX === "right" ? right : 2 * Math.min(centerX, width - centerX);
    const maxH = anchorY === "top" ? height - top : anchorY === "bottom" ? bottom : 2 * Math.min(centerY, height - centerY);
    const shrink = Math.min(1, maxW / w, maxH / h);
    w *= shrink;
    h *= shrink;

    const x = anchorX === "left" ? left : anchorX === "right" ? right - w : centerX - w / 2;
    const y = anchorY === "top" ? top : anchorY === "bottom" ? bottom - h : centerY - h / 2;
    return { x, y, w, h };
}

export function paintStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
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

const QUALITY: Record<string, number | undefined> = { "image/jpeg": 0.92, "image/webp": 0.92 };

export async function exportItem(item: Item): Promise<File> {
    if (!isEdited(item)) return item.file;

    const { crop } = item;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(crop.w));
    canvas.height = Math.max(1, Math.round(crop.h));

    const ctx = canvas.getContext("2d")!;
    ctx.translate(-crop.x, -crop.y);
    ctx.drawImage(item.image, 0, 0);
    item.strokes.forEach(stroke => paintStroke(ctx, stroke));

    const { type } = item.file;
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, QUALITY[type]));
    if (!blob) throw new Error("could not encode " + item.file.name);

    return new File([blob], item.file.name, { type: blob.type });
}
