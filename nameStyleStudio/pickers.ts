/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";

const logger = new Logger("NameStyleStudio");

const KINDS: [kind: string, selector: string][] = [
    ["decoration", '[class*="decorationGridItem_"]'],
    ["effect", '[class*="effectGridItem_"]'],
    ["frame", '[class*="frameGridItem_"], [class*="framePresetItem_"]'],
    ["nameplate", '[class*="nameplateItem_"]']
];

const ANY = KINDS.map(k => k[1]).join(", ");
const logged = new Set<string>();
let observer: MutationObserver | null = null;

const describe = (el: Element) => {
    const r = el.getBoundingClientRect();
    const cls = typeof el.className === "string" ? el.className.split(" ").slice(0, 4).join(".") : "";
    return `${el.tagName.toLowerCase()}.${cls} ${Math.round(r.width)}x${Math.round(r.height)} ${el.getAttribute("role") ?? ""}`.trim();
};

function outline(el: Element, depth: number): string[] {
    if (depth < 0) return [];
    return [describe(el), ...[...el.children].slice(0, 4).flatMap(c => outline(c, depth - 1).map(l => "  " + l))];
}

function windowOf(tile: Element) {
    return tile.closest('[class*="modal_"], [role="dialog"], [class*="layer_"]') as HTMLElement | null;
}

function tag(tile: Element) {
    const kind = KINDS.find(([, sel]) => tile.matches(sel))?.[0];
    const win = windowOf(tile);
    if (!kind || !win || win.classList.contains("vc-cp")) return;
    win.classList.add("vc-cp", `vc-cp-${kind}`, "vc-cp-fresh");
    setTimeout(() => win.classList.remove("vc-cp-fresh"), 700);
    tile.closest('[class*="list_"]')?.classList.add("vc-cp-list");
    if (logged.has(kind)) return;
    logged.add(kind);
    setTimeout(() => logger.info([`PICKER ${kind}`, ...outline(win, 7)].join("\n")), 1000);
}

function scan(node: Element) {
    if (node.closest(".vc-cp") || !node.closest('[class*="layerContainer_"]')) return;
    if (node.matches(ANY)) return tag(node);
    const tile = node.querySelector(ANY);
    if (tile) tag(tile);
}

export function startPickers() {
    observer = new MutationObserver(records => {
        for (const r of records)
            for (const n of r.addedNodes)
                if (n instanceof Element) scan(n);
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

export function stopPickers() {
    observer?.disconnect();
    observer = null;
    document.querySelectorAll(".vc-cp").forEach(el => el.classList.remove("vc-cp"));
}
