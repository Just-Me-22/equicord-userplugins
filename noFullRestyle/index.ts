/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

const HOVER = "vc-region-hover";
const RING = "vc-region-ring";
const BASE = '[class*="baseLayer_"] > div[class*="base__"]';
const REGIONS = [
    `${BASE} > div[class*="bar_"]`,
    'nav[class*="guilds_"]',
    'div[class*="sidebarList"]',
    'nav[class*="privateChannels_"]',
    'div[class*="chat_"] section[class*="title_"]',
    'main[class*="chatContent"]'
].join(",");

let ring: HTMLDivElement | undefined;

function light(base: Element | null) {
    if (base && ring!.parentElement !== base) base.append(ring!);
    ring!.classList.toggle(HOVER, base !== null);
}

function onOver(e: PointerEvent) {
    const target = e.target as Element;
    light(target.closest?.(REGIONS) ? target.closest(BASE) : null);
}

function onOut(e: PointerEvent) {
    if (!e.relatedTarget) light(null);
}

export default definePlugin({
    name: "NoFullRestyle",
    description: "Stops three things that make Discord re-style the whole app: the screen reader announcer being moved to the start of the page when a modal opens, the focus class flipping on the page root when the window gains or loses focus, and the mouse/keyboard class flipping when you switch between typing and clicking. Loading spinners keep spinning while Discord is in the background, and keyboard focus outlines no longer show. Also marks the app while you hover the server list, channel list or chat, so a theme can light it up without a :has() rule. The class goes on an empty .vc-region-ring overlay inside it.",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],

    start() {
        ring = document.createElement("div");
        ring.className = RING;
        ring.style.cssText = "position:absolute;inset:0;pointer-events:none";
        document.addEventListener("pointerover", onOver, { passive: true });
        document.addEventListener("pointerout", onOut, { passive: true });
    },

    stop() {
        document.removeEventListener("pointerover", onOver);
        document.removeEventListener("pointerout", onOut);
        ring?.remove();
        ring = undefined;
    },

    patches: [
        {
            find: '.dataset.liveAnnouncer="true"',
            all: true,
            replacement: {
                match: /(this\.parentNode|document\.body)\.prepend\(this\.node\)/g,
                replace: "$1.append(this.node)"
            }
        },
        {
            find: '"app-focused":',
            replacement: [
                {
                    match: /"app-focused":\i/,
                    replace: '"app-focused":!0'
                },
                {
                    match: /"keyboard-mode":\i/,
                    replace: '"keyboard-mode":!1'
                },
                {
                    match: /"mouse-mode":\i/,
                    replace: '"mouse-mode":!0'
                }
            ]
        }
    ]
});
