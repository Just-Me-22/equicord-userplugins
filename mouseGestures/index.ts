/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { isPluginEnabled } from "@api/PluginManager";
import definePlugin from "@utils/types";

import { Action, allActions, resolve } from "./actions";
import { hideCheat, pointer, showCheat } from "./cheat";
import { closeOverlay, drawOverlay, dropReady, openOverlay, showReady, tick } from "./overlay";
import { radialOpen } from "./radial";
import { DEFAULT_BINDINGS, DEFAULTS_VERSION, settings } from "./settings";
import { matchShape } from "./shapes";
import { arrows, Stroke } from "./stroke";
import { openStudio } from "./studio";
import { Context, contextAt, MESSAGE_SELECTOR } from "./zones";

const READY_DELAY = 90;
const SWIPE_SLIDE = 72;
const CHEAT_SLOP = 6;
const BLOCKED = 'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="slider"], [role="dialog"], [role="menu"], a[href], img, video, canvas, [draggable="true"], .vc-mg-pad';
const NEVER = 'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="slider"], [role="dialog"], [role="menu"], .vc-mg-pad';

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

function startsGesture(e: PointerEvent, ctx: Context) {
    const t = e.target as Element;
    if (t.closest(MESSAGE_SELECTOR)) {
        const free = isPluginEnabled("NoMessageSelect") && !t.closest("[data-vc-selectable]");
        return free ? !t.closest(BLOCKED) : emptySpot(e);
    }
    if (ctx.zones.length) return !t.closest(NEVER);
    return emptySpot(e);
}

let drag: {
    x: number; y: number; at: number; ctx: Context; stroke: Stroke; drawing: boolean; marked: Element | null; movable: Element | null;
    armTimer?: ReturnType<typeof setTimeout>; readyTimer?: ReturnType<typeof setTimeout>; cheatTimer?: ReturnType<typeof setTimeout>; still?: [number, number];
} | null = null;
let swallowClick = false;

function mark(el: Element | null | undefined) {
    if (!drag || drag.marked === (el ?? null)) return;
    drag.marked?.classList.remove("vc-mg-target");
    el?.classList.add("vc-mg-target");
    drag.marked = el ?? null;
}

function decide(stroke: Stroke, ctx: Context): { action?: Action; keys: string; } {
    const shape = matchShape(stroke.points, ctx);
    if (shape) return { action: shape.action, keys: `◎ ${shape.shape.name}` };
    return { action: stroke.gesture ? resolve(stroke.gesture, ctx) : undefined, keys: arrows(stroke.gesture) };
}

function run(action: Action | undefined, ctx: Context) {
    if (!action) return;
    if (settings.store.sound) tick();
    action.run(ctx);
}

function disarm(d: NonNullable<typeof drag>) {
    clearTimeout(d.armTimer);
    clearTimeout(d.readyTimer);
    clearTimeout(d.cheatTimer);
    dropReady();
    d.movable?.classList.remove("vc-mg-armed");
}

function end(go: boolean) {
    const d = drag;
    drag = null;
    if (!d) return;
    disarm(d);
    d.marked?.classList.remove("vc-mg-target");
    if (!d.drawing) return;
    hideCheat();
    swallowClick = true;
    const action = go ? decide(d.stroke, d.ctx).action : undefined;
    closeOverlay(!!action);
    run(action, d.ctx);
}

function onPointerDown(e: PointerEvent) {
    if (radialOpen()) return;
    end(false);
    hideCheat();
    swallowClick = false;
    if (e.button !== 0 || !e.isPrimary || !e.isTrusted || !(e.target instanceof Element)) return;
    const ctx = contextAt(e.target);
    pointer.ctx = ctx;
    if (!startsGesture(e, ctx)) return;
    drag = {
        x: e.clientX,
        y: e.clientY,
        at: e.timeStamp,
        ctx,
        stroke: new Stroke(e.clientX, e.clientY, settings.store.stepSize, settings.store.diagonals),
        drawing: false,
        marked: null,
        movable: ctx.zones.length && !ctx.hit ? e.target.closest('[draggable="true"]') : null
    };
    if (settings.store.readyRing) {
        const { clientX, clientY } = e;
        drag.readyTimer = setTimeout(() => showReady(clientX, clientY), READY_DELAY);
    }
    if (drag.movable) {
        const { movable } = drag;
        drag.armTimer = setTimeout(() => movable.classList.add("vc-mg-armed"), settings.store.holdToMove);
    }
}

function watchStill(e: PointerEvent) {
    if (!drag || !settings.store.cheatSheet) return;
    if (drag.still && Math.hypot(e.clientX - drag.still[0], e.clientY - drag.still[1]) < CHEAT_SLOP) return;
    drag.still = [e.clientX, e.clientY];
    hideCheat();
    clearTimeout(drag.cheatTimer);
    const { ctx } = drag;
    const { clientX, clientY } = e;
    drag.cheatTimer = setTimeout(() => showCheat(clientX, clientY, ctx), settings.store.cheatDelay);
}

function onPointerMove(e: PointerEvent) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    if (!drag) return;
    if (!drag.drawing) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < settings.store.startDistance) return;
        drag.drawing = true;
        disarm(drag);
        if (settings.store.trail) openOverlay();
    }
    getSelection()?.removeAllRanges();
    drag.stroke.add(e.clientX, e.clientY);
    watchStill(e);
    const { action, keys } = decide(drag.stroke, drag.ctx);
    mark(action && action.zone !== "anywhere" ? drag.ctx.targets[action.zone] : null);
    drawOverlay(drag.stroke.points, e.clientX, e.clientY, keys, action?.label ?? null);
}

function onDragStart(e: DragEvent) {
    if (!drag) return;
    if (e.timeStamp - drag.at >= settings.store.holdToMove) {
        disarm(drag);
        drag.marked?.classList.remove("vc-mg-target");
        drag = null;
        closeOverlay(false);
        return;
    }
    stop(e);
}

function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    hideCheat();
    if (!drag?.drawing) return;
    stop(e);
    end(false);
}

function onClick(e: MouseEvent) {
    if (!swallowClick || !e.isTrusted) return;
    swallowClick = false;
    stop(e);
}

const swipe: { acc: number; ctx: Context | null; timer?: ReturnType<typeof setTimeout>; until: number; } = { acc: 0, ctx: null, until: 0 };

function sideways(el: Element | null) {
    for (; el && el !== document.body; el = el.parentElement)
        if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
    return false;
}

function settle(matched: boolean) {
    clearTimeout(swipe.timer);
    const el = swipe.ctx?.hit?.element as HTMLElement | undefined;
    if (el) {
        el.style.transition = "translate 220ms cubic-bezier(0.23, 1, 0.32, 1)";
        el.style.translate = "";
        setTimeout(() => el.style.transition = "", 240);
    }
    swipe.acc = 0;
    swipe.ctx = null;
    closeOverlay(matched);
}

function onWheel(e: WheelEvent) {
    if (!settings.store.twoFingerSwipes || e.ctrlKey || e.timeStamp < swipe.until) return;
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    if (swipe.acc === 0) {
        if (sideways(e.target as Element)) return;
        swipe.ctx = contextAt(e.target as Element);
        if (settings.store.trail) openOverlay();
    }
    const ctx = swipe.ctx!;
    swipe.acc += e.deltaX;
    clearTimeout(swipe.timer);
    swipe.timer = setTimeout(() => settle(false), 160);

    const gesture = swipe.acc > 0 ? "L" : "R";
    const action = resolve(gesture, ctx);
    const el = ctx.hit?.element as HTMLElement | undefined;
    if (el) {
        el.style.transition = "";
        el.style.translate = `${Math.max(-SWIPE_SLIDE, Math.min(SWIPE_SLIDE, -swipe.acc * 0.45))}px 0`;
    }
    drawOverlay([], e.clientX, e.clientY, arrows(gesture), action?.label ?? null);

    if (Math.abs(swipe.acc) < settings.store.swipeDistance) return;
    settle(!!action);
    swipe.until = e.timeStamp + 700;
    run(action, ctx);
}

function addNewDefaults() {
    const version = settings.store.defaultsVersion ?? 1;
    if (version >= DEFAULTS_VERSION) return;
    if (version < 3 && settings.store.stepSize < 22) settings.store.stepSize = 30;
    const bindings = { ...settings.store.bindings };
    const zoneOf = (id: string) => allActions().find(a => a.id === id)?.zone;
    for (const [id, gesture] of Object.entries(DEFAULT_BINDINGS)) {
        if (id in bindings) continue;
        const taken = Object.entries(bindings).some(([other, g]) => g === gesture && zoneOf(other) === zoneOf(id));
        if (!taken) bindings[id] = gesture;
    }
    settings.store.bindings = bindings;
    settings.store.defaultsVersion = DEFAULTS_VERSION;
}

const listeners: [string, (e: any) => void][] = [
    ["pointerdown", onPointerDown],
    ["pointermove", onPointerMove],
    ["pointerup", () => end(true)],
    ["pointercancel", () => end(false)],
    ["dragstart", onDragStart],
    ["blur", (e: FocusEvent) => { if (e.target === window) end(false); }],
    ["keydown", onKeyDown],
    ["click", onClick],
    ["wheel", onWheel]
];

export default definePlugin({
    name: "MouseGestures",
    description: "Drag to draw a gesture or a shape you taught it. What it does depends on where you start: a message, the tab bar, the server list, the channel list, a person, or anywhere else. Set it all up in the gesture studio",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],
    settings,

    toolboxActions: {
        "Gesture studio": () => openStudio()
    },

    start() {
        addNewDefaults();
        for (const [type, fn] of listeners) window.addEventListener(type, fn, { capture: true, passive: type === "wheel" });
    },

    stop() {
        for (const [type, fn] of listeners) window.removeEventListener(type, fn, { capture: true });
        end(false);
        settle(false);
        hideCheat();
        swallowClick = false;
    }
});
