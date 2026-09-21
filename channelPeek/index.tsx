/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings, Settings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import roleColorEverywhere from "@plugins/roleColorEverywhere";
import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import { classes } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { Channel, Message } from "@vencord/discord-types";
import { ChannelType } from "@vencord/discord-types/enums";
import { findByPropsLazy, findComponentByCodeLazy } from "@webpack";
import { FluxDispatcher, GuildChannelStore, GuildMemberStore, Menu, MessageStore, Modal, openModal, Parser, RelationshipStore, SelectedGuildStore, useEffect, UserGuildSettingsStore, UserStore, useState } from "@webpack/common";

const SocketModule = findByPropsLazy("getSocket");

/** discord's own preview cache. the gateway's LAST_MESSAGES reply lands here, not in
 *  MessageStore, and it is seeded from guild.lastMessages on connection open.
 *  found by its methods, not by name: "MessagePreviewStore" in the source is a logger
 *  label, and findStoreLazy on a name that does not exist throws on first access. */
const PreviewStore = findByPropsLazy("isLocalFetchNeeded", "isLatest");

const cl = classNameFactory("vc-channel-peek-");
const logger = new Logger("ChannelPeek");

const settings = definePluginSettings({
    showAuthor: {
        type: OptionType.BOOLEAN,
        description: "Prefix each preview with who sent it.",
        default: true
    },
    roleColors: {
        type: OptionType.BOOLEAN,
        description: "Colour the sender's name with their top role colour.",
        default: true
    },
    hideMuted: {
        type: OptionType.BOOLEAN,
        description: "Leave muted channels without a preview.",
        default: true
    },
    channelIcons: {
        type: OptionType.BOOLEAN,
        description: "Replace the # with the channel's emoji on a tinted circle.",
        default: true,
        restartNeeded: true
    },
    iconSize: {
        type: OptionType.SELECT,
        description: "How big the emoji circle is.",
        options: [
            { label: "Tiny - 20px circle, 14px emoji", value: "tiny", default: true },
            { label: "Small - 32px circle, 16px emoji", value: "small" },
            { label: "Medium - 42px circle, 20px emoji", value: "medium" }
        ]
    },
    iconFallback: {
        type: OptionType.STRING,
        description: "Emoji for channels that have none set. Leave empty to keep the # on those.",
        default: "\u{1F310}"
    },
    iconOverrides: {
        type: OptionType.STRING,
        description: "Per-channel emoji, as channelId=emoji separated by spaces. Example: 1346683143800881210=\u{1F604}",
        default: ""
    }
});

function describe(message: Message): React.ReactNode {
    // the parser turns <:name:id> into a real emoji, and handles mentions and markdown
    if (message.content) return Parser.parseInlineReply(message.content);

    const attachment = message.attachments?.[0];
    if (attachment) return attachment.content_type?.startsWith("image/") ? "sent an image" : "sent an attachment";
    if (message.stickerItems?.length) return "sent a sticker";
    if (message.embeds?.length) return "sent an embed";

    return null;
}

function parseOverrides(): Map<string, string> {
    const map = new Map<string, string>();
    for (const pair of settings.store.iconOverrides.split(/\s+/)) {
        const [id, emoji] = pair.split("=");
        if (id && emoji) map.set(id, emoji);
    }
    return map;
}

type EmojiSelectPayload = {
    id?: string | null;
    name?: string | null;
    optionallyDiverseSequence?: string;
};

const ReactionEmojiPicker = findComponentByCodeLazy<any>("showAddEmojiButton:", "pickerIntention:", "messageId:");

/** custom emoji round-trip as name:id, unicode as the sequence itself */
function emojiValue(emoji: EmojiSelectPayload | null | undefined) {
    if (!emoji) return "";
    if (emoji.id && emoji.name) return `${emoji.name}:${emoji.id}`;
    if (emoji.optionallyDiverseSequence?.trim()) return emoji.optionallyDiverseSequence;
    return emoji.name?.trim() ?? "";
}

function setOverride(channelId: string, emoji: string | null) {
    const map = parseOverrides();
    if (emoji) map.set(channelId, emoji);
    else map.delete(channelId);
    settings.store.iconOverrides = [...map].map(([id, value]) => `${id}=${value}`).join(" ");
}

function openEmojiPicker(channel: Channel) {
    openModal(props => (
        <Modal {...props} size="md" title="Set Channel Emoji">
            <div className={cl("picker-notice")}>
                Icon changes locally. Only you will see this change.
            </div>
            <ReactionEmojiPicker
                channel={channel}
                closePopout={props.onClose}
                onSelectEmoji={({ emoji, willClose }: { emoji: EmojiSelectPayload | null; willClose: boolean; }) => {
                    const value = emojiValue(emoji);
                    if (value) setOverride(channel.id, value);
                    if (willClose) props.onClose();
                }}
            />
        </Modal>
    ));
}

const channelContext: NavContextMenuPatchCallback = (children, { channel }: { channel: Channel; }) => {
    if (!channel) return;
    if (channel.type !== ChannelType.GUILD_TEXT && channel.type !== ChannelType.GUILD_ANNOUNCEMENT) return;

    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="vc-channel-peek-pick"
                label="Set Channel Emoji"
                action={() => openEmojiPicker(channel)}
            />
            {parseOverrides().has(channel.id) && (
                <Menu.MenuItem
                    id="vc-channel-peek-reset"
                    label="Reset Channel Emoji"
                    color="danger"
                    action={() => setOverride(channel.id, null)}
                />
            )}
        </Menu.MenuGroup>
    );
};

/** a stable hue per emoji, so the circles vary without shipping a colour table */
function tintFor(emoji: string) {
    let hue = 7;
    for (const char of emoji) hue = (hue * 31 + char.codePointAt(0)!) % 360;
    return `hsl(${hue} 45% 50% / 0.22)`;
}

/** null means "leave discord's # alone" - resolved outside the component so the patch
 *  can fall through instead of rendering an empty slot. */
function resolveEmoji(channel: Channel) {
    const override = parseOverrides().get(channel.id);
    if (override) {
        const custom = override.match(/^(.+):(\d+)$/);
        return custom
            ? { emoji: custom[1], custom: { id: custom[2], name: custom[1] } }
            : { emoji: override, custom: null };
    }

    const native = channel.iconEmoji;
    const emoji = native?.name ?? settings.store.iconFallback;
    return emoji ? { emoji, custom: native?.id ? native : null } : null;
}

const ChannelIcon = ErrorBoundary.wrap(function ChannelIcon({ channel, containerClassName }: { channel: Channel; containerClassName?: string; }) {
    // subscribing is what makes the picker's write show up without a reload
    settings.use(["iconOverrides", "iconFallback", "iconSize"]);

    const resolved = resolveEmoji(channel);
    if (!resolved) return null;
    const { emoji, custom } = resolved;

    return (
        <div
            className={classes(cl("icon"), cl("icon-" + settings.store.iconSize), containerClassName)}
            style={{ background: tintFor(emoji) }}
            role="button"
            aria-label="Set channel emoji"
            // the icon lives inside the row's link, so without both of these the click
            // opens the channel instead of the picker
            onClick={e => {
                e.preventDefault();
                e.stopPropagation();
                openEmojiPicker(channel);
            }}
        >
            {custom?.id
                ? <img className={cl("icon-custom")} src={`https://cdn.discordapp.com/emojis/${custom.id}.webp?size=32`} alt={emoji} />
                : emoji}
        </div>
    );
}, { noop: true });

const watchers = new Map<string, Set<() => void>>();
const MESSAGE_EVENTS = [
    "MESSAGE_CREATE", "MESSAGE_UPDATE", "MESSAGE_DELETE", "LOAD_MESSAGES_SUCCESS",
    "MESSAGE_PREVIEWS_LOADED", "MESSAGE_PREVIEWS_LOCALLY_LOADED"
] as const;

function wakeAll() {
    for (const listeners of watchers.values()) listeners.forEach(notify => notify());
}

function onMessageEvent(event: any) {
    // the previews events carry a batch with no single channel, so wake everything.
    // they are also the first moment we know who the authors are, so ask for them.
    if (event.messages) {
        wakeAll();
        requestMissingMembers(SelectedGuildStore.getGuildId());
        return;
    }

    const channelId = event.channelId ?? event.message?.channel_id;
    if (channelId) watchers.get(channelId)?.forEach(notify => notify());
}

function lastMessageOf(channel: Channel): Message | undefined {
    // MessageStore is fresher for a channel you are actually reading
    const open = MessageStore.getLastMessage(channel.id) as Message | undefined;
    if (open) return open;

    // this runs inside discord's own render for every row, so a throw here takes the
    // whole channel list down. degrade to no preview instead.
    try {
        const record = PreviewStore.message(channel.guild_id, channel.id);
        return record?.message ?? record ?? undefined;
    } catch (err) {
        logger.error("preview store lookup failed", err);
        return undefined;
    }
}

function useLastMessage(channel: Channel) {
    const channelId = channel.id;
    const [message, setMessage] = useState(() => lastMessageOf(channel));

    useEffect(() => {
        const update = () => setMessage(lastMessageOf(channel));
        update();

        let listeners = watchers.get(channelId);
        if (!listeners) watchers.set(channelId, listeners = new Set());
        listeners.add(update);

        return () => {
            listeners!.delete(update);
            if (listeners!.size === 0) watchers.delete(channelId);
        };
    }, [channelId]);

    return message;
}

/** GuildMemberStore is the only source that actually holds anything: preview records
 *  declare colorString and nick but leave both undefined. */
function roleColorOf(channel: Channel, authorId: string) {
    if (!settings.store.roleColors) return null;

    return (isPluginEnabled(roleColorEverywhere.name)
        ? roleColorEverywhere.getColorString(authorId, channel.id)
        : GuildMemberStore.getMember(channel.guild_id, authorId)?.colorString) ?? null;
}

/** mixed the same way RoleColorEverywhere mixes chat messages, against --text-muted
 *  since that is what a subtitle inherits. follows its messageSaturation setting so
 *  previews sit at whatever intensity the rest of the client does. */
function previewColor(channel: Channel, authorId: string) {
    const base = roleColorOf(channel, authorId);
    if (!base) return null;

    if (!isPluginEnabled(roleColorEverywhere.name)) return base;

    const saturation = Settings.plugins.RoleColorEverywhere?.messageSaturation ?? 30;
    if (saturation === 0) return null;
    if (saturation >= 100) return base;

    return `color-mix(in oklab, ${base} ${saturation}%, var(--text-muted))`;
}

/** wrapped because this renders inside discord's own channel row: an uncaught throw
 *  here is the "Discord crashed" screen, not a missing preview. */
const Preview = ErrorBoundary.wrap(function Preview({ channel }: { channel: Channel; }) {
    settings.use(["showAuthor", "roleColors", "iconSize"]);

    const message = useLastMessage(channel);
    if (!message) return null;

    const text = describe(message);
    if (!text) return null;

    // system messages and some preview records carry no author at all
    const { author } = message;

    // colour the whole line, not just the name. mentions and channel links set their
    // own colour, so they still render the way they do in chat.
    const color = author ? previewColor(channel, author.id) : null;
    const wrap = (body: React.ReactNode) => (
        <span
            className={classes(cl("preview"), cl("preview-" + settings.store.iconSize))}
            style={color ? { color } : undefined}
        >
            {body}
        </span>
    );

    if (!settings.store.showAuthor || !author) return wrap(text);

    const name = author.id === UserStore.getCurrentUser()?.id
        ? "You"
        : RelationshipStore.getNickname(author.id) || author.globalName || author.username;

    return wrap(<>{name}: {text}</>);
}, { noop: true });

/** One gateway op covers a whole guild, so this costs nothing like a REST fetch per channel would. */
function requestLastMessages(guildId: string | null | undefined) {
    if (!guildId) return;

    const channelIds = GuildChannelStore.getChannels(guildId)?.SELECTABLE?.map((entry: any) => entry.channel.id);
    if (!channelIds?.length) return;

    try {
        SocketModule.getSocket().requestLastMessages(guildId, channelIds);
    } catch (err) {
        // loud on purpose: a silent catch here hid this failing entirely
        logger.error("requestLastMessages failed", err);
    }
}

const requested = new Set<string>();
const pending = new Set<string>();

/** role colours come from GuildMemberStore, which only knows members it has loaded.
 *  for a channel you have never opened that is nobody, so the preview renders
 *  uncoloured until you click in. ask for the authors we are actually showing. */
function requestMissingMembers(guildId: string | null | undefined) {
    if (!guildId || !settings.store.roleColors) return;

    const channelIds = GuildChannelStore.getChannels(guildId)?.SELECTABLE?.map((entry: any) => entry.channel.id);
    if (!channelIds?.length) return;

    const userIds = new Set<string>();
    for (const channelId of channelIds) {
        let authorId: string | undefined;
        try {
            const record = PreviewStore.message(guildId, channelId);
            authorId = (record?.message ?? record)?.author?.id;
        } catch { continue; }

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

/** discord fires this for every batch of members it resolves while you scroll, and a
 *  blanket wake re-parses the markdown of every visible row each time. only the members
 *  we actually asked for can change a preview, so wake on those and ignore the rest. */
function onMembersChunk({ guildId, members }: any) {
    if (!pending.size || !members?.length) return;

    let arrived = false;
    for (const member of members) {
        const key = `${guildId}:${member.user?.id ?? member.userId}`;
        if (pending.delete(key)) arrived = true;
    }

    if (arrived) wakeAll();
}

function onChannelSelect({ guildId }: any) {
    requestLastMessages(guildId);
    requestMissingMembers(guildId);
}

export default definePlugin({
    name: "ChannelPeek",
    description: "Shows the most recent message under each server channel, the way MessagePeek does for DMs.",
    authors: [{ name: "heart_menace", id: 281162701303185408n }],
    tags: ["Appearance", "Chat"],
    settings,

    contextMenus: {
        "channel-context": channelContext
    },

    patches: [
        // the row already renders a second line when given a subtitle; discord just
        // never passes one for text channels. a destructuring default fills it in
        // without touching the row's markup.
        {
            find: "UNREAD_IMPORTANT:",
            replacement: {
                match: /(?<=,subtitle:)(\i)(?=,subtitleColor:)/,
                replace: "$1=$self.getSubtitle(arguments[0])"
            }
        },
        // the row's icon is a memo'd component; returning early from it swaps the #
        // without touching the row's layout
        {
            find: "UNREAD_IMPORTANT:",
            predicate: () => settings.store.channelIcons,
            replacement: {
                match: /(\.memo\(function\((\i)\)\{)(?=let\{className:\i,containerClassName:\i,channel:)/,
                replace: "$1const vcIcon=$self.renderChannelIcon($2);if(vcIcon!=null)return vcIcon;"
            }
        }
    ],

    start() {
        for (const event of MESSAGE_EVENTS) FluxDispatcher.subscribe(event, onMessageEvent);
        FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);
        // the members arriving is what makes an uncoloured preview colour itself
        FluxDispatcher.subscribe("GUILD_MEMBERS_CHUNK", onMembersChunk);

        const guildId = SelectedGuildStore.getGuildId();
        requestLastMessages(guildId);
        requestMissingMembers(guildId);
    },

    stop() {
        for (const event of MESSAGE_EVENTS) FluxDispatcher.unsubscribe(event, onMessageEvent);
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect);
        FluxDispatcher.unsubscribe("GUILD_MEMBERS_CHUNK", onMembersChunk);
        watchers.clear();
        requested.clear();
        pending.clear();
    },

    getSubtitle(props: { channel: Channel; }) {
        const { channel } = props;
        if (!channel) return undefined;
        if (channel.type !== ChannelType.GUILD_TEXT && channel.type !== ChannelType.GUILD_ANNOUNCEMENT) return undefined;
        if (settings.store.hideMuted && UserGuildSettingsStore.isChannelMuted(channel.guild_id, channel.id)) return undefined;
        // a channel that never had a message gets no second line. one that has keeps the
        // preview mounted while the content is still in flight, so the batch can wake it
        if (!channel.lastMessageId) return undefined;

        return <Preview channel={channel} />;
    },

    renderChannelIcon(props: { channel: Channel; containerClassName?: string; }) {
        const { channel } = props;
        if (!channel) return null;
        if (channel.type !== ChannelType.GUILD_TEXT && channel.type !== ChannelType.GUILD_ANNOUNCEMENT) return null;

        if (!resolveEmoji(channel)) return null;

        return <ChannelIcon channel={channel} containerClassName={props.containerClassName} />;
    }
});
