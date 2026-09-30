/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { Channel, Message } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, GuildChannelStore, GuildMemberStore, MessageStore, SelectedGuildStore, VoiceStateStore } from "@webpack/common";

import { recordMessage } from "./activity";
import { clearDeleted, clearRecent, isHeld, noteArrival, noteAuthor, noteDeleted, noteOccupancy, release } from "./recent";
import { hooks, settings } from "./settings";
import { refreshAutoCollapse } from "./sidebar";

const SocketModule = findByPropsLazy("getSocket");

const PreviewStore = findByPropsLazy("isLocalFetchNeeded", "isLatest");

const logger = new Logger("ChannelPeek");

const watchers = new Map<string, Set<() => void>>();

export function subscribeChannel(channelId: string, notify: () => void) {
    let listeners = watchers.get(channelId);
    if (!listeners) watchers.set(channelId, listeners = new Set());
    listeners.add(notify);

    return () => {
        listeners!.delete(notify);
        if (listeners!.size === 0) watchers.delete(channelId);
    };
}

function wake(channelId: string) {
    watchers.get(channelId)?.forEach(notify => notify());
}

function wakeAll() {
    for (const listeners of watchers.values()) listeners.forEach(notify => notify());
}

export function lastMessageOf(channel: Channel): Message | undefined {
    const open = MessageStore.getLastMessage(channel.id) as Message | undefined;
    if (open) return open;

    try {
        const record = PreviewStore.message(channel.guild_id, channel.id);
        return record?.message ?? record ?? undefined;
    } catch (err) {
        logger.error("preview store lookup failed", err);
        return undefined;
    }
}

function previewAuthorId(guildId: string, channelId: string) {
    try {
        const record = PreviewStore.message(guildId, channelId);
        return (record?.message ?? record)?.author?.id as string | undefined;
    } catch {
        return undefined;
    }
}

function onMessageEvent(event: any) {
    if (event.type === "MESSAGE_CREATE" && event.message?.channel_id) {
        const channelId = event.message.channel_id;
        recordMessage(channelId);
        noteArrival(channelId);
        if (event.message.author?.id) noteAuthor(channelId, event.message.author.id);
        clearDeleted(channelId);
        refreshAutoCollapse();
    }

    if (event.type === "MESSAGE_DELETE" && event.channelId && event.id) noteDeleted(event.channelId, event.id);

    if (event.messages) {
        const touched = new Set<string>();
        for (const entry of event.messages) {
            const id = entry?.channel_id ?? entry?.channelId ?? entry?.message?.channel_id;
            if (id) touched.add(id);
        }

        if (touched.size) touched.forEach(wake);
        else wakeAll();

        hooks.categoriesChanged();

        requestMissingMembers(SelectedGuildStore.getGuildId());
        return;
    }

    const channelId = event.channelId ?? event.message?.channel_id;
    if (channelId) {
        wake(channelId);
        hooks.categoriesChanged();
    }
}

function requestLastMessages(guildId: string | null | undefined) {
    if (!guildId) return;

    const channelIds = GuildChannelStore.getChannels(guildId)?.SELECTABLE?.map((entry: any) => entry.channel.id);
    if (!channelIds?.length) return;

    try {
        SocketModule.getSocket().requestLastMessages(guildId, channelIds);
    } catch (err) {
        logger.error("requestLastMessages failed", err);
    }
}

const requested = new Set<string>();
const pending = new Set<string>();

function requestMissingMembers(guildId: string | null | undefined) {
    if (!guildId || !settings.store.roleColors) return;

    const channelIds = GuildChannelStore.getChannels(guildId)?.SELECTABLE?.map((entry: any) => entry.channel.id);
    if (!channelIds?.length) return;

    const userIds = new Set<string>();
    for (const channelId of channelIds) {
        const authorId = previewAuthorId(guildId, channelId);
        if (!authorId) continue;

        const key = `${guildId}:${authorId}`;
        if (requested.has(key) || GuildMemberStore.isMember(guildId, authorId)) continue;

        requested.add(key);
        pending.add(key);
        userIds.add(authorId);
    }

    if (!userIds.size) return;

    FluxDispatcher.dispatch({
        type: "GUILD_MEMBERS_REQUEST",
        guildIds: [guildId],
        userIds: [...userIds]
    });
}

function onMembersChunk({ guildId, members }: any) {
    if (!pending.size || !members?.length) return;

    let arrived = false;
    for (const member of members) {
        const key = `${guildId}:${member.user?.id ?? member.userId}`;
        if (pending.delete(key)) arrived = true;
    }

    if (arrived) wakeAll();
}

let lastGuildId: string | null = null;

function onChannelSelect({ guildId, channelId }: any) {
    if (channelId && isHeld(channelId)) {
        release(channelId);
        wake(channelId);
    }

    if (guildId !== lastGuildId) {
        lastGuildId = guildId ?? null;
        requested.clear();
        pending.clear();
    }

    requestLastMessages(guildId);
    requestMissingMembers(guildId);
    noteStartingOccupancy(guildId);
}

function onTyping({ channelId }: any) {
    if (settings.store.typingIndicator) wake(channelId);
}

const occupants = (channelId: string) => Object.keys(VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {}).length;

function onVoiceState({ voiceStates }: any) {
    if (!settings.store.voiceOccupants || !voiceStates?.length) return;
    for (const state of voiceStates) {
        for (const id of [state.channelId, state.oldChannelId]) {
            if (!id) continue;
            noteOccupancy(id, occupants(id), false);
            wake(id);
        }
    }
}

function noteStartingOccupancy(guildId: string | null | undefined) {
    if (!guildId) return;
    for (const entry of GuildChannelStore.getChannels(guildId)?.VOCAL ?? []) {
        const { id } = entry.channel;
        noteOccupancy(id, occupants(id), true);
    }
}

const MESSAGE_EVENTS = [
    "MESSAGE_CREATE", "MESSAGE_UPDATE", "MESSAGE_DELETE", "LOAD_MESSAGES_SUCCESS",
    "MESSAGE_PREVIEWS_LOADED", "MESSAGE_PREVIEWS_LOCALLY_LOADED"
] as const;

const TYPING_EVENTS = ["TYPING_START", "TYPING_STOP"] as const;

export function startGateway() {
    for (const event of MESSAGE_EVENTS) FluxDispatcher.subscribe(event, onMessageEvent);
    for (const event of TYPING_EVENTS) FluxDispatcher.subscribe(event, onTyping);
    FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);
    FluxDispatcher.subscribe("VOICE_STATE_UPDATES", onVoiceState);
    FluxDispatcher.subscribe("GUILD_MEMBERS_CHUNK", onMembersChunk);

    const guildId = SelectedGuildStore.getGuildId();
    lastGuildId = guildId ?? null;
    requestLastMessages(guildId);
    requestMissingMembers(guildId);
}

export function stopGateway() {
    for (const event of MESSAGE_EVENTS) FluxDispatcher.unsubscribe(event, onMessageEvent);
    for (const event of TYPING_EVENTS) FluxDispatcher.unsubscribe(event, onTyping);
    FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect);
    FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", onVoiceState);
    FluxDispatcher.unsubscribe("GUILD_MEMBERS_CHUNK", onMembersChunk);

    watchers.clear();
    requested.clear();
    pending.clear();
    clearRecent();
}
