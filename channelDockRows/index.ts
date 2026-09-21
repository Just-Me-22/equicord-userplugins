/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

const LIST = "ul[aria-label='Direct Messages']";
const DOCK = ["/channels/@me", "/store", "/shop", "/family-center", "/quest-home"]
    .map(href => `a[href="${href}"]`)
    .join(",");
const MARK = "vc-dock-row";

let list: HTMLElement | null = null;
let rowObserver: MutationObserver | null = null;
let rootObserver: MutationObserver | null = null;

function paint() {
    if (!list) return;
    for (const row of Array.from(list.children)) {
        row.classList.toggle(MARK, row.querySelector(DOCK) != null);
    }
}

function attach() {
    const found = document.querySelector<HTMLElement>(LIST);
    if (!found || found === list) return;

    rowObserver?.disconnect();
    list = found;
    rowObserver = new MutationObserver(paint);
    rowObserver.observe(list, { childList: true });
    paint();
}

export default definePlugin({
    name: "ChannelDockRows",
    description: "Marks the Friends, Nitro, Shop, Family Center and Quests rows in the DM list with a stable class, so themes can style them with plain class selectors instead of :has()",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],

    start() {
        rootObserver = new MutationObserver(() => {
            if (list && document.contains(list)) return;
            attach();
        });
        rootObserver.observe(document.body, { childList: true, subtree: true });
        attach();
    },

    stop() {
        rootObserver?.disconnect();
        rowObserver?.disconnect();
        rootObserver = rowObserver = null;
        list = null;
        for (const el of Array.from(document.querySelectorAll("." + MARK))) {
            el.classList.remove(MARK);
        }
    }
});
