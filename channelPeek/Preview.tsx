/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { Settings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import roleColorEverywhere from "@plugins/roleColorEverywhere";
import { translate } from "@plugins/translate/utils";
import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import { classes } from "@utils/misc";
import { Channel, Message } from "@vencord/discord-types";
import { ChannelType } from "@vencord/discord-types/enums";
import {
    Constants, GuildMemberStore, IconUtils, NavigationRouter, PermissionsBits, PermissionStore, Popout,
    ReadStateStore, ReadStateUtils, RelationshipStore, RestAPI, showToast, Toasts, Tooltip, TypingStore, useEffect,
    useRef, UserGuildSettingsStore, UserStore, useState, useStateFromStores, VoiceStateStore
} from "@webpack/common";
import type { ReactNode } from "react";

import { activityOf } from "./activity";
import { describe, plainText } from "./describe";
import { ageOf, isStale, markKeywords, matchesKeyword, nameOf } from "./format";
import { lastMessageOf, subscribeChannel } from "./gateway";
import { hoverHandlers } from "./HoverCard";
import { EmojiSelectPayload, emojiValue, ReactionEmojiPicker } from "./picker";
import { openQuickReply } from "./QuickReply";
import { burstOf, deletedIn, GuildScheduledEventStore, heldIn, loadedMessages, noteShown, occupancyOf, recentAuthors } from "./recent";
import { Later, settings, styleFor } from "./settings";
import { useMinute } from "./ticker";

const cl = classNameFactory("vc-channel-peek-");
const logger = new Logger("ChannelPeek");

const skipped = (message: Message) =>
    (settings.store.skippedAuthors as string[]).includes(message.author?.id)
    || (settings.store.bots === "skip" && Boolean(message.author?.bot));

function pick(channel: Channel): { message: Message | undefined; hiddenFrom: Message | null; } {
    const held = heldIn(channel.id);
    if (held) return { message: held, hiddenFrom: null };

    const last = lastMessageOf(channel);
    if (!last || !skipped(last)) return { message: last, hiddenFrom: null };

    const loaded = loadedMessages(channel.id);
    for (let i = loaded.length - 1; i >= 0; i--) if (!skipped(loaded[i])) return { message: loaded[i], hiddenFrom: null };
    return { message: undefined, hiddenFrom: last };
}

function useLastMessage(channel: Channel) {
    const channelId = channel.id;
    const [picked, setPicked] = useState(() => pick(channel));

    useEffect(() => {
        const update = () => setPicked(pick(channel));
        update();
        return subscribeChannel(channelId, update);
    }, [channelId]);

    return picked;
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

function lasted(ms: number) {
    const minutes = Math.max(1, Math.round(ms / 60_000));
    return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function VoiceLine({ channel }: { channel: Channel; }) {
    const states = useStateFromStores([VoiceStateStore], () => VoiceStateStore.getVoiceStatesForChannel(channel.id));
    const detail = settings.store.voiceDetail;
    useMinute(detail);
    const ids = Object.keys(states ?? {});
    if (!ids.length) return null;

    const names = ids.map(id => displayName(id, "Unknown"));
    const shown = names.slice(0, 3).join(", ");
    const extra = names.length - Math.min(names.length, 3);
    const list = Object.values(states ?? {}) as any[];
    const streaming = detail && list.some(one => one.selfStream);
    const camera = detail && list.some(one => one.selfVideo);
    const since = detail ? occupancyOf(channel.id) : undefined;

    return <span className={cl("preview")}>
        {streaming && <span className={cl("badge", "badge-live")}>LIVE</span>}
        {camera && <span className={cl("badge")}>camera</span>}
        <span className={cl("text")}>{extra > 0 ? `${shown} +${extra}` : shown}</span>
        {since && <span className={cl("meta")}><span className={cl("age")}>{since.saw ? "" : "at least "}{lasted(Date.now() - since.at)}</span></span>}
    </span>;
}

function Talking({ channel, lastAuthor }: { channel: Channel; lastAuthor?: string; }) {
    const ids = recentAuthors(channel.id, lastAuthor);
    if (ids.length < 2) return null;
    return <span className={cl("talking")} aria-label={`${ids.length} people talking`}>
        {ids.map(id => {
            const user = UserStore.getUser(id);
            return user ? <img key={id} src={IconUtils.getUserAvatarURL(user, false, 16)} alt="" /> : null;
        })}
    </span>;
}

function eventSoon(channel: Channel) {
    if (!settings.store.eventBadges || !channel.guild_id) return null;
    try {
        const now = Date.now();
        const soon = GuildScheduledEventStore.getGuildScheduledEventsForGuild(channel.guild_id)
            ?.filter(one => one.channel_id === channel.id)
            .map(one => ({ ...one, at: new Date(one.scheduled_start_time).getTime() }))
            .filter(one => one.status === 2 || (one.at > now && one.at - now < 86_400_000))
            .sort((a, b) => a.at - b.at)[0];
        if (!soon) return null;
        return soon.status === 2 ? `${soon.name} is on now` : `${soon.name} in ${lasted(soon.at - now)}`;
    } catch {
        return null;
    }
}

function Heatmap({ channelId }: { channelId: string; }) {
    const bars = activityOf(channelId);
    if (!bars) return null;

    const stops = bars.map((level, hour) =>
        `color-mix(in srgb, currentcolor ${Math.round(15 + level * 85)}%, transparent) ${(hour / 24 * 100).toFixed(2)}% ${((hour + 1) / 24 * 100).toFixed(2)}%`);

    return <span className={cl("heat")} style={{ backgroundImage: `linear-gradient(to right, ${stops.join()})` }} aria-hidden="true" />;
}

function stop(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
}

function canReact(channel: Channel) {
    return PermissionStore.can(PermissionsBits.ADD_REACTIONS, channel)
        && PermissionStore.can(PermissionsBits.READ_MESSAGE_HISTORY, channel);
}

function react(channel: Channel, message: Message, emoji: EmojiSelectPayload | null) {
    const value = emojiValue(emoji);
    if (!value) return;

    RestAPI.put({ url: Constants.Endpoints.REACTION(channel.id, message.id, value, "@me") }).catch(err => {
        logger.error("could not react", err);
        showToast("Could not add that reaction", Toasts.Type.FAILURE);
    });
}

function ReactButton({ channel, message }: { channel: Channel; message: Message; }) {
    const trigger = useRef<HTMLButtonElement>(null);

    return <Popout
        position="bottom"
        align="left"
        targetElementRef={trigger}
        renderPopout={({ closePopout }: { closePopout: () => void; }) => (
            <ReactionEmojiPicker
                channel={channel}
                closePopout={closePopout}
                onSelectEmoji={({ emoji, willClose }: { emoji: EmojiSelectPayload | null; willClose: boolean; }) => {
                    react(channel, message, emoji);
                    if (willClose) closePopout();
                }}
            />
        )}
    >
        {(popoutProps: any) => <Tooltip text="React">
            {tip => <button
                {...popoutProps}
                {...tip}
                ref={trigger}
                className={cl("action")}
                onClick={e => {
                    stop(e);
                    tip.onClick?.();
                    popoutProps.onClick?.(e);
                }}
            >
                <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16ZM9 9.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM12 18a5.5 5.5 0 0 0 5-3.2 1 1 0 0 0-1.8-.9A3.5 3.5 0 0 1 12 16a3.5 3.5 0 0 1-3.2-2.1 1 1 0 1 0-1.8.9A5.5 5.5 0 0 0 12 18Z" />
                </svg>
            </button>}
        </Tooltip>}
    </Popout>;
}

function Action({ label, className, disabled, onClick, children }: {
    label: string;
    className?: string;
    disabled?: boolean;
    onClick(e: React.MouseEvent<HTMLButtonElement>): void;
    children: ReactNode;
}) {
    return <Tooltip text={label}>
        {tip => <button
            {...tip}
            className={classes(cl("action"), className)}
            disabled={disabled}
            onClick={e => {
                stop(e);
                tip.onClick?.();
                onClick(e);
            }}
        >
            {children}
        </button>}
    </Tooltip>;
}

function saveForLater(channel: Channel, message: Message) {
    const list = settings.store.later as Later[];
    if (list.some(one => one.messageId === message.id)) return showToast("Already saved for later", Toasts.Type.MESSAGE);
    settings.store.later = [{
        channelId: channel.id,
        guildId: channel.guild_id,
        messageId: message.id,
        name: message.author ? nameOf(message) : "",
        text: plainText(message).slice(0, 200),
        at: message.timestamp ? new Date(message.timestamp as any).getTime() : Date.now()
    }, ...list.map(one => ({ ...one }))].slice(0, 50);
    showToast("Saved for later. It is in Catch Up.", Toasts.Type.SUCCESS);
}

function Actions({ channel, message, unread, onTranslate }: { channel: Channel; message: Message; unread: boolean; onTranslate?: () => void; }) {
    const { markReadButton, quickReply, quickReact, laterButton } = settings.use(["markReadButton", "quickReply", "quickReact", "laterButton"]);
    const [acked, setAcked] = useState(false);

    useEffect(() => {
        if (!acked) return;
        const timer = setTimeout(() => setAcked(false), 800);
        return () => clearTimeout(timer);
    }, [acked]);

    const reacts = quickReact && canReact(channel);
    const marks = markReadButton && (unread || acked);
    if (!quickReply && !reacts && !marks && !laterButton && !onTranslate) return null;

    return <span className={cl("actions")}>
        {onTranslate && <Action label="Translate" onClick={onTranslate}>
            <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M4 5h7V3h2v2h7v2h-2.1a14 14 0 0 1-3.4 6.6l2.3 2.3-1.4 1.4-2.4-2.4A14 14 0 0 1 8 17.3l-.8-1.8a12 12 0 0 0 3.4-1.8A12 12 0 0 1 8 10h2.1a10 10 0 0 0 2 2.4A12 12 0 0 0 15.3 7H4V5Zm13 9h2l4 9h-2.2l-.9-2h-3.8l-.9 2H13l4-9Zm-.1 5h2.2L18 16.6 16.9 19Z" />
            </svg>
        </Action>}
        {laterButton && <Action label="Read later" onClick={() => saveForLater(channel, message)}>
            <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Zm1 2v12.6l5-2.9 5 2.9V5H7Z" />
            </svg>
        </Action>}
        {quickReply && <Action label="Reply" onClick={e => openQuickReply(channel, e.currentTarget.getBoundingClientRect(), message)}>
            <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11Z" />
            </svg>
        </Action>}
        {reacts && <ReactButton channel={channel} message={message} />}
        {marks && <Action
            label={acked ? "Marked as read" : "Mark as read"}
            className={acked ? cl("action-done") : undefined}
            disabled={acked}
            onClick={() => {
                ReadStateUtils.ackChannel(channel);
                setAcked(true);
            }}
        >
            <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" />
            </svg>
        </Action>}
    </span>;
}

function Text({ keyed, title, children }: { keyed: boolean; title?: string; children: ReactNode; }) {
    const box = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        if (!keyed || !box.current) return;
        return markKeywords(box.current);
    });

    return <span ref={box} className={cl("text")} title={title}>{children}</span>;
}

function TypingDots() {
    return <svg className={cl("dots")} width={16} height={6} viewBox="0 0 16 6" aria-hidden="true">
        <circle cx={3} cy={3} r={2} fill="currentColor" />
        <circle cx={8} cy={3} r={2} fill="currentColor" />
        <circle cx={13} cy={3} r={2} fill="currentColor" />
    </svg>;
}

const Preview = ErrorBoundary.wrap(function Preview({ channel }: { channel: Channel; }) {
    settings.use([
        "showAuthor", "showAvatar", "roleColors", "colorScope", "iconSize", "previewLines",
        "fullTextTooltip", "showAge", "staleAfter", "boldMentions", "dimRead", "unreadCount",
        "keywords", "typingIndicator", "voiceOccupants", "jumpToMessage", "mutedChannels",
        "attachmentDetail", "thumbnails", "linkStyle", "blurNsfw", "replyContext", "heatmap",
        "whoTalking", "burstBadge", "friendRing", "bots", "skippedAuthors", "editedMarks", "eventBadges",
        "codePreview", "translateButton", "guildStyles", "hoverCard", "voiceDetail"
    ]);

    const { message: picked, hiddenFrom } = useLastMessage(channel);
    const gone = settings.store.editedMarks ? deletedIn(channel.id) : undefined;
    const message = gone ?? picked;
    const style = styleFor(channel.guild_id);
    const [translated, setTranslated] = useState<{ id: string; text: string; } | null>(null);
    const read = useStateFromStores([ReadStateStore], () => ({
        unread: ReadStateStore.hasUnread(channel.id),
        count: ReadStateStore.getUnreadCount(channel.id),
        mentions: ReadStateStore.getMentionCount(channel.id)
    }), [channel.id], (a, b) => a.unread === b.unread && a.count === b.count && a.mentions === b.mentions);

    const typing = useStateFromStores([TypingStore], () => {
        if (!settings.store.typingIndicator) return "";
        const me = UserStore.getCurrentUser()?.id;
        return Object.keys(TypingStore.getTypingUsers(channel.id)).filter(id => id !== me).join();
    }, [channel.id]);

    useMinute(settings.store.showAge || settings.store.staleAfter > 0);

    if (typing) {
        return <span className={classes(cl("preview"), cl("typing"))}>
            <TypingDots />
            <span className={cl("text")}>{typingLabel(typing.split(","))}</span>
        </span>;
    }

    if (channel.type === ChannelType.GUILD_VOICE || channel.type === ChannelType.GUILD_STAGE_VOICE) {
        return settings.store.voiceOccupants ? <VoiceLine channel={channel} /> : null;
    }

    if (!message && hiddenFrom) {
        return <span className={classes(cl("preview"), cl("faded"))}>
            <span className={cl("text")}>{`a message from ${nameOf(hiddenFrom)} you skip`}</span>
        </span>;
    }

    if (!message) return null;
    if (!gone) noteShown(channel.id, message);

    const text = translated?.id === message.id ? translated.text : describe(message, channel);
    if (!text) return null;

    const { author } = message;
    const timestamp = message.timestamp ? new Date(message.timestamp as any).getTime() : 0;

    const muted = UserGuildSettingsStore.isChannelMuted(channel.guild_id, channel.id);
    const dimmed = (style.dimRead && !read.unread) || (muted && settings.store.mutedChannels === "dim");

    const raw = plainText(message);
    const color = author && settings.store.roleColors ? previewColor(channel, author.id) : null;
    const wholeLine = settings.store.colorScope === "line";

    const name = author ? nameOf(message) : null;
    const avatar = style.showAvatar && author
        ? IconUtils.getUserAvatarURL(author, false, 16)
        : null;

    const isReply = settings.store.replyContext && Boolean((message as any).messageReference);

    const mentioned = settings.store.boldMentions && mentionsMe(message);
    const lead = style.showAuthor || !name;
    const friend = settings.store.friendRing && Boolean(author) && RelationshipStore.isFriend(author.id);
    const bot = settings.store.bots === "light" && author?.bot;
    const burst = settings.store.burstBadge ? burstOf(channel.id) : 0;
    const event = eventSoon(channel);
    const edited = settings.store.editedMarks && !gone && Boolean(message.editedTimestamp);
    const canTranslate = settings.store.translateButton && isPluginEnabled("Translate") && Boolean(message.content) && translated?.id !== message.id;
    const translateNow = canTranslate
        ? () => {
            translate("received", message.content)
                .then(result => setTranslated({ id: message.id, text: result.text }))
                .catch(() => showToast("Could not translate that", Toasts.Type.FAILURE));
        }
        : undefined;
    const showCount = settings.store.unreadCount && read.count > 0;
    const showAge = settings.store.showAge && timestamp > 0;

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
            cl("lines-" + style.previewLines),
            dimmed || isStale(timestamp) ? cl("faded") : undefined,
            gone ? cl("deleted") : undefined,
            bot ? cl("bot") : undefined,
            heldIn(channel.id) ? cl("held") : undefined
        )}
        style={wholeLine && color ? { color } : undefined}
        onClick={jump}
        {...(settings.store.hoverCard ? hoverHandlers(channel) : {})}
    >
        <Text keyed={matchesKeyword(raw)} title={settings.store.fullTextTooltip ? `${name ? name + ": " : ""}${raw}` : undefined}>
            {lead && avatar && <img className={cl("avatar", { "avatar-friend": friend })} src={avatar} alt="" loading="lazy" />}
            {lead && isReply && <svg className={cl("reply-mark")} width={12} height={12} viewBox="0 0 24 24" aria-label="Reply">
                <path d="M6 4v7a4 4 0 0 0 4 4h9m-4-4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            </svg>}
            {lead && name && <span className={cl("author", { "author-friend": friend && !avatar })} style={color ? { color } : undefined}>{name}</span>}
            {mentioned && <span className={cl("at")} aria-label="Mentions you">@</span>}
            {text}
            {edited && <span className={cl("edited")}>edited</span>}
        </Text>
        {burst >= 8 && <span className={cl("badge", "badge-burst")}>{burst} in 2m</span>}
        {event && <span className={cl("badge")}>{event}</span>}
        {settings.store.whoTalking && <Talking channel={channel} lastAuthor={author?.id} />}
        {settings.store.heatmap && <Heatmap channelId={channel.id} />}
        <Actions channel={channel} message={message} unread={read.unread} onTranslate={translateNow} />
        {(showCount || showAge) && <span className={cl("meta")}>
            {showCount && <span className={cl("count", { "count-mention": read.mentions > 0 })}>{read.count}</span>}
            {showAge && <span className={cl("age")}>{ageOf(timestamp)}</span>}
        </span>}
    </span>;
}, { noop: true });

export default Preview;
