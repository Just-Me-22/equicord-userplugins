/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import fast from "file://fast.webm?base64";

import { settings } from "./settings";

export const PACE = "vc-aat-pace";
const LINGER = 1000;

const live = document.getElementsByTagName("video");
const clip = Uint8Array.from(atob(fast), c => c.charCodeAt(0));

let pacer: HTMLVideoElement | undefined;
let buffer: SourceBuffer | undefined;
let stopTimer: ReturnType<typeof setTimeout> | undefined;

function feed() {
    if (!pacer || !buffer || buffer.updating) return;

    const { buffered } = buffer;
    const now = pacer.currentTime;
    if (!buffered.length || buffered.end(buffered.length - 1) - now < 1) buffer.appendBuffer(clip);
    else if (now - buffered.start(0) > 10) buffer.remove(0, now - 5);
}

function stop() {
    stopTimer = undefined;
    pacer?.pause();
}

function sync() {
    if (!pacer) return;

    let playing = 0;
    for (const video of live) if (video !== pacer && !video.paused) playing++;

    if (settings.store.fullRate && playing >= 2) {
        clearTimeout(stopTimer);
        stopTimer = undefined;
        if (pacer.paused) pacer.play().catch(() => { });
    } else if (!pacer.paused && !stopTimer) {
        stopTimer = setTimeout(stop, LINGER);
    }
}

function tick() {
    feed();
    sync();
}

export function startPace() {
    const source = new MediaSource();
    const url = URL.createObjectURL(source);
    source.addEventListener("sourceopen", () => {
        URL.revokeObjectURL(url);
        buffer = source.addSourceBuffer('video/webm; codecs="vp8"');
        buffer.mode = "sequence";
        feed();
    }, { once: true });

    pacer = document.createElement("video");
    pacer.className = PACE;
    pacer.muted = true;
    pacer.src = url;
    pacer.addEventListener("timeupdate", tick);
    document.body.append(pacer);

    document.addEventListener("play", sync, true);
    document.addEventListener("pause", sync, true);
    sync();
}

export function stopPace() {
    document.removeEventListener("play", sync, true);
    document.removeEventListener("pause", sync, true);
    clearTimeout(stopTimer);
    pacer?.remove();
    pacer = buffer = stopTimer = undefined;
}
