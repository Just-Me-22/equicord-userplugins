/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    doubleClick: {
        type: OptionType.BOOLEAN,
        description: "Double-click opens the right-click menu",
        default: true
    },
    onMessages: {
        type: OptionType.SELECT,
        description: "What double-click does on a message",
        options: [
            { label: "Open the menu", value: "menu", default: true },
            { label: "Open the menu only with Alt held, leaving plain double-click to MessageClickActions", value: "alt" }
        ]
    },
    doubleClickSpeed: {
        type: OptionType.SLIDER,
        description: "How quickly the second click has to follow the first, in milliseconds. Raise it if double-clicks get missed, lower it if two separate clicks open the menu",
        markers: [200, 300, 400, 500, 600, 700, 800],
        default: 400,
        stickToMarkers: false
    },
    skipTextBoxes: {
        type: OptionType.BOOLEAN,
        description: "In the message box and other text fields, double-click selects a word as usual",
        default: true
    },
    hold: {
        type: OptionType.BOOLEAN,
        description: "Pressing and holding still also opens the menu. Whatever you pressed doesn't get clicked",
        default: true
    },
    holdTime: {
        type: OptionType.SLIDER,
        description: "How long to hold, in milliseconds",
        markers: [300, 400, 500, 600, 800, 1000, 1200],
        default: 550,
        stickToMarkers: false
    },
    ripple: {
        type: OptionType.BOOLEAN,
        description: "Show a small ring where the menu opens, filling up while you hold",
        default: true
    }
});

const SLOP = 10;
const RING_DELAY = 150;
const TEXT = 'input, textarea, [contenteditable="true"], [role="textbox"]';
const MESSAGE = '[id^="chat-messages-"]';

interface Point { clientX: number; clientY: number; screenX: number; screenY: number; }

const point = (e: MouseEvent): Point => ({ clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY });
const near = (a: Point, b: Point) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) <= SLOP;

let lastDown: (Point & { time: number; }) | null = null;
let armed = false;
let swallowClick = false;
let swallowDblClick = false;
let deferred: ReturnType<typeof setTimeout> | undefined;
let hold: { at: Point; timer: ReturnType<typeof setTimeout>; ringTimer?: ReturnType<typeof setTimeout>; } | null = null;
let ring: HTMLDivElement | null = null;

const altOnly = () => settings.store.doubleClick && settings.store.onMessages === "alt";

function stop(e: Event) {
    e.preventDefault();
    e.stopImmediatePropagation();
}

function hasOwnDoubleClick(el: Element | null) {
    for (; el && el !== document.body; el = el.parentElement) {
        const key = Object.keys(el).find(k => k.startsWith("__reactProps$"));
        if (key && typeof (el as any)[key]?.onDoubleClick === "function") return true;
    }
    return false;
}

function newRing(at: Point) {
    ring?.remove();
    const el = document.createElement("div");
    el.className = "vc-dcm-ring";
    el.style.left = `${at.clientX}px`;
    el.style.top = `${at.clientY}px`;
    el.innerHTML = '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" pathLength="1"/></svg>';
    document.body.appendChild(el);
    ring = el;
    return el;
}

function chargeRing(at: Point, ms: number) {
    const el = newRing(at);
    el.style.setProperty("--vc-dcm-fill", `${ms}ms`);
    el.classList.add("vc-dcm-charging");
}

function pulseRing(at: Point) {
    const el = ring?.classList.contains("vc-dcm-charging") ? ring : newRing(at);
    el.classList.remove("vc-dcm-charging");
    el.classList.add("vc-dcm-done");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    ring = null;
}

function dropRing() {
    const el = ring;
    if (!el) return;
    ring = null;
    el.classList.add("vc-dcm-cancel");
    setTimeout(() => el.remove(), 150);
}

function openMenu(target: Element, at: Point) {
    target.dispatchEvent(new MouseEvent("contextmenu", {
        ...at,
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        button: 2,
        buttons: 2
    }));
    if (settings.store.ripple) pulseRing(at);
}

function cancelHold() {
    if (!hold) return;
    clearTimeout(hold.timer);
    clearTimeout(hold.ringTimer);
    hold = null;
    dropRing();
}

function onPointerDown(e: PointerEvent) {
    cancelHold();
    swallowClick = false;
    if (!settings.store.hold || e.button !== 0 || !e.isPrimary || !e.isTrusted) return;
    const target = e.target as Element;
    const at = point(e);
    const { holdTime, ripple } = settings.store;
    hold = {
        at,
        timer: setTimeout(() => {
            hold = null;
            swallowClick = true;
            lastDown = null;
            openMenu(target, at);
        }, holdTime),
        ringTimer: ripple ? setTimeout(() => chargeRing(at, holdTime - RING_DELAY), RING_DELAY) : undefined
    };
}

function onPointerMove(e: PointerEvent) {
    if (hold && !near(hold.at, e)) cancelHold();
}

function onMouseDown(e: MouseEvent) {
    armed = false;
    if (e.button !== 0 || !e.isTrusted) return;
    const now = e.timeStamp;
    const quick = lastDown !== null && now - lastDown.time <= settings.store.doubleClickSpeed && near(lastDown, e);
    lastDown = quick ? null : { ...point(e), time: now };
    if (!quick || !settings.store.doubleClick) return;

    const target = e.target as Element;
    if (settings.store.skipTextBoxes && target.closest(TEXT)) return;
    if (target.closest(MESSAGE) ? altOnly() && !e.altKey : hasOwnDoubleClick(target)) return;

    e.preventDefault();
    armed = true;
}

function onClick(e: MouseEvent) {
    if (!e.isTrusted || e.button !== 0) return;
    if (swallowClick) {
        swallowClick = false;
        stop(e);
        return;
    }

    const target = e.target as Element;
    if (armed) {
        armed = false;
        clearTimeout(deferred);
        deferred = undefined;
        swallowDblClick = true;
        stop(e);
        openMenu(target, point(e));
        return;
    }

    if (e.altKey && altOnly() && target.closest(MESSAGE)) {
        stop(e);
        const init: MouseEventInit = { ...point(e), bubbles: true, cancelable: true, composed: true, view: window, detail: 1, altKey: true, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey };
        clearTimeout(deferred);
        deferred = setTimeout(() => {
            deferred = undefined;
            target.dispatchEvent(new MouseEvent("click", init));
        }, settings.store.doubleClickSpeed);
    }
}

function onDblClick(e: MouseEvent) {
    if (!swallowDblClick) return;
    swallowDblClick = false;
    stop(e);
}

const listeners: [string, (e: any) => void][] = [
    ["pointerdown", onPointerDown],
    ["pointermove", onPointerMove],
    ["pointerup", cancelHold],
    ["pointercancel", cancelHold],
    ["dragstart", cancelHold],
    ["wheel", cancelHold],
    ["blur", cancelHold],
    ["mousedown", onMouseDown],
    ["click", onClick],
    ["dblclick", onDblClick]
];

export default definePlugin({
    name: "DoubleClickMenu",
    description: "Opens the right-click menu with a double-click or a press and hold, for touchpads that can't right-click",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],
    settings,

    start() {
        for (const [type, fn] of listeners) window.addEventListener(type, fn, { capture: true, passive: type === "wheel" });
    },

    stop() {
        for (const [type, fn] of listeners) window.removeEventListener(type, fn, { capture: true });
        cancelHold();
        clearTimeout(deferred);
        ring?.remove();
        ring = null;
        lastDown = null;
        armed = swallowClick = swallowDblClick = false;
    }
});
