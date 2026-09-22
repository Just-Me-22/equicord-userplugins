/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Channel } from "@vencord/discord-types";
import { ChannelType } from "@vencord/discord-types/enums";
import {
    ChannelStore, FluxDispatcher, GuildChannelStore, ReadStateStore, SelectedChannelStore,
    SelectedGuildStore, UserGuildSettingsStore
} from "@webpack/common";

import { settings } from "./settings";

const PREVIEWABLE = [ChannelType.GUILD_TEXT, ChannelType.GUILD_ANNOUNCEMENT];

let frame = 0;

function guildChannels(guildId: string) {
    const entries = GuildChannelStore.getChannels(guildId)?.SELECTABLE ?? [];

    return entries
        .map((entry: any) => ChannelStore.getChannel(entry.channel?.id ?? entry.channel))
        .filter((channel: Channel | undefined): channel is Channel =>
            Boolean(channel) && PREVIEWABLE.includes(channel!.type));
}

function run() {
    frame = 0;
    if (!settings.store.autoCollapse) return;

    const guildId = SelectedGuildStore.getGuildId();
    if (!guildId) return;

    const open = SelectedChannelStore.getChannelId();
    const live = new Map<string, boolean>();

    for (const channel of guildChannels(guildId)) {
        const parent = channel.parent_id;
        if (!parent) continue;

        const wanted = ReadStateStore.hasUnread(channel.id) || channel.id === open;
        live.set(parent, (live.get(parent) ?? false) || wanted);
    }

    const overrides = UserGuildSettingsStore.getChannelOverrides(guildId) ?? {};
    for (const [categoryId, wanted] of live) {
        if (wanted === !overrides[categoryId]?.collapsed) continue;

        FluxDispatcher.dispatch({
            type: wanted ? "CATEGORY_EXPAND" : "CATEGORY_COLLAPSE",
            guildId,
            categoryId
        });
    }
}

export function refreshAutoCollapse() {
    if (frame || !settings.store.autoCollapse) return;
    frame = requestAnimationFrame(run);
}

export function stopAutoCollapse() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
}
