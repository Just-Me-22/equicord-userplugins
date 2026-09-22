/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelStore, ReadStateStore } from "@webpack/common";

import { plainText } from "./describe";
import { lastMessageOf } from "./gateway";
import { settings } from "./settings";

const HIDDEN = "vc-channel-peek-filtered-out";
const ROUTE = /^\/channels\/(?:@me|\d+)\/(\d+)/;

let query = "";
let observer: MutationObserver | undefined;
let frame = 0;

export function getQuery() {
    return query;
}

export function setQuery(next: string) {
    query = next;
    refresh();
}

function serverList() {
    return document.querySelector<HTMLElement>('nav:not([class*="privateChannels_"]) ul');
}

function shouldHide(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return false;

    if (settings.store.hideRead && !ReadStateStore.hasUnread(channelId)) return true;
    if (!query) return false;

    const needle = query.toLowerCase();
    if (channel.name?.toLowerCase().includes(needle)) return false;

    const message = lastMessageOf(channel);
    return !message || !plainText(message).toLowerCase().includes(needle);
}

function apply() {
    frame = 0;

    const list = serverList();
    if (!list) return;

    const active = Boolean(query) || settings.store.hideRead;

    for (const link of list.querySelectorAll<HTMLAnchorElement>('a[href^="/channels/"]')) {
        const row = link.closest("li");
        if (!row) continue;

        const channelId = link.getAttribute("href")?.match(ROUTE)?.[1];
        row.classList.toggle(HIDDEN, active && Boolean(channelId) && shouldHide(channelId!));
    }
}

export function refresh() {
    if (frame) return;
    frame = requestAnimationFrame(apply);
}

export function startFilter() {
    if (observer) return;

    observer = new MutationObserver(refresh);
    const list = serverList();
    if (list) observer.observe(list, { childList: true, subtree: true });

    refresh();
}

export function stopFilter() {
    observer?.disconnect();
    observer = undefined;

    if (frame) cancelAnimationFrame(frame);
    frame = 0;

    for (const row of document.querySelectorAll(`.${HIDDEN}`)) row.classList.remove(HIDDEN);
}

export function restartFilter() {
    stopFilter();
    startFilter();
}
