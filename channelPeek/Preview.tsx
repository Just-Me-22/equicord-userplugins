/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { Settings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import roleColorEverywhere from "@plugins/roleColorEverywhere";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { Channel, Message } from "@vencord/discord-types";
import { ChannelType } from "@vencord/discord-types/enums";
import {
    GuildMemberStore, IconUtils, NavigationRouter, ReadStateStore, ReadStateUtils,
    RelationshipStore, TypingStore, useEffect,
UserGuildSettingsStore, UserStore, useState, useStateFromStores, VoiceStateStore
} from "@webpack/common";

import { activityOf } from "./activity";
import { describe, plainText } from "./describe";
import { ageOf, isStale, matchesKeyword } from "./format";
import { lastMessageOf, subscribeChannel } from "./gateway";
import { openQuickReply } from "./QuickReply";
import { settings } from "./settings";
import { useMinute } from "./ticker";

const cl = classNameFactory("vc-channel-peek-");

function useLastMessage(channel: Channel) {
    const channelId = channel.id;
    const [message, setMessage] = useState(() => lastMessageOf(channel));

    useEffect(() => {
        const update = () => setMessage(lastMessageOf(channel));
        update();
        return subscribeChannel(channelId, update);
    }, [channelId]);

    return message;
}

function roleColorOf(channel: Channel, authorId: string) {
    if (!settings.store.roleColors) return null;

    return (isPluginEnabled(roleColorEverywhere.name)
        ? roleColorEverywhere.getColorString(authorId, channel.id)
        : GuildMemberStore.getMember(channel.guild_id, authorId)?.colorString) ?? null;
}

function previewColor(channel: Channel, authorId: string) {
    const base = roleColorOf(channel, authorId);
    if (!base) return null;

    if (!isPluginEnabled(roleColorEverywhere.name)) return base;

    const saturation = Settings.plugins.RoleColorEverywhere?.messageSaturation ?? 30;
    if (saturation === 0) return null;
    if (saturation >= 100) return base;

    return `color-mix(in oklab, ${base} ${saturation}%, var(--text-muted))`;
}

function displayName(userId: string, fallback: string) {
    const user = UserStore.getUser(userId);
    if (!user) return fallback;
    return RelationshipStore.getNickname(userId) || user.globalName || user.username;
}

function nameOf(message: Message) {
    const { author } = message;
    if (author.id === UserStore.getCurrentUser()?.id) return "You";
    return RelationshipStore.getNickname(author.id) || author.globalName || author.username;
}

function mentionsMe(message: Message) {
    if (message.mentionEveryone) return true;

    const me = UserStore.getCurrentUser()?.id;
    if (!me) return false;
    return Boolean(message.mentions?.some((user: any) => (user.id ?? user) === me));
}

function typingLabel(ids: string[]) {
    return ids.length === 1
        ? `${displayName(ids[0], "Someone")} is typing…`
        : `${ids.length} people are typing…`;
}

function VoiceLine({ channel }: { channel: Channel; }) {
    const states = useStateFromStores([VoiceStateStore], () => VoiceStateStore.getVoiceStatesForChannel(channel.id));
    const ids = Object.keys(states ?? {});
    if (!ids.length) return null;

    const names = ids.map(id => displayName(id, "Unknown"));
    const shown = names.slice(0, 3).join(", ");
    const extra = names.length - Math.min(names.length, 3);

    return <span className={cl("preview")}>{extra > 0 ? `${shown} +${extra}` : shown}</span>;
}

function Heatmap({ channelId }: { channelId: string; }) {
    const bars = activityOf(channelId);
    if (!bars) return null;

    return <span className={cl("heat")} aria-hidden="true">
        {bars.map((level, hour) => <i key={hour} style={{ opacity: 0.15 + level * 0.85 }} />)}
    </span>;
}

function Actions({ channel, unread }: { channel: Channel; unread: boolean; }) {
    const { markReadButton, quickReply } = settings.use(["markReadButton", "quickReply"]);
    if (!markReadButton && !quickReply) return null;

    const stop = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    return <span className={cl("actions")}>
        {quickReply && <button
            className={cl("action")}
            aria-label="Reply without opening the channel"
            onClick={e => {
                stop(e);
                openQuickReply(channel, e.currentTarget.getBoundingClientRect());
            }}
        >
            <svg width={12} height={12} viewBox="0 0 24 24">
                <path fill="currentColor" d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11Z" />
            </svg>
        </button>}
        {markReadButton && unread && <button
            className={cl("action")}
            aria-label="Mark as read"
            onClick={e => {
                stop(e);
                ReadStateUtils.ackChannel(channel);
            }}
        >
            <svg width={12} height={12} viewBox="0 0 24 24">
                <path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" />
            </svg>
        </button>}
    </span>;
}

const Preview = ErrorBoundary.wrap(function Preview({ channel }: { channel: Channel; }) {
    settings.use([
        "showAuthor", "showAvatar", "roleColors", "colorScope", "iconSize", "previewLines",
        "fullTextTooltip", "showAge", "staleAfter", "boldMentions", "dimRead", "unreadCount",
        "keywords", "typingIndicator", "voiceOccupants", "jumpToMessage", "mutedChannels",
        "attachmentDetail", "thumbnails", "linkStyle", "blurNsfw", "replyContext", "heatmap"
    ]);

    const message = useLastMessage(channel);
    const read = useStateFromStores([ReadStateStore], () => ({
        unread: ReadStateStore.hasUnread(channel.id),
        count: ReadStateStore.getUnreadCount(channel.id)
    }), [channel.id], (a, b) => a.unread === b.unread && a.count === b.count);

    const typing = useStateFromStores([TypingStore], () => {
        if (!settings.store.typingIndicator) return "";
        const me = UserStore.getCurrentUser()?.id;
        return Object.keys(TypingStore.getTypingUsers(channel.id)).filter(id => id !== me).join();
    }, [channel.id]);

    useMinute(settings.store.showAge || settings.store.staleAfter > 0);

    if (typing) {
        return <span className={classes(cl("preview"), cl("typing"))}>{typingLabel(typing.split(","))}</span>;
    }

    if (channel.type === ChannelType.GUILD_VOICE || channel.type === ChannelType.GUILD_STAGE_VOICE) {
        return settings.store.voiceOccupants ? <VoiceLine channel={channel} /> : null;
    }

    if (!message) return null;

    const text = describe(message, channel);
    if (!text) return null;

    const { author } = message;
    const timestamp = message.timestamp ? new Date(message.timestamp as any).getTime() : 0;

    const muted = UserGuildSettingsStore.isChannelMuted(channel.guild_id, channel.id);
    const dimmed = (settings.store.dimRead && !read.unread) || (muted && settings.store.mutedChannels === "dim");

    const raw = plainText(message);
    const color = author && settings.store.roleColors ? previewColor(channel, author.id) : null;
    const wholeLine = settings.store.colorScope === "line";

    const name = author ? nameOf(message) : null;
    const avatar = settings.store.showAvatar && author
        ? IconUtils.getUserAvatarURL(author, false, 16)
        : null;

    const isReply = settings.store.replyContext && Boolean((message as any).messageReference);

    const body = <>
        {avatar && <img className={cl("avatar")} src={avatar} alt="" loading="lazy" />}
        {isReply && <span className={cl("reply-mark")}>{"↳ "}</span>}
        {name && <span className={cl("author")} style={!wholeLine && color ? { color } : undefined}>{name}: </span>}
        {text}
    </>;

    const jump = settings.store.jumpToMessage
        ? (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            NavigationRouter.transitionTo(`/channels/${channel.guild_id ?? "@me"}/${channel.id}/${message.id}`);
        }
        : undefined;

    return <span
        className={classes(
            cl("preview"),
            cl("preview-" + settings.store.iconSize),
            cl("lines-" + settings.store.previewLines),
            dimmed ? cl("dimmed") : undefined,
            isStale(timestamp) ? cl("stale") : undefined,
            matchesKeyword(raw) ? cl("keyword") : undefined,
            settings.store.boldMentions && mentionsMe(message) ? cl("mention") : undefined
        )}
        style={wholeLine && color ? { color } : undefined}
        title={settings.store.fullTextTooltip ? `${name ? name + ": " : ""}${raw}` : undefined}
        onClick={jump}
    >
        {settings.store.showAuthor || !name ? body : text}
        {settings.store.heatmap && <Heatmap channelId={channel.id} />}
        {settings.store.unreadCount && read.count > 0 && <span className={cl("count")}>{read.count}</span>}
        {settings.store.showAge && timestamp > 0 && <span className={cl("age")}>{ageOf(timestamp)}</span>}
        <Actions channel={channel} unread={read.unread} />
    </span>;
}, { noop: true });

export default Preview;
