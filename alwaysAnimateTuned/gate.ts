/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ExpressionPickerStore, WindowStore } from "@webpack/common";

import { PACE } from "./pace";
import { settings } from "./settings";

const OFFSCREEN = "vc-aat-offscreen";
export const NAMEPLATE = "vc-aat-nameplate";
const SCROLL_SETTLE = 150;
const TYPING_SETTLE = 700;
const RESUME_PER_FRAME = 4;
const PASS_DEADLINE = 200;

const live = document.getElementsByTagName("video");

let reduceMotion: MediaQueryList | undefined;
let scrolling = false;
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
let typing = false;
let typingTimer: ReturnType<typeof setTimeout> | undefined;
let frame = 0;
let pass = 0;
let resumeFrame = 0;
let resuming: HTMLVideoElement[] = [];
let seen = new Set<HTMLVideoElement>();
let observer: IntersectionObserver | undefined;
const offscreen = new WeakSet<HTMLVideoElement>();
const held = new WeakSet<HTMLVideoElement>();
const scrolled = new WeakMap<Element, { top: number; left: number; at: number; }>();
let pointer = { x: 0, y: 0 };
let lastInput = Date.now();
let idleTimer: ReturnType<typeof setInterval> | undefined;
let settledAt = 0;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
let inputAttached = false;
let wasAwake: boolean | undefined;
let picking = false;
let unsubscribePicker: (() => void) | undefined;

interface PickerStore {
    getState(): { activeView: unknown; };
    subscribe(listener: (state: { activeView: unknown; }) => void): () => void;
}

function idle() {
    const { idleAfter } = settings.store;
    return idleAfter > 0 && Date.now() - lastInput >= idleAfter * 1000;
}

function awake() {
    if (settings.store.respectReducedMotion && reduceMotion?.matches) return false;
    if (settings.store.pauseWhenHidden && document.hidden) return false;
    return !idle();
}

export function on() {
    return awake() && WindowStore.isFocused();
}

function permitted() {
    if (!on()) return false;
    if (settings.store.pauseWhileScrolling && scrolling) return false;
    return !(settings.store.pauseWhileTyping && typing);
}

function canPlay() {
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

function under(video: HTMLVideoElement) {
    const box = video.getBoundingClientRect();
    return pointer.x >= box.left && pointer.x <= box.right && pointer.y >= box.top && pointer.y <= box.bottom;
}

function videos() {
    return [...live].filter(video => !video.controls && video.duration !== Infinity && !video.classList.contains(PACE));
}

function reobserve(all: HTMLVideoElement[]) {
    if (!observer) return;

    const next = new Set(all);
    for (const video of seen) if (!next.has(video)) observer.unobserve(video);
    for (const video of all) if (!seen.has(video)) observer.observe(video);
    seen = next;
}

function hold(video: HTMLVideoElement) {
    if (video.paused) return;
    video.pause();
    held.add(video);
}

function resume() {
    resumeFrame = 0;
    for (const video of resuming.splice(0, RESUME_PER_FRAME)) {
        held.delete(video);
        video.play().catch(() => { });
    }
    if (resuming.length) resumeFrame = requestAnimationFrame(resume);
}

function runPass() {
    pass = 0;

    const all = videos();
    reobserve(all);
    resuming = [];

    if (!canPlay()) {
        for (const video of all) hold(video);
        return;
    }

    let playable = all;
    if (settings.store.pauseOffscreen) playable = playable.filter(video => !offscreen.has(video));
    if (settings.store.hoverOnly) playable = playable.filter(under);
    if (settings.store.pauseWhilePicking && picking) playable = playable.filter(video => !video.classList.contains(NAMEPLATE));

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
        if (!keep.has(video)) hold(video);
        else if (video.paused && (held.has(video) || video.autoplay)) resuming.push(video);
    }
    if (resuming.length && !resumeFrame) resumeFrame = requestAnimationFrame(resume);
}

function schedulePass() {
    if (pass) return;
    pass = requestIdleCallback(runPass, { timeout: PASS_DEADLINE });
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

    document.body.classList.toggle(OFFSCREEN, settings.store.pauseOffscreen);

    syncInput();

    const nowAwake = awake();
    if (settings.store.refreshStatic && wasAwake !== undefined && nowAwake !== wasAwake) WindowStore.emitChange();
    wasAwake = nowAwake;

    schedulePass();
}

export function refreshGate() {
    if (frame) return;
    frame = requestAnimationFrame(apply);
}

function fast(target: EventTarget | null, threshold: number) {
    const el = target instanceof Element ? target : document.scrollingElement;
    if (!el) return true;

    const now = performance.now();
    const last = scrolled.get(el);
    scrolled.set(el, { top: el.scrollTop, left: el.scrollLeft, at: now });
    if (!last) return false;

    const dt = now - last.at;
    if (dt <= 0) return true;
    return (Math.abs(el.scrollTop - last.top) + Math.abs(el.scrollLeft - last.left)) / dt * 1000 >= threshold;
}

function onScroll(e: Event) {
    if (!settings.store.pauseWhileScrolling) return;

    const { scrollSpeed } = settings.store;
    if (scrollSpeed > 0 && !fast(e.target, scrollSpeed)) return;

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

function onHover() {
    if (settings.store.hoverOnly) schedulePass();
}

function editable(target: EventTarget | null) {
    return target instanceof HTMLElement
        && (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement);
}

function onKey(e: KeyboardEvent) {
    onInput();
    if (!settings.store.pauseWhileTyping || !editable(e.target)) return;

    if (!typing) {
        typing = true;
        refreshGate();
    }

    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
        typing = false;
        refreshGate();
    }, TYPING_SETTLE);
}

function onInput() {
    const wasIdle = idle();
    lastInput = Date.now();
    if (wasIdle) refreshGate();
}

const INPUT: [string, EventListener][] = [
    ["pointermove", onPointer as EventListener],
    ["pointerover", onHover],
    ["keydown", onKey as EventListener],
    ["pointerdown", onInput],
    ["wheel", onInput]
];

function syncInput() {
    const want = WindowStore.isFocused();
    if (want === inputAttached) return;
    inputAttached = want;

    for (const [type, listener] of INPUT) {
        if (want) document.addEventListener(type, listener, { passive: true });
        else document.removeEventListener(type, listener);
    }
    if (want) lastInput = Date.now();
}

export function startGate() {
    reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

    observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
            const video = entry.target as HTMLVideoElement;
            if (entry.isIntersecting) offscreen.delete(video);
            else offscreen.add(video);
        }
        schedulePass();
    }, { rootMargin: "64px" });

    reduceMotion.addEventListener("change", refreshGate);
    document.addEventListener("visibilitychange", refreshGate);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    WindowStore.addChangeListener(refreshGate);
    const picker = ExpressionPickerStore.useExpressionPickerStore as unknown as PickerStore;
    picking = picker.getState().activeView != null;
    unsubscribePicker = picker.subscribe(state => {
        const open = state.activeView != null;
        if (open === picking) return;
        picking = open;
        schedulePass();
    });
    idleTimer = setInterval(() => {
        if (settings.store.idleAfter > 0) refreshGate();
    }, 5000);

    refreshGate();
}

export function stopGate() {
    reduceMotion?.removeEventListener("change", refreshGate);
    document.removeEventListener("visibilitychange", refreshGate);
    document.removeEventListener("scroll", onScroll, { capture: true });
    WindowStore.removeChangeListener(refreshGate);
    unsubscribePicker?.();
    unsubscribePicker = undefined;
    picking = false;
    for (const [type, listener] of INPUT) document.removeEventListener(type, listener);
    inputAttached = false;

    observer?.disconnect();
    observer = undefined;
    seen = new Set();

    clearTimeout(scrollTimer);
    clearTimeout(typingTimer);
    clearInterval(idleTimer);
    clearTimeout(settleTimer);
    if (frame) cancelAnimationFrame(frame);
    if (pass) cancelIdleCallback(pass);
    if (resumeFrame) cancelAnimationFrame(resumeFrame);
    frame = pass = resumeFrame = 0;
    resuming = [];
    scrolling = typing = false;
    wasAwake = undefined;

    document.body.classList.remove(OFFSCREEN);
}
