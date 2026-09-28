/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { Channel, Message } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import {
    GuildChannelStore, GuildStore, IconUtils, MessageStore, NavigationRouter, PermissionsBits, PermissionStore, ReadStateStore,
    ReadStateUtils, useEffect, UserGuildSettingsStore, useStateFromStores
} from "@webpack/common";

import { Avatar, displayName, Glyph, guildIcon, IconButton, ICONS } from "./parts";
import { closeNow, isPinned, setPinned } from "./state";

const PreviewStore = findByPropsLazy("isLocalFetchNeeded", "isLatest");
const SocketModule = findByPropsLazy("getSocket");

const logger = new Logger("ChannelHoverPreview");

interface Unread {
    channel: Channel;
    mentions: number;
    text: string;
    author?: string;
    avatar?: string;
}

function lastMessageOf(guildId: string, channelId: string): Message | undefined {
    const open = MessageStore.getLastMessage(channelId) as Message | undefined;
    if (open) return open;

    try {
        const record = PreviewStore.message(guildId, channelId);
        return record?.message ?? record ?? undefined;
    } catch (err) {
        logger.error("preview store lookup failed", err);
        return undefined;
    }
}

function textOf(message: Message) {
    if (message.content) return message.content;
    if (message.attachments?.length) return "sent an attachment";
    if (message.stickerItems?.length) return "sent a sticker";
    if (message.embeds?.length) return "sent an embed";
    return "";
}

function unreadChannels(guildId: string): Channel[] {
    const selectable = (GuildChannelStore.getChannels(guildId) as any)?.SELECTABLE ?? [];

    return selectable
        .map((entry: { channel: Channel; }) => entry.channel)
        .filter((channel: Channel) => ReadStateStore.hasUnread(channel.id)
            && !UserGuildSettingsStore.isChannelMuted(guildId, channel.id)
            && PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel));
}

function unreadIn(guildId: string): Unread[] {
    return unreadChannels(guildId)
        .map(channel => {
            const message = lastMessageOf(guildId, channel.id);
            const author = message?.author;
            return {
                channel,
                mentions: ReadStateStore.getMentionCount(channel.id),
                text: message ? textOf(message) : "",
                author: author ? displayName(author.id, author.globalName || author.username) : undefined,
                avatar: author?.avatar !== undefined ? IconUtils.getUserAvatarURL(author, false, 32) : undefined
            };
        })
        .sort((a: Unread, b: Unread) => (b.mentions > 0 ? 1 : 0) - (a.mentions > 0 ? 1 : 0)
            || (b.channel.lastMessageId ?? "").localeCompare(a.channel.lastMessageId ?? "", undefined, { numeric: true }));
}

export function ServerBody({ guildId, onDragStart }: { guildId: string; onDragStart(e: React.PointerEvent): void; }) {
    const guild = useStateFromStores([GuildStore], () => GuildStore.getGuild(guildId));
    const rows = useStateFromStores([ReadStateStore, MessageStore, PreviewStore], () => unreadIn(guildId), [guildId],
        (a, b) => a.length === b.length && a.every((row, i) => row.channel.id === b[i].channel.id && row.mentions === b[i].mentions && row.text === b[i].text));
    const pinned = isPinned();

    useEffect(() => {
        const missing = unreadChannels(guildId).filter(channel => !lastMessageOf(guildId, channel.id)).map(channel => channel.id);
        if (!missing.length) return;

        try {
            SocketModule.getSocket().requestLastMessages(guildId, missing);
        } catch (err) {
            logger.error("requestLastMessages failed", err);
        }
    }, [guildId]);

    return <>
        <div className="chp-header" onPointerDown={onDragStart}>
            <Avatar src={guildIcon(guildId)} fallback={guild?.name.slice(0, 2) ?? "?"} />
            <span className="chp-header-text">
                <span className="chp-title">{guild?.name ?? "Server"}</span>
                <span className="chp-topic">{rows.length ? `${rows.length} unread` : "All caught up"}</span>
            </span>
            <span className="chp-header-actions">
                {rows.length > 0 && <IconButton label="Mark all as read" icon={ICONS.read} onClick={() => rows.forEach(row => ReadStateUtils.ackChannel(row.channel))} />}
                <IconButton label={pinned ? "Unpin" : "Keep open"} icon={ICONS.pin} active={pinned} onClick={() => setPinned(!pinned)} />
                {pinned && <IconButton label="Close" icon={ICONS.close} onClick={closeNow} />}
            </span>
        </div>
        <div className="chp-scroller chp-unreads">
            {rows.length === 0 && <div className="chp-empty">Nothing unread here</div>}
            {rows.map(row => <button
                key={row.channel.id}
                className="chp-unread-row"
                onClick={() => {
                    closeNow();
                    NavigationRouter.transitionTo(`/channels/${guildId}/${row.channel.id}`);
                }}
            >
                <span className="chp-unread-where">
                    <Glyph path={ICONS.hash} size={14} />
                    <span className="chp-unread-name">{row.channel.name}</span>
                    {row.mentions > 0 && <span className="chp-badge">{row.mentions}</span>}
                </span>
                {row.text && <span className="chp-unread-message">
                    {row.avatar && <img className="chp-unread-avatar" src={row.avatar} alt="" />}
                    {row.author && <span className="chp-unread-author">{row.author}</span>}
                    <span className="chp-unread-text">{row.text}</span>
                </span>}
            </button>)}
        </div>
    </>;
}
