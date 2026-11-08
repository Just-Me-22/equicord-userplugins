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
    effect?: "blur" | "pixelate";
    rect?: Rect;
}

export interface Overlay {
    id: number;
    text: string;
    x: number;
    y: number;
    size: number;
    color: string;
    outline: boolean;
    font: string;
}

export interface Filters {
    brightness: number;
    contrast: number;
    saturation: number;
    warmth: number;
}

export const NEUTRAL: Filters = { brightness: 1, contrast: 1, saturation: 1, warmth: 0 };

export type Kind = "image" | "gif" | "video";
export type Direction = "forward" | "reverse" | "boomerang";

export interface Frame {
    bitmap: ImageBitmap;
    start: number;
    duration: number;
}

export interface Edits {
    crop: Rect;
    strokes: Stroke[];
    overlays: Overlay[];
    filters: Filters;
    trim: [number, number];
    speed: number;
    direction: Direction;
    output: { w: number; h: number; } | null;
    guide: "circle" | null;
}

export interface Item extends Edits {
    id: number;
    file: File;
    kind: Kind;
    preview: ImageBitmap;
    width: number;
    height: number;
    duration: number;
    frames?: Frame[];
    mediaUrl?: string;
    spoiler: boolean;
    alt: string;
    compress: number;
    history: Edits[];
}

export type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
export const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

export function kindOf(type: string): Kind | null {
    if (IMAGE_TYPES.has(type)) return "image";
    if (type === "image/gif" && "ImageDecoder" in window) return "gif";
    if (VIDEO_TYPES.has(type) && "VideoEncoder" in window) return "video";
    return null;
}

export const isEditableType = (type: string) => kindOf(type) !== null;

let nextId = 0;
export const newId = () => nextId++;

const PREVIEW_SIDE = 2048;
const FRAME_SIDE = 480;

const shrinkTo = (w: number, h: number, side: number) => {
    const k = Math.min(1, side / Math.max(w, h));
    return { resizeWidth: Math.max(1, Math.round(w * k)), resizeHeight: Math.max(1, Math.round(h * k)), resizeQuality: "high" as const };
};

function base(file: File, kind: Kind, preview: ImageBitmap, width: number, height: number, duration: number): Item {
    return {
        id: newId(), file, kind, preview, width, height, duration,
        crop: { x: 0, y: 0, w: width, h: height }, strokes: [], overlays: [], filters: { ...NEUTRAL },
        trim: [0, duration], speed: 1, direction: "forward", output: null, guide: null,
        spoiler: false, alt: "", compress: 1, history: []
    };
}

async function loadImage(file: File): Promise<Item> {
    const url = URL.createObjectURL(file);
    try {
        const img = new Image();
        img.src = url;
        await img.decode();
        const preview = await createImageBitmap(img, shrinkTo(img.naturalWidth, img.naturalHeight, PREVIEW_SIDE));
        return base(file, "image", preview, img.naturalWidth, img.naturalHeight, 0);
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function loadGif(file: File): Promise<Item> {
    const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: "image/gif" });
    try {
        await decoder.tracks.ready;
        const count = decoder.tracks.selectedTrack?.frameCount ?? 1;
        const frames: Frame[] = [];
        let start = 0, width = 0, height = 0;
        for (let i = 0; i < count; i++) {
            const { image } = await decoder.decode({ frameIndex: i });
            width = image.displayWidth;
            height = image.displayHeight;
            const raw = (image.duration ?? 0) / 1000;
            const duration = raw > 10 ? raw : 100;
            const bitmap = await createImageBitmap(image, shrinkTo(width, height, FRAME_SIDE));
            image.close();
            frames.push({ bitmap, start, duration });
            start += duration;
        }
        const item = base(file, "gif", frames[0].bitmap, width, height, start);
        item.frames = frames;
        return item;
    } finally {
        decoder.close();
    }
}

export function waitFor(target: EventTarget, event: string) {
    return new Promise<void>((resolve, reject) => {
        target.addEventListener(event, () => resolve(), { once: true });
        target.addEventListener("error", () => reject(new Error("could not read the video")), { once: true });
    });
}

export function seek(video: HTMLVideoElement, seconds: number) {
    if (Math.abs(video.currentTime - seconds) < 0.0005 && video.readyState >= 2) return Promise.resolve();
    const done = waitFor(video, "seeked");
    video.currentTime = seconds;
    return done;
}

async function loadVideo(file: File): Promise<Item> {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = url;
    try {
        await waitFor(video, "loadeddata");
        await seek(video, Math.min(0.05, video.duration / 2));
        const preview = await createImageBitmap(video, shrinkTo(video.videoWidth, video.videoHeight, PREVIEW_SIDE));
        const item = base(file, "video", preview, video.videoWidth, video.videoHeight, video.duration * 1000);
        item.mediaUrl = url;
        return item;
    } catch (err) {
        URL.revokeObjectURL(url);
        throw err;
    } finally {
        video.removeAttribute("src");
        video.load();
    }
}

export function loadItem(file: File): Promise<Item> {
    switch (kindOf(file.type)) {
        case "gif": return loadGif(file);
        case "video": return loadVideo(file);
        default: return loadImage(file);
    }
}

export async function stillItem(blob: Blob, name: string): Promise<Item> {
    return loadImage(new File([blob], name, { type: blob.type }));
}

export function disposeItem(item: Item) {
    if (item.frames) item.frames.forEach(f => f.bitmap.close());
    else item.preview.close();
    if (item.mediaUrl) URL.revokeObjectURL(item.mediaUrl);
}

export function frameAt(item: Item, ms: number): Frame | null {
    const { frames } = item;
    if (!frames?.length) return null;
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (frames[mid].start <= ms) lo = mid;
        else hi = mid - 1;
    }
    return frames[lo];
}

export function drawPreview(ctx: CanvasRenderingContext2D, item: Item) {
    ctx.drawImage(item.preview, 0, 0, item.width, item.height);
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const sameFilters = (a: Filters, b: Filters) => a.brightness === b.brightness && a.contrast === b.contrast && a.saturation === b.saturation && a.warmth === b.warmth;

export function isEdited(item: Item) {
    const { crop } = item;
    return item.strokes.length > 0 || item.overlays.length > 0 || !sameFilters(item.filters, NEUTRAL)
        || crop.x !== 0 || crop.y !== 0 || crop.w !== item.width || crop.h !== item.height
        || item.output !== null || item.compress !== 1
        || (item.kind !== "image" && (item.trim[0] !== 0 || item.trim[1] !== item.duration || item.speed !== 1 || item.direction !== "forward"));
}

export function snapshot(item: Item): Edits {
    const { crop, strokes, overlays, filters, trim, speed, direction, output, guide } = item;
    return { crop, strokes, overlays, filters, trim, speed, direction, output, guide };
}

export function fitAspect(item: Item, aspect: number): Rect {
    const { width, height } = item;
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

export function outputSize(item: Item): [number, number] {
    const w = item.output?.w ?? item.crop.w;
    const h = item.output?.h ?? item.crop.h;
    return [Math.max(1, Math.round(w * item.compress)), Math.max(1, Math.round(h * item.compress))];
}

export function formatTime(ms: number) {
    const s = Math.max(0, ms) / 1000;
    return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}
