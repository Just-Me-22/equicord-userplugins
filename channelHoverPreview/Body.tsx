/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { getUserSettingLazy } from "@api/UserSettings";
import { createTab } from "@equicordplugins/channelTabs/util/tabs";
import { copyWithToast, sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { Channel, Message } from "@vencord/discord-types";
import { ChannelType } from "@vencord/discord-types/enums";
import { findByPropsLazy, findComponentByCodeLazy } from "@webpack";
import {
    ActiveJoinedThreadsStore, Constants, IconUtils, MessageStore, NavigationRouter, PermissionsBits, PermissionStore,
    Popout, ReadStateStore, ReadStateUtils, RestAPI, showToast, SnowflakeUtils, Toasts, TypingStore, useEffect,
    useLayoutEffect, useMemo, useRef, UserStore, useState, useStateFromStores, VoiceStateStore
} from "@webpack/common";
import type { ComponentType, JSX, MouseEvent as ReactMouseEvent, ReactNode } from "react";

import { Avatar, channelIcon, channelTitle, displayName, Dots, emojiValue, Glyph, IconButton, ICONS, PickedEmoji, ReactionEmojiPicker } from "./parts";
import { settings } from "./settings";
import { closeNow, isPinned, panel, setPinned } from "./state";

const ChannelMessage = findComponentByCodeLazy("isFirstMessageInForumPost", "trackAnnouncementViews") as ComponentType<any>;
const MessageActions = findByPropsLazy("fetchMessages", "sendMessage");
const MessageDisplayCompact = getUserSettingLazy("textAndImages", "messageDisplayCompact")!;

const logger = new Logger("ChannelHoverPreview");

const NO_JUMP = "a, button, [role='button'], video, audio, [class*='spoiler'], textarea, input";
const OLDER = 25;
const NEAR_TOP = 80;
const NEAR_BOTTOM = 40;

const requested = new Set<string>();
const savedPlace = new Map<string, string>();
const dayFormat = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" });

const timeOf = (message: Message) => +new Date(message.timestamp as any);

function linkTo(channel: Channel, messageId?: string) {
    return `/channels/${channel.guild_id ?? "@me"}/${channel.id}${messageId ? `/${messageId}` : ""}`;
}

function openInTab(channel: Channel, messageId?: string) {
    createTab({ guildId: channel.guild_id ?? "@me", channelId: channel.id }, false, messageId);
}

function useMessages(channelId: string, want: number) {
    const messages = useStateFromStores([MessageStore], () => MessageStore.getMessages(channelId)?._array as Message[] | undefined) ?? [];
    const hasMore = useStateFromStores([MessageStore], () => Boolean(MessageStore.getMessages(channelId)?.hasMoreBefore));
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);

    const fetch = (options: Record<string, unknown>) => {
        if (requested.has(channelId)) return;
        requested.add(channelId);
        setLoading(true);
        setFailed(null);

        MessageActions.fetchMessages({ channelId, ...options })
            .catch((err: any) => setFailed(`${err?.status ?? ""} ${err?.body?.message ?? err?.message ?? err}`.trim()))
            .finally(() => {
                requested.delete(channelId);
                setLoading(false);
            });
    };

    useEffect(() => {
        if (messages.length < want) fetch({ limit: want });
    }, [channelId, attempt]);

    const loadOlder = () => {
        if (!hasMore || loading || !messages.length) return false;
        fetch({ limit: OLDER, before: messages[0].id });
        return true;
    };

    return {
        messages,
        loading: loading || (!messages.length && !failed && requested.has(channelId)),
        failed,
        hasMore,
        loadOlder,
        retry: () => setAttempt(n => n + 1)
    };
}

function canSend(channel: Channel) {
    return channel.isPrivate() || PermissionStore.can(PermissionsBits.SEND_MESSAGES, channel);
}

function canReact(channel: Channel) {
    return channel.isPrivate() || (PermissionStore.can(PermissionsBits.ADD_REACTIONS, channel)
        && PermissionStore.can(PermissionsBits.READ_MESSAGE_HISTORY, channel));
}

function react(channel: Channel, message: Message, emoji: PickedEmoji | null) {
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
        position="left"
        align="center"
        targetElementRef={trigger}
        renderPopout={({ closePopout }: { closePopout: () => void; }) => (
            <ReactionEmojiPicker
                channel={channel}
                messageId={message.id}
                closePopout={closePopout}
                onSelectEmoji={({ emoji, willClose }: { emoji: PickedEmoji | null; willClose: boolean; }) => {
                    react(channel, message, emoji);
                    if (willClose) closePopout();
                }}
            />
        )}
    >
        {(popoutProps: any) => <button
            {...popoutProps}
            ref={trigger}
            className="chp-tool"
            aria-label="React"
            onClick={e => {
                e.stopPropagation();
                popoutProps.onClick?.(e);
            }}
        >
            <Glyph path={ICONS.react} />
        </button>}
    </Popout>;
}

function Tools({ channel, message, onReply }: { channel: Channel; message: Message; onReply?: () => void; }) {
    return <div className="chp-tools">
        {onReply && <button className="chp-tool" aria-label="Reply" onClick={e => { e.stopPropagation(); onReply(); }}>
            <Glyph path={ICONS.reply} />
        </button>}
        {canReact(channel) && <ReactButton channel={channel} message={message} />}
        <button
            className="chp-tool"
            aria-label="Copy message link"
            onClick={e => {
                e.stopPropagation();
                copyWithToast(`https://discord.com${linkTo(channel, message.id)}`, "Message link copied");
            }}
        >
            <Glyph path={ICONS.link} />
        </button>
    </div>;
}

function Composer({ channel, replyTo, clearReply, focusKey }: { channel: Channel; replyTo: Message | null; clearReply(): void; focusKey: number; }) {
    const [value, setValue] = useState("");
    const [sending, setSending] = useState(false);
    const input = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (focusKey) input.current?.focus();
    }, [focusKey]);

    useLayoutEffect(() => {
        const box = input.current;
        if (!box) return;
        box.style.height = "auto";
        box.style.height = `${box.scrollHeight}px`;
    }, [value]);

    const send = async () => {
        const content = value.trim();
        if (!content || sending) return;

        setSending(true);
        try {
            await sendMessage(channel.id, { content }, true, replyTo
                ? { messageReference: { guild_id: channel.guild_id, channel_id: channel.id, message_id: replyTo.id } }
                : {});
            setValue("");
            clearReply();
        } finally {
            setSending(false);
            input.current?.focus();
        }
    };

    const where = channel.isPrivate() ? `@${channelTitle(channel)}` : `#${channel.name}`;

    return <div className="chp-composer">
        {replyTo && <div className="chp-replying">
            <span>Replying to <strong>{displayName(replyTo.author.id, replyTo.author.username)}</strong></span>
            <IconButton label="Cancel reply" icon={ICONS.close} onClick={clearReply} />
        </div>}
        <textarea
            ref={input}
            className="chp-input"
            rows={1}
            value={value}
            disabled={sending}
            placeholder={`Message ${where}`}
            onChange={e => setValue(e.currentTarget.value)}
            onKeyDown={e => {
                if (e.key === "Escape") {
                    e.stopPropagation();
                    if (replyTo) clearReply();
                    else e.currentTarget.blur();
                    return;
                }
                if (e.key !== "Enter" || e.shiftKey) return;
                e.preventDefault();
                send();
            }}
        />
    </div>;
}

function VoiceStrip({ channel }: { channel: Channel; }) {
    const states = useStateFromStores([VoiceStateStore], () => VoiceStateStore.getVoiceStatesForChannel(channel.id));
    const people = Object.values(states ?? {}) as any[];
    if (!people.length) return null;

    return <div className="chp-voice">
        {people.map(state => {
            const user = UserStore.getUser(state.userId);
            const quiet = state.selfDeaf || state.deaf ? ICONS.deafened : state.selfMute || state.mute ? ICONS.muted : null;
            return <span className="chp-voice-person" key={state.userId}>
                {user && <img className="chp-voice-avatar" src={IconUtils.getUserAvatarURL(user, false, 32)} alt="" />}
                <span className="chp-voice-name">{displayName(state.userId, "Unknown")}</span>
                {quiet && <span className="chp-voice-state"><Glyph path={quiet} size={12} /></span>}
            </span>;
        })}
    </div>;
}

function threadsOf(record: unknown) {
    return Object.values((record ?? {}) as Record<string, any>)
        .map(entry => entry?.channel ?? entry)
        .filter((post): post is Channel => Boolean(post?.id));
}

function ForumPosts({ channel }: { channel: Channel; }) {
    const posts = useStateFromStores([ActiveJoinedThreadsStore], () => [
        ...threadsOf(ActiveJoinedThreadsStore.getActiveJoinedThreadsForParent(channel.guild_id, channel.id)),
        ...threadsOf(ActiveJoinedThreadsStore.getActiveUnjoinedThreadsForParent(channel.guild_id, channel.id))
    ]);

    const newest = [...posts]
        .sort((a, b) => (b.lastMessageId ?? b.id).localeCompare(a.lastMessageId ?? a.id, undefined, { numeric: true }))
        .slice(0, 20);

    if (!newest.length) return <div className="chp-empty">No recent posts</div>;

    return <div className="chp-posts">
        {newest.map(post => <button
            key={post.id}
            className="chp-post"
            onClick={() => {
                closeNow();
                NavigationRouter.transitionTo(linkTo(post));
            }}
        >
            <span className="chp-post-name">{post.name}</span>
            <span className="chp-post-meta">
                {(post as any).messageCount ?? 0} replies · {ageOf(SnowflakeUtils.extractTimestamp(post.lastMessageId ?? post.id))}
            </span>
        </button>)}
    </div>;
}

function ageOf(at: number) {
    const minutes = Math.floor((Date.now() - at) / 60_000);
    if (minutes < 1) return "now";
    if (minutes < 60) return `${minutes}m`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
    return `${Math.floor(minutes / 1440)}d`;
}

function Skeleton() {
    return <div className="chp-skeleton" aria-label="Loading messages">
        {[72, 48, 64].map(width => <div className="chp-skeleton-row" key={width}>
            <span className="chp-skeleton-avatar" />
            <span className="chp-skeleton-lines">
                <span className="chp-skeleton-line" style={{ width: "28%" }} />
                <span className="chp-skeleton-line" style={{ width: `${width}%` }} />
            </span>
        </div>)}
    </div>;
}

function Typing({ channelId }: { channelId: string; }) {
    const ids = useStateFromStores([TypingStore], () => {
        const me = UserStore.getCurrentUser()?.id;
        return Object.keys(TypingStore.getTypingUsers(channelId)).filter(id => id !== me).join();
    }, [channelId]);

    if (!ids) return null;
    const people = ids.split(",");

    return <div className="chp-typing">
        <Dots />
        {people.length === 1 ? `${displayName(people[0])} is typing…` : `${people.length} people are typing…`}
    </div>;
}

function Header({ channel, unread, searching, onSearch, onDragStart }: {
    channel: Channel;
    unread: boolean;
    searching: boolean;
    onSearch(): void;
    onDragStart(e: React.PointerEvent): void;
}) {
    const pinned = isPinned();
    const glyph = channel.type === ChannelType.GUILD_VOICE || channel.type === ChannelType.GUILD_STAGE_VOICE
        ? ICONS.voice
        : channel.type === ChannelType.GUILD_FORUM ? ICONS.forum : ICONS.hash;

    return <div className="chp-header" onPointerDown={onDragStart}>
        <Avatar src={channelIcon(channel)} fallback={<Glyph path={glyph} />} />
        <span className="chp-header-text">
            <span className="chp-title">{channelTitle(channel)}</span>
            {channel.topic && <span className="chp-topic">{channel.topic}</span>}
        </span>
        <span className="chp-header-actions">
            {unread && <IconButton label="Mark as read" icon={ICONS.read} onClick={() => ReadStateUtils.ackChannel(channel)} />}
            <IconButton label="Search these messages" icon={ICONS.search} active={searching} onClick={onSearch} />
            {isPluginEnabled("ChannelTabs") && <IconButton label="Open in a new tab" icon={ICONS.tab} onClick={() => openInTab(channel)} />}
            <IconButton label={pinned ? "Unpin" : "Keep open"} icon={ICONS.pin} active={pinned} onClick={() => setPinned(!pinned)} />
            {pinned && <IconButton label="Close" icon={ICONS.close} onClick={closeNow} />}
        </span>
    </div>;
}

export function ChannelBody({ channel, maxHeight, onDragStart }: { channel: Channel; maxHeight: number; onDragStart(e: React.PointerEvent): void; }) {
    const { messageCount, display, clickToJump, composer, onlyUnread } =
        settings.use(["messageCount", "display", "clickToJump", "composer", "onlyUnread"]);

    const [want, setWant] = useState(() => Math.max(1, Math.round(messageCount)));
    const { messages, loading, failed, hasMore, loadOlder, retry } = useMessages(channel.id, want);
    const read = useStateFromStores([ReadStateStore], () => ({
        unread: ReadStateStore.hasUnread(channel.id),
        first: ReadStateStore.getOldestUnreadMessageId(channel.id)
    }), [channel.id], (a, b) => a.unread === b.unread && a.first === b.first);

    const rawCompact = MessageDisplayCompact.useSetting();
    const compact = display === "compact" ? true : display === "cozy" ? false : rawCompact;

    const [query, setQuery] = useState<string | null>(null);
    const [replyTo, setReplyTo] = useState<Message | null>(null);
    const [focusKey, setFocusKey] = useState(0);
    const [edges, setEdges] = useState({ top: true, bottom: true });

    const scroller = useRef<HTMLDivElement | null>(null);
    const snapshot = useRef<{ first?: string; last?: string; height: number; atBottom: boolean; placed: boolean; }>({ height: 0, atBottom: true, placed: false });
    const arrived = useRef(new Set<string>());

    const isForum = channel.type === ChannelType.GUILD_FORUM || channel.type === ChannelType.GUILD_MEDIA;
    const sendable = composer && !isForum && canSend(channel);

    useEffect(() => {
        panel.search = () => setQuery(current => current ?? "");
        return () => { panel.search = null; };
    }, []);

    const shown = useMemo(() => {
        let list = messages.slice(-want);
        if (onlyUnread && read.unread && read.first) {
            const at = messages.findIndex(message => message.id === read.first);
            if (at >= 0) list = messages.slice(at);
        }
        const needle = query?.trim().toLowerCase();
        return needle ? list.filter(message => message.content?.toLowerCase().includes(needle)) : list;
    }, [messages, want, onlyUnread, read.unread, read.first, query]);

    const { last } = snapshot.current;
    if (snapshot.current.placed && last) {
        const at = shown.findIndex(message => message.id === last);
        if (at >= 0) for (const message of shown.slice(at + 1)) arrived.current.add(message.id);
    }

    useLayoutEffect(() => {
        const el = scroller.current;
        if (!el || !shown.length) return;

        const prev = snapshot.current;
        const first = shown[0].id;
        const newest = shown[shown.length - 1].id;

        if (!prev.placed) {
            const saved = savedPlace.get(channel.id);
            const anchor = (saved && el.querySelector<HTMLElement>(`[data-chp-id="${saved}"]`))
                || (read.unread ? el.querySelector<HTMLElement>(".chp-unread") : null);
            el.scrollTop = anchor ? anchor.offsetTop - 8 : el.scrollHeight;
            prev.placed = true;
        } else if (prev.first !== first && prev.last === newest) {
            el.scrollTop += el.scrollHeight - prev.height;
        } else if (prev.last !== newest && prev.atBottom) {
            el.scrollTop = el.scrollHeight;
        }

        prev.first = first;
        prev.last = newest;
        prev.height = el.scrollHeight;
        prev.atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
        setEdges({ top: el.scrollTop < 4, bottom: prev.atBottom });
    }, [shown]);

    useLayoutEffect(() => () => {
        const el = scroller.current;
        if (!el || !snapshot.current.placed) return;
        if (snapshot.current.atBottom) return void savedPlace.delete(channel.id);

        const { top } = el.getBoundingClientRect();
        const visible = [...el.querySelectorAll<HTMLElement>("[data-chp-id]")].find(row => row.getBoundingClientRect().bottom > top + 8);
        if (visible?.dataset.chpId) savedPlace.set(channel.id, visible.dataset.chpId);
    }, []);

    const onScroll = () => {
        const el = scroller.current;
        if (!el) return;

        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
        snapshot.current.atBottom = atBottom;
        snapshot.current.height = el.scrollHeight;
        const top = el.scrollTop < 4;
        if (top !== edges.top || atBottom !== edges.bottom) setEdges({ top, bottom: atBottom });

        if (el.scrollTop < NEAR_TOP && query == null && loadOlder()) setWant(n => n + OLDER);
    };

    const jump = (e: ReactMouseEvent, message: Message) => {
        if (e.defaultPrevented || (e.target as HTMLElement).closest(NO_JUMP)) return;
        if (window.getSelection()?.toString()) return;

        closeNow();
        NavigationRouter.transitionTo(linkTo(channel, message.id));
    };

    const reply = sendable
        ? (message: Message) => {
            setReplyTo(message);
            setFocusKey(n => n + 1);
        }
        : undefined;

    const rows: JSX.Element[] = [];
    let day = "";
    for (const message of shown) {
        const today = new Date(timeOf(message)).toDateString();
        if (today !== day) {
            if (day) rows.push(<div key={`day-${message.id}`} className="chp-day"><span>{dayFormat.format(timeOf(message))}</span></div>);
            day = today;
        }

        if (message.id === read.first && read.unread)
            rows.push(<div key={`unread-${message.id}`} className="chp-unread"><span>New</span></div>);

        rows.push(
            <div
                key={message.id}
                data-chp-id={message.id}
                className={[
                    "chp-message",
                    clickToJump && "chp-jump",
                    arrived.current.has(message.id) && "chp-arrived",
                    replyTo?.id === message.id && "chp-replying-to"
                ].filter(Boolean).join(" ")}
                onClick={clickToJump ? e => jump(e, message) : undefined}
                onAuxClick={e => {
                    if (e.button !== 1 || !isPluginEnabled("ChannelTabs")) return;
                    e.preventDefault();
                    openInTab(channel, message.id);
                }}
            >
                <ChannelMessage
                    id={`chp-${channel.id}-${message.id}`}
                    message={message}
                    channel={channel}
                    subscribeToComponentDispatch={false}
                    compact={compact}
                />
                <Tools channel={channel} message={message} onReply={reply && (() => reply(message))} />
            </div>
        );
    }

    let content: ReactNode;
    if (isForum) content = <ForumPosts channel={channel} />;
    else if (shown.length) content = rows;
    else if (loading) content = <Skeleton />;
    else if (failed) content = <div className="chp-empty">
        Could not load messages: {failed}
        <button className="chp-retry" onClick={e => { e.stopPropagation(); retry(); }}>Try again</button>
    </div>;
    else content = <div className="chp-empty">{query ? "Nothing matches that" : "No messages yet"}</div>;

    return <>
        <Header
            channel={channel}
            unread={read.unread}
            searching={query != null}
            onSearch={() => setQuery(current => current == null ? "" : null)}
            onDragStart={onDragStart}
        />
        {query != null && <div className="chp-search">
            <Glyph path={ICONS.search} size={14} />
            <input
                className="chp-search-input"
                autoFocus
                value={query}
                placeholder="Search loaded messages"
                onChange={e => setQuery(e.currentTarget.value)}
                onKeyDown={e => {
                    if (e.key !== "Escape") return;
                    e.stopPropagation();
                    setQuery(null);
                }}
            />
            {query.trim() && <span className="chp-search-count">{shown.length}</span>}
        </div>}
        <VoiceStrip channel={channel} />
        <div
            ref={el => { scroller.current = el; panel.scroller = el; }}
            className="chp-scroller"
            style={{ maxHeight }}
            onScroll={onScroll}
        >
            <div className={edges.top ? "chp-edge chp-edge-top" : "chp-edge chp-edge-top chp-edge-on"} />
            {loading && hasMore && shown.length > 0 && <div className="chp-older"><Dots /></div>}
            {content}
            {!isForum && <Typing channelId={channel.id} />}
            <div className={edges.bottom ? "chp-edge chp-edge-bottom" : "chp-edge chp-edge-bottom chp-edge-on"} />
        </div>
        {sendable && <Composer channel={channel} replyTo={replyTo} clearReply={() => setReplyTo(null)} focusKey={focusKey} />}
    </>;
}
