/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { isPluginEnabled } from "@api/PluginManager";
import definePlugin from "@utils/types";

import { Hit, MESSAGE_SELECTOR, messageAt, onMessages, resolve } from "./actions";
import { closeOverlay, drawOverlay, openOverlay } from "./overlay";
import { settings } from "./settings";
import { Stroke } from "./stroke";

const START = 8;
const SWIPE_SLIDE = 72;
const BLOCKED = 'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="slider"], [role="dialog"], [role="menu"], a[href], img, video, canvas, [draggable="true"], .vc-mg-pad';

function onText(x: number, y: number) {
    const node = document.caretRangeFromPoint(x, y)?.startContainer;
    if (node?.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) return false;
    const range = document.createRange();
    range.selectNodeContents(node);
    return [...range.getClientRects()].some(b => x >= b.left - 2 && x <= b.right + 2 && y >= b.top - 2 && y <= b.bottom + 2);
}

function emptySpot(e: PointerEvent) {
    const t = e.target;
    if (!(t instanceof Element) || t.closest(BLOCKED)) return false;
    if (t instanceof HTMLElement && t.clientWidth && (e.offsetX > t.clientWidth || e.offsetY > t.clientHeight)) return false;
    return !onText(e.clientX, e.clientY);
}

function stop(e: Event) {
    e.preventDefault();
    e.stopImmediatePropagation();
}

function startsGesture(e: PointerEvent) {
    const t = e.target as Element;
    if (t.closest?.(MESSAGE_SELECTOR) && isPluginEnabled("NoMessageSelect") && !t.closest("[data-vc-selectable]")) return !t.closest(BLOCKED);
    return emptySpot(e);
}

let drag: { x: number; y: number; hit: Hit | null; stroke: Stroke; drawing: boolean; marked: Element | null; } | null = null;
let swallowClick = false;

function mark(el: Element | null) {
    if (!drag || drag.marked === el) return;
    drag.marked?.classList.remove("vc-mg-target");
    el?.classList.add("vc-mg-target");
    drag.marked = el;
}

function end(run: boolean) {
    const d = drag;
    drag = null;
    if (!d) return;
    d.marked?.classList.remove("vc-mg-target");
    if (!d.drawing) return;
    swallowClick = true;
    const action = run && d.stroke.gesture ? resolve(d.stroke.gesture, d.hit) : undefined;
    closeOverlay(!!action);
    action?.run(d.hit);
}

function onPointerDown(e: PointerEvent) {
    end(false);
    swallowClick = false;
    if (e.button !== 0 || !e.isPrimary || !e.isTrusted || !startsGesture(e)) return;
    drag = {
        x: e.clientX,
        y: e.clientY,
        hit: messageAt(e.target as Element),
        stroke: new Stroke(e.clientX, e.clientY, settings.store.stepSize),
        drawing: false,
        marked: null
    };
}

function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    if (!drag.drawing) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < START) return;
        drag.drawing = true;
        if (settings.store.trail) openOverlay();
    }
    getSelection()?.removeAllRanges();
    const changed = drag.stroke.add(e.clientX, e.clientY);
    const { gesture, points } = drag.stroke;
    const action = gesture ? resolve(gesture, drag.hit) : undefined;
    if (changed) mark(action && onMessages(action) ? drag.hit!.element : null);
    drawOverlay(points, e.clientX, e.clientY, gesture, action?.label ?? null);
}

function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Escape" || !drag?.drawing) return;
    stop(e);
    end(false);
}

function onClick(e: MouseEvent) {
    if (!swallowClick || !e.isTrusted) return;
    swallowClick = false;
    stop(e);
}

const swipe: { acc: number; hit: Hit | null; timer?: ReturnType<typeof setTimeout>; until: number; } = { acc: 0, hit: null, until: 0 };

function sideways(el: Element | null) {
    for (; el && el !== document.body; el = el.parentElement)
        if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
    return false;
}

function settle(matched: boolean) {
    clearTimeout(swipe.timer);
    const el = swipe.hit?.element as HTMLElement | undefined;
    if (el) {
        el.style.transition = "translate 220ms cubic-bezier(0.23, 1, 0.32, 1)";
        el.style.translate = "";
        setTimeout(() => el.style.transition = "", 240);
    }
    swipe.acc = 0;
    swipe.hit = null;
    closeOverlay(matched);
}

function onWheel(e: WheelEvent) {
    if (!settings.store.twoFingerSwipes || e.ctrlKey || e.timeStamp < swipe.until) return;
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    if (swipe.acc === 0) {
        if (sideways(e.target as Element)) return;
        swipe.hit = messageAt(e.target as Element);
        if (settings.store.trail) openOverlay();
    }
    swipe.acc += e.deltaX;
    clearTimeout(swipe.timer);
    swipe.timer = setTimeout(() => settle(false), 160);

    const gesture = swipe.acc > 0 ? "L" : "R";
    const action = resolve(gesture, swipe.hit);
    const el = swipe.hit?.element as HTMLElement | undefined;
    if (el) {
        el.style.transition = "";
        el.style.translate = `${Math.max(-SWIPE_SLIDE, Math.min(SWIPE_SLIDE, -swipe.acc * 0.45))}px 0`;
    }
    drawOverlay([], e.clientX, e.clientY, gesture, action?.label ?? null);

    if (Math.abs(swipe.acc) < settings.store.swipeDistance) return;
    const { hit } = swipe;
    settle(!!action);
    swipe.until = e.timeStamp + 700;
    action?.run(hit);
}

const listeners: [string, (e: any) => void][] = [
    ["pointerdown", onPointerDown],
    ["pointermove", onPointerMove],
    ["pointerup", () => end(true)],
    ["pointercancel", () => end(false)],
    ["blur", () => end(false)],
    ["keydown", onKeyDown],
    ["click", onClick],
    ["wheel", onWheel]
];

export default definePlugin({
    name: "MouseGestures",
    description: "Drag on empty space to draw a gesture: go back, switch tabs and more. On a message, drag anywhere on it to reply, forward, react and so on. Draw your own gestures in the settings",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],
    settings,

    start() {
        for (const [type, fn] of listeners) window.addEventListener(type, fn, { capture: true, passive: type === "wheel" });
    },

    stop() {
        for (const [type, fn] of listeners) window.removeEventListener(type, fn, { capture: true });
        end(false);
        settle(false);
        swallowClick = false;
    }
});
