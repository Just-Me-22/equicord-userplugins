/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";
import { SelectedGuildStore } from "@webpack/common";

const LIST = "ul[aria-label='Direct Messages']";
const DOCK = ["/channels/@me", "/store", "/shop", "/family-center", "/quest-home"]
    .map(href => `a[href="${href}"]`)
    .join(",");
const MARK = "vc-dock-row";
const MAX_TRIES = 300;

let list: HTMLElement | null = null;
let rowObserver: MutationObserver | null = null;
let frame = 0;
let tries = 0;

function paint() {
    if (!list) return;
    for (const row of Array.from(list.children)) {
        row.classList.toggle(MARK, row.querySelector(DOCK) != null);
    }
}

function attach() {
    const found = document.querySelector<HTMLElement>(LIST);
    if (!found) return false;
    if (found === list) return true;

    rowObserver?.disconnect();
    list = found;
    rowObserver = new MutationObserver(paint);
    rowObserver.observe(list, { childList: true });
    paint();
    return true;
}

function seek() {
    frame = 0;
    if (attach() || ++tries > MAX_TRIES) return;
    frame = requestAnimationFrame(seek);
}

function onRoute() {
    if (SelectedGuildStore.getGuildId() != null || list?.isConnected || frame) return;
    tries = 0;
    frame = requestAnimationFrame(seek);
}

export default definePlugin({
    name: "ChannelDockRows",
    description: "Marks the Friends, Nitro, Shop, Family Center and Quests rows in the DM list with a stable class, so themes can style them with plain class selectors instead of :has()",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],

    start() {
        SelectedGuildStore.addChangeListener(onRoute);
        onRoute();
    },

    stop() {
        SelectedGuildStore.removeChangeListener(onRoute);
        cancelAnimationFrame(frame);
        frame = 0;
        rowObserver?.disconnect();
        rowObserver = null;
        list = null;
        for (const el of Array.from(document.querySelectorAll("." + MARK))) {
            el.classList.remove(MARK);
        }
    }
});
