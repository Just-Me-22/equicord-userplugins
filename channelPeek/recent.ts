/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Message } from "@vencord/discord-types";
import { findStoreLazy } from "@webpack";
import { Constants, MessageStore, RestAPI, UserStore } from "@webpack/common";

export interface Line {
    id: string;
    authorId: string;
    name: string;
    bot: boolean;
    content: string;
    at: number;
}

const ChannelListStore = findStoreLazy("ChannelListStore") as { emitChange(): void; };

export function redrawList() {
    try {
        ChannelListStore.emitChange();
    } catch { /* the list redraws on its own next time something changes */ }
}

const BURST_WINDOW = 120_000;
const arrivals = new Map<string, number[]>();

export function noteArrival(channelId: string) {
    const now = Date.now();
    const list = (arrivals.get(channelId) ?? []).filter(at => now - at < BURST_WINDOW);
    list.push(now);
    arrivals.set(channelId, list);
}

export function burstOf(channelId: string) {
    const now = Date.now();
    return (arrivals.get(channelId) ?? []).filter(at => now - at < BURST_WINDOW).length;
}

const authors = new Map<string, string[]>();

export function noteAuthor(channelId: string, authorId: string) {
    const list = (authors.get(channelId) ?? []).filter(id => id !== authorId);
    list.push(authorId);
    authors.set(channelId, list.slice(-6));
}

export function loadedMessages(channelId: string): Message[] {
    return (MessageStore.getMessages(channelId) as any)?.toArray?.() ?? [];
}

export function recentAuthors(channelId: string, lastAuthor?: string) {
    const seen = new Set<string>();
    const order = [...loadedMessages(channelId).map(one => one.author?.id), ...(authors.get(channelId) ?? []), lastAuthor];
    for (let i = order.length - 1; i >= 0 && seen.size < 3; i--) {
        const id = order[i];
        if (id) seen.add(id);
    }
    return [...seen];
}

const seenLast = new Map<string, Message>();
const deleted = new Map<string, Message>();

export function noteShown(channelId: string, message: Message) {
    seenLast.set(channelId, message);
}

export function noteDeleted(channelId: string, messageId: string) {
    const shown = seenLast.get(channelId);
    if (shown?.id === messageId) deleted.set(channelId, shown);
}

export const deletedIn = (channelId: string) => deleted.get(channelId);
export const clearDeleted = (channelId: string) => deleted.delete(channelId);

const held = new Map<string, Message>();

export const heldIn = (channelId: string) => held.get(channelId);
export const isHeld = (channelId: string) => held.has(channelId);

export function hold(channelId: string, message: Message | undefined) {
    if (message) held.set(channelId, message);
}

export function release(channelId: string) {
    held.delete(channelId);
}

const occupiedSince = new Map<string, { at: number; saw: boolean; }>();

export function noteOccupancy(channelId: string, count: number, startup: boolean) {
    if (!count) occupiedSince.delete(channelId);
    else if (!occupiedSince.has(channelId)) occupiedSince.set(channelId, { at: Date.now(), saw: !startup });
}

export const occupancyOf = (channelId: string) => occupiedSince.get(channelId);

function lineFromRaw(raw: any): Line {
    const author = raw.author ?? {};
    return {
        id: raw.id,
        authorId: author.id,
        name: UserStore.getUser(author.id)?.globalName ?? author.global_name ?? author.username ?? "Unknown",
        bot: Boolean(author.bot),
        content: raw.content || (raw.attachments?.length ? `sent ${raw.attachments[0].filename}` : raw.embeds?.length ? "sent an embed" : raw.sticker_items?.length ? "sent a sticker" : ""),
        at: new Date(raw.timestamp).getTime()
    };
}

function lineFromRecord(message: Message): Line {
    return lineFromRaw({
        id: message.id,
        author: { id: message.author?.id, username: message.author?.username, global_name: (message.author as any)?.globalName, bot: message.author?.bot },
        content: message.content,
        attachments: message.attachments,
        embeds: message.embeds,
        sticker_items: message.stickerItems,
        timestamp: message.timestamp
    });
}

const fetched = new Map<string, { at: number; lines: Line[]; }>();

export async function linesBefore(channelId: string, before: string | undefined, limit: number): Promise<Line[]> {
    const loaded = loadedMessages(channelId);
    if (loaded.length) {
        const upTo = before ? loaded.findIndex(one => one.id === before) : loaded.length;
        const slice = loaded.slice(Math.max(0, (upTo < 0 ? loaded.length : upTo) - limit), upTo < 0 ? loaded.length : upTo);
        if (slice.length) return slice.map(lineFromRecord);
    }

    const key = `${channelId}:${before ?? ""}:${limit}`;
    const cached = fetched.get(key);
    if (cached && Date.now() - cached.at < 60_000) return cached.lines;

    const { body } = await RestAPI.get({ url: Constants.Endpoints.MESSAGES(channelId), query: { limit, ...(before ? { before } : {}) } });
    const lines = (body as any[]).map(lineFromRaw).reverse();
    fetched.set(key, { at: Date.now(), lines });
    return lines;
}

export const GuildScheduledEventStore = findStoreLazy("GuildScheduledEventStore") as {
    getGuildScheduledEventsForGuild(guildId: string): { id: string; name: string; channel_id?: string; scheduled_start_time: string; status: number; }[];
};

export function clearRecent() {
    arrivals.clear();
    authors.clear();
    seenLast.clear();
    deleted.clear();
    held.clear();
    occupiedSince.clear();
    fetched.clear();
}
