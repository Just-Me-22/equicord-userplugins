/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Action, allActions } from "./actions";
import { settings } from "./settings";
import { hasGesture, isReady, Point, shapeAction, shapeIcon, similar, templatesOf } from "./shapes";
import { Context, ZONES } from "./zones";

const MAX_ROWS = 18;

let card: HTMLDivElement | null = null;
export const pointer = { x: 0, y: 0, ctx: null as Context | null };

const esc = (text: string) => text.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
function glyph(template: Point[]) {
    const [x, y] = shapeIcon([template[0]], 22).split(",");
    return `<svg class="vc-mg-glyph" width="22" height="22" viewBox="0 0 22 22"><polyline points="${shapeIcon(template, 22)}"/><circle cx="${x}" cy="${y}" r="2.2"/></svg>`;
}

function rows(ctx: Context | null) {
    const { shapes } = settings.store;
    const zones = [...(ctx?.zones ?? []), "anywhere" as const];
    const taken: Point[][] = [];
    const sections: string[] = [];

    const usable = shapes.filter(s => isReady(s) && (shapeAction(s)!.zone === "anywhere" || zones.includes(shapeAction(s)!.zone)));
    if (usable.length)
        sections.push(`<h4>Your shapes</h4>${usable.map(s => `<div class="vc-mg-cheat-row" data-id="${esc(shapeAction(s)!.id)}"><span class="vc-mg-cheat-shape">${esc(s.name)}</span><span>${esc(shapeAction(s)!.label)}</span></div>`).join("")}`);

    for (const zone of zones) {
        const list = allActions().filter(a => a.zone === zone && hasGesture(a.id) && !taken.some(t => similar(t, templatesOf(a.id)[0])));
        if (!list.length) continue;
        list.forEach(a => taken.push(templatesOf(a.id)[0]));
        const { label } = (ZONES.find(z => z.id === zone)!);
        sections.push(`<h4>${label}</h4>${list.map(a => `<div class="vc-mg-cheat-row" data-id="${esc(a.id)}">${glyph(templatesOf(a.id)[0])}<span>${esc(a.label)}</span></div>`).join("")}`);
    }
    return sections;
}

export function showCheat(x = pointer.x, y = pointer.y, ctx: Context | null = pointer.ctx) {
    hideCheat();
    shownCtx = ctx;
    const sections = rows(ctx);
    card = document.createElement("div");
    card.className = "vc-mg-cheat";
    card.innerHTML = sections.length ? sections.join("") : "<p>No gestures set for here yet. Open the gesture studio to add some.</p>";
    const extra = card.querySelectorAll(".vc-mg-cheat-row");
    extra.forEach((row, i) => { if (i >= MAX_ROWS) row.remove(); });
    document.body.appendChild(card);
    const { offsetWidth: w, offsetHeight: h } = card;
    card.style.left = `${Math.max(8, Math.min(x + 20, innerWidth - w - 8))}px`;
    card.style.top = `${Math.max(8, Math.min(y + 20, innerHeight - h - 8))}px`;
}

let shownCtx: Context | null = null;
let hot: HTMLElement | null = null;
let dwell: ReturnType<typeof setTimeout> | undefined;
let runner: (action: Action, ctx: Context | null) => void = () => { };

export const setCheatRunner = (fn: typeof runner) => { runner = fn; };
export const cheatContext = () => shownCtx;
export const cheatPick = () => hot ? allActions().find(a => a.id === hot!.dataset.id) : undefined;

export function cheatMove(x: number, y: number) {
    if (!card) return false;
    const r = card.getBoundingClientRect();
    if (x < r.left - 28 || x > r.right + 28 || y < r.top - 28 || y > r.bottom + 28) return false;
    const inside = x >= r.left && x <= r.right;
    const row = inside ? [...card.querySelectorAll<HTMLElement>("[data-id]")].find(el => {
        const b = el.getBoundingClientRect();
        return y >= b.top && y <= b.bottom;
    }) ?? null : null;
    if (row === hot) return true;
    hot?.classList.remove("vc-mg-cheat-on");
    clearTimeout(dwell);
    hot = row;
    if (!row) return true;
    const wait = settings.store.hoverRun;
    row.style.setProperty("--vc-mg-dwell", `${wait}ms`);
    row.classList.add("vc-mg-cheat-on");
    if (wait > 0) dwell = setTimeout(() => {
        const action = cheatPick();
        if (action) runner(action, shownCtx);
    }, wait);
    return true;
}

export function hideCheat() {
    clearTimeout(dwell);
    hot = null;
    card?.remove();
    card = null;
}

export const cheatOpen = () => card !== null;
