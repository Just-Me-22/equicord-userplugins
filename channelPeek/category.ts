/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Channel } from "@vencord/discord-types";
import { ChannelType } from "@vencord/discord-types/enums";
import { ChannelStore, GuildChannelStore, SelectedGuildStore, UserGuildSettingsStore } from "@webpack/common";

import { plainText } from "./describe";
import { lastMessageOf } from "./gateway";
import { settings } from "./settings";

const PREVIEWABLE = [ChannelType.GUILD_TEXT, ChannelType.GUILD_ANNOUNCEMENT];
const COLLAPSED = '[data-list-item-id^="channels___"][aria-expanded="false"]';
const MAX = 90;

const LAYOUT = `
[class*="wrapperCommon__"][class*="collapsed__"]{height:auto;align-items:flex-start}
${COLLAPSED}{overflow:visible;flex-wrap:wrap}
${COLLAPSED}::after{
flex:0 0 100%;
overflow:hidden;
margin-top:1px;
color:var(--text-muted);
font-size:11px;
font-weight:400;
line-height:1.35;
text-transform:none;
letter-spacing:normal;
white-space:nowrap;
text-overflow:ellipsis;
}`.trim();

let sheet: HTMLStyleElement | undefined;
let observer: MutationObserver | undefined;
let observing: HTMLElement | undefined;
let frame = 0;
let last = "";

function childrenOf(guildId: string, categoryId: string) {
    const entries = GuildChannelStore.getChannels(guildId)?.SELECTABLE ?? [];

    return entries
        .map((entry: any) => ChannelStore.getChannel(entry.channel?.id ?? entry.channel))
        .filter((channel: Channel | undefined): channel is Channel =>
            Boolean(channel) && channel!.parent_id === categoryId && PREVIEWABLE.includes(channel!.type));
}

function newestInCategory(guildId: string, categoryId: string) {
    let best: { channel: Channel; text: string; } | undefined;
    let bestAt = 0;

    for (const channel of childrenOf(guildId, categoryId)) {
        if (UserGuildSettingsStore.isChannelMuted(guildId, channel.id)) continue;

        const message = lastMessageOf(channel);
        if (!message?.timestamp) continue;

        const at = new Date(message.timestamp as any).getTime();
        if (at <= bestAt) continue;

        const text = plainText(message);
        if (!text) continue;

        best = { channel, text };
        bestAt = at;
    }

    return best;
}

function quote(text: string) {
    const flat = text.replace(/\s+/g, " ").trim();
    const clipped = flat.length > MAX ? `${flat.slice(0, MAX - 1)}…` : flat;
    return clipped.replace(/[\\"]/g, match => `\\${match}`);
}

function collapsedIds() {
    return [...document.querySelectorAll<HTMLElement>(COLLAPSED)]
        .map(el => el.getAttribute("data-list-item-id")!.slice("channels___".length))
        .filter(id => ChannelStore.getChannel(id)?.type === ChannelType.GUILD_CATEGORY);
}

function build() {
    const guildId = SelectedGuildStore.getGuildId();
    if (!guildId || !settings.store.categorySummary) return "";

    const rules: string[] = [];
    for (const categoryId of collapsedIds()) {
        const newest = newestInCategory(guildId, categoryId);
        if (!newest) continue;

        rules.push(
            `[data-list-item-id="channels___${categoryId}"][aria-expanded="false"]::after{content:"#${quote(newest.channel.name)}: ${quote(newest.text)}"}`
        );
    }

    return rules.length ? `${LAYOUT}\n${rules.join("\n")}` : "";
}

function watched() {
    return document.querySelector<HTMLElement>('nav:not([class*="privateChannels_"]) ul');
}

function attach() {
    const list = watched();
    if (!observer || !list || list === observing) return;

    observer.disconnect();
    observer.observe(list, { attributes: true, attributeFilter: ["aria-expanded"], subtree: true });
    observing = list;
}

function apply() {
    frame = 0;
    if (!sheet) return;

    attach();

    const css = build();
    if (css === last) return;

    last = css;
    sheet.textContent = css;
}

export function refreshCategories() {
    if (frame || !sheet) return;
    frame = requestAnimationFrame(apply);
}

export function startCategories() {
    if (sheet) return;

    sheet = document.createElement("style");
    sheet.id = "vc-channel-peek-categories";
    document.head.append(sheet);

    observer = new MutationObserver(refreshCategories);
    refreshCategories();
}

export function stopCategories() {
    if (!sheet) return;

    observer?.disconnect();
    observer = undefined;
    observing = undefined;
    if (frame) cancelAnimationFrame(frame);

    frame = 0;
    last = "";
    sheet.remove();
    sheet = undefined;
}
