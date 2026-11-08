/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface MediaChunk {
    data: Uint8Array;
    time: number;
    key: boolean;
}

export interface WebmInput {
    width: number;
    height: number;
    videoCodec: "V_VP8" | "V_VP9";
    video: MediaChunk[];
    duration: number;
    audio?: { sampleRate: number; channels: number; codecPrivate: Uint8Array; chunks: MediaChunk[]; };
}

type Part = Uint8Array;

const concat = (parts: Part[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
};

function idBytes(id: number): Part {
    const out: number[] = [];
    for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 255);
    return Uint8Array.from(out);
}

function sizeBytes(size: number): Part {
    for (let len = 1; len <= 8; len++) {
        if (size < 2 ** (7 * len) - 1) {
            const out = new Uint8Array(len);
            let v = size;
            for (let i = len - 1; i >= 0; i--) {
                out[i] = v & 255;
                v = Math.floor(v / 256);
            }
            out[0] |= 1 << (8 - len);
            return out;
        }
    }
    throw new Error("element too large");
}

const el = (id: number, ...children: Part[]) => {
    const body = concat(children);
    return concat([idBytes(id), sizeBytes(body.length), body]);
};

function uint(v: number): Part {
    const out: number[] = [];
    do {
        out.unshift(v & 255);
        v = Math.floor(v / 256);
    } while (v > 0);
    return Uint8Array.from(out);
}

function float(v: number): Part {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setFloat64(0, v);
    return out;
}

const text = (s: string) => new TextEncoder().encode(s);

const block = (track: number, relative: number, key: boolean, data: Uint8Array) => {
    const head = new Uint8Array(4);
    head[0] = 0x80 | track;
    new DataView(head.buffer).setInt16(1, relative);
    head[3] = key ? 0x80 : 0;
    return el(0xa3, head, data);
};

export function muxWebm(input: WebmInput): Blob {
    const header = el(0x1a45dfa3,
        el(0x4286, uint(1)), el(0x42f7, uint(1)), el(0x42f2, uint(4)), el(0x42f3, uint(8)),
        el(0x4282, text("webm")), el(0x4287, uint(4)), el(0x4285, uint(2)));

    const info = el(0x1549a966,
        el(0x2ad7b1, uint(1_000_000)),
        el(0x4d80, text("UploadEditor")),
        el(0x5741, text("UploadEditor")),
        el(0x4489, float(input.duration)));

    const tracks: Part[] = [el(0xae,
        el(0xd7, uint(1)), el(0x73c5, uint(1)), el(0x9c, uint(0)), el(0x83, uint(1)),
        el(0x86, text(input.videoCodec)),
        el(0xe0, el(0xb0, uint(input.width)), el(0xba, uint(input.height))))];

    if (input.audio) tracks.push(el(0xae,
        el(0xd7, uint(2)), el(0x73c5, uint(2)), el(0x9c, uint(0)), el(0x83, uint(2)),
        el(0x86, text("A_OPUS")), el(0x63a2, input.audio.codecPrivate),
        el(0x56bb, uint(80_000_000)),
        el(0xe1, el(0xb5, float(input.audio.sampleRate)), el(0x9f, uint(input.audio.channels)))));

    const all = [
        ...input.video.map(c => ({ ...c, track: 1 })),
        ...(input.audio?.chunks ?? []).map(c => ({ ...c, track: 2, key: true }))
    ].sort((a, b) => a.time - b.time || a.track - b.track);

    const clusters: Part[] = [];
    let start = -1;
    let blocks: Part[] = [];
    const flush = () => {
        if (start < 0) return;
        clusters.push(el(0x1f43b675, el(0xe7, uint(start)), ...blocks));
        blocks = [];
    };
    for (const chunk of all) {
        const time = Math.round(chunk.time);
        const newCluster = start < 0 || time - start > 30000 || (chunk.track === 1 && chunk.key && time - start >= 2000);
        if (newCluster) {
            flush();
            start = time;
        }
        blocks.push(block(chunk.track, time - start, chunk.key, chunk.data));
    }
    flush();

    const segment = el(0x18538067, info, el(0x1654ae6b, ...tracks), ...clusters);
    return new Blob([header, segment], { type: "video/webm" });
}

export function opusHead(channels: number, sampleRate: number, preSkip = 312): Uint8Array {
    const out = new Uint8Array(19);
    out.set(text("OpusHead"));
    const view = new DataView(out.buffer);
    out[8] = 1;
    out[9] = channels;
    view.setUint16(10, preSkip, true);
    view.setUint32(12, sampleRate, true);
    view.setInt16(16, 0, true);
    out[18] = 0;
    return out;
}
