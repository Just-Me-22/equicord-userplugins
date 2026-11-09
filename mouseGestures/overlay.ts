/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { settings } from "./settings";
import { arrows } from "./stroke";

let root: HTMLDivElement | null = null;

export function openOverlay() {
    root?.remove();
    root = document.createElement("div");
    root.className = "vc-mg-overlay";
    root.style.color = settings.store.trailColor;
    root.innerHTML = '<svg><polyline/></svg><div class="vc-mg-pill" hidden><b></b><span></span></div>';
    document.body.appendChild(root);
}

export function drawOverlay(points: [number, number][], x: number, y: number, gesture: string, label: string | null) {
    if (!root) return;
    root.querySelector("polyline")!.setAttribute("points", points.map(p => p.join(",")).join(" "));
    root.classList.toggle("vc-mg-overlay-nomatch", !!gesture && !label);
    const pill = root.querySelector<HTMLDivElement>(".vc-mg-pill")!;
    pill.hidden = !gesture;
    if (!gesture) return;
    pill.querySelector("b")!.textContent = arrows(gesture);
    pill.querySelector("span")!.textContent = label ?? "No action";
    pill.classList.toggle("vc-mg-pill-miss", !label);
    pill.style.left = `${Math.min(x + 18, innerWidth - pill.offsetWidth - 8)}px`;
    pill.style.top = `${y + 52 > innerHeight ? y - 44 : y + 18}px`;
}

export function closeOverlay(matched: boolean) {
    const el = root;
    root = null;
    if (!el) return;
    el.classList.add(matched ? "vc-mg-overlay-done" : "vc-mg-overlay-miss");
    setTimeout(() => el.remove(), 320);
}
