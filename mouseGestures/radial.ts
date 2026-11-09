/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Action } from "./actions";
import { settings } from "./settings";
import type { Context } from "./zones";

const RADIUS = 96;
const DEAD = 30;

let ring: { el: HTMLDivElement; items: Action[]; ctx: Context; x: number; y: number; pick: number; } | null = null;

const esc = (text: string) => text.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function stop(e: Event) {
    e.preventDefault();
    e.stopImmediatePropagation();
}

function sliceAt(x: number, y: number) {
    if (!ring) return -1;
    const dx = x - ring.x, dy = y - ring.y;
    if (Math.hypot(dx, dy) < DEAD) return -1;
    const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
    const size = 360 / ring.items.length;
    return Math.floor(((angle + size / 2) % 360) / size);
}

function highlight(index: number) {
    if (!ring || ring.pick === index) return;
    ring.pick = index;
    ring.el.querySelectorAll(".vc-mg-radial-item").forEach((item, i) => item.classList.toggle("vc-mg-radial-on", i === index));
    ring.el.style.setProperty("--vc-mg-radial-angle", index < 0 ? "0deg" : `${index * 360 / ring.items.length}deg`);
    ring.el.classList.toggle("vc-mg-radial-aiming", index >= 0);
}

function onMove(e: PointerEvent) {
    if (ring) highlight(sliceAt(e.clientX, e.clientY));
}

function onDown(e: PointerEvent) {
    if (!ring) return;
    stop(e);
    highlight(sliceAt(e.clientX, e.clientY));
}

function onUp(e: PointerEvent) {
    if (!ring) return;
    stop(e);
    const { items, ctx, pick } = ring;
    const far = Math.hypot(e.clientX - ring.x, e.clientY - ring.y) > RADIUS * 2.2;
    closeRadial();
    swallowNextClick();
    if (pick >= 0 && !far) items[pick].run(ctx);
}

function onKey(e: KeyboardEvent) {
    if (!ring) return;
    if (e.key === "Escape") {
        stop(e);
        closeRadial();
        return;
    }
    const n = Number(e.key);
    if (n >= 1 && n <= ring.items.length) {
        stop(e);
        const { items, ctx } = ring;
        closeRadial();
        items[n - 1].run(ctx);
    }
}

function swallowNextClick() {
    const swallow = (e: MouseEvent) => stop(e);
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 400);
}

const listeners: [string, (e: any) => void][] = [
    ["pointermove", onMove],
    ["pointerdown", onDown],
    ["pointerup", onUp],
    ["keydown", onKey]
];

export function openRadial(items: Action[], ctx: Context, x: number, y: number) {
    closeRadial();
    if (!items.length) return;
    const cx = Math.max(RADIUS + 60, Math.min(innerWidth - RADIUS - 60, x));
    const cy = Math.max(RADIUS + 40, Math.min(innerHeight - RADIUS - 40, y));
    const el = document.createElement("div");
    el.className = "vc-mg-radial";
    el.style.left = `${cx}px`;
    el.style.top = `${cy}px`;
    el.style.color = settings.store.trailColor;
    el.style.setProperty("--vc-mg-radial-slice", `${360 / items.length}deg`);
    el.innerHTML = `<div class="vc-mg-radial-wedge"></div><div class="vc-mg-radial-hub">✕</div>${items.map((a, i) => {
        const angle = (i * 360 / items.length - 90) * Math.PI / 180;
        return `<div class="vc-mg-radial-item" style="left:${Math.cos(angle) * RADIUS}px;top:${Math.sin(angle) * RADIUS}px"><b>${i + 1}</b>${esc(a.label)}</div>`;
    }).join("")}`;
    document.body.appendChild(el);
    ring = { el, items, ctx, x: cx, y: cy, pick: -2 };
    highlight(-1);
    for (const [type, fn] of listeners) window.addEventListener(type, fn, { capture: true });
}

export function closeRadial() {
    if (!ring) return;
    for (const [type, fn] of listeners) window.removeEventListener(type, fn, { capture: true });
    const { el } = ring;
    ring = null;
    el.classList.add("vc-mg-radial-out");
    setTimeout(() => el.remove(), 160);
}

export const radialOpen = () => ring !== null;
