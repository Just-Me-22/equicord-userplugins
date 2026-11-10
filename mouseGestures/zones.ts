/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Channel, Message } from "@vencord/discord-types";
import { ChannelStore, MessageStore } from "@webpack/common";

export type Zone = "anywhere" | "messages" | "tabs" | "servers" | "channels" | "people";

export const ZONES: { id: Zone; label: string; hint: string; }[] = [
    { id: "anywhere", label: "Anywhere", hint: "These run wherever you draw, unless the area you start in has its own gesture for the same shape." },
    { id: "messages", label: "Messages", hint: "Start on a message. With NoMessageSelect on, you can start anywhere on it, even on the text." },
    { id: "tabs", label: "Tab bar", hint: "Start in the ChannelTabs bar. Starting on a tab acts on that tab." },
    { id: "servers", label: "Server list", hint: "Start in the server column. Starting on a server acts on that server." },
    { id: "channels", label: "Channel list", hint: "Start in the channel or DM list. Starting on a channel acts on that channel." },
    { id: "people", label: "People", hint: "Start on someone in the member list, a DM row, or a name in chat." }
];

export interface Hit {
    element: Element;
    message: Message;
    channel: Channel;
}

export interface Context {
    zones: Zone[];
    targets: Partial<Record<Zone, Element>>;
    hit?: Hit;
    tabId?: number;
    guildId?: string;
    channelId?: string;
    userId?: string;
}

export const MESSAGE_SELECTOR = '[id^="chat-messages-"]';
const TABS = '[class*="vc-channeltabs-"]';
const SERVERS = '[data-list-id="guildsnav"], [class*="guilds_"]';
const CHANNELS = '[class*="sidebarList_"], #channels, [data-list-id="channels"], [data-list-id^="private-channels"], ul[aria-label="Direct Messages"]';
const MEMBERS = '[aria-label="Members"], [class*="membersWrap_"], [data-list-id^="members"]';

const snowflake = (v: unknown) => typeof v === "string" && /^\d{15,}$/.test(v) ? v : undefined;

function fiberProps<T>(el: Element, pick: (props: any) => T | undefined, depth = 30): T | undefined {
    const key = Object.keys(el).find(k => k.startsWith("__reactFiber$"));
    let fiber = key ? (el as any)[key] : null;
    for (let i = 0; fiber && i < depth; i++, fiber = fiber.return) {
        const value = fiber.memoizedProps && pick(fiber.memoizedProps);
        if (value != null) return value;
    }
}

const listItemId = (el: Element, prefix: string) => {
    const item = el.closest(`[data-list-item-id^="${prefix}"]`);
    return item ? { item, id: snowflake(item.getAttribute("data-list-item-id")!.split("___")[1]) } : null;
};

function messageAt(el: Element): Hit | undefined {
    const element = el.closest(MESSAGE_SELECTOR);
    const ids = element?.id.match(/^chat-messages-(\d+)-(\d+)$/);
    if (!element || !ids) return;
    const message = MessageStore.getMessage(ids[1], ids[2]);
    const channel = ChannelStore.getChannel(ids[1]);
    return message && channel ? { element, message, channel } : undefined;
}

function nearestMessage(el: Element, y: number) {
    const list = el.closest('[class*="messagesWrapper"], [data-list-id="chat-messages"]');
    if (!list) return;
    let best: Element | undefined, gap = 60;
    for (const row of list.querySelectorAll(MESSAGE_SELECTOR)) {
        const r = row.getBoundingClientRect();
        const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        if (d < gap) {
            gap = d;
            best = row;
        }
    }
    return best && messageAt(best);
}

export function contextAt(el: Element | null, y?: number): Context {
    const ctx: Context = { zones: [], targets: {} };
    if (!el?.closest) return ctx;

    const hit = messageAt(el) ?? (y === undefined ? undefined : nearestMessage(el, y));
    if (hit) {
        const name = el.closest('[id^="message-username-"], [class*="avatar_"]');
        if (name) {
            ctx.zones.push("people");
            ctx.targets.people = name;
            ctx.userId = hit.message.author.id;
            ctx.guildId = hit.channel.guild_id ?? undefined;
        }
        ctx.zones.push("messages");
        ctx.targets.messages = hit.element;
        ctx.hit = hit;
        return ctx;
    }

    const tabBar = el.closest(TABS);
    if (tabBar) {
        const tab = el.closest('[class*="vc-channeltabs-tab"]');
        ctx.zones.push("tabs");
        ctx.targets.tabs = tab ?? undefined;
        ctx.tabId = tab ? fiberProps(tab, p => typeof p.id === "number" && "channelId" in p ? p.id : undefined) : undefined;
        return ctx;
    }

    if (el.closest(SERVERS)) {
        const server = listItemId(el, "guildsnav___");
        ctx.zones.push("servers");
        ctx.targets.servers = server?.item;
        ctx.guildId = server?.id;
        return ctx;
    }

    const members = el.closest(MEMBERS);
    const person = members
        ? el.closest('[role="listitem"], [class*="member_"]')
        : el.closest('[data-list-item-id^="private-channels"]') ?? el.closest('ul[aria-label="Direct Messages"] > li');
    const userId = person ? fiberProps(person, p => snowflake(p.user?.id), 15) : undefined;
    const addPerson = () => {
        if (!userId) return;
        ctx.zones.push("people");
        ctx.targets.people = person!;
        ctx.userId = userId;
    };

    if (members) {
        addPerson();
        return ctx;
    }

    if (el.closest(CHANNELS)) {
        const row = listItemId(el, "channels___");
        const li = row?.item ?? el.closest("li");
        const channelId = row?.id ?? (li ? fiberProps(li, p => snowflake(p.channel?.id), 15) : undefined);
        ctx.zones.push("channels");
        ctx.targets.channels = li ?? undefined;
        ctx.channelId = channelId;
        ctx.guildId = channelId ? ChannelStore.getChannel(channelId)?.guild_id ?? undefined : undefined;
    }
    addPerson();
    return ctx;
}
