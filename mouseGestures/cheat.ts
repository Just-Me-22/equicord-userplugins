/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { allActions } from "./actions";
import { settings } from "./settings";
import { isReady, shapeAction } from "./shapes";
import { arrows } from "./stroke";
import { Context, ZONES } from "./zones";

const MAX_ROWS = 18;

let card: HTMLDivElement | null = null;
export const pointer = { x: 0, y: 0, ctx: null as Context | null };

const esc = (text: string) => text.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const keys = (gesture: string) => arrows(gesture).split(" ").map(a => `<kbd>${a}</kbd>`).join("");

function rows(ctx: Context | null) {
    const { bindings, shapes } = settings.store;
    const zones = [...(ctx?.zones ?? []), "anywhere" as const];
    const taken = new Set<string>();
    const sections: string[] = [];

    const usable = shapes.filter(s => isReady(s) && (shapeAction(s)!.zone === "anywhere" || zones.includes(shapeAction(s)!.zone)));
    if (usable.length)
        sections.push(`<h4>Your shapes</h4>${usable.map(s => `<div class="vc-mg-cheat-row"><span class="vc-mg-cheat-shape">${esc(s.name)}</span><span>${esc(shapeAction(s)!.label)}</span></div>`).join("")}`);

    for (const zone of zones) {
        const list = allActions().filter(a => a.zone === zone && bindings[a.id] && !taken.has(bindings[a.id]));
        if (!list.length) continue;
        list.forEach(a => taken.add(bindings[a.id]));
        const { label } = (ZONES.find(z => z.id === zone)!);
        sections.push(`<h4>${label}</h4>${list.map(a => `<div class="vc-mg-cheat-row"><span class="vc-mg-keys">${keys(bindings[a.id])}</span><span>${esc(a.label)}</span></div>`).join("")}`);
    }
    return sections;
}

export function showCheat(x = pointer.x, y = pointer.y, ctx: Context | null = pointer.ctx) {
    hideCheat();
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

export function hideCheat() {
    card?.remove();
    card = null;
}

export const cheatOpen = () => card !== null;
