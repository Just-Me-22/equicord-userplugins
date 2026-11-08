/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface GifFrame {
    data: ImageData;
    delay: number;
}

class Bytes {
    private buf = new Uint8Array(1 << 16);
    length = 0;

    private grow(extra: number) {
        if (this.length + extra <= this.buf.length) return;
        let size = this.buf.length * 2;
        while (size < this.length + extra) size *= 2;
        const next = new Uint8Array(size);
        next.set(this.buf.subarray(0, this.length));
        this.buf = next;
    }

    byte(b: number) {
        this.grow(1);
        this.buf[this.length++] = b & 255;
    }

    short(v: number) {
        this.byte(v);
        this.byte(v >> 8);
    }

    bytes(list: ArrayLike<number>) {
        this.grow(list.length);
        this.buf.set(list, this.length);
        this.length += list.length;
    }

    text(s: string) {
        for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
    }

    result() {
        return this.buf.slice(0, this.length);
    }
}

interface Box { pixels: number[]; }

function palette(data: Uint8ClampedArray, size: number): number[] {
    const step = Math.max(1, Math.floor(data.length / 4 / 20000));
    const sample: number[] = [];
    for (let i = 0; i < data.length; i += 4 * step)
        if (data[i + 3] >= 128) sample.push(data[i] << 16 | data[i + 1] << 8 | data[i + 2]);
    if (!sample.length) return [0];

    const boxes: Box[] = [{ pixels: sample }];
    while (boxes.length < size) {
        let target = -1, widest = -1, channel = 0;
        boxes.forEach((box, i) => {
            if (box.pixels.length < 2) return;
            for (let c = 0; c < 3; c++) {
                const shift = 16 - c * 8;
                let lo = 255, hi = 0;
                for (const p of box.pixels) {
                    const v = p >> shift & 255;
                    if (v < lo) lo = v;
                    if (v > hi) hi = v;
                }
                const range = (hi - lo) * Math.sqrt(box.pixels.length);
                if (range > widest) { widest = range; target = i; channel = shift; }
            }
        });
        if (target < 0 || widest <= 0) break;
        const box = boxes[target].pixels.sort((a, b) => (a >> channel & 255) - (b >> channel & 255));
        const mid = box.length >> 1;
        boxes.splice(target, 1, { pixels: box.slice(0, mid) }, { pixels: box.slice(mid) });
    }

    return boxes.map(({ pixels }) => {
        let r = 0, g = 0, b = 0;
        for (const p of pixels) {
            r += p >> 16 & 255;
            g += p >> 8 & 255;
            b += p & 255;
        }
        const n = pixels.length;
        return Math.round(r / n) << 16 | Math.round(g / n) << 8 | Math.round(b / n);
    });
}

function indexer(colors: number[]) {
    const cache = new Int16Array(32768).fill(-1);
    return (r: number, g: number, b: number) => {
        const key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
        const hit = cache[key];
        if (hit >= 0) return hit;
        let best = 0, bestD = Infinity;
        for (let i = 0; i < colors.length; i++) {
            const c = colors[i];
            const dr = (c >> 16 & 255) - r, dg = (c >> 8 & 255) - g, db = (c & 255) - b;
            const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
            if (d < bestD) { bestD = d; best = i; }
        }
        cache[key] = best;
        return best;
    };
}

function lzw(indices: Uint8Array, out: Bytes) {
    const minSize = 8;
    const clear = 1 << minSize;
    const end = clear + 1;
    let codeSize = minSize + 1;
    let next = end + 1;
    let dict = new Map<number, number>();

    const block: number[] = [];
    let acc = 0, bits = 0;
    const emit = (code: number) => {
        acc |= code << bits;
        bits += codeSize;
        while (bits >= 8) {
            block.push(acc & 255);
            acc >>>= 8;
            bits -= 8;
            if (block.length === 255) {
                out.byte(255);
                out.bytes(block);
                block.length = 0;
            }
        }
    };

    out.byte(minSize);
    emit(clear);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
        const k = indices[i];
        const key = prefix << 8 | k;
        const found = dict.get(key);
        if (found !== undefined) {
            prefix = found;
            continue;
        }
        emit(prefix);
        if (next < 4096) {
            dict.set(key, next++);
            if (next > 1 << codeSize && codeSize < 12) codeSize++;
        } else {
            emit(clear);
            dict = new Map();
            codeSize = minSize + 1;
            next = end + 1;
        }
        prefix = k;
    }
    emit(prefix);
    emit(end);
    if (bits > 0) block.push(acc & 255);
    if (block.length) {
        out.byte(block.length);
        out.bytes(block);
    }
    out.byte(0);
}

export class GifWriter {
    private out = new Bytes();

    constructor(private width: number, private height: number) {
        const { out } = this;
        out.text("GIF89a");
        out.short(width);
        out.short(height);
        out.byte(0);
        out.byte(0);
        out.byte(0);
        out.bytes([0x21, 0xff, 0x0b]);
        out.text("NETSCAPE2.0");
        out.bytes([0x03, 0x01, 0x00, 0x00, 0x00]);
    }

    add({ data, delay }: GifFrame) {
        const { out, width, height } = this;
        const px = data.data;
        let transparent = false;
        for (let i = 3; i < px.length; i += 4) if (px[i] < 128) { transparent = true; break; }
        const colors = palette(px, transparent ? 255 : 256);
        const find = indexer(colors);
        const clearIndex = colors.length;
        const indices = new Uint8Array(width * height);
        for (let i = 0, j = 0; j < indices.length; i += 4, j++)
            indices[j] = transparent && px[i + 3] < 128 ? clearIndex : find(px[i], px[i + 1], px[i + 2]);

        out.bytes([0x21, 0xf9, 0x04, transparent ? 0x09 : 0x04]);
        out.short(Math.max(2, Math.round(delay / 10)));
        out.byte(transparent ? clearIndex : 0);
        out.byte(0);

        out.byte(0x2c);
        out.short(0);
        out.short(0);
        out.short(width);
        out.short(height);
        out.byte(0x87);
        for (let i = 0; i < 256; i++) {
            const c = colors[i] ?? 0;
            out.bytes([c >> 16 & 255, c >> 8 & 255, c & 255]);
        }
        lzw(indices, out);
    }

    done() {
        this.out.byte(0x3b);
        return this.out.result();
    }
}
