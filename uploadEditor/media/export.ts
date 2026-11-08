/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isEdited, Item, outputSize, seek, waitFor } from "../image";
import { placeCrop, renderEdits } from "../render";
import { GifWriter } from "./gif";
import { MediaChunk, muxWebm, opusHead } from "./webm";

export type Progress = (fraction: number) => void;

const QUALITY: Record<string, number | undefined> = { "image/jpeg": 0.92, "image/webp": 0.92 };
const FPS = 30;

const tick = () => new Promise(r => setTimeout(r, 0));

const rename = (name: string, ext: string) => name.replace(/\.[^.]+$/, "") + ext;

async function exportStill(item: Item): Promise<File> {
    const [w, h] = outputSize(item);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d")!;
    placeCrop(ctx, item, w, h);
    const full = await createImageBitmap(item.file);
    try {
        renderEdits(ctx, item, full);
    } finally {
        full.close();
    }
    const { type } = item.file;
    const quality = QUALITY[type] && item.compress < 1 ? 0.8 : QUALITY[type];
    const blob = await canvas.convertToBlob({ type, quality });
    return new File([blob], item.file.name, { type: blob.type });
}

export interface Step { index: number; duration: number; }

export function timeline(item: Item): Step[] {
    const [a, b] = item.trim;
    const forward: Step[] = [];
    (item.frames ?? []).forEach((f, index) => {
        const from = Math.max(f.start, a), to = Math.min(f.start + f.duration, b);
        if (to > from) forward.push({ index, duration: (to - from) / item.speed });
    });
    if (item.direction === "reverse") return forward.reverse();
    if (item.direction === "boomerang") return [...forward, ...forward.slice(1, -1).reverse()];
    return forward;
}

async function exportGif(item: Item, progress: Progress): Promise<File> {
    const [w, h] = outputSize(item);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const writer = new GifWriter(w, h);
    const decoder = new ImageDecoder({ data: await item.file.arrayBuffer(), type: "image/gif" });
    try {
        await decoder.tracks.ready;
        const plan = timeline(item);
        for (const [k, step] of plan.entries()) {
            const { image } = await decoder.decode({ frameIndex: step.index });
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, w, h);
            placeCrop(ctx, item, w, h);
            renderEdits(ctx, item, image);
            image.close();
            writer.add({ data: ctx.getImageData(0, 0, w, h), delay: step.duration });
            progress((k + 1) / plan.length);
            if (k % 4 === 0) await tick();
        }
    } finally {
        decoder.close();
    }
    return new File([writer.done()], rename(item.file.name, ".gif"), { type: "image/gif" });
}

export function sourceTimes(item: Item): number[] {
    const [a, b] = item.trim;
    const span = (b - a) / item.speed;
    const count = Math.max(1, Math.round(span / 1000 * FPS));
    const forward = Array.from({ length: count }, (_, i) => Math.min(b - 1, a + i / FPS * 1000 * item.speed));
    if (item.direction === "reverse") return forward.reverse();
    if (item.direction === "boomerang") return [...forward, ...forward.slice(1, -1).reverse()];
    return forward;
}

const VIDEO_CODECS: [string, "V_VP9" | "V_VP8"][] = [["vp09.00.10.08", "V_VP9"], ["vp8", "V_VP8"]];

async function encodeAudio(item: Item): Promise<{ sampleRate: number; channels: number; codecPrivate: Uint8Array; chunks: MediaChunk[]; } | null> {
    if (item.speed !== 1 || item.direction !== "forward" || !("AudioEncoder" in window)) return null;
    const [a, b] = item.trim;
    let buffer: AudioBuffer;
    try {
        buffer = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await item.file.arrayBuffer());
    } catch {
        return null;
    }
    const rate = 48000;
    const channels = Math.min(2, buffer.numberOfChannels);
    const length = Math.max(1, Math.round((b - a) / 1000 * rate));
    const off = new OfflineAudioContext(channels, length, rate);
    const node = off.createBufferSource();
    node.buffer = buffer;
    node.connect(off.destination);
    node.start(0, a / 1000, (b - a) / 1000);
    const rendered = await off.startRendering();

    const chunks: MediaChunk[] = [];
    let head: Uint8Array | null = null;
    let failure: unknown = null;
    const encoder = new AudioEncoder({
        output: (chunk, meta) => {
            const desc = meta?.decoderConfig?.description;
            if (desc && !head) head = new Uint8Array(desc instanceof ArrayBuffer ? desc : (desc as ArrayBufferView).buffer);
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            chunks.push({ data, time: chunk.timestamp / 1000, key: true });
        },
        error: e => { failure = e; }
    });
    encoder.configure({ codec: "opus", sampleRate: rate, numberOfChannels: channels, bitrate: 128_000 });
    const step = 960 * 50;
    for (let i = 0; i < length; i += step) {
        const n = Math.min(step, length - i);
        const data = new Float32Array(n * channels);
        for (let c = 0; c < channels; c++) data.set(rendered.getChannelData(c).subarray(i, i + n), c * n);
        encoder.encode(new AudioData({ format: "f32-planar", sampleRate: rate, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round(i / rate * 1e6), data }));
    }
    await encoder.flush();
    encoder.close();
    if (failure) return null;
    return { sampleRate: rate, channels, chunks, codecPrivate: head ?? opusHead(channels, rate) };
}

export const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

async function exportVideo(item: Item, progress: Progress, bitrate?: number): Promise<File> {
    let [w, h] = outputSize(item);
    const cap = Math.min(1, 1920 / Math.max(w, h));
    w = even(w * cap);
    h = even(h * cap);
    const rate = bitrate ?? Math.min(8_000_000, Math.max(600_000, w * h * FPS * 0.1));

    let picked: [string, "V_VP9" | "V_VP8"] | null = null;
    for (const option of VIDEO_CODECS) {
        const support = await VideoEncoder.isConfigSupported({ codec: option[0], width: w, height: h, bitrate: rate, framerate: FPS });
        if (support.supported) { picked = option; break; }
    }
    if (!picked) throw new Error("this Discord build can't encode video");

    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = item.mediaUrl!;
    await waitFor(video, "loadeddata");

    const chunks: MediaChunk[] = [];
    let failure: unknown = null;
    const encoder = new VideoEncoder({
        output: chunk => {
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            chunks.push({ data, time: chunk.timestamp / 1000, key: chunk.type === "key" });
        },
        error: e => { failure = e; }
    });
    encoder.configure({ codec: picked[0], width: w, height: h, bitrate: rate, framerate: FPS, latencyMode: "quality" });

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d")!;
    const times = sourceTimes(item);
    try {
        for (const [i, ms] of times.entries()) {
            if (failure) throw failure;
            await seek(video, ms / 1000);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, w, h);
            placeCrop(ctx, item, w, h);
            renderEdits(ctx, item, video);
            const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
            encoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
            frame.close();
            while (encoder.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 5));
            progress((i + 1) / times.length * 0.9);
        }
        await encoder.flush();
    } finally {
        encoder.close();
        video.removeAttribute("src");
        video.load();
    }
    if (failure) throw failure;

    const audio = await encodeAudio(item);
    progress(1);
    const blob = muxWebm({ width: w, height: h, videoCodec: picked[1], video: chunks, duration: times.length / FPS * 1000, audio: audio ?? undefined });
    return new File([blob], rename(item.file.name, ".webm"), { type: "video/webm" });
}

export interface ExportOptions { bitrate?: number; }

export async function exportItem(item: Item, progress: Progress = () => { }, options: ExportOptions = {}): Promise<File> {
    let { file } = item;
    if (isEdited(item) || options.bitrate) {
        if (item.kind === "gif") file = await exportGif(item, progress);
        else if (item.kind === "video") file = await exportVideo(item, progress, options.bitrate);
        else file = await exportStill(item);
    }
    if (item.spoiler && !file.name.startsWith("SPOILER_")) file = new File([file], "SPOILER_" + file.name, { type: file.type });
    return file;
}

export async function grabFrame(item: Item, ms: number): Promise<Blob> {
    const [w, h] = [Math.max(1, Math.round(item.crop.w)), Math.max(1, Math.round(item.crop.h))];
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d")!;
    placeCrop(ctx, item, w, h);
    if (item.kind === "gif") {
        const decoder = new ImageDecoder({ data: await item.file.arrayBuffer(), type: "image/gif" });
        try {
            await decoder.tracks.ready;
            const frames = item.frames ?? [];
            let index = 0;
            frames.forEach((f, i) => { if (f.start <= ms) index = i; });
            const { image } = await decoder.decode({ frameIndex: index });
            renderEdits(ctx, item, image);
            image.close();
        } finally {
            decoder.close();
        }
    } else if (item.kind === "video") {
        const video = document.createElement("video");
        video.muted = true;
        video.src = item.mediaUrl!;
        await waitFor(video, "loadeddata");
        await seek(video, ms / 1000);
        renderEdits(ctx, item, video);
        video.removeAttribute("src");
        video.load();
    } else {
        const full = await createImageBitmap(item.file);
        renderEdits(ctx, item, full);
        full.close();
    }
    return canvas.convertToBlob({ type: "image/png" });
}
