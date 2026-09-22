/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { WindowStore } from "@webpack/common";

import { settings } from "./settings";

const FROZEN = "vc-aat-frozen";
const OFFSCREEN = "vc-aat-offscreen";
const SCROLL_SETTLE = 150;

let reduceMotion: MediaQueryList | undefined;
let scrolling = false;
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
let frame = 0;
let seen = new Set<HTMLVideoElement>();
let observer: IntersectionObserver | undefined;
const offscreen = new WeakSet<HTMLVideoElement>();
let pointer = { x: 0, y: 0 };
let lastInput = Date.now();
let idleTimer: ReturnType<typeof setInterval> | undefined;
let settledAt = 0;
let settleTimer: ReturnType<typeof setTimeout> | undefined;

function idle() {
    const { idleAfter } = settings.store;
    return idleAfter > 0 && Date.now() - lastInput >= idleAfter * 1000;
}

function permitted() {
    if (settings.store.respectReducedMotion && reduceMotion?.matches) return false;
    if (settings.store.pauseWhenHidden && document.hidden) return false;
    if (settings.store.pauseWhileScrolling && scrolling) return false;
    if (idle()) return false;
    return WindowStore.isFocused();
}

export function on() {
    if (!permitted()) return false;

    const delay = settings.store.settleDelay;
    if (delay <= 0) return true;
    return settledAt > 0 && Date.now() - settledAt >= delay;
}

function distanceTo(video: HTMLVideoElement) {
    const box = video.getBoundingClientRect();
    const dx = pointer.x - (box.left + box.width / 2);
    const dy = pointer.y - (box.top + box.height / 2);
    return dx * dx + dy * dy;
}

function videos() {
    return [...document.querySelectorAll<HTMLVideoElement>("video")]
        .filter(video => !video.controls && video.duration !== Infinity);
}

function reobserve(all: HTMLVideoElement[]) {
    if (!observer) return;

    const next = new Set(all);
    for (const video of seen) if (!next.has(video)) observer.unobserve(video);
    for (const video of all) if (!seen.has(video)) observer.observe(video);
    seen = next;
}

function apply() {
    frame = 0;

    const delay = settings.store.settleDelay;
    if (!permitted()) {
        settledAt = 0;
    } else if (settledAt === 0) {
        settledAt = Date.now();
        if (delay > 0) {
            clearTimeout(settleTimer);
            settleTimer = setTimeout(refreshGate, delay);
        }
    }

    const allowed = on();
    document.body.classList.toggle(FROZEN, !allowed);
    document.body.classList.toggle(OFFSCREEN, settings.store.pauseOffscreen);

    const all = videos();
    reobserve(all);

    if (!allowed) {
        for (const video of all) video.pause();
        return;
    }

    let playable = all;
    if (settings.store.pauseOffscreen) playable = playable.filter(video => !offscreen.has(video));

    const cap = settings.store.maxAnimated;
    if (cap > 0 && playable.length > cap) {
        playable = playable
            .map(video => ({ video, near: distanceTo(video) }))
            .sort((a, b) => a.near - b.near)
            .slice(0, cap)
            .map(entry => entry.video);
    }

    const keep = new Set(playable);
    for (const video of all) {
        if (keep.has(video)) video.play().catch(() => { });
        else video.pause();
    }
}

export function refreshGate() {
    if (frame) return;
    frame = requestAnimationFrame(apply);
}

function onScroll() {
    if (!settings.store.pauseWhileScrolling) return;

    if (!scrolling) {
        scrolling = true;
        refreshGate();
    }

    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
        scrolling = false;
        refreshGate();
    }, SCROLL_SETTLE);
}

function onPointer(e: PointerEvent) {
    pointer = { x: e.clientX, y: e.clientY };
    onInput();
}

function onInput() {
    const wasIdle = idle();
    lastInput = Date.now();
    if (wasIdle) refreshGate();
}

export function startGate() {
    reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

    observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
            const video = entry.target as HTMLVideoElement;
            if (entry.isIntersecting) offscreen.delete(video);
            else offscreen.add(video);
        }
        refreshGate();
    }, { rootMargin: "64px" });

    reduceMotion.addEventListener("change", refreshGate);
    document.addEventListener("visibilitychange", refreshGate);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("keydown", onInput, { passive: true });
    document.addEventListener("pointerdown", onInput, { passive: true });
    document.addEventListener("wheel", onInput, { passive: true });
    WindowStore.addChangeListener(refreshGate);
    idleTimer = setInterval(() => {
        if (settings.store.idleAfter > 0) refreshGate();
    }, 5000);

    refreshGate();
}

export function stopGate() {
    reduceMotion?.removeEventListener("change", refreshGate);
    document.removeEventListener("visibilitychange", refreshGate);
    document.removeEventListener("scroll", onScroll, { capture: true });
    document.removeEventListener("pointermove", onPointer);
    document.removeEventListener("keydown", onInput);
    document.removeEventListener("pointerdown", onInput);
    document.removeEventListener("wheel", onInput);
    WindowStore.removeChangeListener(refreshGate);

    observer?.disconnect();
    observer = undefined;
    seen = new Set();

    clearTimeout(scrollTimer);
    clearInterval(idleTimer);
    clearTimeout(settleTimer);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    scrolling = false;

    document.body.classList.remove(FROZEN);
    document.body.classList.remove(OFFSCREEN);
}
