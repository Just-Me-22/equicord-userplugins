/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Channel } from "@vencord/discord-types";
import { findComponentByCodeLazy } from "@webpack";
import { GuildStore, IconUtils, RelationshipStore, Tooltip, UserStore } from "@webpack/common";
import type { ReactNode } from "react";

export const ReactionEmojiPicker = findComponentByCodeLazy<any>("showAddEmojiButton:", "pickerIntention:", "messageId:");

export interface PickedEmoji {
    id?: string | null;
    name?: string | null;
    optionallyDiverseSequence?: string;
}

export function emojiValue(emoji: PickedEmoji | null | undefined) {
    if (!emoji) return "";
    if (emoji.id && emoji.name) return `${emoji.name}:${emoji.id}`;
    if (emoji.optionallyDiverseSequence?.trim()) return emoji.optionallyDiverseSequence;
    return emoji.name?.trim() ?? "";
}

export function displayName(userId: string, fallback = "Someone") {
    const user = UserStore.getUser(userId);
    if (!user) return fallback;
    return RelationshipStore.getNickname(userId) || user.globalName || user.username;
}

export function channelTitle(channel: Channel) {
    if (channel.name) return channel.name;
    const [first] = channel.recipients ?? [];
    return first ? displayName(first, "Direct Message") : "Direct Message";
}

export function channelIcon(channel: Channel) {
    if (channel.isDM?.()) {
        const user = UserStore.getUser(channel.recipients[0]);
        return user ? IconUtils.getUserAvatarURL(user, false, 32) : undefined;
    }
    if (channel.isGroupDM?.()) return IconUtils.getChannelIconURL({ id: channel.id, icon: channel.icon, size: 32 });
    return undefined;
}

export function guildIcon(guildId: string) {
    const guild = GuildStore.getGuild(guildId);
    return guild?.icon ? IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 32 }) : undefined;
}

export function Dots() {
    return <svg className="chp-dots" width={16} height={6} viewBox="0 0 16 6" aria-hidden="true">
        <circle cx={3} cy={3} r={2} fill="currentColor" />
        <circle cx={8} cy={3} r={2} fill="currentColor" />
        <circle cx={13} cy={3} r={2} fill="currentColor" />
    </svg>;
}

export function Glyph({ path, size = 16 }: { path: string; size?: number; }) {
    return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d={path} />
    </svg>;
}

export const ICONS = {
    hash: "M10.99 3.16A1 1 0 1 0 9 2.84L8.15 8H4a1 1 0 0 0 0 2h3.82l-.67 4H3a1 1 0 1 0 0 2h3.82l-.8 4.84a1 1 0 0 0 1.97.32L8.85 16h4.97l-.8 4.84a1 1 0 0 0 1.97.32l.86-5.16H20a1 1 0 1 0 0-2h-3.82l.67-4H21a1 1 0 1 0 0-2h-3.82l.8-4.84a1 1 0 1 0-1.97-.32L15.15 8h-4.97l.8-4.84ZM14.15 14l.67-4H9.85l-.67 4h4.97Z",
    voice: "M12 3a1 1 0 0 0-1.7-.7L6.6 6H4a2 2 0 0 0-2 2v8c0 1.1.9 2 2 2h2.6l3.7 3.7A1 1 0 0 0 12 21V3ZM15.1 20.75c-.58.14-1.1-.33-1.1-.92v-.03c0-.5.37-.92.85-1.05a7 7 0 0 0 0-13.5A1.11 1.11 0 0 1 14 4.2v-.03c0-.6.52-1.06 1.1-.92a9 9 0 0 1 0 17.5ZM15.16 16.51c-.57.28-1.16-.2-1.16-.83v-.14c0-.43.28-.8.63-1.02a3 3 0 0 0 0-5.04c-.35-.23-.63-.6-.63-1.02v-.14c0-.63.59-1.1 1.16-.83a5 5 0 0 1 0 9.02Z",
    forum: "M18.91 12.98a5.45 5.45 0 0 1 2.18 6.2c-.1.33-.09.68.1.96l.83 1.32a1 1 0 0 1-.84 1.54h-5.5A5.6 5.6 0 0 1 10 17.5a5.6 5.6 0 0 1 5.68-5.5c1.2 0 2.32.36 3.23.98ZM2.2 17.52c-.18.28-.2.63-.1.96L3 20.5a1 1 0 0 1-.84 1.5H9.2A7.6 7.6 0 0 1 8 17.5a7.6 7.6 0 0 1 7.68-7.5c.44 0 .87.04 1.28.1A8.5 8.5 0 0 0 9.5 2 8.5 8.5 0 0 0 1 10.5c0 1.72.46 3.3 1.2 4.66V17.52Z",
    reply: "M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11Z",
    react: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16ZM9 9.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM12 18a5.5 5.5 0 0 0 5-3.2 1 1 0 0 0-1.8-.9A3.5 3.5 0 0 1 12 16a3.5 3.5 0 0 1-3.2-2.1 1 1 0 1 0-1.8.9A5.5 5.5 0 0 0 12 18Z",
    link: "M16.32 14.72a1 1 0 0 1 0-1.41l2.51-2.51a3.98 3.98 0 0 0-5.62-5.63l-2.52 2.51a1 1 0 0 1-1.41-1.41l2.52-2.52a5.98 5.98 0 0 1 8.45 8.46l-2.52 2.51a1 1 0 0 1-1.41 0ZM7.68 9.29a1 1 0 0 1 0 1.41l-2.52 2.51a3.98 3.98 0 1 0 5.63 5.63l2.51-2.52a1 1 0 0 1 1.42 1.42l-2.52 2.51a5.98 5.98 0 0 1-8.45-8.45l2.51-2.51a1 1 0 0 1 1.42 0ZM14.7 10.7a1 1 0 0 0-1.4-1.4l-4 4a1 1 0 1 0 1.4 1.4l4-4Z",
    read: "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z",
    tab: "M4 4h9v2H6v12h12v-7h2v9H4V4Zm11 0h5v5h-2V7.4l-5.3 5.3-1.4-1.4L16.6 6H15V4Z",
    search: "M10 3a7 7 0 1 0 4.2 12.6l5.1 5.1 1.4-1.4-5.1-5.1A7 7 0 0 0 10 3Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z",
    pin: "M15 3 21 9l-2 1-3.5 3.5L15 18l-2 2-4-4-5 5-1-1 5-5-4-4 2-2 4.5-.5L14 5l1-2Z",
    close: "M17.3 5.3a1 1 0 1 1 1.4 1.4L13.42 12l5.3 5.3a1 1 0 1 1-1.42 1.4L12 13.42l-5.3 5.3a1 1 0 0 1-1.4-1.42L10.58 12l-5.3-5.3a1 1 0 0 1 1.42-1.4L12 10.58l5.3-5.3Z",
    muted: "M2.7 1.3a1 1 0 0 0-1.4 1.4l20 20a1 1 0 0 0 1.4-1.4l-20-20ZM17 11.4V7a5 5 0 0 0-9.7-1.7L17 11.4ZM7 10.6V11a5 5 0 0 0 7.5 4.3l1.5 1.5A7 7 0 0 1 5 11a1 1 0 1 0-2 0 9 9 0 0 0 8 8.9V22a1 1 0 1 0 2 0v-2.1c1.3-.1 2.5-.6 3.6-1.3l-2-2A5 5 0 0 1 7 10.6Z",
    deafened: "M22.7 2.7a1 1 0 0 0-1.4-1.4l-20 20a1 1 0 1 0 1.4 1.4l20-20ZM12 3a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h.6l12.9-12.9A9 9 0 0 0 12 3Zm8.3 5.4L18 10.7c0 .4.1.9.1 1.3v1h-1a3 3 0 0 0-3 3v1.6l-2.3 2.3c.4.1.9.1 1.3.1h2a3 3 0 0 0 3-3v-5c0-1.3-.3-2.5-.8-3.6Z"
};

export function IconButton({ label, icon, active, onClick }: { label: string; icon: string; active?: boolean; onClick(): void; }) {
    return <Tooltip text={label}>
        {tip => <button
            {...tip}
            className={active ? "chp-icon-button chp-icon-button-on" : "chp-icon-button"}
            aria-pressed={active}
            onClick={e => {
                e.stopPropagation();
                tip.onClick?.();
                onClick();
            }}
        >
            <Glyph path={icon} />
        </button>}
    </Tooltip>;
}

export function Avatar({ src, fallback }: { src?: string; fallback: ReactNode; }) {
    return src
        ? <img className="chp-header-icon" src={src} alt="" />
        : <span className="chp-header-icon chp-header-glyph">{fallback}</span>;
}
